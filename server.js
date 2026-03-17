require('dotenv').config();

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.stack || err.message);
});

const express = require('express');
const path = require('path');
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

const RESIDENTS = ['Alex RedWhite', 'Raffo DJ', 'Sound Bogie'];
// DJs with server-injected fixed schedules who are not residents.
const ALL_SLOTS = [
  '14:00\u201315:00','15:00\u201316:00','16:00\u201317:00','17:00\u201318:00',
  '18:00\u201319:00','19:00\u201320:00','20:00\u201321:00','21:00\u201322:00',
  '22:00\u201323:00','23:00\u201300:00','00:00\u201301:00','01:00\u201302:00'
];
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
  // M/D/YYYY or MM/DD/YYYY  (YYYY-MM-DD is Supabase ISO format)
  const mMDY = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mMDY) return `${mMDY[3]}-${pad2(mMDY[1])}-${pad2(mMDY[2])}`;
  // YYYY/MM/DD
  const mYMD = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (mYMD) return `${mYMD[1]}-${mYMD[2]}-${mYMD[3]}`;
  return null;
}

/* == FIXED DJ SCHEDULES =================================================== */
// Single source of truth for DJs with server-injected recurring weekly schedules.
// Keys are day-of-week (0=Sun … 6=Sat).
const FIXED_SCHEDULES = {
  'Davoted': {
    arkbar: {
      1: ['14:00\u201315:00','15:00\u201316:00'],
      3: ['14:00\u201315:00','15:00\u201316:00','16:00\u201317:00'],
      4: ['14:00\u201315:00','15:00\u201316:00','20:00\u201321:00','21:00\u201322:00','22:00\u201323:00'],
      5: ['14:00\u201315:00','15:00\u201316:00','16:00\u201317:00'],
    },
    loveBeach: {
      2: ['20:00\u201321:00','21:00\u201322:00','22:00\u201323:00','23:00\u201300:00'],
      3: ['20:00\u201321:00','21:00\u201322:00','22:00\u201323:00','23:00\u201300:00'],
    },
  },
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
 *
 * On a typical roster editing session the user loads once (cold),
 * then every subsequent month-switch or tab-switch serves from cache.
 * Only writes (assign, batch, clear) bust the relevant roster entry.
 */

const cache = {
  djs:          { data: null, time: 0, ttl: 10 * 60 * 1000 },
  availability: new Map(),
  roster:       new Map(),
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

async function fetchAvailability(month) {
  const cached = cache.availability.get(month);
  if (cached && (Date.now() - cached.time) < AVAIL_TTL) {
    return cached.data;
  }

  const parts = month.split(' ');
  const monthIdx = MONTH_NAMES.indexOf(parts[0]);
  const year = parseInt(parts[1]);
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();

  // Include availability from all DJs who have submitted for this month.
  const [{ data: portalRows }, { data: submittedRows }] = await Promise.all([
    supabase.from('dj_availability').select('*').eq('month', month),
    supabase.from('dj_submissions').select('name').eq('month', month).eq('status', 'submitted'),
  ]);
  const submittedNames = new Set((submittedRows || []).map(r => r.name.trim().toLowerCase()));
  const rows = (portalRows || []).filter(r =>
    submittedNames.has(r.name.trim().toLowerCase())
  );

  const map = {};

  // Build per-DJ status lookup from dj_availability: { djName: { dateKey: { slot: status } } }
  const djStatus = {};
  for (const { name: dj, date: dateRaw, slot, month: rowMonth, status } of rows) {
    if (!dj || !dateRaw || !slot || rowMonth !== month) continue;
    const dk = parseDateKey(dateRaw);
    if (!dk) continue;
    const ns = normalizeSlot(slot);
    ((djStatus[dj] ??= {})[dk] ??= {})[ns] = status || 'available';
  }

  // Add all DJs (residents and casuals) who are explicitly available.
  for (const [dj, dates] of Object.entries(djStatus)) {
    for (const [dk, slots] of Object.entries(dates)) {
      for (const [ns, status] of Object.entries(slots)) {
        if (status === 'unavailable') continue;
        (map[dk] ??= {})[ns] ??= [];
        if (!map[dk][ns].includes(dj)) map[dk][ns].push(dj);
      }
    }
  }

  // Ensure every date+slot has a Guest DJ option.
  if (year !== undefined && monthIdx >= 0) {
    for (let d = 1; d <= daysInMonth; d++) {
      const dk = makeDateKey(year, monthIdx + 1, d);
      if (!map[dk]) map[dk] = {};
      for (const slot of ALL_SLOTS) {
        const ns = normalizeSlot(slot);
        if (!map[dk][ns]) map[dk][ns] = [];
        if (!map[dk][ns].includes('Guest DJ')) map[dk][ns].push('Guest DJ');
      }
    }
  }

  // Auto-populate fixed recurring monthly schedules from FIXED_SCHEDULES.
  if (year !== undefined && monthIdx >= 0) {
    for (const [djName, sched] of Object.entries(FIXED_SCHEDULES)) {
      for (let d = 1; d <= daysInMonth; d++) {
        const dk = makeDateKey(year, monthIdx + 1, d);
        const dow = new Date(year, monthIdx, d).getDay();
        const slots = [...(sched.arkbar[dow] || []), ...(sched.loveBeach[dow] || [])];
        for (const slot of slots) {
          const ns = normalizeSlot(slot);
          (map[dk] ??= {})[ns] ??= [];
          if (!map[dk][ns].includes(djName)) map[dk][ns].push(djName);
        }
      }
    }
  }

  const result = { success: true, availability: map };
  cache.availability.set(month, { data: result, time: Date.now() });
  return result;
}

async function fetchRoster(venue, month) {
  const key = `${venue}|${month}`;
  const cached = cache.roster.get(key);
  if (cached) return cached;

  let query = supabase.from('roster_assignments').select('*').eq('venue', venue);
  if (month) query = query.eq('month', month);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const filtered = (data || [])
    .filter(r => r.date && r.dj)
    .map(r => [r.date, normalizeSlot(r.slot), r.dj, r.month]);

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
  if (!name || !pin) {
    console.error('[requireDJAuth] missing name or pin — name:', name, 'pin present:', !!pin, 'path:', req.path);
    return res.status(401).json({ success: false, error: 'Unauthorised' });
  }
  try {
    const { data: pinData } = await supabase
      .from('dj_pins')
      .select('pin')
      .ilike('name', name.trim())
      .single();
    const correctPin = pinData ? pinData.pin : null;
    if (!correctPin || String(correctPin).trim() !== String(pin).trim()) {
      console.error('[requireDJAuth] pin mismatch for', name, '— expected:', correctPin, 'got:', pin);
      return res.status(401).json({ success: false, error: 'Unauthorised' });
    }
    next();
  } catch (err) {
    console.error('[requireDJAuth] error:', err.message);
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

/* == UNAVAILABILITY MAP (for roster auto-suggest) ========================= */
app.get('/api/roster/unavailability/:month', requireAdmin, async (req, res) => {
  try {
    const month = decodeURIComponent(req.params.month);
    const { data: rows, error } = await supabase
      .from('dj_availability')
      .select('name, date, slot')
      .eq('month', month)
      .eq('status', 'unavailable');
    if (error) throw new Error(error.message);
    const map = {};
    for (const { name, date, slot } of (rows || [])) {
      const dk = parseDateKey(date);
      if (!dk || !slot) continue;
      const ns = normalizeSlot(slot);
      (map[name] ??= []).push(`${dk}|${ns}`);
    }
    res.json({ success: true, unavailability: map });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* == DIAGNOSTIC ENDPOINT ================================================== */

// Server-side copy of FIXED_TEMPLATE from roster.html (lines 1199-1230).
// Keys use en-dash (\u2013) to match normalizeSlot convention.
const DIAG_FIXED_TEMPLATE = {
  love: {
    weekday: {
      0: { '14:00\u201315:00':'Donsine','15:00\u201316:00':'Donsine','16:00\u201317:00':'Donsine','20:00\u201321:00':'Cocoa','21:00\u201322:00':'Cocoa','22:00\u201323:00':'Cocoa','23:00\u201300:00':'Cocoa' },
      1: { '14:00\u201315:00':'Mostyx','15:00\u201316:00':'Mostyx','16:00\u201317:00':'Mostyx','20:00\u201321:00':'Pick','21:00\u201322:00':'Pick','22:00\u201323:00':'Pick','23:00\u201300:00':'Pick' },
      2: { '14:00\u201315:00':'Vozka','15:00\u201316:00':'Vozka','16:00\u201317:00':'Vozka','20:00\u201321:00':'Davoted','21:00\u201322:00':'Davoted','22:00\u201323:00':'Davoted','23:00\u201300:00':'Davoted' },
      3: { '14:00\u201315:00':'Pick','15:00\u201316:00':'Pick','16:00\u201317:00':'Pick','20:00\u201321:00':'Davoted','21:00\u201322:00':'Davoted','22:00\u201323:00':'Davoted','23:00\u201300:00':'Davoted' },
      4: { '14:00\u201315:00':'Buba','15:00\u201316:00':'Buba','16:00\u201317:00':'Buba','20:00\u201321:00':'Jessi','21:00\u201322:00':'Jessi','22:00\u201323:00':'Jessi','23:00\u201300:00':'Jessi' },
      5: { '14:00\u201315:00':'Donsine','15:00\u201316:00':'Donsine','16:00\u201317:00':'Donsine','20:00\u201321:00':'Sky','21:00\u201322:00':'Sky','22:00\u201323:00':'Sky','23:00\u201300:00':'Sky' },
    },
    satA: { '14:00\u201315:00':'Cocoa','15:00\u201316:00':'Cocoa','16:00\u201317:00':'Bollie','17:00\u201318:00':'Bollie','18:00\u201319:00':'Mostyx','19:00\u201320:00':'Mostyx','20:00\u201321:00':'Donsine','21:00\u201322:00':'Donsine','22:00\u201323:00':'Donsine','23:00\u201300:00':'Donsine' },
    satB: { '14:00\u201315:00':'Laina','15:00\u201316:00':'Laina','16:00\u201317:00':'Jessi','17:00\u201318:00':'Jessi','18:00\u201319:00':'Pick','19:00\u201320:00':'Pick','20:00\u201321:00':'Donsine','21:00\u201322:00':'Donsine','22:00\u201323:00':'Donsine','23:00\u201300:00':'Donsine' },
  },
  arkbar: {
    0: { '14:00\u201315:00':'Alex RedWhite','15:00\u201316:00':'Alex RedWhite','16:00\u201317:00':'Alex RedWhite','20:00\u201321:00':'Pick','21:00\u201322:00':'Pick','22:00\u201323:00':'Pick','23:00\u201300:00':'Alex RedWhite','00:00\u201301:00':'Alex RedWhite','01:00\u201302:00':'Alex RedWhite' },
    1: { '14:00\u201315:00':'Davoted','15:00\u201316:00':'Davoted','17:00\u201318:00':'Alex RedWhite','18:00\u201319:00':'Alex RedWhite','20:00\u201321:00':'Raffo DJ','21:00\u201322:00':'Raffo DJ','22:00\u201323:00':'Raffo DJ','23:00\u201300:00':'Tony','00:00\u201301:00':'Tony','01:00\u201302:00':'Tony' },
    2: { '14:00\u201315:00':'Pick','15:00\u201316:00':'Pick','16:00\u201317:00':'Pick','17:00\u201318:00':'Tony','18:00\u201319:00':'Tony','23:00\u201300:00':'Raffo DJ','00:00\u201301:00':'Raffo DJ','01:00\u201302:00':'Raffo DJ' },
    3: { '14:00\u201315:00':'Davoted','15:00\u201316:00':'Davoted','16:00\u201317:00':'Davoted','17:00\u201318:00':'Sound Bogie','18:00\u201319:00':'Sound Bogie','20:00\u201321:00':'Raffo DJ','21:00\u201322:00':'Raffo DJ','22:00\u201323:00':'Raffo DJ','23:00\u201300:00':'Alex RedWhite','00:00\u201301:00':'Alex RedWhite','01:00\u201302:00':'Alex RedWhite' },
    4: { '14:00\u201315:00':'Pick','15:00\u201316:00':'Pick','16:00\u201317:00':'Pick','17:00\u201318:00':'Raffo DJ','18:00\u201319:00':'Raffo DJ','20:00\u201321:00':'Davoted','21:00\u201322:00':'Davoted','22:00\u201323:00':'Davoted','23:00\u201300:00':'Raffo DJ','00:00\u201301:00':'Raffo DJ','01:00\u201302:00':'Raffo DJ' },
    5: { '14:00\u201315:00':'Davoted','15:00\u201316:00':'Davoted','16:00\u201317:00':'Davoted','17:00\u201318:00':'Jessi','18:00\u201319:00':'Jessi','20:00\u201321:00':'Alex RedWhite','21:00\u201322:00':'Alex RedWhite','22:00\u201323:00':'Alex RedWhite','23:00\u201300:00':'Sound Bogie','00:00\u201301:00':'Sound Bogie','01:00\u201302:00':'Sound Bogie' },
    6: { '14:00\u201315:00':'Pick','15:00\u201316:00':'Pick','16:00\u201317:00':'Pick','17:00\u201318:00':'Alex RedWhite','18:00\u201319:00':'Alex RedWhite','20:00\u201321:00':'Sound Bogie','21:00\u201322:00':'Raffo DJ','22:00\u201323:00':'Raffo DJ' },
  },
  hip: {
    0: 'Tony',
    1: 'Vozka',
    2: 'Buba',
    3: 'Pick',
    4: 'Tobi',
    5: 'Vozka',
    6: ['Pick','Tony'],
  },
};

// Verify FIXED_TEMPLATE against known failing cases.
// Raffo DJ should be in ARKbar Tuesday (dow=1) for 23:00-00:00, 00:00-01:00, 01:00-02:00.
// Pick should be in ARKbar Tuesday (dow=1) for 14:00-15:00, 15:00-16:00, 16:00-17:00.
function getDiagTemplateWarnings() {
  const warnings = [];
  const tue = DIAG_FIXED_TEMPLATE.arkbar[1] || {};

  const raffoTueLateSlots = ['23:00\u201300:00','00:00\u201301:00','01:00\u201302:00'];
  const raffoMissing = raffoTueLateSlots.filter(s => tue[s] !== 'Raffo DJ');
  if (raffoMissing.length > 0) {
    warnings.push(
      `TEMPLATE_STALE: Raffo DJ missing from ARKbar Tuesday slots: ${raffoMissing.join(', ')}. ` +
      `Found: ${raffoTueLateSlots.map(s => `${s}=${tue[s]||'(empty)'}`).join(', ')}`
    );
  }

  const pickTueDaySlots = ['14:00\u201315:00','15:00\u201316:00','16:00\u201317:00'];
  const pickMissing = pickTueDaySlots.filter(s => tue[s] !== 'Pick');
  if (pickMissing.length > 0) {
    warnings.push(
      `TEMPLATE_STALE: Pick missing from ARKbar Tuesday slots: ${pickMissing.join(', ')}. ` +
      `Found: ${pickTueDaySlots.map(s => `${s}=${tue[s]||'(empty)'}`).join(', ')}`
    );
  }

  return warnings;
}

// Post-midnight slot date-shifting: slots starting 00: or 01: belong to the previous calendar day.
function diagGetUnavailLookupDate(dateStr, slot) {
  if (slot.startsWith('00:') || slot.startsWith('01:')) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - 1);
    return makeDateKey(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  }
  return dateStr;
}

// Build contiguous block groups from a DJ's template slots on a given day+venue.
// Returns an array of slot arrays, where each inner array is one contiguous block.
function getDJTemplateBlocks(venue, dow, djName, satToggle) {
  const ALL_ARKBAR = [
    '14:00\u201315:00','15:00\u201316:00','16:00\u201317:00','17:00\u201318:00',
    '18:00\u201319:00','19:00\u201320:00','20:00\u201321:00','21:00\u201322:00',
    '22:00\u201323:00','23:00\u201300:00','00:00\u201301:00','01:00\u201302:00',
  ];
  const ALL_LOVE_WEEKDAY = [
    '14:00\u201315:00','15:00\u201316:00','16:00\u201317:00',
    '20:00\u201321:00','21:00\u201322:00','22:00\u201323:00','23:00\u201300:00',
  ];
  const ALL_LOVE_SATURDAY = [
    '14:00\u201315:00','15:00\u201316:00','16:00\u201317:00',
    '17:00\u201318:00','18:00\u201319:00','19:00\u201320:00',
    '20:00\u201321:00','21:00\u201322:00','22:00\u201323:00','23:00\u201300:00',
  ];
  const HIP_SLOTS = ['21:00\u201322:00','22:00\u201323:00','23:00\u201300:00','00:00\u201301:00'];

  let template = null;
  let orderedSlots = [];

  if (venue === 'arkbar') {
    template = DIAG_FIXED_TEMPLATE.arkbar[dow] || {};
    orderedSlots = ALL_ARKBAR;
  } else if (venue === 'love') {
    if (dow === 6) {
      template = satToggle % 2 === 0 ? DIAG_FIXED_TEMPLATE.love.satA : DIAG_FIXED_TEMPLATE.love.satB;
      orderedSlots = ALL_LOVE_SATURDAY;
    } else {
      template = DIAG_FIXED_TEMPLATE.love.weekday[dow] || {};
      orderedSlots = ALL_LOVE_WEEKDAY;
    }
  } else if (venue === 'hip') {
    let hipDJ = DIAG_FIXED_TEMPLATE.hip[dow];
    if (!hipDJ) return [];
    if (Array.isArray(hipDJ)) hipDJ = hipDJ[satToggle % hipDJ.length];
    if (hipDJ !== djName) return [];
    return [HIP_SLOTS];
  }

  if (!template) return [];

  // Find contiguous runs of this DJ's slots in template order
  const blocks = [];
  let current = [];
  for (const slot of orderedSlots) {
    if (template[slot] === djName) {
      current.push(slot);
    } else {
      if (current.length > 0) { blocks.push(current); current = []; }
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

app.get('/api/admin/diagnostic/:month', requireAdmin, async (req, res) => {
  try {
    const month = decodeURIComponent(req.params.month);
    const parts = month.split(' ');
    if (parts.length !== 2) return res.status(400).json({ success: false, error: 'Month must be "MonthName YYYY"' });
    const monthIdx = MONTH_NAMES.indexOf(parts[0]);
    const year = parseInt(parts[1]);
    if (monthIdx < 0 || isNaN(year)) return res.status(400).json({ success: false, error: 'Invalid month' });

    const templateWarnings = getDiagTemplateWarnings();

    const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();

    // Fetch all roster assignments for all 3 venues
    const [arkData, hipData, loveData] = await Promise.all([
      supabase.from('roster_assignments').select('date, slot, dj').eq('venue', 'arkbar').eq('month', month),
      supabase.from('roster_assignments').select('date, slot, dj').eq('venue', 'hip').eq('month', month),
      supabase.from('roster_assignments').select('date, slot, dj').eq('venue', 'love').eq('month', month),
    ]);
    if (arkData.error) throw new Error(arkData.error.message);
    if (hipData.error) throw new Error(hipData.error.message);
    if (loveData.error) throw new Error(loveData.error.message);

    // Fetch all unavailability records for this month
    const { data: unavailRows, error: unavailError } = await supabase
      .from('dj_availability')
      .select('name, date, slot')
      .eq('month', month)
      .eq('status', 'unavailable');
    if (unavailError) throw new Error(unavailError.message);

    // Build unavailability lookup: djName -> Set of "dateKey|normalizedSlot"
    const unavailSet = {};
    for (const { name, date, slot } of (unavailRows || [])) {
      const dk = parseDateKey(date);
      if (!dk || !slot) continue;
      const ns = normalizeSlot(slot);
      (unavailSet[name] ??= new Set()).add(`${dk}|${ns}`);
    }

    const violations = [];
    const partialBlocks = [];
    let totalAssignments = 0;

    // Process assignments from all venues
    const allAssignments = [
      ...(arkData.data || []).map(r => ({ ...r, venue: 'arkbar' })),
      ...(hipData.data || []).map(r => ({ ...r, venue: 'hip' })),
      ...(loveData.data || []).map(r => ({ ...r, venue: 'love' })),
    ];

    totalAssignments = allAssignments.length;

    for (const { date: dateRaw, slot: slotRaw, dj, venue } of allAssignments) {
      const dateKey = parseDateKey(dateRaw);
      if (!dateKey || !slotRaw || !dj) continue;
      const slot = normalizeSlot(slotRaw);

      // Unavailability violation check with post-midnight date shifting
      const unavailDateKey = diagGetUnavailLookupDate(dateKey, slot);
      if (unavailSet[dj] && unavailSet[dj].has(`${unavailDateKey}|${slot}`)) {
        violations.push({
          type: 'unavailability',
          dj,
          date: dateKey,
          slot,
          venue,
          detail: 'DJ marked unavailable for this date+slot',
        });
      }
    }

    // Partial block detection: group actual slots by dj+date+venue, compare to template blocks
    // Build satToggle counters (must iterate days in order to match auto-suggest logic)
    const satLoveToggleMap = {}; // used for love beach Saturday alternation
    const satHipToggleMap = {};  // used for hip Saturday alternation
    let satLoveCnt = 0;
    let satHipCnt = 0;
    const daySatLoveToggle = {};
    const daySatHipToggle = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, monthIdx, d).getDay();
      const dk = makeDateKey(year, monthIdx + 1, d);
      if (dow === 6) {
        daySatLoveToggle[dk] = satLoveCnt++;
        daySatHipToggle[dk] = satHipCnt++;
      }
    }

    // Build actual slot map: "dj|dateKey|venue" -> Set of slots
    const actualSlotMap = {};
    for (const { date: dateRaw, slot: slotRaw, dj, venue } of allAssignments) {
      const dateKey = parseDateKey(dateRaw);
      if (!dateKey || !slotRaw || !dj) continue;
      const slot = normalizeSlot(slotRaw);
      const key = `${dj}|${dateKey}|${venue}`;
      (actualSlotMap[key] ??= new Set()).add(slot);
    }

    // For each day and venue, check each DJ's template blocks against actual assignments
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, monthIdx, d).getDay();
      const dateKey = makeDateKey(year, monthIdx + 1, d);

      for (const venue of ['arkbar', 'love', 'hip']) {
        // Collect all DJs who appear in template for this day+venue
        const djsInTemplate = new Set();
        let tpl = null;
        if (venue === 'arkbar') {
          tpl = DIAG_FIXED_TEMPLATE.arkbar[dow];
          if (tpl) Object.values(tpl).forEach(dj => djsInTemplate.add(dj));
        } else if (venue === 'love') {
          if (dow === 6) {
            const toggle = daySatLoveToggle[dateKey] ?? 0;
            tpl = toggle % 2 === 0 ? DIAG_FIXED_TEMPLATE.love.satA : DIAG_FIXED_TEMPLATE.love.satB;
          } else {
            tpl = DIAG_FIXED_TEMPLATE.love.weekday[dow];
          }
          if (tpl) Object.values(tpl).forEach(dj => djsInTemplate.add(dj));
        } else if (venue === 'hip') {
          let hipDJ = DIAG_FIXED_TEMPLATE.hip[dow];
          if (hipDJ) {
            const toggle = daySatHipToggle[dateKey] ?? 0;
            if (Array.isArray(hipDJ)) hipDJ = hipDJ[toggle % hipDJ.length];
            djsInTemplate.add(hipDJ);
          }
        }

        for (const djName of djsInTemplate) {
          const satToggle = dow === 6 ? (daySatLoveToggle[dateKey] ?? 0) : 0;
          const blocks = getDJTemplateBlocks(venue, dow, djName, satToggle);
          if (blocks.length === 0) continue;

          const actualKey = `${djName}|${dateKey}|${venue}`;
          const actualSlots = actualSlotMap[actualKey] || new Set();

          for (const expectedSlots of blocks) {
            const assignedFromBlock = expectedSlots.filter(s => actualSlots.has(s));
            if (assignedFromBlock.length > 0 && assignedFromBlock.length < expectedSlots.length) {
              const missingSlots = expectedSlots.filter(s => !actualSlots.has(s));
              partialBlocks.push({
                dj: djName,
                date: dateKey,
                venue,
                expectedSlots,
                actualSlots: assignedFromBlock,
                missing: missingSlots,
              });
            }
          }
        }
      }
    }

    // DJ status overview: submission status + unavailability count per DJ
    const { data: submissionRows } = await supabase
      .from('dj_submissions')
      .select('name, status')
      .eq('month', month);
    const submissionMap = {};
    for (const r of (submissionRows || [])) submissionMap[r.name.trim()] = r.status;

    const { data: allAvailRows } = await supabase
      .from('dj_availability')
      .select('name, status')
      .eq('month', month);
    const availStats = {};
    for (const r of (allAvailRows || [])) {
      const n = r.name.trim();
      if (!availStats[n]) availStats[n] = { available: 0, unavailable: 0 };
      availStats[n][r.status === 'unavailable' ? 'unavailable' : 'available']++;
    }

    const { data: djRows } = await supabase.from('dj_rates').select('name');
    const djStatus = (djRows || []).map(d => {
      const n = d.name.trim();
      const stats = availStats[n] || { available: 0, unavailable: 0 };
      return {
        dj: n,
        submissionStatus: submissionMap[n] || 'none',
        availableSlots: stats.available,
        unavailableSlots: stats.unavailable,
        totalSlots: stats.available + stats.unavailable,
      };
    }).sort((a, b) => a.dj.localeCompare(b.dj));

    console.log('[diagnostic] DJ Status for', month);
    console.table(djStatus.map(d => ({
      DJ: d.dj,
      Submission: d.submissionStatus,
      Available: d.availableSlots,
      Unavailable: d.unavailableSlots,
      Total: d.totalSlots,
    })));

    res.json({
      success: true,
      month,
      templateWarnings,
      summary: {
        totalAssignments,
        unavailabilityViolations: violations.length,
        partialBlocks: partialBlocks.length,
      },
      violations,
      partialBlocks,
      djStatus,
    });
  } catch (err) {
    console.error('[diagnostic] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* == ASSIGN SINGLE CELL =================================================== */
app.post('/api/roster/assign', requireAdmin, async (req, res) => {
  try {
    const { venue, date, slot, dj, month } = req.body;
    const normSlot = normalizeSlot(slot);
    if (dj) {
      const { error } = await supabase.from('roster_assignments').upsert(
        { venue, date, slot: normSlot, month, dj },
        { onConflict: 'venue,date,slot' }
      );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from('roster_assignments')
        .delete().eq('venue', venue).eq('date', date).eq('slot', normSlot);
      if (error) throw new Error(error.message);
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
      const rows = assignments.map(({ date, slot, dj }) => ({
        venue, date, slot: normalizeSlot(slot), month, dj,
      }));
      const { error } = await supabase.from('roster_assignments').upsert(
        rows, { onConflict: 'venue,date,slot' }
      );
      if (error) throw new Error(error.message);
      invalidateRoster(venue, month);
      return { upserted: rows.length };
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
    const { data: deleted, error } = await supabase.from('roster_assignments')
      .delete().eq('venue', venue).eq('month', month).select();
    if (error) throw new Error(error.message);
    invalidateAllRosters(month);
    res.json({ success: true, cleared: (deleted || []).length });
  } catch (err) {
    console.error('Clear error:', err);
    res.json({ success: false, error: err.message });
  }
});

/* == DJ PORTAL ============================================================ */

cache.finalized = { data: null, time: 0, ttl: 5 * 60 * 1000 };

async function fetchFinalized() {
  const c = cache.finalized;
  if (c.data !== null && (Date.now() - c.time) < c.ttl) return c.data;
  const { data, error } = await supabase.from('finalized_months').select('month');
  if (error) throw new Error(error.message);
  const months = (data || []).map(r => r.month).filter(Boolean);
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

    // Check DJ Submissions for this DJ+month to determine submissionStatus.
    const { data: submissionRow } = await supabase
      .from('dj_submissions')
      .select('status')
      .ilike('name', name.trim())
      .eq('month', month)
      .maybeSingle();

    let submissionStatus = submissionRow ? (submissionRow.status || 'none') : 'none';

    // Read stored availability from Supabase.
    const stored = {};
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
      stored[dk][ns] = row.status || 'unavailable';
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
          const defaultStatus = (fixedToday && fixedToday.has(ns)) ? 'available' : 'unavailable';
          availability[dk][ns] = (stored[dk] && stored[dk][ns] !== undefined)
            ? stored[dk][ns]
            : defaultStatus;
        }
      }
    }

    // Include per-date fixed schedule with venue labels for resident DJs
    const fixedDisplay = {};
    if (fixedSched && monthIdx >= 0 && !isNaN(year)) {
      const days = new Date(year, monthIdx + 1, 0).getDate();
      for (let d = 1; d <= days; d++) {
        const dk = makeDateKey(year, monthIdx + 1, d);
        const dow = new Date(year, monthIdx, d).getDay();
        const daySlots = {};
        for (const [venue, label] of [['arkbar', 'ARKbar'], ['loveBeach', 'Love Beach']]) {
          const venueSlots = fixedSched[venue][dow] || [];
          for (const s of venueSlots) daySlots[normalizeSlot(s)] = label;
        }
        if (Object.keys(daySlots).length > 0) fixedDisplay[dk] = daySlots;
      }
    }

    res.json({ success: true, availability, isFinalized, isResident, submissionStatus, fixedSchedule: fixedDisplay });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* -- POST /api/dj/availability -------------------------------------------- */


app.post('/api/dj/availability', requireDJAuth, async (req, res) => {
  try {
    const { name, month, slots } = req.body;
    if (!name || !month || !Array.isArray(slots)) return res.json({ success: false, error: 'Missing fields' });
    const finalized = await fetchFinalized();
    if (finalized.months.includes(month)) return res.json({ success: false, error: 'This month is finalized and cannot be edited' });

    // Upsert only — never delete. Atomic: partial failure leaves existing data intact.
    const newRows = slots.map(({ date, slot, status }) => ({
      name: name.trim(), date, slot: slot.replace(/–/g, '-'), month, status,
    }));
    if (newRows.length > 0) {
      // Batch in chunks of 500 to avoid Supabase payload limits
      for (let i = 0; i < newRows.length; i += 500) {
        const chunk = newRows.slice(i, i + 500);
        const { error } = await supabase
          .from('dj_availability')
          .upsert(chunk, { onConflict: 'name,date,slot' });
        if (error) {
          console.error('[dj/availability] upsert error:', error, 'chunk:', i, 'sample:', chunk[0], 'total:', newRows.length);
          throw new Error(error.message);
        }
      }
    }

    cache.availability.delete(month);
    res.json({ success: true, saved: newRows.length });
  } catch (err) {
    console.error('[dj/availability] caught:', err.message);
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
    const { data: rows, error } = await supabase
      .from('dj_submissions')
      .select('name, status')
      .eq('month', month);
    if (error) throw new Error(error.message);
    const submitted = (rows || []).map(r => ({ name: r.name.trim(), status: r.status }));
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
    // Inject fixed schedule entries for DJs with recurring weekly schedules.
    // These display as pre-loaded bookings so residents see their schedule on load.
    const fixedSched = FIXED_SCHEDULES[name] || null;
    if (fixedSched) {
      const parts = month.split(' ');
      const monthIdx = MONTH_NAMES.indexOf(parts[0]);
      const year = parseInt(parts[1]);
      if (monthIdx >= 0 && !isNaN(year)) {
        const existing = new Set(schedule.map(s => `${s.date}|${s.slot}|${s.venue}`));
        const days = new Date(year, monthIdx + 1, 0).getDate();
        for (let d = 1; d <= days; d++) {
          const dk = makeDateKey(year, monthIdx + 1, d);
          const dow = new Date(year, monthIdx, d).getDay();
          for (const [venueKey, label] of [['arkbar', 'ARKbar'], ['loveBeach', 'Love Beach']]) {
            const slots = fixedSched[venueKey][dow] || [];
            for (const s of slots) {
              const ns = normalizeSlot(s);
              const key = `${dk}|${ns}|${label}`;
              if (!existing.has(key)) {
                schedule.push({ venue: label, date: dk, slot: ns });
                existing.add(key);
              }
            }
          }
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
    const { error } = await supabase.from('dj_signoffs').insert(
      { date, slot: normalizeSlot(slot), name, venue, month, timestamp: new Date().toISOString(), action: 'sign' }
    );
    if (error) throw new Error(error.message);
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
    const ts = new Date().toISOString();
    const rows = slots.map(({ slot, venue }) => ({
      date, slot: normalizeSlot(slot), name, venue, month, timestamp: ts, action: 'sign',
    }));
    const { error } = await supabase.from('dj_signoffs').insert(rows);
    if (error) throw new Error(error.message);
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
    // Read all signoff log entries for this DJ/date/month
    const { data: rows, error: readError } = await supabase.from('dj_signoffs')
      .select('*').eq('month', month).ilike('name', name).eq('date', date);
    if (readError) throw new Error(readError.message);
    // Determine which slot|venue combos are currently net-signed
    const net = {};
    (rows || []).forEach(r => { net[`${r.slot}|${r.venue}`] = (r.action || 'sign'); });
    const toUnsign = Object.entries(net).filter(([, action]) => action === 'sign').map(([k]) => k);
    if (toUnsign.length === 0) return res.json({ success: true, unsignedCount: 0 });
    const ts = new Date().toISOString();
    const unsignRows = toUnsign.map(k => {
      const [slot, venue] = k.split('|');
      return { date, slot, name, venue, month, timestamp: ts, action: 'unsign' };
    });
    const { error: writeError } = await supabase.from('dj_signoffs').insert(unsignRows);
    if (writeError) throw new Error(writeError.message);
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
    const { data, error } = await supabase.from('dj_signoffs')
      .select('*').ilike('name', name).eq('month', month);
    if (error) throw new Error(error.message);
    // Process log: last action per date|slot|venue wins
    const latest = {};
    for (const r of (data || [])) {
      const key = `${r.date}|${normalizeSlot(r.slot)}|${r.venue}`;
      latest[key] = { date: r.date, slot: normalizeSlot(r.slot), venue: r.venue, action: r.action || 'sign' };
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
    const { data, error } = await supabase.from('dj_signoffs').select('*').eq('month', month);
    if (error) throw new Error(error.message);
    // Last action wins per DJ+date+slot+venue key
    const latest = {};
    for (const r of (data || [])) {
      if (!r.name) continue;
      const key = `${r.name}|${r.date}|${normalizeSlot(r.slot)}|${r.venue}`;
      latest[key] = { dj: r.name.trim(), action: r.action || 'sign' };
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

    const [signoffData, djData] = await Promise.all([
      supabase.from('dj_signoffs').select('*').eq('month', month),
      fetchDJs(),
    ]);
    if (signoffData.error) throw new Error(signoffData.error.message);

    const djMap = {};
    (djData.djs || []).forEach(d => { djMap[d.name.trim().toLowerCase()] = d; });

    // Last action wins per DJ+date+slot+venue key
    const latest = {};
    for (const r of (signoffData.data || [])) {
      if (!r.name) continue;
      const key = `${r.name}|${r.date}|${normalizeSlot(r.slot)}|${r.venue}`;
      latest[key] = { dj: r.name.trim(), venue: (r.venue || '').toLowerCase(), action: r.action || 'sign' };
    }

    const hours = {};
    for (const { dj, venue, action } of Object.values(latest)) {
      if (action !== 'sign') continue;
      if (dj === 'Guest DJ') continue;
      if (!hours[dj]) hours[dj] = { arkbar: 0, hip: 0, love: 0, total: 0 };
      const vl = venue.toLowerCase();
      const vk = vl === 'love beach' || vl === 'love' ? 'love'
               : vl === 'hip' ? 'hip' : 'arkbar';
      hours[dj][vk]++;
      hours[dj].total++;
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

    const { error: finalizeError } = await supabase.from('finalized_months').upsert(
      { month, finalized_at: new Date().toISOString() },
      { onConflict: 'month' }
    );
    if (finalizeError) {
      console.error('Finalized Months write failed:', finalizeError.message);
      return res.json({ success: false, error: 'Failed to record finalization: ' + finalizeError.message });
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
    // a. Clear DJ Availability rows for this month
    await supabase.from('dj_availability').delete().eq('month', month);

    // b. Clear DJ Submissions rows for this month
    {
      const { error: subDelError } = await supabase
        .from('dj_submissions')
        .delete()
        .eq('month', month);
      if (subDelError) throw new Error(subDelError.message);
    }

    // c. Flush roster cache
    invalidateAllRosters(month);

    // d. Flush availability cache for this month
    cache.availability.delete(month);

    // e. Clear all roster_assignments for this month
    const { error: rosterDelError } = await supabase.from('roster_assignments').delete().eq('month', month);
    if (rosterDelError) throw new Error(rosterDelError.message);

    res.json({ success: true, month });
  } catch (err) {
    console.error('Reset-month error:', err);
    res.json({ success: false, error: err.message });
  }
});

/* == START ================================================================= */
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
