const express = require('express');
const path = require('path');
const { google } = require('googleapis');
const app = express();
app.use(express.json());

/* == GOOGLE SHEETS AUTH (cached singleton) ================================ */
let _sheets = null;
function getSheets() {
  if (_sheets) return _sheets;
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

const SHEET_ID = process.env.SPREADSHEET_ID;
const RESIDENTS = ['Alex RedWhite', 'Raffo DJ', 'Sound Bogie'];
const ALL_SLOTS = [
  '14:00\u201315:00','15:00\u201316:00','16:00\u201317:00','17:00\u201318:00',
  '18:00\u201319:00','20:00\u201321:00','21:00\u201322:00',
  '22:00\u201323:00','23:00\u201300:00','00:00\u201301:00','01:00\u201302:00'
];
const MORNING_SLOTS = new Set([
  '14:00\u201315:00','15:00\u201316:00','16:00\u201317:00','17:00\u201318:00','18:00\u201319:00'
]);
const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const SHORT_MONTHS = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};

const normalizeSlot = s => s ? s.replace(/[-\u2013\u2014]/g, '\u2013') : s;
const pad2 = n => String(n).padStart(2, '0');
const makeDateKey = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

function parseDateKey(dateStr) {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const m = dateStr.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (m) return `${m[3]}-${pad2(SHORT_MONTHS[m[2]] || 0)}-${pad2(m[1])}`;
  return null;
}

function tabName(venue) {
  return venue === 'love' ? 'Love Beach Roster'
       : venue === 'hip'  ? 'HIP Roster'
       : 'ARKbar Roster';
}

/* == CACHE LAYER ========================================================== */
/*
 * TTLs tuned by data volatility:
 *   DJ list:      10min  (almost never changes)
 *   Availability: 3min   (changes when DJs submit form)
 *   Roster:       write-through (no TTL, invalidated on assign/batch/clear)
 *   Blackouts:    3min   (changes infrequently)
 *
 * On a typical roster editing session the user loads once (cold),
 * then every subsequent month-switch or tab-switch serves from cache.
 * Only writes (assign, batch, clear) bust the relevant roster entry.
 */

const cache = {
  djs:          { data: null, time: 0, ttl: 10 * 60 * 1000 },
  availability: new Map(),
  roster:       new Map(),
  blackouts:    { data: null, time: 0, ttl: 3 * 60 * 1000, month: null },
};

const AVAIL_TTL = 3 * 60 * 1000;

function isFresh(entry) {
  return entry.data !== null && (Date.now() - entry.time) < entry.ttl;
}

function invalidateRoster(venue, month) {
  cache.roster.delete(`${venue}|${month}`);
}

function invalidateAllRosters(month) {
  for (const key of cache.roster.keys()) {
    if (key.endsWith(`|${month}`)) cache.roster.delete(key);
  }
}

/* == CACHED FETCHERS ====================================================== */

async function fetchDJs() {
  if (isFresh(cache.djs)) return cache.djs.data;
  const sheets = getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: 'DJ Rates!A2:B',
  });
  const djs = (response.data.values || []).map(([name, rate]) => ({
    name, rate: parseInt(rate) || 0
  }));
  const result = { success: true, djs };
  cache.djs.data = result;
  cache.djs.time = Date.now();
  return result;
}

async function fetchBlackouts(month) {
  if (isFresh(cache.blackouts) && cache.blackouts.month === month) {
    return cache.blackouts.data;
  }
  const sheets = getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: 'Resident Blackouts!A2:E',
  }).catch(() => ({ data: { values: [] } }));

  const blackouts = {};
  RESIDENTS.forEach(r => { blackouts[r] = {}; });
  for (const [dj, dateRaw, monthLabel, , type] of (response.data.values || [])) {
    if (!dj || !dateRaw || !blackouts[dj]) continue;
    if (month && monthLabel !== month) continue;
    const dk = parseDateKey(dateRaw);
    if (dk) blackouts[dj][dk] = type || 'full';
  }

  cache.blackouts.data = blackouts;
  cache.blackouts.month = month;
  cache.blackouts.time = Date.now();
  return blackouts;
}

async function fetchAvailability(month) {
  const cached = cache.availability.get(month);
  if (cached && (Date.now() - cached.time) < AVAIL_TTL) {
    return cached.data;
  }

  const sheets = getSheets();
  const parts = month.split(' ');
  const monthIdx = MONTH_NAMES.indexOf(parts[0]);
  const year = parseInt(parts[1]);
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();

  const [availRes, blackouts] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: 'DJ Availability_Datasheet!A2:F',
    }),
    fetchBlackouts(month),
  ]);

  const filtered = (availRes.data.values || []).filter(r => r[2] === month);
  const map = {};
  for (const [, dj, , dateRaw, , slot] of filtered) {
    if (!dateRaw || !slot || !dj) continue;
    const dk = parseDateKey(dateRaw);
    if (!dk) continue;
    const ns = normalizeSlot(slot);
    (map[dk] ??= {})[ns] ??= [];
    if (!map[dk][ns].includes(dj)) map[dk][ns].push(dj);
  }

  if (year !== undefined && monthIdx >= 0) {
    for (let d = 1; d <= daysInMonth; d++) {
      const dk = makeDateKey(year, monthIdx + 1, d);
      if (!map[dk]) map[dk] = {};
      for (const slot of ALL_SLOTS) {
        const ns = normalizeSlot(slot);
        if (!map[dk][ns]) map[dk][ns] = [];
        const arr = map[dk][ns];
        for (const resident of RESIDENTS) {
          const bo = blackouts[resident][dk];
          if (bo === 'full') continue;
          if (bo === 'morning' && MORNING_SLOTS.has(slot)) continue;
          if (!arr.includes(resident)) arr.push(resident);
        }
        if (!arr.includes('Guest DJ')) arr.push('Guest DJ');
      }
    }
  }

  const result = { success: true, availability: map, blackouts };
  cache.availability.set(month, { data: result, time: Date.now() });
  return result;
}

async function fetchRoster(venue, month) {
  const key = `${venue}|${month}`;
  const cached = cache.roster.get(key);
  if (cached) return cached;

  const sheets = getSheets();
  let values = [];
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: `${tabName(venue)}!A:D`,
    });
    values = response.data.values || [];
  } catch (e) {}

  const filtered = values
    .filter(r => r[0] !== 'Date' && (!month || r[3] === month) && r[0] && r[2])
    .map(r => { if (r[1]) r[1] = normalizeSlot(r[1]); return r; });

  const result = { success: true, roster: filtered };
  cache.roster.set(key, result);
  return result;
}

/* == STATIC FILES ========================================================= */
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/availability', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/roster', (req, res) => res.sendFile(path.join(__dirname, 'public', 'roster.html')));

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  index: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

/* == AUTH ================================================================== */
app.post('/api/auth', (req, res) => {
  res.json({ success: req.body.password === process.env.ADMIN_PASSWORD });
});

/* == API ROUTES =========================================================== */

app.get('/api/djs', async (req, res) => {
  try { res.json(await fetchDJs()); }
  catch (err) { res.json({ success: false, error: err.message }); }
});

app.get('/api/availability', async (req, res) => {
  try {
    const month = req.query.month;
    if (!month) return res.json({ success: false, error: 'month required' });
    res.json(await fetchAvailability(month));
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/roster', async (req, res) => {
  try {
    const { venue, month } = req.query;
    res.json(await fetchRoster(venue, month));
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* == BLACKOUT SUBMISSION ================================================== */
app.post('/api/blackout', async (req, res) => {
  try {
    const { dj, month, dates } = req.body;
    if (!dj || !month || !Array.isArray(dates)) return res.json({ success: false, error: 'Missing fields' });
    const sheets = getSheets();
    const timestamp = new Date().toISOString();
    const newRows = dates.map(({ date, type }) => [dj, date, month, timestamp, type || 'full']);
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: 'Resident Blackouts!A2:E',
    }).catch(() => ({ data: { values: [] } }));
    const keepRows = (existing.data.values || []).filter(r => !(r[0] === dj && r[2] === month));
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: 'Resident Blackouts!A2',
      valueInputOption: 'RAW',
      requestBody: { values: [...keepRows, ...newRows].length > 0 ? [...keepRows, ...newRows] : [['']] },
    });
    // Invalidate
    cache.blackouts.data = null;
    cache.availability.delete(month);
    res.json({ success: true, saved: newRows.length });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});

/* == ASSIGN SINGLE CELL =================================================== */
app.post('/api/roster/assign', async (req, res) => {
  try {
    const sheets = getSheets();
    const { venue, date, slot, dj, month } = req.body;
    const tab = tabName(venue);
    let existingRows = [];
    try {
      existingRows = (await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID, range: `${tab}!A:D`,
      })).data.values || [];
    } catch(e) {}
    const normSlot = normalizeSlot(slot);
    const rowIndex = existingRows.findIndex(r => r[0] === date && normalizeSlot(r[1]) === normSlot && r[3] === month);
    if (rowIndex >= 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${tab}!A${rowIndex + 1}:D${rowIndex + 1}`,
        valueInputOption: 'RAW',
        requestBody: { values: [dj ? [date, slot, dj, month] : ['', '', '', '']] },
      });
    } else if (dj) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID, range: `${tab}!A:D`,
        valueInputOption: 'RAW',
        requestBody: { values: [[date, slot, dj, month]] },
      });
    }
    invalidateRoster(venue, month);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* == BATCH ASSIGN ========================================================= */
app.post('/api/roster/batch', async (req, res) => {
  try {
    const sheets = getSheets();
    const { venue, month, assignments } = req.body;
    const tab = tabName(venue);
    let existingRows = [];
    try {
      existingRows = (await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID, range: `${tab}!A:D`,
      })).data.values || [];
    } catch(e) {}
    const rowMap = {};
    existingRows.forEach((r, i) => {
      if (r[0] && r[1] && r[3] === month) rowMap[`${r[0]}|${normalizeSlot(r[1])}`] = i;
    });
    const updateData = [], appendRows = [];
    for (const { date, slot, dj } of assignments) {
      const key = `${date}|${normalizeSlot(slot)}`;
      if (rowMap[key] !== undefined) {
        updateData.push({ range: `${tab}!A${rowMap[key] + 1}:D${rowMap[key] + 1}`, values: [[date, slot, dj, month]] });
      } else {
        appendRows.push([date, slot, dj, month]);
      }
    }
    const promises = [];
    if (updateData.length) promises.push(sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID, requestBody: { valueInputOption: 'RAW', data: updateData },
    }));
    if (appendRows.length) promises.push(sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: `${tab}!A:D`,
      valueInputOption: 'RAW', requestBody: { values: appendRows },
    }));
    await Promise.all(promises);
    invalidateRoster(venue, month);
    res.json({ success: true, updated: updateData.length, appended: appendRows.length });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* == CLEAR ROSTER ========================================================= */
app.post('/api/roster/clear', async (req, res) => {
  try {
    const sheets = getSheets();
    const { venue, month } = req.body;
    const tab = tabName(venue);
    let existingRows = [];
    try {
      existingRows = (await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID, range: `${tab}!A:D`,
      })).data.values || [];
    } catch(e) {}
    const header = ['Date', 'Slot', 'DJ', 'Month'];
    const dataRows = existingRows.filter(r => r[0] && r[0] !== 'Date');
    const keepRows = dataRows.filter(r => (r[3] || '') !== month);
    await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `${tab}!A:D` });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: `${tab}!A1`,
      valueInputOption: 'RAW', requestBody: { values: [header, ...keepRows] },
    });
    invalidateAllRosters(month);
    res.json({ success: true, cleared: dataRows.length - keepRows.length });
  } catch (err) {
    console.error('Clear error:', err);
    res.json({ success: false, error: err.message });
  }
});

/* == CACHE STATUS (debug) ================================================= */
app.get('/api/cache-status', (req, res) => {
  const age = entry => entry.data ? Math.round((Date.now() - entry.time) / 1000) + 's' : null;
  res.json({
    djs: { cached: !!cache.djs.data, age: age(cache.djs) },
    blackouts: { cached: !!cache.blackouts.data, age: age(cache.blackouts) },
    availability: [...cache.availability.keys()].map(k => ({
      month: k, age: Math.round((Date.now() - cache.availability.get(k).time) / 1000) + 's'
    })),
    roster: [...cache.roster.keys()],
  });
});

/* == START ================================================================= */
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
