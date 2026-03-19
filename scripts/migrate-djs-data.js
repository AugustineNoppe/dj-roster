// Migrates DJ data from legacy tables (dj_rates, dj_pins) into the new djs table.
// Seeds recurring_availability and fixed_schedules JSONB columns from hardcoded constants.
// Usage:   node scripts/migrate-djs-data.js
// Re-run:  node scripts/migrate-djs-data.js --force   (deletes all rows and re-inserts)
// Requires: .env with SUPABASE_URL and SUPABASE_SERVICE_KEY

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// --- Step 0: Startup guard ---
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment.');
  console.error('       Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const FORCE = process.argv.includes('--force');

// --- Constants (copied exactly from server.js and lib/business-logic.js) ---

const _A12 = ['14:00\u201315:00','15:00\u201316:00','16:00\u201317:00','17:00\u201318:00',
              '18:00\u201319:00','19:00\u201320:00','20:00\u201321:00','21:00\u201322:00',
              '22:00\u201323:00','23:00\u201300:00','00:00\u201301:00','01:00\u201302:00'];
const _SB  = ['17:00\u201318:00','18:00\u201319:00','19:00\u201320:00','20:00\u201321:00',
              '21:00\u201322:00','22:00\u201323:00','23:00\u201300:00','00:00\u201301:00','01:00\u201302:00'];
const _AW  = ['17:00\u201318:00','18:00\u201319:00','19:00\u201320:00','20:00\u201321:00',
              '21:00\u201322:00','22:00\u201323:00','23:00\u201300:00','00:00\u201301:00','01:00\u201302:00'];
const _MT  = ['17:00\u201318:00','18:00\u201319:00','19:00\u201320:00','20:00\u201321:00',
              '21:00\u201322:00','22:00\u201323:00','23:00\u201300:00','00:00\u201301:00','01:00\u201302:00'];
const _MS  = ['18:00\u201319:00','19:00\u201320:00','20:00\u201321:00','21:00\u201322:00',
              '22:00\u201323:00','23:00\u201300:00','00:00\u201301:00','01:00\u201302:00'];

// Source: server.js lines 145-154
const FIXED_AVAILABILITY = {
  'Alex RedWhite': { 0:_A12, 1:_A12, 2:_A12, 3:_AW, 4:_A12, 5:_A12, 6:_A12 },
  'Raffo DJ':      { 0:_A12, 1:_A12, 2:_A12, 3:_A12, 4:_A12, 5:_A12, 6:_A12 },
  'Sound Bogie':   { 1:_SB, 2:_SB, 3:_SB, 4:_SB, 5:_SB, 6:_SB },
  'Vozka':         { 1:_A12, 2:_A12, 5:_A12 },
  'Tobi':          { 4:_A12 },
  'Buba':          { 2:_A12, 3:_A12, 4:_A12, 5:_A12, 6:_A12 },
  'Donsine':       { 4:_A12, 5:_A12, 6:_A12, 0:_A12 },
  'Mostyx':        { 0:_A12, 1:_A12, 2:_A12, 3:_A12, 4:_MT, 5:_A12, 6:_MS },
};

// Source: lib/business-logic.js lines 47-60
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

// Source: lib/business-logic.js line 35
const RESIDENTS = ['Alex RedWhite', 'Raffo DJ', 'Sound Bogie'];

// --- Helpers ---

// Normalize en-dash/em-dash to hyphen for deduplication keying only.
// The original display name is preserved for the actual insert.
function canonicalizeName(name) {
  return name.trim().replace(/[\u2013\u2014]/g, '-');
}

// --- Main ---

async function main() {
  let errorCount = 0;

  console.log('=== DJ Migration Script ===');
  console.log(`Mode: ${FORCE ? 'FORCE (will delete and re-insert all rows)' : 'NORMAL (skip if djs already has rows)'}`);
  console.log('');

  // --- Step 1: Idempotency check ---
  const { count: existingCount, error: countError } = await supabase
    .from('djs')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.error('ERROR: Failed to count rows in djs:', countError.message);
    process.exit(1);
  }

  if (existingCount > 0 && !FORCE) {
    console.log(`djs table already has ${existingCount} rows. Use --force to re-run.`);
    process.exit(0);
  }

  if (FORCE && existingCount > 0) {
    console.log(`--force: Deleting ${existingCount} existing rows from djs...`);
    const { error: deleteError } = await supabase
      .from('djs')
      .delete()
      .not('id', 'is', null);

    if (deleteError) {
      console.error('ERROR: Failed to delete rows from djs:', deleteError.message);
      process.exit(1);
    }
    console.log('Deleted all existing djs rows. Proceeding with fresh migration.');
    console.log('');
  }

  // --- Step 2: Read legacy tables ---
  console.log('Reading legacy tables...');

  const { data: ratesRows, error: ratesError } = await supabase
    .from('dj_rates')
    .select('name, rate');

  if (ratesError) {
    console.error('ERROR: Failed to fetch dj_rates:', ratesError.message);
    process.exit(1);
  }

  const { data: pinsRows, error: pinsError } = await supabase
    .from('dj_pins')
    .select('name, pin');

  if (pinsError) {
    console.error('ERROR: Failed to fetch dj_pins:', pinsError.message);
    process.exit(1);
  }

  console.log(`dj_rates: ${ratesRows ? ratesRows.length : 0} rows`);
  console.log(`dj_pins:  ${pinsRows ? pinsRows.length : 0} rows`);

  if (!ratesRows || ratesRows.length === 0) {
    console.error('ERROR: dj_rates returned 0 rows. Cannot proceed with empty source data.');
    process.exit(1);
  }
  if (!pinsRows || pinsRows.length === 0) {
    console.error('ERROR: dj_pins returned 0 rows. Cannot proceed without PINs.');
    process.exit(1);
  }
  console.log('');

  // --- Step 3: Deduplicate and audit ---
  console.log('Building deduplicated maps...');

  const rateMap = new Map(); // canonical-key -> { name: display_name, rate }
  for (const row of ratesRows) {
    const key = canonicalizeName(row.name).toLowerCase();
    if (rateMap.has(key)) {
      console.warn(`WARNING: DUPLICATE name in dj_rates: "${rateMap.get(key).name}" vs "${row.name}" — keeping first occurrence`);
      continue;
    }
    rateMap.set(key, { name: row.name, rate: row.rate });
  }

  const pinsMap = new Map(); // canonical-key -> pin_hash
  for (const row of pinsRows) {
    const key = canonicalizeName(row.name).toLowerCase();
    if (pinsMap.has(key)) {
      console.warn(`WARNING: DUPLICATE name in dj_pins: "${row.name}" — keeping first occurrence`);
      continue;
    }
    pinsMap.set(key, row.pin);
  }

  // Audit: names in dj_rates but NOT in dj_pins
  for (const [key, dj] of rateMap) {
    if (!pinsMap.has(key)) {
      console.warn(`WARNING: "${dj.name}" exists in dj_rates but has NO matching PIN in dj_pins — will skip`);
    }
  }

  // Audit: names in dj_pins but NOT in dj_rates (informational)
  for (const [key, _pin] of pinsMap) {
    if (!rateMap.has(key)) {
      // Find original name for the warning
      const originalPinRow = pinsRows.find(r => canonicalizeName(r.name).toLowerCase() === key);
      console.warn(`WARNING: "${originalPinRow ? originalPinRow.name : key}" exists in dj_pins but has NO matching rate in dj_rates (informational — will not be inserted)`);
    }
  }
  console.log('');

  // --- Step 4: Build insert rows ---
  console.log('Building insert rows...');

  const insertRows = [];
  for (const [key, dj] of rateMap) {
    const pin_hash = pinsMap.get(key);
    if (!pin_hash) {
      // Already warned in Step 3
      continue;
    }

    // Validate bcrypt hash format
    if (typeof pin_hash !== 'string' || (!pin_hash.startsWith('$2b$') && !pin_hash.startsWith('$2a$'))) {
      console.error(`ERROR: "${dj.name}" has an unexpected pin_hash format (expected $2b$ or $2a$) — skipping`);
      errorCount += 1;
      continue;
    }

    const type = RESIDENTS.includes(dj.name) ? 'resident' : 'casual';

    insertRows.push({
      name: dj.name,
      pin_hash,
      rate: dj.rate,
      type,
      active: true,
      venues: [],
      recurring_availability: {},
      fixed_schedules: {},
      failed_attempts: 0,
      locked_until: null,
    });

    console.log(`  Prepared: "${dj.name}" (rate=${dj.rate}, type=${type})`);
  }

  console.log(`\n${insertRows.length} rows prepared for insert.`);
  console.log('');

  if (insertRows.length === 0) {
    console.error('ERROR: No rows to insert. Check warnings above.');
    process.exit(1);
  }

  // --- Step 5: Insert into djs ---
  console.log('Inserting into djs...');

  const { error: insertError } = await supabase
    .from('djs')
    .insert(insertRows);

  if (insertError) {
    console.error('ERROR: Insert failed:', insertError.message);
    process.exit(1);
  }

  console.log(`Inserted ${insertRows.length} rows into djs.`);
  console.log('');

  // --- Step 6: Seed JSONB columns ---
  console.log('Seeding JSONB columns from constants...');

  // recurring_availability (8 DJs from FIXED_AVAILABILITY)
  for (const djName of Object.keys(FIXED_AVAILABILITY)) {
    const { error: updateError } = await supabase
      .from('djs')
      .update({ recurring_availability: FIXED_AVAILABILITY[djName] })
      .eq('name', djName);

    if (updateError) {
      console.error(`  ERROR seeding recurring_availability for "${djName}": ${updateError.message}`);
      errorCount += 1;
    } else {
      console.log(`  recurring_availability set for "${djName}"`);
    }
  }

  // fixed_schedules (only Davoted)
  for (const djName of Object.keys(FIXED_SCHEDULES)) {
    const { error: updateError } = await supabase
      .from('djs')
      .update({ fixed_schedules: FIXED_SCHEDULES[djName] })
      .eq('name', djName);

    if (updateError) {
      console.error(`  ERROR seeding fixed_schedules for "${djName}": ${updateError.message}`);
      errorCount += 1;
    } else {
      console.log(`  fixed_schedules set for "${djName}"`);
    }
  }
  console.log('');

  // --- Step 7: Verification output ---
  console.log('--- VERIFICATION ---');

  const { data: djRows, error: verifyError } = await supabase
    .from('djs')
    .select('name, rate, type, active, recurring_availability, fixed_schedules');

  if (verifyError) {
    console.error('ERROR: Failed to fetch djs for verification:', verifyError.message);
    errorCount += 1;
  } else {
    console.log(`djs table row count: ${djRows.length}`);
    console.log('');

    for (const dj of djRows) {
      const hasAvail = dj.recurring_availability && Object.keys(dj.recurring_availability).length > 0;
      const hasSched = dj.fixed_schedules && Object.keys(dj.fixed_schedules).length > 0;

      // Cross-table check against dj_availability
      const { count: availCount, error: availError } = await supabase
        .from('dj_availability')
        .select('*', { count: 'exact', head: true })
        .ilike('name', dj.name);

      const availDisplay = availError ? 'ERR' : String(availCount);
      if (!availError && availCount === 0) {
        console.warn(`  WARNING: "${dj.name}" has 0 rows in dj_availability — name mismatch risk`);
      }

      console.log(
        `  ${dj.name}: rate=${dj.rate} type=${dj.type} active=${dj.active}` +
        ` recurring=${hasAvail ? 'YES' : 'EMPTY'}` +
        ` fixed=${hasSched ? 'YES' : 'EMPTY'}` +
        ` availability_rows=${availDisplay}`
      );
    }
  }

  console.log('');
  console.log('--- NEXT STEP ---');
  console.log('Verify output above matches expected DJ roster.');
  console.log('Test each DJ login with their existing PIN.');
  console.log('Then run: scripts/drop-legacy-tables.sql (SEPARATELY, after manual verification)');

  console.log('');
  if (errorCount > 0) {
    console.error(`MIGRATION COMPLETE WITH ${errorCount} ERROR(S) — review errors above before proceeding`);
    process.exit(1);
  } else {
    console.log('=== MIGRATION COMPLETE ===');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
