const express = require('express');
const path = require('path');
const { google } = require('googleapis');
const app = express();
app.use(express.json());

function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const SHEET_ID = process.env.SPREADSHEET_ID;

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/availability', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/roster', (req, res) => res.sendFile(path.join(__dirname, 'public', 'roster.html')));
app.get('/hours', (req, res) => res.sendFile(path.join(__dirname, 'public', 'hours.html')));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  res.json({ success: password === process.env.ADMIN_PASSWORD });
});

const RESIDENTS = ['Alex RedWhite', 'Raffo DJ', 'Sound Bogie'];
const ARKBAR_SLOTS = [
  '14:00–15:00','15:00–16:00','16:00–17:00','17:00–18:00',
  '18:00–19:00','20:00–21:00','21:00–22:00',
  '22:00–23:00','23:00–00:00','00:00–01:00','01:00–02:00'
];
const HIP_SLOTS = ['21:00–22:00','22:00–23:00','23:00–00:00','00:00–01:00'];
const MORNING_SLOTS = ['14:00–15:00','15:00–16:00','16:00–17:00','17:00–18:00','18:00–19:00'];
const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

const normalizeSlot = s => s ? s.replace(/[-\u2013\u2014]/g, '\u2013') : s;

// Convert sheet date format "1 Mar 2026" → "2026-03-01"
function parseDateKey(dateStr) {
  if (!dateStr) return null;
  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // Format: "1 Mar 2026" or "01 Mar 2026"
  const months = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,
                   Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
  const m = dateStr.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (m) {
    const day = String(m[1]).padStart(2,'0');
    const mon = String(months[m[2]] || 0).padStart(2,'0');
    return `${m[3]}-${mon}-${day}`;
  }
  return null;
}

app.get('/api/availability', async (req, res) => {
  try {
    const sheets = getSheets();
    const month = req.query.month; // e.g. "March 2026"

    let year, monthIdx, daysInMonth;
    if (month) {
      const parts = month.split(' ');
      monthIdx = MONTH_NAMES.indexOf(parts[0]);
      year = parseInt(parts[1]);
      daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
    }

    const [availRes, blackoutRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'DJ Availability_Datasheet!A2:F',
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Resident Blackouts!A2:E',
      }).catch(() => ({ data: { values: [] } }))
    ]);

    const rows = availRes.data.values || [];
    const blackoutRows = blackoutRes.data.values || [];

    // ── REGULAR DJ AVAILABILITY ───────────────────────────────────────────────
    // Sheet columns: timestamp(A), dj(B), month(C), date(D), day(E), slot(F)
    // Date in column D may be "1 Mar 2026" — convert to YYYY-MM-DD
    const filtered = month ? rows.filter(r => r[2] === month) : rows;
    const map = {}; // { "2026-03-01": { "21:00–22:00": ["Pick", ...] } }

    filtered.forEach(([timestamp, dj, monthLabel, dateRaw, day, slot]) => {
      if (!dateRaw || !slot || !dj) return;
      const dateKey = parseDateKey(dateRaw);
      if (!dateKey) return;
      const normSlot = normalizeSlot(slot);
      if (!map[dateKey]) map[dateKey] = {};
      if (!map[dateKey][normSlot]) map[dateKey][normSlot] = [];
      if (!map[dateKey][normSlot].includes(dj)) map[dateKey][normSlot].push(dj);
    });

    // ── RESIDENT BLACKOUTS ────────────────────────────────────────────────────
    // Blackout sheet: dj(A), date(B), month(C), timestamp(D), type(E)
    // date in column B is like "1 Mar 2026"
    const blackouts = {}; // { "Alex RedWhite": { "2026-03-01": "full"|"morning" } }
    RESIDENTS.forEach(r => { blackouts[r] = {}; });
    blackoutRows.forEach(([dj, dateRaw, monthLabel, timestamp, type]) => {
      if (!dj || !dateRaw) return;
      const m = monthLabel || month;
      if (month && m !== month) return;
      if (!blackouts[dj]) return;
      const dateKey = parseDateKey(dateRaw);
      if (dateKey) blackouts[dj][dateKey] = type || 'full';
    });

    // ── INJECT RESIDENTS ──────────────────────────────────────────────────────
    // Residents are available for ALL ARKbar slots unless blacked out.
    // They are NOT pre-injected into HIP slots.
    // HIP cells will still show residents for manual assignment — 
    // the client checks cross-venue conflicts at render time.
    if (month && year !== undefined && monthIdx >= 0) {
      for (let d = 1; d <= daysInMonth; d++) {
        const dateKey = `${year}-${String(monthIdx+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

        RESIDENTS.forEach(resident => {
          const blackoutType = blackouts[resident][dateKey];
          if (blackoutType === 'full') return; // fully blacked out

          if (!map[dateKey]) map[dateKey] = {};

          ARKBAR_SLOTS.forEach(slot => {
            if (blackoutType === 'morning' && MORNING_SLOTS.includes(slot)) return;
            const normSlot = normalizeSlot(slot);
            if (!map[dateKey][normSlot]) map[dateKey][normSlot] = [];
            if (!map[dateKey][normSlot].includes(resident)) {
              map[dateKey][normSlot].push(resident);
            }
          });
        });
      }
    }

    // ── INJECT GUEST DJ ──────────────────────────────────────────────────────
    // Guest DJ is always available for all slots at all venues
    if (month && year !== undefined && monthIdx >= 0) {
      for (let d = 1; d <= daysInMonth; d++) {
        const dateKey = `${year}-${String(monthIdx+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        if (!map[dateKey]) map[dateKey] = {};
        ARKBAR_SLOTS.forEach(slot => {
          const normSlot = normalizeSlot(slot);
          if (!map[dateKey][normSlot]) map[dateKey][normSlot] = [];
          if (!map[dateKey][normSlot].includes('Guest DJ')) {
            map[dateKey][normSlot].push('Guest DJ');
          }
        });
      }
    }

    // Return both the availability map and the blackout map
    // Client uses blackouts to show resident availability on HIP/Love cells
    res.json({ success: true, availability: map, blackouts });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/blackout', async (req, res) => {
  try {
    const { dj, month, dates } = req.body;
    if (!dj || !month || !Array.isArray(dates)) {
      return res.json({ success: false, error: 'Missing fields' });
    }
    const sheets = getSheets();
    const timestamp = new Date().toISOString();
    const rows = dates.map(({ date, type }) => [dj, date, month, timestamp, type || 'full']);

    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Resident Blackouts!A2:E',
    }).catch(() => ({ data: { values: [] } }));

    const existingRows = existing.data.values || [];
    const keepRows = existingRows.filter(r => !(r[0] === dj && r[2] === month));
    const newData = [...keepRows, ...rows];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: 'Resident Blackouts!A2',
      valueInputOption: 'RAW',
      requestBody: { values: newData.length > 0 ? newData : [['']] },
    });

    res.json({ success: true, saved: rows.length });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/djs', async (req, res) => {
  try {
    const sheets = getSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'DJ Rates!A2:B',
    });
    const rows = response.data.values || [];
    const djs = rows.map(([name, rate]) => ({ name, rate: parseInt(rate) || 0 }));
    res.json({ success: true, djs });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// GET roster — venue param: 'arkbar' | 'hip' | 'love'
app.get('/api/roster', async (req, res) => {
  try {
    const sheets = getSheets();
    const { venue, month } = req.query;
    const tabName = venue === 'love' ? 'Love Beach Roster'
                  : venue === 'hip'  ? 'HIP Roster'
                  : 'ARKbar Roster';
    let values = [];
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A:D`,
      });
      values = response.data.values || [];
    } catch (e) {}

    const filtered = values
      .filter(r => r[0] !== 'Date' && (!month || r[3] === month))
      .map(r => {
        if (r[1]) r[1] = normalizeSlot(r[1]);
        return r;
      })
      .filter(r => r[0] && r[2]);

    res.json({ success: true, roster: filtered });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// POST assign — single cell save
app.post('/api/roster/assign', async (req, res) => {
  try {
    const sheets = getSheets();
    const { venue, date, slot, dj, month } = req.body;
    const tabName = venue === 'love' ? 'Love Beach Roster'
                  : venue === 'hip'  ? 'HIP Roster'
                  : 'ARKbar Roster';

    let existingRows = [];
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A:D`,
      });
      existingRows = response.data.values || [];
    } catch(e) {}

    const normSlot = normalizeSlot(slot);
    const rowIndex = existingRows.findIndex(
      r => r[0] === date && normalizeSlot(r[1]) === normSlot && r[3] === month
    );

    if (rowIndex >= 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A${rowIndex + 1}:D${rowIndex + 1}`,
        valueInputOption: 'RAW',
        requestBody: { values: [dj ? [date, slot, dj, month] : ['', '', '', '']] },
      });
    } else if (dj) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A:D`,
        valueInputOption: 'RAW',
        requestBody: { values: [[date, slot, dj, month]] },
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// POST batch — auto-suggest save (ARKbar only)
app.post('/api/roster/batch', async (req, res) => {
  try {
    const sheets = getSheets();
    const { venue, month, assignments } = req.body;
    const tabName = venue === 'love' ? 'Love Beach Roster' : 'ARKbar Roster';
    // HIP is never batch-saved — it's manual only

    let existingRows = [];
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A:D`,
      });
      existingRows = response.data.values || [];
    } catch(e) {}

    const rowMap = {};
    existingRows.forEach((r, i) => {
      if (r[0] && r[1] && r[3] === month) rowMap[`${r[0]}|${normalizeSlot(r[1])}`] = i;
    });

    const updateData = [];
    const appendRows = [];

    for (const { date, slot, dj } of assignments) {
      const key = `${date}|${normalizeSlot(slot)}`;
      if (rowMap[key] !== undefined) {
        updateData.push({
          range: `${tabName}!A${rowMap[key] + 1}:D${rowMap[key] + 1}`,
          values: [[date, slot, dj, month]],
        });
      } else {
        appendRows.push([date, slot, dj, month]);
      }
    }

    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { valueInputOption: 'RAW', data: updateData },
      });
    }
    if (appendRows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A:D`,
        valueInputOption: 'RAW',
        requestBody: { values: appendRows },
      });
    }

    res.json({ success: true, updated: updateData.length, appended: appendRows.length });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// POST clear — clears a venue's roster for a month
app.post('/api/roster/clear', async (req, res) => {
  try {
    const sheets = getSheets();
    const { venue, month } = req.body;
    const tabName = venue === 'love' ? 'Love Beach Roster'
                  : venue === 'hip'  ? 'HIP Roster'
                  : 'ARKbar Roster';

    let existingRows = [];
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A:D`,
      });
      existingRows = response.data.values || [];
    } catch(e) {}

    // Keep header + rows from other months, discard current month
    const header = ['Date', 'Slot', 'DJ', 'Month'];
    const dataRows = existingRows.filter(r => r[0] && r[0] !== 'Date');
    const keepRows = dataRows.filter(r => (r[3] || '') !== month);
    const writeRows = [header, ...keepRows];

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A:D`,
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: writeRows },
    });

    res.json({ success: true, cleared: dataRows.length - keepRows.length });
  } catch (err) {
    console.error('Clear error:', err);
    res.json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
