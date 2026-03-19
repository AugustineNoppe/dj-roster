'use strict';

/* == UTILITY FUNCTIONS ===================================================== */

// CANONICAL slot format — always use normalizeSlot() on slot values before DB writes and after DB reads.
const normalizeSlot = s => s ? s.replace(/[-\u2013\u2014]/g, '\u2013') : s;

const pad2 = n => String(n).padStart(2, '0');

const makeDateKey = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const SHORT_MONTHS = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};

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

/* == CONSTANTS ============================================================= */

const ALL_SLOTS = [
  '14:00\u201315:00','15:00\u201316:00','16:00\u201317:00','17:00\u201318:00',
  '18:00\u201319:00','19:00\u201320:00','20:00\u201321:00','21:00\u201322:00',
  '22:00\u201323:00','23:00\u201300:00','00:00\u201301:00','01:00\u201302:00'
];

/* == DIAGNOSTIC TEMPLATE =================================================== */
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

/* == AVAILABILITY MAP ====================================================== */

/**
 * Build availability map from already-fetched data (no Supabase dependency).
 *
 * @param {object} params
 * @param {Array}  params.portalRows    - rows from dj_availability: [{ name, date, slot, month, status }]
 * @param {Set}    params.submittedNames - Set of lowercase DJ names who submitted this month
 * @param {string} params.month         - "Month YYYY" e.g. "March 2026"
 * @param {object} params.fixedSchedules - FIXED_SCHEDULES object
 * @returns {{ dateKey: { slot: [djName, ...] } }}
 */
function buildAvailabilityMap({ portalRows, submittedNames, month, fixedSchedules }) {
  const parts = month.split(' ');
  const monthIdx = MONTH_NAMES.indexOf(parts[0]);
  const year = parseInt(parts[1]);
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();

  // Filter portal rows to only submitted DJs
  const rows = (portalRows || []).filter(r =>
    submittedNames.has(r.name.trim().toLowerCase())
  );

  const map = {};

  // Build per-DJ status lookup: { djName: { dateKey: { slot: status } } }
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

  // Auto-populate fixed recurring monthly schedules from fixedSchedules.
  if (year !== undefined && monthIdx >= 0 && fixedSchedules) {
    for (const [djName, sched] of Object.entries(fixedSchedules)) {
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

  return map;
}

/* == FINALIZATION ACCOUNTING =============================================== */

/**
 * Compute the finalization report from signoff rows.
 *
 * @param {object} params
 * @param {Array}  params.signoffRows - rows ordered by timestamp: [{ name, date, slot, venue, action, timestamp }]
 * @param {object} params.djRateMap   - { lowercaseName: { name, rate } }
 * @returns {{ report: Array, grandTotal: number, grandCost: number }}
 */
function computeFinalizationReport({ signoffRows, djRateMap }) {
  // Last action wins per DJ+date+slot+venue key
  const latest = {};
  for (const r of (signoffRows || [])) {
    if (!r.name) continue;
    const key = `${r.name}|${r.date}|${normalizeSlot(r.slot)}|${r.venue}`;
    latest[key] = { dj: r.name.trim(), venue: (r.venue || '').toLowerCase(), action: r.action || 'sign' };
  }

  // AUDIT (Phase 2 Plan 03): accounting verified correct.
  // - last-action-wins: timestamp-ordered, unique key per dj+date+slot+venue
  // - venue map: 'ARKbar'->'arkbar', 'HIP'->'hip', 'Love Beach'/'love'->'love'
  // - Guest DJ excluded; rate lookup: djRateMap[djName.trim().toLowerCase()]
  // - 1 slot = 1 hour; cost = total * rate (integer from dj_rates)
  // - no double-count possible: Object.values(latest) has one entry per unique key
  const hours = {};
  for (const { dj, venue, action } of Object.values(latest)) {
    if (action !== 'sign') continue;
    if (dj === 'Guest DJ') continue;
    if (!hours[dj]) hours[dj] = { arkbar: 0, hip: 0, love: 0, total: 0 };
    const vl = venue.toLowerCase();
    // venue normalization: 'ARKbar'->'arkbar', 'HIP'->'hip', 'Love Beach'->'love'
    const vk = vl === 'love beach' || vl === 'love' ? 'love'
             : vl === 'hip' ? 'hip' : 'arkbar';
    hours[dj][vk]++;
    hours[dj].total++;
  }

  const report = [];
  let grandTotal = 0, grandCost = 0;
  Object.keys(hours).sort().forEach(djName => {
    const h = hours[djName];
    const info = djRateMap[djName.trim().toLowerCase()];
    const rate = info ? info.rate : 0;
    const cost = h.total * rate; // 1 slot = 1 hour; rate is per-hour from dj_rates
    grandTotal += h.total; grandCost += cost;
    report.push({ name: djName, arkbar: h.arkbar, hip: h.hip, love: h.love, total: h.total, rate, cost });
  });

  return { report, grandTotal, grandCost };
}

/* == AUTO-SUGGEST TEMPLATE BLOCKS ========================================== */

/**
 * Build contiguous block groups from a DJ's template slots on a given day+venue.
 * Returns an array of slot arrays, where each inner array is one contiguous block.
 *
 * @param {string} venue      - 'arkbar', 'love', or 'hip'
 * @param {number} dow        - day of week (0=Sun, 6=Sat)
 * @param {string} djName     - DJ's display name
 * @param {number} satToggle  - Saturday toggle index (for love/hip venues)
 * @param {object} [template] - DIAG_FIXED_TEMPLATE-shaped object; defaults to DIAG_FIXED_TEMPLATE
 * @returns {string[][]}
 */
function getDJTemplateBlocks(venue, dow, djName, satToggle, template) {
  if (template === undefined) template = DIAG_FIXED_TEMPLATE;

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

  let tpl = null;
  let orderedSlots = [];

  if (venue === 'arkbar') {
    tpl = template.arkbar[dow] || {};
    orderedSlots = ALL_ARKBAR;
  } else if (venue === 'love') {
    if (dow === 6) {
      tpl = satToggle % 2 === 0 ? template.love.satA : template.love.satB;
      orderedSlots = ALL_LOVE_SATURDAY;
    } else {
      tpl = template.love.weekday[dow] || {};
      orderedSlots = ALL_LOVE_WEEKDAY;
    }
  } else if (venue === 'hip') {
    let hipDJ = template.hip[dow];
    if (!hipDJ) return [];
    if (Array.isArray(hipDJ)) hipDJ = hipDJ[satToggle % hipDJ.length];
    if (hipDJ !== djName) return [];
    return [HIP_SLOTS];
  }

  if (!tpl) return [];

  // Find contiguous runs of this DJ's slots in template order
  const blocks = [];
  let current = [];
  for (const slot of orderedSlots) {
    if (tpl[slot] === djName) {
      current.push(slot);
    } else {
      if (current.length > 0) { blocks.push(current); current = []; }
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

/* == EXPORTS =============================================================== */

module.exports = {
  normalizeSlot,
  pad2,
  makeDateKey,
  parseDateKey,
  ALL_SLOTS,
  MONTH_NAMES,
  SHORT_MONTHS,
  DIAG_FIXED_TEMPLATE,
  buildAvailabilityMap,
  computeFinalizationReport,
  getDJTemplateBlocks,
};
