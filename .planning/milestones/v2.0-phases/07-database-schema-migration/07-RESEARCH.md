# Phase 7: Database Schema & Migration — Research

**Researched:** 2026-03-19
**Domain:** Supabase PostgreSQL schema creation, Node.js data migration scripts, JSONB column seeding
**Confidence:** HIGH — all findings are directly evidenced from codebase inspection of server.js, lib/business-logic.js, and existing migration scripts

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DB-01 | Single `djs` table created with columns: id, name, pin_hash, rate, type, active, venues, recurring_availability (JSONB), fixed_schedules (JSONB), failed_attempts, locked_until | Schema SQL pattern established from existing migration (migrate-availability-timestamps.sql); full column set defined below |
| DB-02 | Migration script populates `djs` from dj_rates + dj_pins, deduplicating en-dash/hyphen name variants | Node.js migration pattern established from hash-existing-pins.js; deduplication via lower(trim(name)) documented |
| DB-03 | Migration seeds recurring_availability JSONB from FIXED_AVAILABILITY constants and fixed_schedules JSONB from FIXED_SCHEDULES constants | Both constants are inspected in full below; JSONB seeding pattern via Supabase JS client documented |
| DB-04 | Old tables (dj_rates, dj_pins) dropped after verified cutover | Drop is a manual step separate from the migration script; verification checklist documented |
</phase_requirements>

---

## Summary

Phase 7 creates the `djs` table in Supabase and populates it completely from two legacy tables (`dj_rates`, `dj_pins`) and two hardcoded code constants (`FIXED_AVAILABILITY`, `FIXED_SCHEDULES`). Nothing in the application reads from `djs` yet — that is Phase 8. Phase 7's only job is to produce a correct, complete `djs` table so subsequent phases have a reliable data source.

The technical work is two scripts: one SQL file run in the Supabase SQL Editor (creates the table), and one Node.js script (migrates data and seeds JSONB). The project already has this exact split pattern: `scripts/migrate-availability-timestamps.sql` for schema and `scripts/hash-existing-pins.js` for data migration. No new packages are needed.

The primary risk is the known en-dash/hyphen duplicate issue in `dj_rates`. The migration script must handle deduplication explicitly; inserting without it will violate the `UNIQUE` constraint on `djs.name` and abort. A secondary risk is name-spelling consistency: if any name is normalized differently than how it appears in `dj_availability`/`dj_signoffs`, lookups against those tables will silently return zero rows after Phase 8 cutover. The mitigation is a cross-table audit built into the migration script's verification output.

**Primary recommendation:** Write a single idempotent Node.js migration script that (1) audits duplicates and prints them, (2) inserts deduplicated rows with pin hashes, (3) seeds JSONB columns from the two constants, (4) prints verification counts — and stop there. The DROP TABLE step (DB-04) is a separate, manually-triggered confirmation that happens only after a human has verified all success criteria.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | 2.99.1 (installed) | All DB operations: CREATE via SQL Editor, INSERT/UPDATE from Node.js script | Already installed and in production; same client used in all existing scripts |
| Node.js built-in | — | Migration script runtime, `dotenv` for env vars | Same pattern as `scripts/hash-existing-pins.js` |
| `bcrypt` | ^6.0.0 (installed) | Not needed in migration — PINs are already hashed in `dj_pins` | Already installed; confirm hashes start with `$2b$` before copying |
| Plain `.sql` | — | Table creation in Supabase SQL Editor | Established project pattern: see `scripts/migrate-availability-timestamps.sql` |

### No New Dependencies

```bash
# No npm install required — all needed packages already in dependencies
```

---

## Architecture Patterns

### Recommended Script Structure

```
scripts/
├── migrate-djs-schema.sql      # Step 1: CREATE TABLE djs — run in Supabase SQL Editor
└── migrate-djs-data.js         # Step 2: populate djs from legacy tables + constants
```

This mirrors the existing split pattern (SQL for schema, Node.js for data transforms).

### Column Name Decision: `fixed_schedules` vs `fixed_schedule`

REQUIREMENTS.md (DB-01, DB-03) and the Phase 7 success criteria both use **`fixed_schedules`** (plural). ARCHITECTURE.md's example SQL uses `fixed_schedule` (singular). The **canonical name is `fixed_schedules` (plural)** — this matches the REQUIREMENTS and the success criteria that the planner will validate against. Use `fixed_schedules` in the CREATE TABLE statement.

### Pattern 1: SQL Migration File (Schema Only)

Create `scripts/migrate-djs-schema.sql` — runs once in the Supabase SQL Editor.

```sql
-- Source: established project pattern (migrate-availability-timestamps.sql)
-- Run in Supabase Dashboard > SQL Editor > New query

CREATE TABLE IF NOT EXISTS djs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text UNIQUE NOT NULL,
  pin_hash              text NOT NULL,
  rate                  integer NOT NULL DEFAULT 0,
  type                  text NOT NULL DEFAULT 'casual',
  active                boolean NOT NULL DEFAULT true,
  venues                text[] DEFAULT '{}',
  recurring_availability jsonb DEFAULT '{}',
  fixed_schedules        jsonb DEFAULT '{}',
  failed_attempts        integer NOT NULL DEFAULT 0,
  locked_until           timestamptz,
  created_at             timestamptz DEFAULT now()
);

-- Verify table was created
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'djs'
ORDER BY ordinal_position;
```

Key decisions locked by REQUIREMENTS:
- Column `failed_attempts` (not `lockout_count`) — matches DB-01 verbatim
- Column `fixed_schedules` (plural) — matches DB-01 and success criterion 5
- `UNIQUE` constraint on `name` — required; catches duplicate-name migration bugs loudly

### Pattern 2: Node.js Data Migration Script

Create `scripts/migrate-djs-data.js` — follows the pattern of `scripts/hash-existing-pins.js`:

```javascript
// Source: scripts/hash-existing-pins.js pattern
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Startup guard — fail loudly if env is missing
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
```

**Deduplication logic** (the critical section — handles en-dash/hyphen variants):

```javascript
// Canonical name: trim, then normalize dashes/en-dashes to a single form
function canonicalizeName(name) {
  return name.trim().replace(/[\u2013\u2014]/g, '-'); // collapse to hyphen for keying only
}

// Build a deduplicated map: canonical-key -> { name: display_name, rate }
// If both "Alex Red-White" and "Alex Red–White" exist, pick one (last wins, or log both)
const rateMap = new Map();
for (const row of ratesRows) {
  const key = canonicalizeName(row.name).toLowerCase();
  if (rateMap.has(key)) {
    console.warn(`DUPLICATE name detected: "${rateMap.get(key).name}" vs "${row.name}" — keeping first`);
    continue; // keep first occurrence
  }
  rateMap.set(key, { name: row.name, rate: row.rate });
}
```

**JOIN with dj_pins** using case-insensitive matching:

```javascript
// For each canonical DJ in rateMap, find their pin in dj_pins
const pinsMap = new Map();
for (const row of pinsRows) {
  pinsMap.set(canonicalizeName(row.name).toLowerCase(), row.pin);
}

for (const [key, dj] of rateMap) {
  const pin_hash = pinsMap.get(key);
  if (!pin_hash) {
    console.warn(`No PIN found for DJ: "${dj.name}" — skipping`);
    continue;
  }
  // ... INSERT into djs
}
```

**JSONB seeding** — pass the raw JS object, never JSON.stringify():

```javascript
// Source: PITFALLS.md — Supabase JS client serializes objects; JSON.stringify causes double-encoding
const { error } = await supabase
  .from('djs')
  .update({
    recurring_availability: FIXED_AVAILABILITY[djName] || {},
    fixed_schedules: FIXED_SCHEDULES[djName] || {},
  })
  .eq('name', djName);
```

### Pattern 3: Idempotency Check

The script should be safe to re-run (mirrors hash-existing-pins.js pattern):

```javascript
// Check if djs table already has rows before inserting
const { count } = await supabase
  .from('djs')
  .select('*', { count: 'exact', head: true });

if (count > 0) {
  console.log(`djs table already has ${count} rows. Use --force to re-run.`);
  process.exit(0);
}
```

### Anti-Patterns to Avoid

- **Calling JSON.stringify() before upserting JSONB fields:** Supabase JS client serializes JS objects correctly. Calling JSON.stringify() first causes the JSONB column to store an escaped string, not a JSON object. Pass the raw JS object.
- **Using `.single()` when multiple rows might match:** If deduplication missed a case, `.single()` throws `PGRST116`. Use `.maybeSingle()` on reads during migration verification.
- **Running DROP TABLE inside the migration script:** The DROP step (DB-04) is explicitly a separate, manually-triggered action per the Phase 7 success criteria. The migration script must not drop old tables.
- **Copying pin_hash without validating bcrypt format:** The existing `dj_pins.pin` column should already contain bcrypt hashes (starting with `$2b$` or `$2a$`) after v1.0's hash-existing-pins.js ran. Log a warning and skip any row where the hash format is unexpected.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Name deduplication key | Custom unicode comparison | `lower(trim(name))` + regex for dash variants | Same approach `normalizeSlot()` uses for slot strings |
| JSONB serialization | Manual JSON.stringify | Pass raw JS object to Supabase client | Client handles serialization; manual stringify causes double-encoding |
| Schema migrations | Knex/Prisma migration runner | SQL file in Supabase SQL Editor | Established project pattern; no new tooling |
| Duplicate-name detection | Manual audit | `SELECT name, COUNT(*) FROM dj_rates GROUP BY name HAVING COUNT(*) > 1` | One SQL query gives the full picture before writing any code |

**Key insight:** The migration is a one-time operation on ~15 DJs. Simple, explicit, verbose code is better than clever code. Log every action, every skip, every warning.

---

## Common Pitfalls

### Pitfall 1: En-dash/Hyphen Duplicate Names in dj_rates

**What goes wrong:** `dj_rates` contains known duplicate rows where some DJ names use a regular hyphen (`-`) and others use an en-dash (`–`, U+2013). The `UNIQUE` constraint on `djs.name` will cause INSERT to fail loudly if both variants are passed. If the deduplication picks the wrong variant, PINs may not match across the JOIN with `dj_pins`.

**Why it happens:** The v1.0 PIN migration used exact-match `.eq('name', name)` without normalization. Duplicates entered at data entry time were never cleaned up.

**How to avoid:**
1. Run the audit query first, before writing the migration: `SELECT name, COUNT(*) FROM dj_rates GROUP BY name HAVING COUNT(*) > 1;`
2. Log both variants when a duplicate is found so the human can verify the canonical spelling.
3. Join `dj_rates` to `dj_pins` via `lower(trim(name))` comparison, not exact match.

**Warning signs:** INSERT fails with a unique constraint violation; logs show "DUPLICATE name detected" for specific DJs.

### Pitfall 2: Name Spelling That Differs From dj_availability Rows

**What goes wrong:** If the migration normalizes a DJ's name (e.g., changes `"Alex Red-White"` to `"Alex RedWhite"`), all historical rows in `dj_availability`, `dj_submissions`, `roster_assignments`, and `dj_signoffs` retain the old spelling. After Phase 8 cutover, availability lookups for that DJ silently return zero rows.

**Why it happens:** Those tables have no foreign key to `dj_rates` or `djs`. Name-string joins are purely convention.

**How to avoid:**
1. Do not rename any DJ's canonical name during migration — only deduplicate character variants to a spelling that already appears consistently in the dependent tables.
2. The migration script's verification step must include a cross-table check: for each inserted DJ name, query `dj_availability` and confirm at least one row matches case-insensitively.

**Warning signs:** After Phase 8 cutover, a DJ's availability page is empty despite having submitted; finalization report shows zero hours for that DJ.

### Pitfall 3: JSONB Field Stored as String Instead of Object

**What goes wrong:** Calling `JSON.stringify(FIXED_AVAILABILITY[djName])` before the Supabase upsert causes the column to store an escaped string (`"{\"0\":[...]}"`) instead of a JSONB object (`{"0":[...]}`). Subsequent reads via Supabase JS client may return the string type instead of an object, breaking all downstream JSON access.

**Why it happens:** Misunderstanding of how the Supabase JS client handles JSONB columns. The client serializes JS objects automatically.

**How to avoid:** Pass the raw JS object directly. If the column already has a bad string value, fix it in SQL: `UPDATE djs SET recurring_availability = recurring_availability::jsonb`.

**Warning signs:** `typeof row.recurring_availability === 'string'` in the Node.js application after migration.

### Pitfall 4: day-of-week Keys Stored as Integers vs Strings in JSONB

**What goes wrong:** The `FIXED_AVAILABILITY` constant uses integer keys (`{ 0: [...], 1: [...] }`). When serialized to JSONB, PostgreSQL stores all JSON object keys as strings. The value stored becomes `{ "0": [...], "1": [...] }`. If Phase 8 code reads this and does `map[0]` (integer key) instead of `map["0"]` or `map[0]` (JavaScript coerces), behavior depends on JS type coercion in object property access.

**Why it happens:** JavaScript silently coerces integer property keys to strings in object literals. The source constant looks like integer keys but they are stored as strings in JSONB.

**How to avoid:** The existing code in `business-logic.js` uses `Object.entries()` on the fixedSchedules objects, which yields string keys — this is already the safe pattern. Verify the migration verification script reads back and tests a spot-check: `const avail = row.recurring_availability; assert(Array.isArray(avail["0"]) || avail[0] === undefined)`.

**Warning signs:** recurring_availability reads return empty on integer key lookup; must use string key.

### Pitfall 5: Missing .env File Causes Silent Zero-Row Reads

**What goes wrong:** If the migration script runs without `SUPABASE_SERVICE_KEY` in `.env`, the Supabase client connects anonymously. Depending on Row Level Security settings, it may read 0 rows from `dj_rates` without error, insert nothing, and exit successfully — reporting "0 DJs migrated" with no indication of error.

**Why it happens:** Supabase client construction does not throw if the service key is missing; it silently uses the anon key.

**How to avoid:** Add an explicit startup check at the top of the script (as shown in the Code Examples section).

---

## Code Examples

### Full Verification Output (end of migration script)

```javascript
// Source: established pattern from hash-existing-pins.js verification section
// Run at end of migration to confirm success before operator proceeds to drop step

async function verifyMigration(insertedNames) {
  console.log('\n--- VERIFICATION ---');

  const { data: djRows, count } = await supabase
    .from('djs')
    .select('name, rate, type, active, recurring_availability, fixed_schedules', { count: 'exact' });

  console.log(`djs table row count: ${count}`);

  for (const dj of djRows) {
    const hasAvail = dj.recurring_availability && Object.keys(dj.recurring_availability).length > 0;
    const hasSched = dj.fixed_schedules && Object.keys(dj.fixed_schedules).length > 0;

    // Cross-table check: does dj_availability have a row for this DJ?
    const { count: availCount } = await supabase
      .from('dj_availability')
      .select('*', { count: 'exact', head: true })
      .ilike('name', dj.name);

    console.log(
      `  ${dj.name}: rate=${dj.rate} type=${dj.type} active=${dj.active}` +
      ` recurring=${hasAvail ? 'YES' : 'EMPTY'}` +
      ` fixed=${hasSched ? 'YES' : 'EMPTY'}` +
      ` availability_rows=${availCount}`
    );
  }

  console.log('\n--- NEXT STEP ---');
  console.log('Manually verify the above output matches expected DJ roster.');
  console.log('Test each DJ login with their existing PIN.');
  console.log('Then run: scripts/drop-legacy-tables.sql (SEPARATELY, after manual verification)');
}
```

### Deduplication Audit Query (run first, before writing migration script)

```sql
-- Run in Supabase SQL Editor BEFORE writing the migration script
-- Understand the actual scope of duplicate names
SELECT name, COUNT(*) as count
FROM dj_rates
GROUP BY name
HAVING COUNT(*) > 1
ORDER BY name;

-- Also check for name mismatches between dj_rates and dj_pins
SELECT r.name as rates_name, p.name as pins_name
FROM dj_rates r
FULL OUTER JOIN dj_pins p ON lower(trim(r.name)) = lower(trim(p.name))
WHERE r.name IS NULL OR p.name IS NULL;
```

### DROP TABLE Script (separate, manually triggered — DB-04)

Create `scripts/drop-legacy-tables.sql` — **not called by the migration script**. Run only after manual verification of all 5 success criteria.

```sql
-- MANUAL STEP — run only after verifying ALL Phase 7 success criteria:
-- 1. SELECT COUNT(*) FROM djs returns expected DJ count with no duplicates
-- 2. Every DJ can log in with existing PIN
-- 3. Availability reads return same results as before migration
-- 4. djs.recurring_availability contains correct FIXED_AVAILABILITY data
-- 5. djs.fixed_schedules contains correct FIXED_SCHEDULES data

DROP TABLE IF EXISTS dj_rates;
DROP TABLE IF EXISTS dj_pins;
```

---

## What The Constants Actually Contain

### FIXED_AVAILABILITY (server.js lines 145–154)

8 DJs have recurring availability defaults. Keys are day-of-week integers 0–6 (Sunday=0). Values are arrays of slot strings using en-dash (U+2013).

DJs with entries: Alex RedWhite, Raffo DJ, Sound Bogie, Vozka, Tobi, Buba, Donsine, Mostyx.

Note: DJs not in FIXED_AVAILABILITY (e.g., Davoted, Pick, Sky, Cocoa, etc.) should have `recurring_availability: {}` in `djs`.

### FIXED_SCHEDULES (lib/business-logic.js lines 47–60)

Only **one DJ** has a fixed schedule: Davoted. The structure is venue -> day-of-week -> slot[].

```
Davoted: {
  arkbar: { 1: [...], 3: [...], 4: [...], 5: [...] },
  loveBeach: { 2: [...], 3: [...] }
}
```

All other DJs should have `fixed_schedules: {}` in `djs`.

### Implication for Seeding

The seeding loop iterates over all DJs in `djs` and sets JSONB columns. Only DJs present in the constant get non-empty JSONB:

```javascript
// Exact names that need FIXED_AVAILABILITY seeded (from server.js lines 146-154):
const FIXED_AVAILABILITY_NAMES = [
  'Alex RedWhite', 'Raffo DJ', 'Sound Bogie', 'Vozka', 'Tobi', 'Buba', 'Donsine', 'Mostyx'
];

// Exact names that need FIXED_SCHEDULES seeded (from business-logic.js lines 48-59):
const FIXED_SCHEDULES_NAMES = ['Davoted'];
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SQL migration files run in Supabase SQL Editor | Same — no change | Established in v1.0 | Zero new tooling overhead |
| Node.js scripts using @supabase/supabase-js | Same — no change | Established in v1.0 | Same pattern, same library |

No "new" approaches apply to this phase. The migration uses established project patterns throughout.

---

## Open Questions

1. **Exact DJ names and counts in production dj_rates**
   - What we know: FIXED_AVAILABILITY references 8 DJs by name; DIAG_FIXED_TEMPLATE references ~15 DJ names; dj_pins has an unknown row count
   - What's unclear: The exact list of all DJs in `dj_rates` is not visible from codebase inspection alone — only a live Supabase query reveals it
   - Recommendation: The migration script's first action should be to print all rows from `dj_rates` and `dj_pins` so the operator sees the full scope before any INSERT occurs

2. **Which variant (hyphen vs en-dash) is "canonical" for duplicate DJ names**
   - What we know: Both `normalizeSlot()` and the existing ilike queries treat the variants as equivalent
   - What's unclear: Which spelling is used in `dj_availability` historical data — this is the "correct" spelling to canonicalize to
   - Recommendation: The deduplication audit query (shown above) should be run and reviewed by the operator before the migration script is finalized

3. **DJ type values for existing DJs**
   - What we know: RESIDENTS constant = ['Alex RedWhite', 'Raffo DJ', 'Sound Bogie'] → these get `type = 'resident'`; all others get `type = 'casual'`
   - What's unclear: Whether any DJs should be classified as 'guest' type
   - Recommendation: Default all non-residents to 'casual' for the migration; type can be changed via the Phase 10 admin UI after launch

---

## Validation Architecture

Phase 7 is a **database-only phase** — no application code changes. All validation is manual inspection of the Supabase database, not automated Jest tests. The existing `lib/business-logic.test.js` suite (49 tests) is unaffected by Phase 7 and should continue to pass.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest ^30.3.0 |
| Config file | package.json `"test": "jest"` |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DB-01 | `djs` table exists with correct columns | manual-only | SQL: `SELECT column_name FROM information_schema.columns WHERE table_name='djs'` | N/A — manual SQL verification |
| DB-02 | All DJs from dj_rates+dj_pins exist in djs, no duplicates, PINs match | manual-only | Migration script verification output + manual PIN test for each DJ | N/A — manual |
| DB-03 | JSONB fields contain correct data from constants | manual-only | Migration script verification output; spot-check via `SELECT recurring_availability FROM djs WHERE name='Mostyx'` | N/A — manual |
| DB-04 | Old tables dropped only after manual verification | manual-only | Human runs drop-legacy-tables.sql after confirming criteria 1–5 | N/A — manual |

### Sampling Rate

- **Per task commit:** `npm test` — confirms existing 49 tests still pass (no regressions from file additions in scripts/)
- **Per wave merge:** `npm test`
- **Phase gate:** All 5 Phase 7 success criteria verified manually in Supabase before `/gsd:verify-work`

### Wave 0 Gaps

No test files need to be created for Phase 7. All verification is manual inspection of the database using the migration script's output and SQL Editor queries. The existing test suite must remain green throughout.

---

## Sources

### Primary (HIGH confidence)
- `C:/Users/gusno/dj-roster/server.js` lines 127–154 — FIXED_AVAILABILITY constant inspected directly, all 8 DJ entries confirmed
- `C:/Users/gusno/dj-roster/lib/business-logic.js` lines 47–60 — FIXED_SCHEDULES constant inspected directly, only Davoted has entries
- `C:/Users/gusno/dj-roster/scripts/hash-existing-pins.js` — established migration script pattern: dotenv, startup guard, per-row processing, error counting, process.exit(1) on errors
- `C:/Users/gusno/dj-roster/scripts/migrate-availability-timestamps.sql` — established SQL migration pattern: IF NOT EXISTS, verify with SELECT at end
- `.planning/REQUIREMENTS.md` — DB-01 column list (authoritative source for column names, incl. `failed_attempts` and `fixed_schedules` plural)
- `.planning/ROADMAP.md` — Phase 7 success criteria (authoritative for what must be true before Phase 8)
- `.planning/STATE.md` — locked decisions: clean cutover (no dual-write), locked_until on djs table directly, PINs are admin-allocated

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` — schema SQL example and integration point analysis (note: uses `fixed_schedule` singular — overridden by REQUIREMENTS.md which uses plural `fixed_schedules`)
- `.planning/research/PITFALLS.md` — en-dash/hyphen pitfall, JSONB serialization gotcha, cross-table name consistency risk
- `.planning/research/STACK.md` — confirmed no new packages needed, Supabase JS client JSONB behavior

---

## Metadata

**Confidence breakdown:**
- Schema design: HIGH — column list is directly specified in REQUIREMENTS.md DB-01; no inference needed
- Migration script pattern: HIGH — directly evidenced from hash-existing-pins.js; same structure applies
- Constants content: HIGH — both FIXED_AVAILABILITY and FIXED_SCHEDULES read directly from source files
- Pitfalls: HIGH — en-dash issue documented in STATE.md as a known blocker; JSONB and name-spelling risks from PITFALLS.md are codebase-evidenced
- Exact DJ count/names in production DB: LOW — cannot be known without a live Supabase query; migration script must print this at runtime

**Research date:** 2026-03-19
**Valid until:** Stable (PostgreSQL schema patterns do not change; Supabase JS 2.x JSONB behavior is stable)
