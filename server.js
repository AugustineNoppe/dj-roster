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

// ARKbar slots — 19:00–20:00 removed (dead slot)
const ARKBAR_SLOTS = [
  '14:00–15:00','15:00–16:00','16:00–17:00','17:00–18:00',
  '18:00–19:00','20:00–21:00','21:00–22:00',
  '22:00–23:00','23:00–00:00','00:00–01:00','01:00–02:00'
];

// HIP slots — residents NEVER go here
const HIP_SLOTS = ['21:00–22:00','22:00–23:00','23:00–00:00','00:00–01:00'];

const normalizeSlot = s => s ? s.replace(/[-\u2013\u2014]/g, '\u2013') : s;

const MORNING_SLOTS = ['14:00–15:00','15:00–16:00','16:00–17:00','17:00–18:00','18:00–19:00'];

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

// Server-side guard: block residents from being saved into HIP slots.
// 'type' is passed explicitly from the client ('arkbar' | 'hip' | 'love').
function isIllegalAssignment(slot, dj, type) {
  if (!dj || !RESIDENTS.includes(dj)) return false;
  const isHip = type === 'hip' || (!type && HIP_SLOTS.map(normalizeSlot).includes(normalizeSlot(slot)));
  return isHip;
}

app.get('/api/availability', async (req, res) => {
  try {
    const sheets = getSheets();
    const month = req.query.month;

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
    // Plain slot keys — exactly as stored in the sheet. No prefixing.
    // Regular DJs appear in both ARKbar and HIP dropdowns for overlapping slots.
    // The client-side NO_HIP filter removes residents from HIP dropdowns.
    const filtered = month ? rows.filter(r => r[2] === month) : rows;
    const map = {};

    filtered.forEach(([timestamp, dj, monthLabel, date, day, slot]) => {
      if (!date || !slot) return;
      if (!map[date]) map[date] = {};
      if (!map[date][slot]) map[date][slot] = [];
      if (!map[date][slot].includes(dj)) map[date][slot].push(dj);
    });

    // ── RESIDENT AVAILABILITY ─────────────────────────────────────────────────
    // Residents are injected into ALL ARKbar slots (14:00–02:00).
    // They are NOT injected into HIP_SLOTS — client NO_HIP filter is the
    // first line of defence, server isIllegalAssignment is the hard block.
    const blackouts = {};
    RESIDENTS.forEach(r => { blackouts[r] = {}; });
    blackoutRows.forEach(([dj, date, monthLabel, timestamp, type]) => {
      if (!dj || !date) return;
      const m = monthLabel || month;
      if (month && m !== month) return;
      if (blackouts[dj]) blackouts[dj][date] = type || 'full';
    });

    if (month && year !== undefined && monthIdx >= 0) {
      for (let d = 1; d <= daysInMonth; d++) {
        const dateKey = `${year}-${String(monthIdx+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const blackoutLabel = `${d} ${MONTH_NAMES[monthIdx].slice(0,3)} ${year}`;

        RESIDENTS.forEach(resident => {
          const blackoutType = blackouts[resident][blackoutLabel];
          if (blackoutType === 'full') return;
          if (!map[dateKey]) map[dateKey] = {};

          ARKBAR_SLOTS.forEach(slot => {
            if (blackoutType === 'morning' && MORNING_SLOTS.includes(slot)) return;
            // Only inject resident into this slot if it's NOT a HIP slot
            // (HIP_SLOTS overlap with ARKbar — injecting residents there causes bleed)
            if (HIP_SLOTS.includes(slot)) return;
            if (!map[dateKey][slot]) map[dateKey][slot] = [];
            if (!map[dateKey][slot].includes(resident)) {
              map[dateKey][slot].push(resident);
            }
          });
        });
      }
    }

    res.json({ success: true, availability: map });
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

app.get('/api/roster', async (req, res) => {
  try {
    const sheets = getSheets();
    const { venue, month } = req.query;
    const tabName = venue === 'love' ? 'Love Beach Roster' : 'ARKbar Roster';
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
        if (r[1]) r[1] = r[1].replace(/\u2013/g, '-').replace(/-/g, '\u2013');
        return r;
      })
      .filter(r => r[0] && r[2]);
    res.json({ success: true, roster: filtered });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/roster/assign', async (req, res) => {
  try {
    const sheets = getSheets();
    const { venue, date, slot, dj, month, type } = req.body;

    if (isIllegalAssignment(slot, dj, type)) {
      return res.json({ success: false, error: `${dj} cannot be assigned to HIP slot ${slot}` });
    }

    const tabName = venue === 'love' ? 'Love Beach Roster' : 'ARKbar Roster';

    let existingRows = [];
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A:D`,
      });
      existingRows = response.data.values || [];
    } catch(e) {}

    const normSlot = normalizeSlot(slot);
    const rowIndex = existingRows.findIndex(r => r[0] === date && normalizeSlot(r[1]) === normSlot && r[3] === month);

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

app.post('/api/roster/batch', async (req, res) => {
  try {
    const sheets = getSheets();
    const { venue, month, assignments } = req.body;

    // Hard block: strip any resident→HIP assignments before saving
    const safeAssignments = assignments.filter(({ slot, dj, type }) => !isIllegalAssignment(slot, dj, type));
    const blocked = assignments.length - safeAssignments.length;
    if (blocked > 0) console.warn(`Blocked ${blocked} illegal resident→HIP assignments`);

    const tabName = venue === 'love' ? 'Love Beach Roster' : 'ARKbar Roster';

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

    for (const { date, slot, dj } of safeAssignments) {
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

app.post('/api/roster/clear', async (req, res) => {
  try {
    const sheets = getSheets();
    const { venue, month } = req.body;
    const tabName = venue === 'love' ? 'Love Beach Roster' : 'ARKbar Roster';

    let existingRows = [];
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A:D`,
      });
      existingRows = response.data.values || [];
    } catch(e) {}

    const clearData = [];
    existingRows.forEach((r, i) => {
      if ((r[3] || '') === month) {
        clearData.push({
          range: `${tabName}!A${i + 1}:D${i + 1}`,
          values: [['', '', '', '']],
        });
      }
    });

    if (clearData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { valueInputOption: 'RAW', data: clearData },
      });
    }

    res.json({ success: true, cleared: clearData.length });
  } catch (err) {
    console.error('Clear error:', err);
    res.json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
