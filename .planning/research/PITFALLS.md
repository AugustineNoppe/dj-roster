# Pitfalls Research

**Domain:** DJ scheduling app — database consolidation, admin management UI, hardcoded-to-dynamic migration
**Researched:** 2026-03-19
**Confidence:** HIGH — all pitfalls are directly evidenced from codebase inspection of server.js, lib/business-logic.js, and public/roster.html

---

## Critical Pitfalls

### Pitfall 1: En-dash / Hyphen Mismatch Survives Migration Into the New Table

**What goes wrong:**
The existing `dj_rates` and `dj_pins` tables contain known duplicate rows where some DJ names use a regular hyphen (`-`) and others use an en-dash (`–`, U+2013). The `normalizeSlot()` function handles this for slot strings but there is no equivalent normalization for DJ names on write. When the migration script SELECTs from `dj_rates` + `dj_pins` and INSERTs into `djs`, both variants land in the new table. Every downstream lookup — login auth (`.ilike('name', name.trim())`), availability fetch, roster assignment — will then match two rows and produce non-deterministic results or a `PGRST116 "multiple rows returned"` crash from `.single()`.

**Why it happens:**
The v1 bcrypt PIN migration script (`scripts/hash-existing-pins.js`) used `.eq('name', name)` (exact match) rather than a normalize-then-upsert pattern. Duplicates entered at data entry time were never deduplicated. The problem is documented in PROJECT.md ("Known: existing duplicate DB rows (en-dash + hyphen variants) not cleaned up") but deduplication is not yet part of any migration script.

**How to avoid:**
1. Before creating the `djs` table, run a deduplication audit query in the Supabase SQL editor: `SELECT name, COUNT(*) FROM dj_rates GROUP BY name HAVING COUNT(*) > 1;`
2. Write the migration script to normalize all DJ names through a canonical form (trim + collapse any `-` or `–` to a single consistent character) before inserting into `djs`.
3. Add a `UNIQUE` constraint on `djs.name` so duplicate inserts fail loudly instead of silently succeeding.
4. After migration, add an application-layer `normalizeDJName()` helper that mirrors `normalizeSlot()` and run it on every DB write path.

**Warning signs:**
- Any login that used to work returns "Invalid name or PIN" after migration.
- `supabase.from('djs').select('pin').ilike('name', ...).single()` throws `PGRST116`.
- Admin DJ list shows the same DJ name twice with slightly different character encodings.

**Phase to address:** Phase 1 (table creation and migration script) — must be resolved before any code cutover.

---

### Pitfall 2: Clean Cutover Leaves `dj_availability` and `dj_signoffs` Referencing Old Name Spelling

**What goes wrong:**
`dj_availability`, `dj_submissions`, `roster_assignments`, and `dj_signoffs` all store DJ names as plain strings (no foreign key). If the migration deduplicates or renames a DJ (e.g., from `"Alex Red-White"` to `"Alex RedWhite"`), all historical rows in those tables retain the old spelling. After cutover, lookups like `.ilike('name', name.trim())` on availability and signoffs silently return zero rows for the renamed DJ. The finalization accounting in `computeFinalizationReport()` builds its `djRateMap` by lowercasing `djs.name` — a renamed DJ's historical signoffs no longer match and their pay calculation becomes zero.

**Why it happens:**
Supabase has no enforced foreign key from availability/signoffs to dj_rates (and there won't be one to `djs` either). Name-string joins are purely convention. Renaming a DJ in the source table does not cascade anywhere.

**How to avoid:**
1. Do not rename any DJ's canonical name during migration — only deduplicate character variants to a single spelling that already exists in availability/signoffs data.
2. If renaming is unavoidable, the migration script must also UPDATE every affected row in `dj_availability`, `dj_submissions`, `roster_assignments`, and `dj_signoffs`.
3. Treat DJ names as immutable primary keys in the data model. Expose a "rename DJ" admin action only if it cascades all dependent tables.

**Warning signs:**
- A DJ's availability page shows no slots after migration despite having submitted.
- Finalization report shows 0 cost for a DJ who was signed off.
- `djStatus` in the diagnostic endpoint shows 0 total slots for an active DJ.

**Phase to address:** Phase 1 (migration script) — include a pre-migration name audit and a test that reads back availability for each migrated DJ.

---

### Pitfall 3: `FIXED_SCHEDULES` and `FIXED_AVAILABILITY` Moved to DB Without Updating All Consumers

**What goes wrong:**
Both `FIXED_SCHEDULES` (from `lib/business-logic.js`) and `FIXED_AVAILABILITY` (from `server.js`) are consumed in multiple places that will not automatically switch to the database version. Specifically:

- `buildAvailabilityMap()` in `lib/business-logic.js` receives `fixedSchedules` as a parameter — it will keep receiving the in-memory constant unless the call site in `fetchAvailability()` (server.js line 283) is updated.
- `/api/dj/schedule/:name/:month` (server.js line 992) injects fixed schedule entries from `FIXED_SCHEDULES[name]` to pre-populate the DJ portal schedule view.
- `/api/dj/availability/:name/:month` (server.js line 801–820) merges both `FIXED_SCHEDULES[name]` and `FIXED_AVAILABILITY[name]` to build `FIXED_PORTAL`.
- `/api/fixed-schedules` (server.js line 387) returns the raw `FIXED_SCHEDULES` constant directly.
- `roster.html` line 782 calls `/api/fixed-schedules` and uses the result to render the fixed template overlay.

If the DB migration removes the constants but any one of these call sites is missed, that feature silently falls back to empty/undefined and the DJ portal shows no pre-populated slots.

**Why it happens:**
The constants are used in 5+ locations across 2 files. It is easy to update the obvious server route but miss the business-logic parameter injection and the DJ portal endpoints.

**How to avoid:**
1. Before removing the constants, grep every reference: `FIXED_SCHEDULES`, `FIXED_AVAILABILITY`, `fixedSchedules`, `fixedAvail`, `fixedSched` across all files.
2. Replace constants with a single `fetchFixedData()` async function that reads from `djs` and is called once per request lifecycle (or cached alongside the DJ list cache, which already has a 10-minute TTL).
3. Keep the `/api/fixed-schedules` endpoint working by having it serve data from the new `djs` table rather than deleting it — roster.html depends on it.
4. Update the 49 existing Jest tests: `buildAvailabilityMap()` currently receives `fixedSchedules` as a parameter, which is correct for testability — keep this pattern and update test fixtures rather than removing the parameter.

**Warning signs:**
- Davoted's DJ portal shows no pre-populated schedule slots.
- Auto-suggest places Davoted in slots they have a fixed schedule for (double-booking).
- The roster fixed-template overlay is blank where it previously showed template assignments.

**Phase to address:** Phase 2 (server.js cutover) — requires a complete call-site audit before removing the in-memory constants.

---

### Pitfall 4: `RESIDENTS` Constant Has Two Independent Copies

**What goes wrong:**
`RESIDENTS` is defined in `lib/business-logic.js` (line 35) AND hardcoded as a fallback default in `roster.html` (line 606). The server exports `RESIDENTS` from `lib/business-logic.js` and overwrites the frontend value via `/api/config` on load. If the milestone moves `RESIDENTS` to a DB field (e.g., `djs.type = 'resident'`), and the `/api/config` response is updated but `roster.html`'s fallback default is left unchanged, the frontend will briefly operate on the wrong resident list during the window before `/api/config` resolves. More critically, if `/api/config` fails, the app silently falls back to the stale hardcoded list.

Beyond `RESIDENTS`, `roster.html` contains `RESIDENTS_80HR`, `TARGETS`, `RESIDENT_MIN`, `HIP_ROTATION`, and `LOVE_DJS` (lines 610–651) — all hardcoded and not currently exposed via any API. These will need to be addressed in scope or explicitly declared out-of-scope for this milestone.

**Why it happens:**
The frontend comment at line 605 documents this dual-source pattern: "fallback keeps the app functional if the fetch fails." The fallback becomes a liability if the source of truth changes.

**How to avoid:**
1. When moving `RESIDENTS` to `djs.type`, update `/api/config` to derive the list from `djs` and verify the frontend fallback is also updated to match current data.
2. For `RESIDENTS_80HR`, `TARGETS`, `HIP_ROTATION`, and `LOVE_DJS`: decide explicitly whether these move to DB in this milestone or stay hardcoded. Do not leave the decision implicit.
3. If staying hardcoded for this milestone, add a code comment marking each as "v2 hardcoded — not yet in DB" to prevent confusion.

**Warning signs:**
- Hours tab shows wrong residents in the summary bar after migration.
- A newly-added DJ with `type='resident'` in the DB does not appear in the hours summary.
- Auto-suggest does not enforce resident minimum hours for a DJ whose type was changed via admin UI.

**Phase to address:** Phase 2 (server.js cutover) for `RESIDENTS`; Phase 3 (frontend wiring) to clean up frontend-side hardcoding.

---

### Pitfall 5: In-Memory Lockout State Race During Cutover to DB

**What goes wrong:**
The current lockout is a `Map` in process memory (`_loginAttempts`). Moving it to Supabase requires that the DB path is the only path — if any code path still writes to the in-memory Map while reads now check the DB (or vice versa), failed attempts go untracked. The `requireDJAuth` middleware (server.js line 357) and `/api/dj/login` (line 772) both call `checkLockout()`, `recordFailedAttempt()`, and `clearFailedAttempts()` independently. Both must be updated atomically.

There is also a subtlety: the current `clearLockout` admin endpoint (`/api/admin/clear-lockout`) calls `clearFailedAttempts(name)` which deletes from the in-memory Map. After cutover, this endpoint must also delete (or reset) the DB row, not the Map.

**Why it happens:**
The lockout functions are called in two separate middleware/route handlers. Partial updates leave one handler still using the Map while the other uses the DB.

**How to avoid:**
1. Replace `checkLockout()`, `recordFailedAttempt()`, and `clearFailedAttempts()` with async DB-backed equivalents simultaneously — do not ship a partial migration.
2. Update `/api/admin/clear-lockout` in the same commit as the lockout helper functions.
3. Keep the function signatures identical (same names, add `async`) so no call-site changes are required beyond adding `await`.
4. During the transition, add a startup log line confirming "lockout source: DB" vs "lockout source: memory" to make the active implementation visible.

**Warning signs:**
- A locked-out DJ can log in successfully after server restart (lockout not persisted).
- Admin "clear lockout" succeeds but the DJ is still locked out on next login attempt.
- Console shows lockout checks against DB but `recordFailedAttempt` still writing to `_loginAttempts` Map.

**Phase to address:** Phase 2 (server.js cutover) — both read and write paths must change in the same deployment.

---

### Pitfall 6: Supabase `upsert` on `djs` Table Silently Ignores Schema-Mismatched Fields

**What goes wrong:**
Supabase's JS client silently discards fields that do not exist in the target table. If the `djs` table schema is created without a column (e.g., `recurring_availability` is not yet added), an `upsert` call that includes that field will succeed and return no error — but the data will not be saved. This is especially dangerous for admin CRUD operations where the success response misleads the user.

**Why it happens:**
The existing `dj_rates` upsert (server.js line 1154) demonstrates this pattern: `{ name: newName, rate }` — only two fields. When the admin UI gains more fields (recurring availability, fixed schedule, active status, venues), it is easy to add them to the frontend form and the server route without verifying the DB column exists. The Supabase JS client does not warn about extra fields.

**How to avoid:**
1. Create the complete `djs` table schema (all columns) before writing any application code that uses the table.
2. After each admin CRUD operation, SELECT the saved row and verify the fields match what was sent.
3. Add `returning: 'representation'` to upsert calls so the response includes the actual saved state, making discrepancies visible.

**Warning signs:**
- Admin saves recurring availability for a DJ; the save appears to succeed; the DJ portal still shows no defaults.
- `SELECT * FROM djs WHERE name = '...'` in Supabase SQL editor shows null for a field the admin UI just saved.

**Phase to address:** Phase 1 (table creation) — the schema must be finalized before any code targets it.

---

### Pitfall 7: Cache Invalidation Not Extended to Cover New `djs` Fields

**What goes wrong:**
The existing `invalidateCaches('djs')` call (server.js line 1158) clears `cache.djs.data` and all availability caches. This was sufficient when `dj_rates` only held `name` and `rate`. After consolidation, `djs` holds PIN hash, recurring availability, fixed schedule, active status, and venues. Any admin operation that modifies fields beyond rate (e.g., resetting a PIN, changing recurring availability) must also trigger the right cache invalidation. Specifically:
- PIN reset: no cache currently affected, but after consolidation `cache.djs` is the source and must be cleared so login fetches a fresh PIN hash.
- Recurring availability change: must clear `cache.availability` for all months (current code does this when `'djs'` is invalidated, but only if the new admin routes call `invalidateCaches('djs')` consistently).
- Active status change: must clear `cache.djs` immediately or a deactivated DJ continues to appear in the DJ list for up to 10 minutes.

**Why it happens:**
Each new admin endpoint is written independently and the developer must remember to call `invalidateCaches`. There is no enforced contract.

**How to avoid:**
1. Centralize all `djs` table writes behind a single `saveDJ()` helper that always calls `invalidateCaches('djs')` before returning.
2. Document in the centralized invalidation comment block (server.js line 202) that `djs` invalidation covers PIN changes and availability defaults, not only rate changes.

**Warning signs:**
- DJ is deactivated in admin UI but still appears in the auto-suggest dropdown for up to 10 minutes.
- PIN reset appears to succeed but old PIN still works until server restarts.

**Phase to address:** Phase 2 (server.js admin routes) — every new DJ-writing endpoint must call `invalidateCaches('djs')`.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keep `DIAG_FIXED_TEMPLATE` hardcoded in `business-logic.js` | No schema changes needed | Template drifts from actual DB-configured schedules; diagnostic tool gives misleading results | Acceptable for this milestone if documented — but add a TODO |
| Dual-source `RESIDENTS` (DB + frontend fallback) | Frontend works during API failures | Stale fallback produces wrong hours-tab behavior if residents change | Acceptable only if fallback is updated to match DB state on migration |
| Store `recurring_availability` and `fixed_schedule` as JSONB columns | Flexible, no schema changes per DJ | Queries against slot content require JSON operators; easy to save structurally invalid JSON from admin UI | Acceptable — validate shape server-side before upsert |
| Skip migrating `HIP_ROTATION` and `LOVE_DJS` to DB in v2 | Reduces scope significantly | Auto-suggest and Love Beach availability remain configuration-in-code | Acceptable for this milestone if explicitly called out in code comments |
| Reuse existing `ilike` name matching on `djs` table | Zero code change at call sites | `ilike` masks name normalization bugs; correct approach is exact match after normalization | Never for new write paths — only acceptable for read fallback |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Supabase `upsert` with `onConflict` | Forgetting that `onConflict` must match the actual unique constraint column name, not just any unique-ish field | Verify the constraint name in Supabase dashboard before writing upsert code; test with a deliberate duplicate insert |
| Supabase `.single()` after `.ilike()` | Returns `PGRST116` error if more than one row matches — happens after duplicate DJ name rows are created | Use `.maybeSingle()` for defensive reads; use `.single()` only when a unique constraint guarantees at most one row |
| Supabase JSONB columns | JS object saved as `JSON.stringify(obj)` (string) instead of plain object — Supabase stores it as escaped string, not JSONB | Pass the raw JS object; Supabase JS client serializes correctly; never call `JSON.stringify` before upsert |
| Supabase service key in migration scripts | Scripts run locally use `.env`; if `.env` is missing the key, the script connects with no credentials and silently reads 0 rows | Add an explicit check at script startup: `if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('Missing key')` |
| Webhook signature verification (HMAC) | Comparing raw string to hex digest fails due to encoding; using `==` instead of `crypto.timingSafeEqual` creates timing oracle | Use `Buffer.from(received, 'hex')` and `crypto.timingSafeEqual()` for comparison; reject immediately if header is absent |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading full `djs` table on every availability fetch (no caching) | Slow availability page load; Supabase rate limit hits during busy roster-building sessions | The existing 10-minute `cache.djs` TTL already prevents this — ensure new fields (recurring_availability, fixed_schedule) are included in the cached SELECT, not fetched separately | At current scale (10–20 DJs) this is not a concern; becomes visible if DJ list grows to 50+ |
| bcrypt comparison in lockout-check DB path | Each login requires a bcrypt round AND a DB read; concurrent logins during busy periods stack latency | Keep bcrypt in application layer; DB stores only the hash; do not add bcrypt to DB triggers | Not a concern at current user count |
| JSONB field fetched when only `name` is needed | DJ list dropdown pays for fetching large JSONB availability/schedule fields | Use `SELECT name, rate, type, active` for list endpoints; only fetch JSONB fields when editing a specific DJ | Negligible at current scale; noticeable if JSONB fields grow large |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Admin PIN reset returns the new PIN in the API response | PIN exposed in browser network tab, server logs, and any reverse proxy access log | Generate PIN server-side, store only the bcrypt hash, return only a success flag; display the PIN once in the admin UI from client-side generation before sending hash to server |
| Webhook endpoint without signature verification accepts arbitrary POSTs | Any actor who discovers the endpoint URL can trigger webhook processing | Implement HMAC-SHA256 verification using `crypto.timingSafeEqual`; reject with 401 before processing body |
| Deactivated DJ can still log in if `active` field is not checked at auth time | Former DJ retains portal access | After cutover, add `active = true` filter to the `requireDJAuth` PIN lookup query on `djs` table |
| `SUPABASE_SERVICE_KEY` used in migration scripts checked into git | Full database access exposed in repository history | Add `scripts/*.env` and `*.local.js` to `.gitignore`; migration scripts should load from environment, not embed credentials |
| Admin CRUD endpoints lack input validation on JSONB fields | Malformed availability/schedule JSON saved to DB causes parse errors on read | Validate structure server-side before upsert: check that `recurring_availability` keys are 0–6 and values are arrays of slot strings |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Admin saves DJ changes and sees no feedback during the Supabase round-trip | Admin double-clicks save, creating duplicate requests | Disable the save button immediately on first click; re-enable on response (success or error) |
| Deactivated DJ disappears from DJ Hours tab historical view | Manager can no longer see a deactivated DJ's hours for the current month | Filter `active=false` DJs from the DJ list dropdown and auto-suggest, but still include them in signoff/hours data by querying signoffs directly rather than joining through the active DJ list |
| Recurring availability displayed in the admin UI uses raw slot strings (en-dash format) | Non-technical admin sees `14:00–15:00` and types `14:00-15:00` into an edit field | Admin UI should use a checkbox grid or time-slot toggle, not a free-text field, for recurring availability editing |
| "Reset PIN" in admin UI generates and shows a PIN, but admin navigates away before writing it down | DJ cannot log in; admin has no record of the new PIN | After PIN reset, show the generated PIN in a modal with a "Copy" button and a confirmation checkbox before dismissing |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **djs table migration:** Data migrated from dj_rates + dj_pins — verify `SELECT COUNT(*) FROM djs` matches the expected DJ count, and that every DJ can still log in with their existing PIN.
- [ ] **Hardcoded arrays removed:** `grep -r "FIXED_SCHEDULES\|FIXED_AVAILABILITY\|RESIDENTS\b" server.js lib/` returns zero results after cutover.
- [ ] **Deactivated DJ flow:** Deactivated DJ cannot log in, does not appear in roster dropdown, does not appear in auto-suggest — but their historical signoffs still appear in the Hours tab and finalization report.
- [ ] **Lockout DB migration:** Server restart no longer clears a locked account — verify by locking a test account, restarting the server, and confirming the account remains locked.
- [ ] **Admin clear-lockout:** After moving lockout to DB, `/api/admin/clear-lockout` deletes the DB row (not the in-memory Map entry that no longer exists).
- [ ] **Cache invalidation coverage:** After adding or deactivating a DJ via admin UI, the DJ list refreshes within the cache TTL window — verify by checking the response of `/api/djs` immediately after a mutation.
- [ ] **JSONB field round-trip:** Recurring availability saved via admin UI can be read back and correctly pre-populates the DJ portal calendar. Test with a DJ who has multi-day patterns (e.g., Mostyx with day-specific exclusions).
- [ ] **Webhook verification:** Endpoint rejects requests with missing or invalid signatures; accepts requests with valid HMAC-SHA256 signature. Test both cases.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Duplicate DJ names in `djs` table after migration | MEDIUM | Run deduplication query in Supabase SQL editor; identify which row has the correct PIN hash (likely the one created by `hash-existing-pins.js`); DELETE the stale row; re-run login test for affected DJs |
| Old name spelling in availability/signoffs after rename | HIGH | Write an UPDATE script for each affected table; requires knowing the old and new name spellings; test finalization report before and after to verify accounting matches |
| In-memory lockout partially migrated (split brain) | LOW | Deploy the complete lockout cutover; restart server; any accounts locked in the Map (not DB) will auto-clear on restart — acceptable 15-minute unlock window |
| JSONB field saves as string instead of object | LOW | Run `UPDATE djs SET recurring_availability = recurring_availability::jsonb` if the column type is JSONB — Supabase will reject non-JSONB strings; fix the application code path and re-save |
| Missing cache invalidation for new admin routes | LOW | Add `invalidateCaches('djs')` to the offending route; restart server to force cold cache |
| DJ deactivated but still in active sessions | LOW | Deactivation takes effect on next API call since there are no long-lived sessions; no recovery needed beyond confirming the `active` field is checked at auth time |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| En-dash/hyphen duplicate names survive migration | Phase 1: Schema + Migration Script | Deduplication audit query returns 0 rows; all DJs can log in post-migration |
| Old name spelling in dependent tables | Phase 1: Migration Script | Each DJ in `djs` has at least one availability row in `dj_availability` that matches by case-insensitive name |
| FIXED_SCHEDULES/FIXED_AVAILABILITY consumers missed | Phase 2: Server Cutover | `grep FIXED_SCHEDULES server.js lib/` returns 0 results; Davoted portal shows pre-populated slots |
| Dual-source RESIDENTS constant | Phase 2: Server Cutover + Phase 3: Frontend | `/api/config` derives residents from `djs.type`; frontend fallback matches current resident list |
| Lockout split-brain during cutover | Phase 2: Server Cutover | Complete lockout function replacement in single commit; admin clear-lockout hits DB |
| Supabase upsert silently drops unknown fields | Phase 1: Schema | All `djs` columns created before any application code writes to table |
| Cache invalidation gaps for new admin routes | Phase 2: Server Cutover | Every admin POST/PATCH route calls `invalidateCaches('djs')` |
| Deactivated DJ still returns in auth check | Phase 2: Server Cutover | `requireDJAuth` filters `active = true` on PIN lookup |
| JSONB field shape not validated | Phase 2: Admin CRUD routes | Server rejects malformed recurring_availability with 400 before upsert |
| Webhook without signature verification | Phase 4 (secondary) | Test rejects invalid HMAC with 401; accepts valid HMAC |

---

## Sources

- Codebase inspection: `server.js` (1,250 LOC) — lockout Map, FIXED_AVAILABILITY, FIXED_SCHEDULES usage sites, dj_rates/dj_pins table references
- Codebase inspection: `lib/business-logic.js` — RESIDENTS, FIXED_SCHEDULES constants, normalizeSlot implementation
- Codebase inspection: `public/roster.html` — frontend RESIDENTS fallback (line 606), RESIDENTS_80HR, HIP_ROTATION, LOVE_DJS hardcoded constants
- Codebase inspection: `scripts/hash-existing-pins.js` — prior migration pattern (idempotency check, `.eq('name', name)` exact match)
- Project context: `PROJECT.md` — known en-dash/hyphen duplicate issue documented explicitly; clean cutover decision documented

---
*Pitfalls research for: DJ Roster — database consolidation, admin management UI, hardcoded-to-dynamic migration*
*Researched: 2026-03-19*
