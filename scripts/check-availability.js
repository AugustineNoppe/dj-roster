require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MONTH = process.argv[2] || 'March 2026';

async function main() {
  // Raw unfiltered count — no month, no slot, no name filter
  console.log('--- RAW ROW COUNTS (no filters) ---');
  // Fetch all rows, no filters — paginate to avoid 1000-row default limit
  const allRows = [];
  let rawOffset = 0;
  let allErr = null;
  while (true) {
    const { data, error } = await supabase
      .from('dj_availability')
      .select('name')
      .range(rawOffset, rawOffset + 999);
    if (error) { allErr = error; break; }
    allRows.push(...(data || []));
    if (!data || data.length < 1000) break;
    rawOffset += 1000;
  }
  if (allErr) {
    console.log(`  Query error: ${allErr.message}`);
  } else {
    const counts = {};
    for (const r of allRows) counts[r.name] = (counts[r.name] || 0) + 1;
    const sorted = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
    if (sorted.length === 0) {
      console.log('  ** ZERO rows in entire dj_availability table **');
    } else {
      for (const [name, count] of sorted) console.log(`  ${name}: ${count} rows`);
    }
    console.log(`  Total rows visible: ${allRows.length}`);
  }
  console.log('');

  console.log(`Checking DJ availability for: ${MONTH}\n`);

  // Paginate dj_availability to avoid Supabase's default 1000-row limit
  async function fetchAllAvailability(month) {
    const rows = [];
    const PAGE = 1000;
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from('dj_availability')
        .select('name, status')
        .eq('month', month)
        .range(offset, offset + PAGE - 1);
      if (error) return { data: null, error };
      rows.push(...(data || []));
      if (!data || data.length < PAGE) break;
      offset += PAGE;
    }
    return { data: rows, error: null };
  }

  const [{ data: djRows, error: djErr }, { data: subRows, error: subErr }, { data: availRows, error: availErr }] = await Promise.all([
    supabase.from('dj_rates').select('name'),
    supabase.from('dj_submissions').select('*').eq('month', MONTH),
    fetchAllAvailability(MONTH),
  ]);

  if (djErr) { console.error('dj_rates query failed:', djErr.message); process.exit(1); }
  if (subErr) { console.error('dj_submissions query failed:', subErr.message); process.exit(1); }
  if (availErr) { console.error('dj_availability query failed:', availErr.message); process.exit(1); }

  const submissionMap = {};
  const submissionTimes = {};
  for (const r of (subRows || [])) {
    submissionMap[r.name.trim()] = r.status;
    submissionTimes[r.name.trim()] = r.updated_at || r.created_at || '?';
  }

  const availStats = {};
  for (const r of (availRows || [])) {
    const n = r.name.trim();
    if (!availStats[n]) availStats[n] = { available: 0, unavailable: 0 };
    availStats[n][r.status === 'unavailable' ? 'unavailable' : 'available']++;
  }

  const table = (djRows || []).map(d => {
    const n = d.name.trim();
    const stats = availStats[n] || { available: 0, unavailable: 0 };
    return {
      DJ: n,
      Submission: submissionMap[n] || 'none',
      SubmittedAt: submissionTimes[n] || '-',
      Available: stats.available,
      Unavailable: stats.unavailable,
      Total: stats.available + stats.unavailable,
    };
  }).sort((a, b) => a.DJ.localeCompare(b.DJ));

  console.table(table);

  const submitted = table.filter(d => d.Submission === 'submitted');
  const noData = submitted.filter(d => d.Total === 0);
  const noUnavail = submitted.filter(d => d.Total > 0 && d.Unavailable === 0);

  console.log(`\nSummary:`);
  console.log(`  Total DJs: ${table.length}`);
  console.log(`  Submitted: ${submitted.length}`);
  console.log(`  Not submitted: ${table.filter(d => d.Submission === 'none').length}`);
  console.log(`  Submitted but zero availability rows: ${noData.length}`);
  if (noData.length > 0) console.log(`    -> ${noData.map(d => d.DJ).join(', ')}`);
  console.log(`  Submitted but zero unavailable slots: ${noUnavail.length}`);
  if (noUnavail.length > 0) console.log(`    -> ${noUnavail.map(d => d.DJ).join(', ')}`);

  // Check for other months to see if the pattern is month-specific
  console.log(`\n--- Checking ALL months in dj_availability ---`);
  const allMonths = [];
  let moOffset = 0;
  while (true) {
    const { data } = await supabase
      .from('dj_availability')
      .select('month, name')
      .range(moOffset, moOffset + 999);
    allMonths.push(...(data || []));
    if (!data || data.length < 1000) break;
    moOffset += 1000;
  }
  const monthCounts = {};
  for (const r of (allMonths || [])) {
    const k = `${r.month}|${r.name.trim()}`;
    monthCounts[k] = (monthCounts[k] || 0) + 1;
  }
  const byMonth = {};
  for (const [k, count] of Object.entries(monthCounts)) {
    const [m, dj] = k.split('|');
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push({ dj, rows: count });
  }
  for (const [m, djs] of Object.entries(byMonth).sort()) {
    console.log(`\n  ${m}: ${djs.length} DJs with data`);
    djs.sort((a, b) => a.dj.localeCompare(b.dj));
    for (const d of djs) console.log(`    ${d.dj}: ${d.rows} rows`);
  }

  // Check dj_submissions for all months
  console.log(`\n--- Checking ALL months in dj_submissions ---`);
  const allSubs = [];
  let subOffset = 0;
  while (true) {
    const { data } = await supabase
      .from('dj_submissions')
      .select('*')
      .range(subOffset, subOffset + 999);
    allSubs.push(...(data || []));
    if (!data || data.length < 1000) break;
    subOffset += 1000;
  }
  const subByMonth = {};
  for (const r of allSubs) {
    if (!subByMonth[r.month]) subByMonth[r.month] = [];
    subByMonth[r.month].push({ dj: r.name.trim(), status: r.status, cols: Object.keys(r).join(',') });
  }
  for (const [m, subs] of Object.entries(subByMonth).sort()) {
    console.log(`\n  ${m}: ${subs.length} submissions`);
    subs.sort((a, b) => a.dj.localeCompare(b.dj));
    for (const s of subs) console.log(`    ${s.dj}: ${s.status} [cols: ${s.cols}]`);
  }

  // Check table structure — unique constraints
  console.log(`\n--- Checking dj_availability table info ---`);
  const { data: colInfo, error: colErr } = await supabase.rpc('get_table_info', { table_name: 'dj_availability' }).maybeSingle();
  if (colErr) {
    console.log('  (Could not query table info via RPC — checking via sample row)');
    // Try inserting and deleting a test row to check for constraint issues
    const testRow = { name: '__TEST__', date: '2099-01-01', slot: '00:00-01:00', month: 'January 2099', status: 'available' };
    const { error: insertErr } = await supabase.from('dj_availability').insert(testRow);
    if (insertErr) {
      console.log(`  Test insert FAILED: ${insertErr.message} (code: ${insertErr.code})`);
    } else {
      console.log('  Test insert OK — no RLS blocking service key inserts');
      await supabase.from('dj_availability').delete().eq('name', '__TEST__').eq('month', 'January 2099');
    }
  } else {
    console.log('  Table info:', JSON.stringify(colInfo, null, 2));
  }

  // Check if RLS is enabled
  console.log(`\n--- Checking RLS policies ---`);
  const { data: rlsData, error: rlsErr } = await supabase
    .from('dj_availability')
    .select('*', { count: 'exact', head: true })
    .eq('month', MONTH);
  console.log(`  Total rows visible with service key for ${MONTH}: ${rlsData}  (count header used)`);
  if (rlsErr) console.log(`  RLS check error: ${rlsErr.message}`);
}

main().catch(err => { console.error(err); process.exit(1); });
