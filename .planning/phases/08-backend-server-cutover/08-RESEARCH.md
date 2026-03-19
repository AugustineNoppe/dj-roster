# Phase 8: Backend Server Cutover — Research

**Researched:** 2026-03-19
**Domain:** Node.js/Express server refactor — hardcoded constants to Supabase DB reads, in-memory lockout to persisted DB lockout, Supabase error handling sweep
**Confidence:** HIGH — all findings based on direct codebase inspection of server.js (1,251 LOC) and lib/business-logic.js (314 LOC); djs table schema confirmed from Phase 7 VERIFICATION.md

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCHED-01 | Recurring availability (FIXED_AVAILABILITY) read from djs.recurring_availability instead of hardcoded constant | FIXED_AVAILABILITY is defined at server.js lines 145–154; consumed at lines 802 and 815–819 in `/api/dj/availability/:name/:month`. Replace with targeted SELECT from djs. |
| SCHED-03 | Fixed schedules (FIXED_SCHEDULES) read from djs.fixed_schedules instead of hardcoded constant | FIXED_SCHEDULES is exported from business-logic.js lines 47–60; consumed at server.js lines 283, 387, 801, 992. Must migrate all 4 sites before removing the constant. |
| SCHED-05 | All hardcoded DJ arrays removed from server.js and lib/business-logic.js; grep for FIXED_AVAILABILITY, FIXED_SCHEDULES, RESIDENTS returns no hits | RESIDENTS is at business-logic.js line 35; FIXED_AVAILABILITY at server.js line 145; FIXED_SCHEDULES at business-logic.js line 47. 3 constants, 7 total call sites. |
| STAB-01 | Account lockout persisted to djs table (failed_attempts, locked_until) — survives server restarts | Current lockout is `_loginAttempts` Map (server.js lines 77–105); djs table has `failed_attempts` (integer) and `locked_until` (timestamptz) columns confirmed in Phase 7. |
| STAB-02 | All lockout functions converted to async DB calls in a single atomic commit | checkLockout, recordFailedAttempt, clearFailedAttempts (lines 81–105) must all become async Supabase UPDATEs in ONE commit. `/api/admin/clear-lockout` (line 1220) must be in the same commit. |
| STAB-03 | Try-catch all bare Supabase calls with graceful error responses — no unhandled promise rejections crash the server | 29 `supabase.from(...)` calls in server.js; several are inside try-catch already; several are NOT (e.g., line 1152: bare `await supabase.from('dj_rates').delete()` with no error check). |
</phase_requirements>

---

## Summary

Phase 8 is a pure server-side refactor. The `djs` table is live in Supabase with 17 DJs, all JSONB fields seeded, legacy tables dropped — Phase 7 is complete. The work is: swap every code path that reads from `dj_rates`, `dj_pins`, or hardcoded constants to instead read from the `djs` table; convert three synchronous lockout functions to async DB calls; and sweep every bare `supabase.from()` call for missing try-catch. No schema changes, no new dependencies, no frontend changes.

The critical constraint is **sequencing**. Constants cannot be deleted until every call site is migrated and confirmed working. The lockout migration must happen as one atomic commit — partial migration creates split-brain state where some paths check the in-memory Map and others check the DB. The `buildAvailabilityMap()` function signature does not change; only the data source passed in changes.

The three hardcoded constants to eliminate are: `FIXED_SCHEDULES` (business-logic.js line 47, 4 server.js call sites), `FIXED_AVAILABILITY` (server.js line 145, 2 call sites), and `RESIDENTS` (business-logic.js line 35, 3 call sites). None of the constants can be removed until all their call sites are migrated. Dead code removal is the last step.

**Primary recommendation:** Work through call sites in dependency order — fetchDJs() first, then auth/login, then lockout (single commit), then availability endpoints, then config/fixed-schedules, then remove dead constants. Do the try-catch sweep last as it touches every route.

---

## Standard Stack

### Core (no new installs — everything already present)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| `@supabase/supabase-js` | 2.99.1 (confirmed in package-lock.json) | All DB reads/writes to `djs` table | Already in use |
| `bcrypt` | ^6.0.0 | PIN hash comparison in auth path | Already in use |
| Node.js built-ins | v25.8.1 | No new stdlib needed for this phase | n/a |

**Installation:** No new packages required.

---

## Architecture Patterns

### The djs Table Schema (confirmed from Phase 7 VERIFICATION.md)

```
Column                  | Type
------------------------|------------------
id                      | uuid (PK)
name                    | text UNIQUE NOT NULL
pin_hash                | text NOT NULL
rate                    | integer
type                    | text ('resident'/'casual'/'guest')
active                  | boolean
venues                  | text[]
recurring_availability  | jsonb
fixed_schedules         | jsonb   ← column is fixed_schedules (plural), NOT fixed_schedule
failed_attempts         | integer ← this is the lockout counter column name
locked_until            | timestamptz
created_at              | timestamptz
```

**Critical naming note:** The column is `fixed_schedules` (plural) and the lockout counter column is `failed_attempts` (not `lockout_count`). The ARCHITECTURE.md research document used slightly different names in one place — the VERIFICATION.md confirms the actual schema.

### Pattern 1: fetchDJs() — switch from dj_rates to djs

**Current (server.js lines 255–268):**
```javascript
const { data: ratesData, error: ratesError } = await supabase
  .from('dj_rates')
  .select('name, rate');
```

**Target:**
```javascript
const { data, error } = await supabase
  .from('djs')
  .select('name, rate, type, active, venues, recurring_availability, fixed_schedules')
  .eq('active', true);
if (error) throw new Error(error.message);
const djs = (data || []).map(d => ({
  name: d.name,
  rate: parseInt(d.rate) || 0,
  type: d.type,
  venues: d.venues || [],
  recurringAvailability: d.recurring_availability || {},
  fixedSchedules: d.fixed_schedules || {},
}));
```

**Why:** All downstream callers that only use `name` and `rate` are unaffected. New callers (availability, config, fixed-schedules endpoints) can now use the richer shape from cache.

### Pattern 2: requireDJAuth() — targeted auth query (never put pin_hash in cache)

**Current (server.js lines 361–364):**
```javascript
const { data: pinData } = await supabase
  .from('dj_pins')
  .select('pin')
  .ilike('name', name.trim())
  .single();
```

**Target — direct query on djs, not via fetchDJs() cache:**
```javascript
const { data: djRow, error: djError } = await supabase
  .from('djs')
  .select('name, pin_hash, failed_attempts, locked_until, active')
  .ilike('name', name.trim())
  .maybeSingle();
```

**Why maybeSingle() not single():** `.single()` throws PGRST116 if 0 rows match (unrecognized DJ name). `.maybeSingle()` returns `null` cleanly, which the auth path already handles.

**Why never via fetchDJs() cache:** The cache is for scheduling data with a 10-minute TTL. Pin hashes should not sit in a general-purpose cache. Use a direct targeted query on every auth attempt.

### Pattern 3: Lockout persistence — all three functions in one commit

**Current (server.js lines 81–105):** synchronous Map operations.

**Target — three async functions replacing the synchronous ones:**

```javascript
async function checkLockout(djRow) {
  // djRow already fetched in auth path — check columns directly
  if (!djRow) return false;
  if (djRow.locked_until && new Date(djRow.locked_until) > new Date()) return true;
  return false;
}

async function recordFailedAttempt(djId, currentCount) {
  const newCount = (currentCount || 0) + 1;
  const lockedUntil = newCount >= MAX_LOGIN_ATTEMPTS
    ? new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString()
    : null;
  await supabase.from('djs').update({
    failed_attempts: newCount,
    locked_until: lockedUntil,
  }).eq('id', djId);
}

async function clearFailedAttempts(djId) {
  await supabase.from('djs').update({
    failed_attempts: 0,
    locked_until: null,
  }).eq('id', djId);
}
```

**Design note:** `checkLockout` no longer queries the DB — it reads `locked_until` from the DJ row already fetched during auth. This avoids a second DB round-trip. The `_loginAttempts` Map and its sync helper functions are deleted in the same commit.

### Pattern 4: fetchAvailability() — build fixedSchedules from DJ cache

**Current (server.js line 283):**
```javascript
const map = buildAvailabilityMap({ portalRows, submittedNames, month, fixedSchedules: FIXED_SCHEDULES });
```

**Target:**
```javascript
const djData = await fetchDJs(); // already cached
const fixedSchedules = {};
for (const dj of (djData.djs || [])) {
  if (dj.fixedSchedules && Object.keys(dj.fixedSchedules).length > 0) {
    fixedSchedules[dj.name] = dj.fixedSchedules;
  }
}
const map = buildAvailabilityMap({ portalRows, submittedNames, month, fixedSchedules });
```

**Why this works:** `buildAvailabilityMap` accepts `fixedSchedules` as a parameter — its signature does not change. The DB-loaded shape is `{ djName: { arkbar: { dow: [slots] }, loveBeach: { dow: [slots] } } }` — identical to the FIXED_SCHEDULES constant structure. Day-of-week keys in JSONB are stored as strings ("1", "2") not integers, but `Object.entries()` already returns string keys so the loop in buildAvailabilityMap works correctly.

### Pattern 5: DJ portal endpoints — targeted single-row query

**Current (server.js lines 801–802):**
```javascript
const fixedSched = FIXED_SCHEDULES[name] || null;
const fixedAvail = FIXED_AVAILABILITY[name] || null;
```

**Target:**
```javascript
const { data: djRow, error: djError } = await supabase
  .from('djs')
  .select('type, recurring_availability, fixed_schedules, active')
  .ilike('name', name.trim())
  .maybeSingle();
if (djError) throw new Error(djError.message);
const fixedSched = djRow ? (djRow.fixed_schedules || null) : null;
const fixedAvail = djRow ? (djRow.recurring_availability || null) : null;
const isResident = djRow ? djRow.type === 'resident' : false;
```

**Same pattern applies to** `/api/dj/schedule/:name/:month` (line 992).

### Pattern 6: Config and fixed-schedules endpoints from DJ cache

**Current:**
```javascript
app.get('/api/config', (req, res) => {
  res.json({ success: true, residents: RESIDENTS });
});
app.get('/api/fixed-schedules', (req, res) => {
  res.json({ success: true, schedules: FIXED_SCHEDULES });
});
```

**Target:**
```javascript
app.get('/api/config', async (req, res) => {
  try {
    const djData = await fetchDJs();
    const residents = (djData.djs || [])
      .filter(d => d.type === 'resident')
      .map(d => d.name);
    res.json({ success: true, residents });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/fixed-schedules', async (req, res) => {
  try {
    const djData = await fetchDJs();
    const schedules = {};
    for (const dj of (djData.djs || [])) {
      if (dj.fixedSchedules && Object.keys(dj.fixedSchedules).length > 0) {
        schedules[dj.name] = dj.fixedSchedules;
      }
    }
    res.json({ success: true, schedules });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});
```

**Note:** Both endpoints become async and add try-catch. The response shape is unchanged — clients consume the same JSON structure.

### Pattern 7: /api/djs/update — retarget from dj_rates to djs

**Current (server.js lines 1152–1157):** writes to `dj_rates` table.

**Target:**
```javascript
const { error: upsertError } = await supabase
  .from('djs')
  .update({ name: newName.trim(), rate })
  .ilike('name', oldName.trim());
if (upsertError) throw new Error(upsertError.message);
invalidateCaches('djs');
```

**Note:** This endpoint currently supports rename (oldName !== newName via delete + upsert). With the `djs` table, rename is now an UPDATE. Since `name` has a UNIQUE constraint, renaming to an existing name will fail — this is the correct behavior.

### Pattern 8: try-catch sweep

All bare `supabase.from()` calls that are NOT already inside a try-catch need wrapping. The highest-risk unprotected call is:

**server.js line 1152** (inside `/api/djs/update`):
```javascript
await supabase.from('dj_rates').delete().ilike('name', oldName.trim());
// No error check — this is a bare async call with no .then/.catch/try-catch
```

Other partial-coverage sites: `fetchAllRows()` already throws on error. `fetchFinalized()` (line 756) has no outer try-catch and is called inside try-catch at call sites — acceptable.

### Build Order Within Phase (must be strictly sequential)

1. **fetchDJs()** — switch to `djs WHERE active = true`, enrich returned shape with `type`, `recurringAvailability`, `fixedSchedules`
2. **requireDJAuth() + /api/dj/login** — switch PIN lookup from `dj_pins` to `djs`; replace `RESIDENTS.includes()` with `type === 'resident'`
3. **Lockout persistence** — convert all three lockout functions to async DB calls; update `/api/admin/clear-lockout`; all in ONE commit
4. **fetchAvailability()** — pull `fixedSchedules` from `fetchDJs()` cache; pass to `buildAvailabilityMap()`
5. **DJ portal availability endpoint** (`/api/dj/availability/:name/:month`) — targeted query for `recurring_availability`, `fixed_schedules`
6. **DJ portal schedule endpoint** (`/api/dj/schedule/:name/:month`) — same targeted query, replace `FIXED_SCHEDULES[name]`
7. **Config/fixed-schedules endpoints** — `/api/config` derives residents from `djs.type`; `/api/fixed-schedules` derives from `djs.fixed_schedules`
8. **Retarget /api/djs/update** — switch upsert target from `dj_rates` to `djs`
9. **Remove dead constants** from `lib/business-logic.js` (FIXED_SCHEDULES, FIXED_AVAILABILITY from server.js, RESIDENTS) — LAST, after all call sites confirmed migrated and tests passing
10. **Try-catch sweep** — wrap all remaining bare `supabase.from()` calls

### Anti-Patterns to Avoid

- **Removing FIXED_SCHEDULES before all call sites are migrated:** There are 4 call sites in server.js (lines 283, 387, 801, 992). Removing the export early causes a runtime ReferenceError. Keep until step 9.
- **Splitting the lockout migration across commits:** If `checkLockout` reads from DB but `recordFailedAttempt` still writes to the Map, login attempts go untracked. All three functions plus the admin clear-lockout endpoint must ship together.
- **Using fetchDJs() cache for pin_hash:** The cache is 10 minutes stale. Auth decisions must use a direct targeted query. Never put pin_hash into the enriched DJ cache.
- **Calling `JSON.stringify()` before Supabase reads of JSONB:** Not directly applicable to Phase 8 (we're reading, not writing JSONB), but the pattern to confirm: `dj.fixed_schedules` from Supabase comes back as a parsed JS object — use it directly.
- **Forgetting `await` on async lockout functions:** After converting `checkLockout` to async, all call sites must `await` it. There are 2 call sites: `requireDJAuth()` (line 357) and `/api/dj/login` (line 772). A missing `await` returns a truthy Promise object — the lockout check silently passes for all accounts.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DB-backed lockout reset | Custom lockout table, atomic sequence | `supabase.from('djs').update({ failed_attempts: 0, locked_until: null })` | Already a column on djs — one UPDATE, zero new tables |
| fixedSchedules shape for buildAvailabilityMap | Format conversion layer | Read `djs.fixed_schedules` directly — shape is identical to FIXED_SCHEDULES | Migration script seeded the JSONB from the same constant |
| JSONB field parsing | `JSON.parse()` calls | Supabase JS client deserializes JSONB automatically | Raw JS objects returned from `.select()` on JSONB columns |

---

## Common Pitfalls

### Pitfall 1: JSONB day-of-week keys are strings, not integers

**What goes wrong:** `buildAvailabilityMap` loops `fixedSchedules[djName]` and accesses `sched.arkbar[dow]` where `dow` is an integer from `new Date().getDay()`. In the hardcoded constant, the keys were integer literals. In JSONB, all object keys are strings — `"1"` not `1`.

**Why it happens:** JavaScript object property access coerces integer keys to strings for `{}` objects, so `obj[1]` and `obj["1"]` both work on plain objects. BUT in `buildAvailabilityMap` line 163, `sched.arkbar[dow]` with an integer `dow` will work IF the JSONB was stored with string keys (JavaScript auto-coerces). However, verify the actual behavior by testing with a known DJ.

**How to avoid:** The existing `buildAvailabilityMap` loop uses `sched.arkbar[dow]` and `sched.loveBeach[dow]`. Since JavaScript coerces both to the same string key, this works correctly. However, add a test case that passes DB-shaped data (string keys) and verifies identical output to constant-shaped data (integer keys).

**Warning signs:** Davoted portal shows no pre-populated slots; the `fixedSchedules` pass-through to `buildAvailabilityMap` silently returns empty arrays.

### Pitfall 2: Lockout split-brain — partial migration

**What goes wrong:** `checkLockout` reads from DB but `recordFailedAttempt` still writes to Map. Failed login attempts are not counted — every fifth attempt that should trigger a lockout does not.

**How to avoid:** All three functions + `/api/admin/clear-lockout` in a single git commit. The commit message should explicitly name all four changes.

**Warning signs:** After 5 failed logins, account is NOT locked. After server restart, previously locked account is unlocked (confirms Map-based lockout was still active).

### Pitfall 3: FIXED_SCHEDULES removed before fetchAvailability() is migrated

**What goes wrong:** `fetchAvailability()` at line 283 passes `fixedSchedules: FIXED_SCHEDULES` to `buildAvailabilityMap`. If the constant is removed before this line is updated, the availability endpoint throws a ReferenceError on every request.

**How to avoid:** Build order steps 4–7 all migrate call sites before step 9 removes the constants.

### Pitfall 4: requireDJAuth calls `.single()` on ilike match

**Current code** at line 364 uses `.single()` on an ilike name match against `dj_pins`. After switching to `djs`, if two DJs had similar names that both match the ilike pattern, `.single()` would throw PGRST116.

**How to avoid:** Use `.maybeSingle()` instead. Check the returned row for null (unrecognized DJ) before proceeding.

### Pitfall 5: /api/dj/availability uses RESIDENTS.includes() for isResident

**Line 800:** `const isResident = RESIDENTS.includes(name);` — this must change to `djRow ? djRow.type === 'resident' : false` once the targeted query is added.

**Warning signs:** A resident DJ's portal shows no "fixed" schedule overlay (the `fixedDisplay` object at line 875 depends on `fixedSched`, not `isResident`, so this is separate — but the `isResident` field in the JSON response will be wrong).

### Pitfall 6: line 648 still queries dj_rates

**server.js line 648** inside a diagnostic-related block fetches `supabase.from('dj_rates').select('name')`. This will fail after legacy tables are dropped (confirmed dropped in Phase 7). This call must be retargeted to `djs` as part of the fetchDJs() migration step.

---

## Code Examples

### Verified: buildAvailabilityMap signature (unchanged)

```javascript
// Source: lib/business-logic.js lines 110–174
function buildAvailabilityMap({ portalRows, submittedNames, month, fixedSchedules }) {
  // ...
  // fixedSchedules loop at line 158:
  for (const [djName, sched] of Object.entries(fixedSchedules)) {
    // sched.arkbar[dow] and sched.loveBeach[dow] — dow is integer from getDay()
    const slots = [...(sched.arkbar[dow] || []), ...(sched.loveBeach[dow] || [])];
  }
}
```

**Implication:** DB-loaded `fixed_schedules` JSONB must have the shape `{ arkbar: { "1": [...], "2": [...] }, loveBeach: { "2": [...] } }`. Since JS integer-to-string key coercion works for object property access, `sched.arkbar[1]` on a `{"1": [...]}` object returns the array correctly.

### Verified: Current /api/admin/clear-lockout (must change in lockout commit)

```javascript
// Source: server.js lines 1220–1225
app.post('/api/admin/clear-lockout', requireAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Missing DJ name' });
  clearFailedAttempts(name);    // ← this becomes an async DB call
  res.json({ success: true, cleared: name.trim().toLowerCase() });
});
```

**After migration:** `clearFailedAttempts` takes a DJ id or name and does a Supabase UPDATE. The endpoint must `await` it and add try-catch.

### Verified: fetchDJs cache invalidation (already correct)

```javascript
// Source: server.js lines 214–220
function invalidateCaches(type, opts = {}) {
  switch (type) {
    case 'djs':
      cache.djs.data = null;
      cache.availability.clear();  // ← already clears all months
      break;
    // ...
  }
}
```

Every new admin write endpoint added in Phase 9 must call `invalidateCaches('djs')`. Phase 8 only modifies existing endpoints — `invalidateCaches('djs')` is already called in `/api/djs/update` (line 1158).

### Verified: The 4 FIXED_SCHEDULES call sites to migrate

```
server.js line 283:  fixedSchedules: FIXED_SCHEDULES       (in fetchAvailability)
server.js line 387:  schedules: FIXED_SCHEDULES             (in /api/fixed-schedules)
server.js line 801:  FIXED_SCHEDULES[name]                  (in /api/dj/availability/:name/:month)
server.js line 992:  FIXED_SCHEDULES[name]                  (in /api/dj/schedule/:name/:month)
```

### Verified: The 3 FIXED_AVAILABILITY call sites to migrate

```
server.js line 145:  const FIXED_AVAILABILITY = { ... }     (definition — remove after all callers gone)
server.js line 802:  FIXED_AVAILABILITY[name]               (in /api/dj/availability/:name/:month)
server.js line 815:  Object.entries(fixedAvail)             (in /api/dj/availability/:name/:month)
```

(Lines 802 and 815–819 are in the same function — one targeted query replaces both.)

### Verified: The 3 RESIDENTS call sites to migrate

```
business-logic.js line 35:  const RESIDENTS = [...]          (definition)
server.js line 117:          RESIDENTS,                       (import — remove when definition removed)
server.js line 789:          RESIDENTS.includes(djName)       (in /api/dj/login)
server.js line 800:          RESIDENTS.includes(name)         (in /api/dj/availability/:name/:month)
server.js line 383:          residents: RESIDENTS             (in /api/config)
```

(Line 383 is the `/api/config` route — migrated in step 7.)

### Verified: line 648 — stale dj_rates reference in diagnostic endpoint

```javascript
// server.js line 648 (inside /api/admin/diagnostic/:month)
const { data: djRows } = await supabase.from('dj_rates').select('name');
```

This references the dropped `dj_rates` table. Must change to `supabase.from('djs').select('name').eq('active', true)` in the fetchDJs() migration step (step 1), or it will throw at runtime.

---

## State of the Art

| Old Approach | Current Approach | Phase 8 Change | Impact |
|--------------|------------------|----------------|--------|
| In-memory `_loginAttempts` Map | djs.failed_attempts + djs.locked_until | Convert 3 sync functions to async DB updates | Lockout survives restarts |
| `dj_rates` + `dj_pins` tables | `djs` table (Phase 7 complete) | Switch fetchDJs() and auth queries | Single table, richer shape |
| FIXED_SCHEDULES constant in code | djs.fixed_schedules JSONB | Pass DB-loaded value to buildAvailabilityMap | Dynamic, editable by admin (Phase 9) |
| FIXED_AVAILABILITY constant in code | djs.recurring_availability JSONB | Targeted query in portal endpoints | Dynamic, editable by admin (Phase 9) |
| RESIDENTS string array constant | djs.type === 'resident' | Filter from fetchDJs() result | Dynamic resident status |

---

## Open Questions

1. **Line 648 dj_rates reference in diagnostic endpoint**
   - What we know: `server.js line 648` calls `supabase.from('dj_rates').select('name')` — this table is confirmed dropped in Phase 7.
   - What's unclear: Whether the diagnostic endpoint (`/api/admin/diagnostic/:month`) is actively used; whether this line is inside or outside a try-catch.
   - Recommendation: Inspect lines 638–660 during task writing. Retarget to `djs` in step 1 (fetchDJs migration). If inside try-catch, it currently throws silently — if not, it crashes the diagnostic endpoint.

2. **fixedSchedules JSONB key type (string vs integer) in buildAvailabilityMap**
   - What we know: The migration script seeded JSONB from the JS constant; JS JSONB keys are always strings in PostgreSQL; `sched.arkbar[dow]` with integer `dow` on `{"1": [...]}` object works due to JS coercion.
   - What's unclear: Whether the seeded JSONB uses string keys `"1"` or numeric-looking keys. The Phase 7 seeding used `FIXED_SCHEDULES` directly and Supabase serializes JS object keys as strings.
   - Recommendation: In the first test after migrating `fetchAvailability()`, verify that Davoted's fixed schedule slots appear in the availability map for a test month. This is a 2-minute manual check.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest (confirmed in package.json scripts: `"test": "jest"`) |
| Config file | None detected — Jest uses defaults |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCHED-01 | `fetchDJs()` returns `recurringAvailability` field from DB; portal availability endpoint uses it | unit | `npm test -- --testNamePattern "recurring_availability"` | ❌ Wave 0 |
| SCHED-03 | `buildAvailabilityMap` receives DB-shaped fixedSchedules and produces correct slot map | unit | `npm test -- --testNamePattern "fixedSchedules from DB"` | ❌ Wave 0 |
| SCHED-05 | No references to FIXED_SCHEDULES, FIXED_AVAILABILITY, RESIDENTS in server.js or lib/ | grep check | `grep -r "FIXED_AVAILABILITY\|FIXED_SCHEDULES\|RESIDENTS" server.js lib/` exits 1 | n/a (post-delete verification) |
| STAB-01 | Lockout persists across "restart" — checkLockout reads locked_until from DB, not Map | unit | `npm test -- --testNamePattern "lockout persistence"` | ❌ Wave 0 |
| STAB-02 | checkLockout + recordFailedAttempt + clearFailedAttempts all hit Supabase | unit | `npm test -- --testNamePattern "lockout DB"` | ❌ Wave 0 |
| STAB-03 | Every Supabase call in server.js is wrapped in try-catch | manual grep | `grep -n "supabase.from" server.js` then verify each is inside try-catch | n/a (manual sweep) |

**Note on existing tests:** `lib/business-logic.test.js` has 49 passing tests. The existing tests import `FIXED_SCHEDULES` and `DIAG_FIXED_TEMPLATE` from business-logic.js. When FIXED_SCHEDULES is removed in step 9, these tests must be updated to pass fixture data instead of importing the constant. `DIAG_FIXED_TEMPLATE` stays in code (deferred to v3+) — no test change needed for it.

### Sampling Rate

- **Per task commit:** `npm test` (runs in ~0.3 seconds — run after every task)
- **Per wave merge:** `npm test` (same command — full suite is fast)
- **Phase gate:** Full suite green + manual smoke test of DJ login + Davoted portal availability before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `lib/business-logic.test.js` — add test: `buildAvailabilityMap` with DB-shaped fixedSchedules (string keys) produces identical output to constant-shaped (integer keys)
- [ ] `lib/business-logic.test.js` — update existing tests that import `FIXED_SCHEDULES` constant to pass fixture data instead (required before step 9, not step 1)
- [ ] No new test file needed for lockout — add tests within existing Jest suite or a new `lib/lockout.test.js`

*(If test infrastructure works correctly today: "Existing Jest suite at lib/business-logic.test.js covers pure functions. New unit tests needed for DB-backed lockout functions and the DB-shaped fixedSchedules path.")*

---

## Sources

### Primary (HIGH confidence)

- `C:/Users/gusno/dj-roster/server.js` — 1,251 LOC, all call sites identified by line number
- `C:/Users/gusno/dj-roster/lib/business-logic.js` — 314 LOC, all constants and exports confirmed
- `C:/Users/gusno/dj-roster/lib/business-logic.test.js` — 49 tests, imports confirmed
- `.planning/phases/07-database-schema-migration/07-VERIFICATION.md` — djs table schema confirmed (12 columns, column names `failed_attempts` and `fixed_schedules`)
- `.planning/research/ARCHITECTURE.md` — build order and integration points (cross-verified against live server.js)
- `.planning/research/PITFALLS.md` — all pitfalls cross-verified against live code
- `C:/Users/gusno/dj-roster/package.json` — `"test": "jest"` confirmed

### Secondary (MEDIUM confidence)

- `.planning/STATE.md` — decision log, Phase 8 blockers documented
- `.planning/research/SUMMARY.md` — project-level architectural guidance

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — no new packages; all patterns based on code already in production
- Architecture: HIGH — all integration points identified by exact line number in source files
- Pitfalls: HIGH — all pitfalls directly evidenced from codebase inspection; none speculative
- Test coverage: MEDIUM — existing 49 tests verified; new tests for DB-backed lockout and JSONB fixedSchedules path are Wave 0 gaps

**Research date:** 2026-03-19
**Valid until:** 2026-04-19 (stable domain; no fast-moving dependencies)
