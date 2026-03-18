// One-time migration: hash existing plaintext PINs in dj_pins table.
// Run ONCE after deploying the bcrypt auth changes in server.js.
// Usage: node scripts/hash-existing-pins.js
// Requires: .env with SUPABASE_URL and SUPABASE_SERVICE_KEY
// Safe to re-run: skips already-hashed PINs (starting with $2b$ or $2a$).

require('dotenv').config();
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  console.log('Starting PIN migration...');

  const { data: rows, error: fetchError } = await supabase
    .from('dj_pins')
    .select('name, pin');

  if (fetchError) {
    console.error('Failed to fetch dj_pins:', fetchError.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log('No rows found in dj_pins. Nothing to migrate.');
    process.exit(0);
  }

  let hashed = 0;
  let alreadyHashed = 0;
  let errors = 0;

  for (const row of rows) {
    const { name, pin } = row;

    // Skip if already a bcrypt hash
    if (typeof pin === 'string' && (pin.startsWith('$2b$') || pin.startsWith('$2a$'))) {
      alreadyHashed += 1;
      continue;
    }

    try {
      const hashedPin = await bcrypt.hash(String(pin).trim(), 10);
      const { error: updateError } = await supabase
        .from('dj_pins')
        .update({ pin: hashedPin })
        .eq('name', name);

      if (updateError) {
        console.error('Error updating PIN for:', name, '—', updateError.message);
        errors += 1;
      } else {
        console.log('Hashed PIN for:', name);
        hashed += 1;
      }
    } catch (err) {
      console.error('Unexpected error for:', name, '—', err.message);
      errors += 1;
    }
  }

  console.log(`\nMigration complete: ${hashed} PINs hashed, ${alreadyHashed} already hashed, ${errors} errors`);

  if (errors > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
