const express = require('express');
const path = require('path');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const app = express();

/* == SECURITY HEADERS (helmet-equivalent) ================================= */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

/* == CORS ================================================================== */
const ALLOWED_ORIGINS = new Set([
  'https://djroster.ark-bar.com',
  'http://localhost:8080',
]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    if (ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password, x-dj-pin');
      res.setHeader('Vary', 'Origin');
    } else {
      return res.status(403).json({ success: false, error: 'Origin not allowed' });
    }
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* == RATE LIMITER ========================================================== */
// Simple in-memory sliding-window counter — 10 requests per IP per 60 s.
const _rateCounts = new Map(); // ip -> [timestamp, ...]
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 10;
function rateLimiter(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const hits = (_rateCounts.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    return res.status(429).json({ success: false, error: 'Too many attempts, please try again later.' });
  }
  hits.push(now);
  _rateCounts.set(ip, hits);
  next();
}

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
// DJs with server-injected fixed schedules who are not residents.
// Their blackout entries must also be tracked so a blackout can suppress a fixed slot.
const FIXED_SCHEDULE_DJS = ['Davoted'];
const ALL_SLOTS = [
  '14:00\u201315:00','15:00\u201316:00','16:00\u201317:00','17:00\u201318:00',
  '18:00\u201319:00','19:00\u201320:00','20:00\u201321:00','21:00\u201322:00',
  '22:00\u201323:00','23:00\u201300:00','00:00\u201301:00','01:00\u201302:00'
];
const MORNING_SLOTS = new Set([
  '14:00\u201315:00','15:00\u201316:00','16:00\u201317:00','17:00\u201318:00','18:00\u201319:00'
]);
const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const SHORT_MONTHS = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
const DJ_SIGNOFFS_SHEET = 'DJ Signoffs';

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

/* == FIXED DJ SCHEDULES =================================================== */
// Single source of truth for DJs with server-injected recurring weekly schedules.
// Keys are day-of-week (0=Sun … 6=Sat). Add new fixed-schedule DJs here for Phase 2.
const FIXED_SCHEDULES = {
  'Davoted': {
    arkbar: {
      1: ['14:00\u201315:00','15:00\u201316:00'],
      3: ['14:00\u201315:00','15:00\u201316:00','16:00\u201317:00'],
      4: ['14:00\u201315:00','15:00\u201316:00','20:00\u201321:00','21:00\u201322:00','22:00\u201323:00'],
      5: ['14:00\u201315:00','15:00\u201316:00','16:00\u201317:00'],
    },
    loveBeach: {
      2: ['20:00\u201321:00','21:00\u201322:00','22:00\u201323:00'],
      3: ['20:00\u201321:00','21:00\u201322:00','22:00\u201323:00'],
    },
  },
};

/* == FIXED AVAILABILITY (Phase 2 pre-load) ================================= */
// Per-DJ availability patterns for non-resident DJs that get pre-loaded on first view.
// These do NOT auto-submit — the DJ must still confirm, keeping the amber state on roster.
const FIXED_AVAILABILITY = {
  Vozka: {
    availableDays: [1, 2, 5], // Mon, Tue, Fri
    availableSlots: ['21:00\u201322:00', '22:00\u201323:00', '23:00\u201300:00', '00:00\u201301:00'],
    allSlotsOnAvailableDays: false
  },
  Tobi: {
    availableDays: [4], // Thu
    availableSlots: ['21:00\u201322:00', '22:00\u201323:00', '23:00\u201300:00', '00:00\u201301:00'],
    allSlotsOnAvailableDays: false
  },
  Buba: {
    unavailableDays: [0, 1], // Sun, Mon — all slots
    allSlotsOnUnavailableDays: true
  },
  Sky: {
    availableDays: [3, 5], // Wed, Fri — all slots available
    allSlotsOnAvailableDays: true
  },
  Donsine: {
    availableDays: [4, 5, 6, 0], // Thu, Fri, Sat, Sun
    allSlotsOnAvailableDays: true
  },
  Mostyx: {
    defaultStatus: 'available',
    unavailableSlotsByDay: {
      4: ['14:00\u201315:00', '15:00\u201316:00', '16:00\u201317:00'], // Thu
      6: ['15:00\u201316:00', '16:00\u201317:00', '17:00\u201318:00']  // Sat
    }
  }
};
const ALL_ARKBAR_SLOTS = [
  '14:00\u201315:00', '15:00\u201316:00', '16:00\u201317:00', '17:00\u201318:00',
  '18:00\u201319:00', '19:00\u201320:00', '20:00\u201321:00', '21:00\u201322:00',
  '22:00\u201323:00', '23:00\u201300:00', '00:00\u201301:00', '01:00\u201302:00'
];

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

// Per-venue mutex: serialises concurrent batch-assign requests for the same venue.
const _batchLocks = new Map();
function withVenueLock(venue, fn) {
  const prev = _batchLocks.get(venue) || Promise.resolve();
  let unlock;
  const next = new Promise(r => { unlock = r; });
  _batchLocks.set(venue, next);
  return prev.then(fn).finally(unlock);
}

function invalidateAllRosters(month) {
  for (const key of cache.roster.keys()) {
    if (key.endsWith(`|${month}`)) cache.roster.delete(key);
  }
}

/* == CACHED FETCHERS ====================================================== */

async function fetchDJs() {
  if (isFresh(cache.djs)) return cache.djs.data;
  const { data: ratesData, error: ratesError } = await supabase
    .from('dj_rates')
    .select('name, rate');
  if (ratesError) throw new Error(ratesError.message);
  const djs = (ratesData || []).map(({ name, rate }) => ({
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
  FIXED_SCHEDULE_DJS.forEach(dj => { blackouts[dj] = {}; });
  for (const [dj, dateRaw, monthLabel, , type] of (response.data.values || [])) {
    if (!dj || !dateRaw) continue;
    if (!blackouts[dj]) blackouts[dj] = {}; // handle any DJ present in the sheet
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

  const [availRes, portalRows, blackouts] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: 'DJ Availability_Datasheet!A2:F',
    }).catch(() => ({ data: { values: [] } })),
    supabase.from('dj_availability').select('*').eq('month', month).then(({ data }) => data || []),
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

  // Build slot-specific unavailability map for residents from DJ Availability portal submissions.
  // Residents submit 'unavailable' for slots they cannot do; these must override the default
  // "residents are always available" assumption in the loop below.
  const residentSlotBlocked = {}; // { djName: { dateKey: Set<normalizedSlot> } }
  for (const { name: dj, date: dateRaw, slot, month: rowMonth, status } of portalRows) {
    if (!dj || !dateRaw || !slot || rowMonth !== month || status !== 'unavailable') continue;
    if (!RESIDENTS.includes(dj)) continue;
    const dk = parseDateKey(dateRaw);
    if (!dk) continue;
    ((residentSlotBlocked[dj] ??= {})[dk] ??= new Set()).add(normalizeSlot(slot));
  }

  // Include portal submissions (dj_availability table) — columns: name, date, slot, month, status
  // status is 'available' for freelance DJs (who only save their available slots) and
  // 'unavailable' for residents (who save their blackout slots). Skip explicit unavailability;
  // treat a missing status column as available so old/manually-entered rows still appear.
  for (const { name: dj, date: dateRaw, slot, month: rowMonth, status } of portalRows) {
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
          if (residentSlotBlocked[resident]?.[dk]?.has(ns)) continue;
          if (!arr.includes(resident)) arr.push(resident);
        }
        if (!arr.includes('Guest DJ')) arr.push('Guest DJ');
      }
    }
  }

  // Auto-populate fixed recurring monthly schedules from FIXED_SCHEDULES.
  if (year !== undefined && monthIdx >= 0) {
    for (const [djName, sched] of Object.entries(FIXED_SCHEDULES)) {
      for (let d = 1; d <= daysInMonth; d++) {
        const dk = makeDateKey(year, monthIdx + 1, d);
        const dow = new Date(year, monthIdx, d).getDay();
        const djBo = blackouts[djName]?.[dk];
        if (djBo === 'full') continue;
        const slots = [...(sched.arkbar[dow] || []), ...(sched.loveBeach[dow] || [])];
        for (const slot of slots) {
          if (djBo === 'morning' && MORNING_SLOTS.has(slot)) continue;
          const ns = normalizeSlot(slot);
          (map[dk] ??= {})[ns] ??= [];
          if (!map[dk][ns].includes(djName)) map[dk][ns].push(djName);
        }
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
app.post('/api/auth', rateLimiter, (req, res) => {
  res.json({ success: req.body.password === process.env.ADMIN_PASSWORD });
});

/* -- Reusable auth middleware ---------------------------------------------- */
function requireAdmin(req, res, next) {
  if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Unauthorised' });
  }
  next();
}

async function requireDJAuth(req, res, next) {
  const name = req.body.name || req.body.dj;
  const pin = req.headers['x-dj-pin'];
  if (!name || !pin) return res.status(401).json({ success: false, error: 'Unauthorised' });
  try {
    const { data: pinData } = await supabase
      .from('dj_pins')
      .select('pin')
      .ilike('name', name.trim())
      .single();
    const correctPin = pinData ? pinData.pin : null;
    if (!correctPin || String(correctPin).trim() !== String(pin).trim()) {
      return res.status(401).json({ success: false, error: 'Unauthorised' });
    }
    next();
  } catch (err) {
    res.status(500).json({ success: false, error: 'Auth error' });
  }
}

/* == CONFIG ================================================================ */
app.get('/api/config', (req, res) => {
  res.json({ success: true, residents: RESIDENTS });
});

app.get('/api/fixed-schedules', (req, res) => {
  res.json({ success: true, schedules: FIXED_SCHEDULES });
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
app.post('/api/blackout', requireDJAuth, async (req, res) => {
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
app.post('/api/roster/assign', requireAdmin, async (req, res) => {
  try {
    const sheets = getSheets();
    const { venue, date, slot, dj, month } = req.body;
    const tab = tabName(venue);
    let existingRows = [];
    try {
      existingRows = (await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID, range: `${tab}!A2:D`,
      })).data.values || [];
    } catch(e) {}
    const normSlot = normalizeSlot(slot);
    const rowIndex = existingRows.findIndex(r => r[0] === date && normalizeSlot(r[1]) === normSlot && r[3] === month);
    if (rowIndex >= 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${tab}!A${rowIndex + 2}:D${rowIndex + 2}`,
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
app.post('/api/roster/batch', requireAdmin, async (req, res) => {
  const { venue, month, assignments } = req.body;
  try {
    const result = await withVenueLock(venue, async () => {
      const sheets = getSheets();
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
      return { updated: updateData.length, appended: appendRows.length };
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* == CLEAR ROSTER ========================================================= */
app.post('/api/roster/clear', requireAdmin, async (req, res) => {
  try {
    const { venue, month } = req.body;
    if (!month || !/^[A-Za-z]+ \d{4}$/.test(month.trim())) {
      return res.status(400).json({ success: false, error: 'Invalid or missing month' });
    }
    const sheets = getSheets();
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
const DJ_AVAIL_SHEET        = 'DJ Availability';
const FINALIZED_SHEET       = 'Finalized Months';
const DJ_PINS_SHEET         = 'DJ PINs';
const DJ_SUBMISSIONS_SHEET  = 'DJ Submissions';

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
app.post('/api/dj/login', rateLimiter, async (req, res) => {
  try {
    const { name, pin } = req.body;
    if (!name || !pin) return res.json({ success: false, error: 'Name and PIN required' });
    const { data: pinData } = await supabase
      .from('dj_pins')
      .select('name, pin')
      .ilike('name', name.trim())
      .single();
    if (!pinData || String(pinData.pin).trim() !== String(pin).trim()) {
      return res.json({ success: false, error: 'Invalid name or PIN' });
    }
    const djName = pinData.name.trim();
    const djData = await fetchDJs();
    const djInfo = (djData.djs || []).find(d => d.name.toLowerCase() === djName.toLowerCase());
    res.json({ success: true, name: djName, isResident: RESIDENTS.includes(djName), rate: djInfo ? djInfo.rate : 0 });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* -- POST /api/dj/change-pin ----------------------------------------------- */
app.post('/api/dj/change-pin', rateLimiter, async (req, res) => {
  try {
    const { name, currentPin, newPin } = req.body;
    if (!name || !currentPin || !newPin) return res.json({ success: false, error: 'Missing fields' });
    if (!/^\d{4}$/.test(String(newPin))) return res.json({ success: false, error: 'New PIN must be exactly 4 digits' });
    const { data: pinData } = await supabase
      .from('dj_pins')
      .select('name, pin')
      .ilike('name', name.trim())
      .single();
    if (!pinData || String(pinData.pin).trim() !== String(currentPin).trim()) {
      return res.json({ success: false, error: 'Current PIN is incorrect' });
    }
    const { error: upsertError } = await supabase
      .from('dj_pins')
      .upsert({ name: pinData.name, pin: String(newPin) }, { onConflict: 'name' });
    if (upsertError) throw new Error(upsertError.message);
    res.json({ success: true });
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
    const fixedSched = FIXED_SCHEDULES[name] || null;
    // Build combined per-dow slot Set from FIXED_SCHEDULES for DJs with fixed schedules.
    const FIXED_PORTAL = {};
    if (fixedSched) {
      for (const [dow, slots] of [...Object.entries(fixedSched.arkbar), ...Object.entries(fixedSched.loveBeach)]) {
        if (!FIXED_PORTAL[dow]) FIXED_PORTAL[dow] = new Set();
        slots.forEach(s => FIXED_PORTAL[dow].add(s));
      }
    }

    const parts = month.split(' ');
    const monthIdx = MONTH_NAMES.indexOf(parts[0]);
    const year = parseInt(parts[1]);

    const finalized = await fetchFinalized();
    const isFinalized = finalized.months.includes(month);

    const sheets = getSheets();

    // Check DJ Submissions for this DJ+month to determine submissionStatus.
    const submissionsResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: `${DJ_SUBMISSIONS_SHEET}!A2:C`,
    }).catch(() => ({ data: { values: [] } }));
    const submissionsRows = submissionsResp.data.values || [];
    const submissionRow = submissionsRows.find(r =>
      r[0] && r[0].trim().toLowerCase() === name.trim().toLowerCase() && r[1] === month
    );

    let submissionStatus = submissionRow ? (submissionRow[2] || 'none') : 'none';

    // For residents with no existing submission record, pre-load default availability.
    const stored = {};
    let preloaded = false;
    if (!submissionRow && isResident && monthIdx >= 0 && !isNaN(year)) {
      await getOrCreateSubmissionsSheet(sheets);
      const preloadRows = generatePreloadRows(name, month, monthIdx, year);
      if (preloadRows && preloadRows.length > 0) {
        // Write avail rows and submission record in parallel — no need to read back what we just wrote.
        await Promise.all([
          supabase.from('dj_availability').upsert(
            preloadRows.map(([n, date, slot, mo, status]) => ({ name: n, date, slot, month: mo, status })),
            { onConflict: 'name,date,slot' }
          ),
          sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID, range: `${DJ_SUBMISSIONS_SHEET}!A:C`,
            valueInputOption: 'RAW', requestBody: { values: [[name, month, 'pre-loaded']] },
          }),
        ]);
        submissionStatus = 'pre-loaded';
        // Build stored directly from the generated rows — avoids an extra Sheets read.
        for (const [, dk, ns, , status] of preloadRows) {
          if (!stored[dk]) stored[dk] = {};
          stored[dk][ns] = status;
        }
        preloaded = true;
      }
    }

    // For FIXED_AVAILABILITY DJs with no existing submission record, pre-load fixed availability.
    if (!submissionRow && !preloaded && FIXED_AVAILABILITY[name] && monthIdx >= 0 && !isNaN(year)) {
      await getOrCreateSubmissionsSheet(sheets);
      const fixedRows = generateFixedAvailabilityRows(name, year, monthIdx + 1);
      if (fixedRows.length > 0) {
        // Expand to 5-column sheet format: [name, dateKey, normalizedSlot, month, status]
        const sheetRows = fixedRows.map(([n, dk, slot, status]) => [n, dk, normalizeSlot(slot), month, status]);
        await Promise.all([
          supabase.from('dj_availability').upsert(
            sheetRows.map(([n, date, slot, mo, status]) => ({ name: n, date, slot, month: mo, status })),
            { onConflict: 'name,date,slot' }
          ),
          sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID, range: `${DJ_SUBMISSIONS_SHEET}!A:C`,
            valueInputOption: 'RAW', requestBody: { values: [[name, month, 'pre-loaded']] },
          }),
        ]);
        submissionStatus = 'pre-loaded';
        // Build stored directly from generated rows — avoids an extra Sheets read.
        for (const [, dk, ns, , status] of sheetRows) {
          if (!stored[dk]) stored[dk] = {};
          stored[dk][ns] = status;
        }
        preloaded = true;
      }
    }

    // Read stored availability from Supabase (skipped when we just pre-loaded it above).
    if (!preloaded) {
      const { data: availRows } = await supabase
        .from('dj_availability')
        .select('*')
        .ilike('name', name.trim())
        .eq('month', month);
      for (const row of (availRows || [])) {
        const dk = parseDateKey(row.date);
        if (!dk || !row.slot) continue;
        const ns = normalizeSlot(row.slot);
        if (!stored[dk]) stored[dk] = {};
        stored[dk][ns] = row.status || (isResident ? 'available' : 'unavailable');
      }
    }

    const availability = {};

    if (monthIdx >= 0 && !isNaN(year)) {
      const days = new Date(year, monthIdx + 1, 0).getDate();
      for (let d = 1; d <= days; d++) {
        const dk = makeDateKey(year, monthIdx + 1, d);
        const dow = new Date(year, monthIdx, d).getDay();
        const fixedToday = fixedSched ? (FIXED_PORTAL[dow] || new Set()) : null;
        availability[dk] = {};
        for (const slot of ALL_SLOTS) {
          const ns = normalizeSlot(slot);
          const defaultStatus = isResident ? 'available'
            : (fixedToday && fixedToday.has(ns)) ? 'available'
            : 'unavailable';
          availability[dk][ns] = (stored[dk] && stored[dk][ns] !== undefined)
            ? stored[dk][ns]
            : defaultStatus;
        }
      }
    }

    res.json({ success: true, availability, isFinalized, isResident, submissionStatus });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* -- POST /api/dj/availability -------------------------------------------- */

/* -- Cached sheet gid for DJ Submissions tab -------------------------------- */
let _djSubmissionsSheetId = null;
async function getOrCreateSubmissionsSheet(sheets) {
  if (_djSubmissionsSheetId !== null) return _djSubmissionsSheetId;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties' });
  const existing = (meta.data.sheets || []).find(s => s.properties.title === DJ_SUBMISSIONS_SHEET);
  if (existing) {
    _djSubmissionsSheetId = existing.properties.sheetId;
    return _djSubmissionsSheetId;
  }
  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: DJ_SUBMISSIONS_SHEET } } }] },
  });
  const newSheetId = addRes.data.replies[0].addSheet.properties.sheetId;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `${DJ_SUBMISSIONS_SHEET}!A1:C1`,
    valueInputOption: 'RAW', requestBody: { values: [['DJ Name', 'Month', 'Status']] },
  });
  _djSubmissionsSheetId = newSheetId;
  return _djSubmissionsSheetId;
}

/* -- Generate pre-load rows for residents ----------------------------------- */
function generatePreloadRows(name, month, monthIdx, year) {
  if (!RESIDENTS.includes(name)) return null;
  const SB_EARLY = new Set(['14:00\u201315:00', '15:00\u201316:00', '16:00\u201317:00']);
  const isSoundBogie = name.trim().toLowerCase() === 'sound bogie';
  const days = new Date(year, monthIdx + 1, 0).getDate();
  const rows = [];
  for (let d = 1; d <= days; d++) {
    const dk = makeDateKey(year, monthIdx + 1, d);
    const dow = new Date(year, monthIdx, d).getDay();
    const isSunday = dow === 0;
    for (const slot of ALL_SLOTS) {
      const ns = normalizeSlot(slot);
      let status = 'available';
      if (isSoundBogie && (isSunday || SB_EARLY.has(ns))) status = 'unavailable';
      rows.push([name, dk, ns, month, status]);
    }
  }
  return rows;
}

/* -- Generate pre-load rows for FIXED_AVAILABILITY DJs --------------------- */
function generateFixedAvailabilityRows(djName, year, month) {
  const config = FIXED_AVAILABILITY[djName];
  if (!config) return [];
  const rows = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dow = date.getDay(); // 0=Sun
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    for (const slot of ALL_ARKBAR_SLOTS) {
      let status;
      if (config.unavailableDays !== undefined) {
        // Buba / Sky pattern — specific days all unavailable, rest all available
        status = config.unavailableDays.includes(dow) ? 'unavailable' : 'available';
      } else if (config.availableDays !== undefined && config.allSlotsOnAvailableDays) {
        // Donsine pattern — specific days all available, rest all unavailable
        status = config.availableDays.includes(dow) ? 'available' : 'unavailable';
      } else if (config.availableDays !== undefined && !config.allSlotsOnAvailableDays) {
        // Vozka / Tobi pattern — specific days + specific slots available, rest unavailable
        if (config.availableDays.includes(dow) && config.availableSlots.includes(slot)) {
          status = 'available';
        } else {
          status = 'unavailable';
        }
      } else if (config.unavailableSlotsByDay !== undefined) {
        // Mostyx pattern — available by default, specific day+slot combos unavailable
        const blockedSlots = config.unavailableSlotsByDay[dow] || [];
        status = blockedSlots.includes(slot) ? 'unavailable' : 'available';
      } else {
        status = 'available';
      }
      rows.push([djName, dateStr, slot, status]);
    }
  }
  return rows;
}

app.post('/api/dj/availability', requireDJAuth, async (req, res) => {
  try {
    const { name, month, slots } = req.body;
    if (!name || !month || !Array.isArray(slots)) return res.json({ success: false, error: 'Missing fields' });
    const finalized = await fetchFinalized();
    if (finalized.months.includes(month)) return res.json({ success: false, error: 'This month is finalized and cannot be edited' });

    // Delete all existing rows for this DJ+month, then upsert the new ones.
    await supabase
      .from('dj_availability')
      .delete()
      .ilike('name', name.trim())
      .eq('month', month);

    const newRows = slots.map(({ date, slot, status }) => ({ name, date, slot, month, status }));
    if (newRows.length > 0) {
      const { error } = await supabase
        .from('dj_availability')
        .upsert(newRows, { onConflict: 'name,date,slot' });
      if (error) throw new Error(error.message);
    }

    cache.availability.delete(month);
    res.json({ success: true, saved: newRows.length });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* -- POST /api/dj/availability/submit ------------------------------------- */
app.post('/api/dj/availability/submit', requireDJAuth, async (req, res) => {
  try {
    const { name, month } = req.body;
    if (!name || !month) return res.json({ success: false, error: 'Missing fields' });
    const finalized = await fetchFinalized();
    if (finalized.months.includes(month)) return res.json({ success: false, error: 'This month is finalized' });

    const { error } = await supabase
      .from('dj_submissions')
      .upsert({ name, month, status: 'submitted' }, { onConflict: 'name,month' });
    if (error) throw new Error(error.message);

    cache.availability.delete(month);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* -- GET /api/dj/submissions/:month --------------------------------------- */
app.get('/api/dj/submissions/:month', async (req, res) => {
  if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const month = decodeURIComponent(req.params.month);
    const sheets = getSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: `${DJ_SUBMISSIONS_SHEET}!A2:C`,
    }).catch(() => ({ data: { values: [] } }));
    const submitted = (response.data.values || [])
      .filter(r => r[1] === month && r[0] && r[2])
      .map(r => ({ name: r[0].trim(), status: r[2] }));
    res.json({ success: true, submitted });
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

/* -- POST /api/dj/signoff ------------------------------------------------- */
app.post('/api/dj/signoff', async (req, res) => {
  try {
    const { name, date, slot, venue, month, password } = req.body;
    if (password !== process.env.MANAGER_PASSWORD) return res.json({ success: false, error: 'Unauthorized' });
    if (!name || !date || !slot || !venue || !month) return res.json({ success: false, error: 'Missing fields' });
    const sheets = getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: `${DJ_SIGNOFFS_SHEET}!A:G`,
      valueInputOption: 'RAW',
      requestBody: { values: [[date, normalizeSlot(slot), name, venue, month, new Date().toISOString(), 'sign']] },
    });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* -- POST /api/dj/signoff-batch ------------------------------------------- */
app.post('/api/dj/signoff-batch', async (req, res) => {
  try {
    const { name, date, slots, month, password } = req.body;
    if (password !== process.env.MANAGER_PASSWORD) return res.json({ success: false, error: 'Unauthorized' });
    if (!name || !date || !month || !Array.isArray(slots) || slots.length === 0)
      return res.json({ success: false, error: 'Missing fields' });
    const sheets = getSheets();
    const ts = new Date().toISOString();
    const rows = slots.map(({ slot, venue }) => [date, normalizeSlot(slot), name, venue, month, ts, 'sign']);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: `${DJ_SIGNOFFS_SHEET}!A:G`,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });
    res.json({ success: true, count: rows.length });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* -- POST /api/dj/unsignoff-day ------------------------------------------- */
app.post('/api/dj/unsignoff-day', async (req, res) => {
  try {
    const { name, date, month, password } = req.body;
    if (password !== process.env.MANAGER_PASSWORD) return res.json({ success: false, error: 'Unauthorized' });
    if (!name || !date || !month) return res.json({ success: false, error: 'Missing fields' });
    const sheets = getSheets();
    // Read all signoffs for this DJ/month to find what to unsign on this date
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: `${DJ_SIGNOFFS_SHEET}!A:G`,
    }).catch(() => ({ data: { values: [] } }));
    const rows = (response.data.values || []).filter(r =>
      r[2] && r[2].trim().toLowerCase() === name.trim().toLowerCase() && r[4] === month && r[0] === date
    );
    // Determine which slot|venue combos are currently net-signed
    const net = {};
    rows.forEach(r => { const k = `${r[1]}|${r[3]}`; net[k] = (r[6] || 'sign'); });
    const toUnsign = Object.entries(net).filter(([,action]) => action === 'sign').map(([k]) => k);
    if (toUnsign.length === 0) return res.json({ success: true, unsignedCount: 0 });
    const ts = new Date().toISOString();
    const unsignRows = toUnsign.map(k => {
      const [slot, venue] = k.split('|');
      return [date, slot, name, venue, month, ts, 'unsign'];
    });
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: `${DJ_SIGNOFFS_SHEET}!A:G`,
      valueInputOption: 'RAW',
      requestBody: { values: unsignRows },
    });
    res.json({ success: true, unsignedCount: unsignRows.length });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* -- GET /api/dj/signoffs/:name/:month ------------------------------------ */
app.get('/api/dj/signoffs/:name/:month', async (req, res) => {
  try {
    const name  = decodeURIComponent(req.params.name);
    const month = decodeURIComponent(req.params.month);
    const sheets = getSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: `${DJ_SIGNOFFS_SHEET}!A:G`,
    }).catch(() => ({ data: { values: [] } }));
    // Process log: last action per date|slot|venue wins
    const latest = {};
    for (const r of (response.data.values || [])) {
      if (!r[2] || r[2].trim().toLowerCase() !== name.trim().toLowerCase() || r[4] !== month) continue;
      const key = `${r[0]}|${normalizeSlot(r[1])}|${r[3]}`;
      latest[key] = { date: r[0], slot: normalizeSlot(r[1]), venue: r[3], action: r[6] || 'sign' };
    }
    const signoffs = Object.values(latest).filter(e => e.action === 'sign').map(({ date, slot, venue }) => ({ date, slot, venue }));
    res.json({ success: true, signoffs });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* -- GET /api/signoffs/:month  (all DJs, for accounting report) ----------- */
app.get('/api/signoffs/:month', async (req, res) => {
  if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const month = decodeURIComponent(req.params.month);
    const sheets = getSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID, range: `${DJ_SIGNOFFS_SHEET}!A:G`,
    }).catch(() => ({ data: { values: [] } }));
    // Last action wins per DJ+date+slot+venue key
    const latest = {};
    for (const r of (response.data.values || [])) {
      if (!r[4] || r[4] !== month || !r[2]) continue;
      const key = `${r[2]}|${r[0]}|${normalizeSlot(r[1])}|${r[3]}`;
      latest[key] = { dj: r[2].trim(), action: r[6] || 'sign' };
    }
    // Count signed-off slots per DJ name
    const signedOff = {};
    for (const { dj, action } of Object.values(latest)) {
      if (action === 'sign') signedOff[dj] = (signedOff[dj] || 0) + 1;
    }
    res.json({ success: true, signedOff });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* -- POST /api/djs/update ------------------------------------------------- */
app.post('/api/djs/update', async (req, res) => {
  try {
    const { oldName, newName, rate, password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD && password !== process.env.MANAGER_PASSWORD) {
      return res.json({ success: false, error: 'Unauthorized' });
    }
    if (!oldName || !newName || rate === undefined) return res.json({ success: false, error: 'Missing fields' });
    if (oldName.trim().toLowerCase() !== newName.trim().toLowerCase()) {
      await supabase.from('dj_rates').delete().ilike('name', oldName.trim());
    }
    const { error: upsertError } = await supabase
      .from('dj_rates')
      .upsert({ name: newName, rate }, { onConflict: 'name' });
    if (upsertError) throw new Error(upsertError.message);
    cache.djs.data = null;
    res.json({ success: true });
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
    (djData.djs || []).forEach(d => { djMap[d.name.trim().toLowerCase()] = d; });

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
      const info = djMap[djName.trim().toLowerCase()];
      const rate = info ? info.rate : 0;
      const cost = h.total * rate;
      grandTotal += h.total; grandCost += cost;
      report.push({ name: djName, arkbar: h.arkbar, hip: h.hip, love: h.love, total: h.total, rate, cost });
    });

    const sheets = getSheets();
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID, range: `${FINALIZED_SHEET}!A:C`,
        valueInputOption: 'RAW',
        requestBody: { values: [[month, new Date().toISOString(), grandCost]] },
      });
    } catch (writeErr) {
      console.error('Finalized Months write failed:', writeErr.message);
      return res.json({ success: false, error: 'Failed to record finalization: ' + writeErr.message });
    }

    cache.finalized.data = null;
    res.json({ success: true, month, report, grandTotal, grandCost });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* == ADMIN — RESET MONTH ================================================== */
app.post('/api/admin/reset-month', requireAdmin, async (req, res) => {
  try {
    const { month } = req.body;
    if (!month || !/^[A-Za-z]+ \d{4}$/.test(month.trim())) {
      return res.status(400).json({ success: false, error: 'Invalid or missing month' });
    }
    const sheets = getSheets();
    const rosterHeader = ['Date', 'Slot', 'DJ', 'Month'];

    // a. Clear DJ Availability rows for this month
    await supabase.from('dj_availability').delete().eq('month', month);

    // b. Clear DJ Submissions rows for this month (column B = month)
    {
      let rows = [];
      try {
        rows = (await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID, range: `${DJ_SUBMISSIONS_SHEET}!A:C`,
        })).data.values || [];
      } catch(e) {}
      const header = rows[0] || [];
      const keep = rows.slice(1).filter(r => (r[1] || '') !== month);
      await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `${DJ_SUBMISSIONS_SHEET}!A:C` });
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID, range: `${DJ_SUBMISSIONS_SHEET}!A1`,
        valueInputOption: 'RAW', requestBody: { values: [header, ...keep] },
      });
    }

    // c. Flush roster cache
    invalidateAllRosters(month);

    // d. Flush availability cache for this month
    cache.availability.delete(month);

    // e. Clear all three roster sheets for this month
    for (const tab of ['ARKbar Roster', 'HIP Roster', 'Love Beach Roster']) {
      let rows = [];
      try {
        rows = (await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID, range: `${tab}!A:D`,
        })).data.values || [];
      } catch(e) {}
      const dataRows = rows.filter(r => r[0] && r[0] !== 'Date');
      const keep = dataRows.filter(r => (r[3] || '') !== month);
      await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `${tab}!A:D` });
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID, range: `${tab}!A1`,
        valueInputOption: 'RAW', requestBody: { values: [rosterHeader, ...keep] },
      });
    }

    res.json({ success: true, month });
  } catch (err) {
    console.error('Reset-month error:', err);
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
