/**
 * verify-finalization.js
 *
 * Offline finalization accounting verification script.
 * Replays the POST /api/roster/finalize accounting logic against live Supabase
 * data for a given month — without writing to finalized_months.
 *
 * Usage:
 *   node scripts/verify-finalization.js "March 2026"
 *
 * Requires: .env with SUPABASE_URL and SUPABASE_SERVICE_KEY
 *
 * last-action-wins logic mirrors server.js POST /api/roster/finalize exactly.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const month = process.argv[2];

if (!month) {
  console.error('Usage: node scripts/verify-finalization.js "March 2026"');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Normalize a time slot string to canonical en-dash format.
 * Mirrors the normalizeSlot() function in server.js.
 */
function normalizeSlot(slot) {
  if (!slot) return slot;
  // Replace hyphen-minus variants with en-dash
  return slot.replace(/\s*[-\u2012\u2013\u2014\u2015]\s*/g, '\u2013');
}

async function main() {
  try {
    // 1. Fetch dj_signoffs for the month, ordered by timestamp ascending (last-action-wins)
    const { data: signoffs, error: signoffError } = await supabase
      .from('dj_signoffs')
      .select('*')
      .eq('month', month)
      .order('timestamp', { ascending: true });

    if (signoffError) {
      console.error('Error fetching dj_signoffs:', signoffError.message);
      process.exit(1);
    }

    // 2. Fetch dj_rates for rate lookup
    const { data: rates, error: ratesError } = await supabase
      .from('dj_rates')
      .select('*');

    if (ratesError) {
      console.error('Error fetching dj_rates:', ratesError.message);
      process.exit(1);
    }

    // 3. Check if month is already finalized (warn but continue)
    const { data: finalizedRows, error: finalizedError } = await supabase
      .from('finalized_months')
      .select('month')
      .eq('month', month);

    if (!finalizedError && finalizedRows && finalizedRows.length > 0) {
      console.warn(`WARNING: ${month} is already finalized. Showing accounting preview anyway.\n`);
    }

    // 4. Build djMap keyed by lowercase trimmed name (mirrors server.js line 1296)
    const djMap = {};
    (rates || []).forEach(d => {
      djMap[d.name.trim().toLowerCase()] = {
        name: d.name,
        rate: parseInt(d.rate) || 0,
      };
    });

    // 5. Last-action-wins: iterate timestamp-ordered signoffs, overwrite by unique key
    //    Key = name|date|normalizedSlot|venue (mirrors server.js lines 1299-1304)
    const latest = {};
    for (const r of (signoffs || [])) {
      if (!r.name) continue;
      const key = `${r.name}|${r.date}|${normalizeSlot(r.slot)}|${r.venue}`;
      latest[key] = {
        dj: r.name.trim(),
        venue: (r.venue || '').toLowerCase(),
        action: r.action || 'sign',
      };
    }

    // 6. Accumulate hours per DJ per venue (mirrors server.js lines 1306-1316)
    const hours = {};
    for (const { dj, venue, action } of Object.values(latest)) {
      if (action !== 'sign') continue;
      if (dj === 'Guest DJ') continue; // Guest DJ excluded from accounting
      if (!hours[dj]) hours[dj] = { arkbar: 0, hip: 0, love: 0, total: 0 };
      const vl = venue.toLowerCase();
      // venue normalization: 'ARKbar'->'arkbar', 'HIP'->'hip', 'Love Beach'->'love'
      const vk = vl === 'love beach' || vl === 'love' ? 'love'
               : vl === 'hip' ? 'hip' : 'arkbar';
      hours[dj][vk]++;
      hours[dj].total++;
    }

    // 7. Build report rows sorted by DJ name (mirrors server.js lines 1318-1327)
    const report = [];
    let grandTotal = 0, grandCost = 0;
    Object.keys(hours).sort().forEach(djName => {
      const h = hours[djName];
      const info = djMap[djName.trim().toLowerCase()];
      const rate = info ? info.rate : 0;
      const cost = h.total * rate; // 1 slot = 1 hour; rate is per-hour from dj_rates
      grandTotal += h.total;
      grandCost += cost;
      report.push({ name: djName, arkbar: h.arkbar, hip: h.hip, love: h.love, total: h.total, rate, cost });
    });

    // 8. Print formatted table
    console.log(`=== Finalization Preview: ${month} ===`);
    console.log('');

    const COL_NAME = 20;
    const COL_NUM  = 7;

    const pad = (s, n) => String(s).padEnd(n);
    const padR = (s, n) => String(s).padStart(n);

    const header = pad('DJ Name', COL_NAME) +
      padR('ARKbar', COL_NUM) + padR('HIP', COL_NUM) +
      padR('Love', COL_NUM)   + padR('Total', COL_NUM) +
      padR('Rate', COL_NUM)   + padR('Cost', COL_NUM);
    const divider = '-'.repeat(header.length);

    console.log(header);
    console.log(divider);

    if (report.length === 0) {
      console.log('  (no signed-off slots found)');
    } else {
      for (const row of report) {
        console.log(
          pad(row.name, COL_NAME) +
          padR(row.arkbar, COL_NUM) + padR(row.hip, COL_NUM) +
          padR(row.love,   COL_NUM) + padR(row.total, COL_NUM) +
          padR(row.rate,   COL_NUM) + padR(row.cost,  COL_NUM)
        );
      }
    }

    console.log(divider);
    console.log(
      pad('GRAND TOTAL', COL_NAME) +
      padR('', COL_NUM) + padR('', COL_NUM) +
      padR('', COL_NUM) + padR(grandTotal, COL_NUM) +
      padR('', COL_NUM) + padR(grandCost, COL_NUM)
    );

    console.log('');
    console.log(`Net-signed slots: ${grandTotal}`);
    console.log(`Unique DJs: ${report.length}`);

    process.exit(0);
  } catch (err) {
    console.error('Unexpected error:', err.message || err);
    process.exit(1);
  }
}

main();
