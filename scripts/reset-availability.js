require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  console.log('Resetting DJ availability and submissions...\n');

  // Delete all dj_availability rows
  const { error: availErr } = await supabase
    .from('dj_availability')
    .delete()
    .neq('id', 0); // Supabase requires a filter — this matches all rows
  if (availErr) { console.error('Failed to delete dj_availability:', availErr.message); process.exit(1); }

  // Delete all dj_submissions rows
  const { error: subErr } = await supabase
    .from('dj_submissions')
    .delete()
    .neq('id', 0);
  if (subErr) { console.error('Failed to delete dj_submissions:', subErr.message); process.exit(1); }

  // Confirm both tables are empty
  const [{ count: availCount }, { count: subCount }] = await Promise.all([
    supabase.from('dj_availability').select('*', { count: 'exact', head: true }),
    supabase.from('dj_submissions').select('*', { count: 'exact', head: true }),
  ]);

  console.log(`dj_availability rows: ${availCount}`);
  console.log(`dj_submissions rows: ${subCount}`);

  if (availCount === 0 && subCount === 0) {
    console.log('\nReset complete. Both tables are empty.');
  } else {
    console.error('\nWARNING: Tables are not empty after delete. Check RLS policies.');
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
