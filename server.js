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
  const s = String(dateStr).trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // D Mon YYYY  e.g. "19 Mar 2026"
  const mDMY = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (mDMY) return `${mDMY[3]}-${pad2(SHORT_MONTHS[mDMY[2]] || 0)}-${pad2(mDMY[1])}`;
  // M/D/YYYY or MM/DD/YYYY  (Google Sheets en-US auto-format)
  const mMDY = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mMDY) return `${mMDY[3]}-${pad2(mMDY[1])}-${pad2(mMDY[2])}`;
  // YYYY/MM/DD
  const mYMD = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (mYMD) return `${mYMD[1]}-${mYMD[2]}-${mYMD[3]}`;
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

  const [availRes, portalRes, blackouts] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: 'DJ Availability_Datasheet!A2:F',
    }).catch(() => ({ data: { values: [] } })),
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: `${DJ_AVAIL_SHEET}!A2:E`,
    }).catch(() => ({ data: { values: [] } })),
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

  // Include portal submissions (DJ Availability sheet) — column layout: name, date, slot, month, status
  // status is 'available' for freelance DJs (who only save their available slots) and
  // 'unavailable' for residents (who save their blackout slots). Skip explicit unavailability;
  // treat a missing status column as available so old/manually-entered rows still appear.
  for (const [dj, dateRaw, slot, rowMonth, status] of (portalRes.data.values || [])) {
    if (!dj || !dateRaw || !slot || rowMonth !== month || status === 'unavailable') continue;
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

  // Auto-populate Davoted's fixed recurring monthly schedule
  if (year !== undefined && monthIdx >= 0) {
    const DAVOTED_ARKBAR_SLOTS = {
      1: ['14:00\u201315:00','15:00\u201316:00'],
      3: ['14:00\u201315:00','15:00\u201316:00','16:00\u201317:00'],
      4: ['14:00\u201315:00','15:00\u201316:00','20:00\u201321:00','21:00\u201322:00','22:00\u201323:00'],
      5: ['14:00\u201315:00','15:00\u201316:00','16:00\u201317:00'],
    };
    const DAVOTED_LOVE_SLOTS = {
      2: ['20:00\u201321:00','21:00\u201322:00','22:00\u201323:00'],
      3: ['20:00\u201321:00','21:00\u201322:00','22:00\u201323:00'],
    };
    for (let d = 1; d <= daysInMonth; d++) {
      const dk = makeDateKey(year, monthIdx + 1, d);
      const dow = new Date(year, monthIdx, d).getDay();
      const slots = [...(DAVOTED_ARKBAR_SLOTS[dow] || []), ...(DAVOTED_LOVE_SLOTS[dow] || [])];
      for (const slot of slots) {
        const ns = normalizeSlot(slot);
        (map[dk] ??= {})[ns] ??= [];
        if (!map[dk][ns].includes('Davoted')) map[dk][ns].push('Davoted');
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

/* == DJ PORTAL — NEW SHEETS / CONSTANTS =================================== */
const DJ_AVAIL_SHEET  = 'DJ Availability';
const FINALIZED_SHEET = 'Finalized Months';
const DJ_PINS_SHEET   = 'DJ PINs';

cache.finalized = { data: null, time: 0, ttl: 5 * 60 * 1000 };

async function fetchFinalized() {
  const c = cache.finalized;
  if (c.data !== null && (Date.now() - c.time) < c.ttl) return c.data;
  const sheets = getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: `${FINALIZED_SHEET}!A2:A`,
  }).catch(() => ({ data: { values: [] } }));
  const months = (response.data.values || []).map(r => r[0]).filter(Boolean);
  c.data = { months };
  c.time = Date.now();
  return c.data;
}

/* -- Static: DJ Portal ---------------------------------------------------- */
app.get('/dj', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dj.html')));

/* -- POST /api/dj/login --------------------------------------------------- */
app.post('/api/dj/login', async (req, res) => {
  try {
    const { name, pin } = req.body;
    if (!name || !pin) return res.json({ success: false, error: 'Name and PIN required' });
    const sheets = getSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: `${DJ_PINS_SHEET}!A2:B`,
    }).catch(() => ({ data: { values: [] } }));
    const rows = response.data.values || [];
    const match = rows.find(r =>
      r[0] && r[0].trim().toLowerCase() === name.trim().toLowerCase() &&
      r[1] && String(r[1]).trim() === String(pin).trim()
    );
    if (!match) return res.json({ success: false, error: 'Invalid name or PIN' });
    const djName = match[0].trim();
    const djData = await fetchDJs();
    const djInfo = (djData.djs || []).find(d => d.name.toLowerCase() === djName.toLowerCase());
    res.json({ success: true, name: djName, isResident: RESIDENTS.includes(djName), rate: djInfo ? djInfo.rate : 0 });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* -- GET /api/dj/availability/:name/:month --------------------------------- */
app.get('/api/dj/availability/:name/:month', async (req, res) => {
  try {
    const name  = decodeURIComponent(req.params.name);
    const month = decodeURIComponent(req.params.month);
    const isResident = RESIDENTS.includes(name);
    const isDavoted = name.trim().toLowerCase() === 'davoted';
    // Davoted's fixed weekly slots — keyed by day-of-week (0=Sun … 6=Sat)
    const DAVOTED_PORTAL = {
      1: new Set(['14:00\u201315:00','15:00\u201316:00']),
      2: new Set(['20:00\u201321:00','21:00\u201322:00','22:00\u201323:00']),
      3: new Set(['14:00\u201315:00','15:00\u201316:00','16:00\u201317:00','20:00\u201321:00','21:00\u201322:00','22:00\u201323:00']),
      4: new Set(['14:00\u201315:00','15:00\u201316:00','20:00\u201321:00','21:00\u201322:00','22:00\u201323:00']),
      5: new Set(['14:00\u201315:00','15:00\u201316:00','16:00\u201317:00']),
    };
    const finalized = await fetchFinalized();
    const isFinalized = finalized.months.includes(month);

    const sheets = getSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: `${DJ_AVAIL_SHEET}!A2:E`,
    }).catch(() => ({ data: { values: [] } }));

    const stored = {};
    for (const row of (response.data.values || [])) {
      if (!row[0] || row[0].trim().toLowerCase() !== name.trim().toLowerCase()) continue;
      if (row[3] !== month) continue;
      const dk = parseDateKey(row[1]);
      if (!dk || !row[2]) continue;
      const ns = normalizeSlot(row[2]);
      if (!stored[dk]) stored[dk] = {};
      stored[dk][ns] = row[4] || (isResident ? 'available' : 'unavailable');
    }

    const parts = month.split(' ');
    const monthIdx = MONTH_NAMES.indexOf(parts[0]);
    const year = parseInt(parts[1]);
    const availability = {};

    if (monthIdx >= 0 && !isNaN(year)) {
      const days = new Date(year, monthIdx + 1, 0).getDate();
      for (let d = 1; d <= days; d++) {
        const dk = makeDateKey(year, monthIdx + 1, d);
        const dow = new Date(year, monthIdx, d).getDay();
        const davotedToday = isDavoted ? (DAVOTED_PORTAL[dow] || new Set()) : null;
        availability[dk] = {};
        for (const slot of ALL_SLOTS) {
          const ns = normalizeSlot(slot);
          const defaultStatus = isResident ? 'available'
            : (davotedToday && davotedToday.has(ns)) ? 'available'
            : 'unavailable';
          availability[dk][ns] = (stored[dk] && stored[dk][ns] !== undefined)
            ? stored[dk][ns]
            : defaultStatus;
        }
      }
    }

    res.json({ success: true, availability, isFinalized, isResident });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* -- POST /api/dj/availability -------------------------------------------- */
app.post('/api/dj/availability', async (req, res) => {
  try {
    const { name, month, slots } = req.body;
    if (!name || !month || !Array.isArray(slots)) return res.json({ success: false, error: 'Missing fields' });
    const finalized = await fetchFinalized();
    if (finalized.months.includes(month)) return res.json({ success: false, error: 'This month is finalized and cannot be edited' });

    const sheets = getSheets();
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: `${DJ_AVAIL_SHEET}!A2:E`,
    }).catch(() => ({ data: { values: [] } }));

    const keepRows = (existing.data.values || []).filter(r =>
      !(r[0] && r[0].trim().toLowerCase() === name.trim().toLowerCase() && r[3] === month)
    );
    const newRows = slots.map(({ date, slot, status }) => [name, date, slot, month, status]);
    const allRows = [...keepRows, ...newRows];

    await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `${DJ_AVAIL_SHEET}!A2:E` });
    if (allRows.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID, range: `${DJ_AVAIL_SHEET}!A2`,
        valueInputOption: 'RAW', requestBody: { values: allRows },
      });
    }
    cache.availability.delete(month);
    res.json({ success: true, saved: newRows.length });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* -- GET /api/dj/schedule/:name/:month ------------------------------------ */
app.get('/api/dj/schedule/:name/:month', async (req, res) => {
  try {
    const name  = decodeURIComponent(req.params.name);
    const month = decodeURIComponent(req.params.month);
    const [arkData, hipData, loveData] = await Promise.all([
      fetchRoster('arkbar', month),
      fetchRoster('hip',    month),
      fetchRoster('love',   month),
    ]);
    const schedule = [];
    for (const { venue, data } of [{ venue: 'ARKbar', data: arkData }, { venue: 'HIP', data: hipData }, { venue: 'Love Beach', data: loveData }]) {
      for (const row of (data.roster || [])) {
        if (row[2] && row[2].trim().toLowerCase() === name.trim().toLowerCase()) {
          schedule.push({ venue, date: row[0], slot: normalizeSlot(row[1]) });
        }
      }
    }
    schedule.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.slot < b.slot ? -1 : 1);
    res.json({ success: true, schedule });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* -- GET /api/finalized --------------------------------------------------- */
app.get('/api/finalized', async (req, res) => {
  try {
    const finalized = await fetchFinalized();
    const month = req.query.month;
    res.json({ success: true, finalized: finalized.months, isFinalized: month ? finalized.months.includes(month) : false });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* -- POST /api/roster/finalize -------------------------------------------- */
app.post('/api/roster/finalize', async (req, res) => {
  try {
    const { month, password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.json({ success: false, error: 'Unauthorized' });
    if (!month) return res.json({ success: false, error: 'Month required' });

    const finalized = await fetchFinalized();
    if (finalized.months.includes(month)) return res.json({ success: false, error: `${month} is already finalized` });

    const [arkData, hipData, loveData, djData] = await Promise.all([
      fetchRoster('arkbar', month), fetchRoster('hip', month),
      fetchRoster('love', month),   fetchDJs(),
    ]);

    const djMap = {};
    (djData.djs || []).forEach(d => { djMap[d.name.toLowerCase()] = d; });

    const hours = {};
    for (const { key, data } of [{ key: 'arkbar', data: arkData }, { key: 'hip', data: hipData }, { key: 'love', data: loveData }]) {
      for (const row of (data.roster || [])) {
        const dj = row[2];
        if (!dj || dj === 'Guest DJ') continue;
        if (!hours[dj]) hours[dj] = { arkbar: 0, hip: 0, love: 0, total: 0 };
        hours[dj][key]++;
        hours[dj].total++;
      }
    }

    const report = [];
    let grandTotal = 0, grandCost = 0;
    Object.keys(hours).sort().forEach(djName => {
      const h = hours[djName];
      const info = djMap[djName.toLowerCase()];
      const rate = info ? info.rate : 0;
      const cost = h.total * rate;
      grandTotal += h.total; grandCost += cost;
      report.push({ name: djName, arkbar: h.arkbar, hip: h.hip, love: h.love, total: h.total, rate, cost });
    });

    const sheets = getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: `${FINALIZED_SHEET}!A:C`,
      valueInputOption: 'RAW',
      requestBody: { values: [[month, new Date().toISOString(), grandCost]] },
    }).catch(err => console.error('Finalized Months write:', err.message));

    cache.finalized.data = null;
    res.json({ success: true, month, report, grandTotal, grandCost });
  } catch (err) {
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
