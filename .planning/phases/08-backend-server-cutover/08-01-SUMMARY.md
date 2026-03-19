---
phase: 08-backend-server-cutover
plan: 01
subsystem: auth, database, api
tags: [supabase, bcrypt, jest, lockout, djs-table]

# Dependency graph
requires:
  - phase: 07-database-schema-migration
    provides: djs table with pin_hash, failed_attempts, locked_until, type, recurring_availability, fixed_schedules columns

provides:
  - fetchDJs() reads from djs table with enriched shape (type, venues, recurringAvailability, fixedSchedules)
  - requireDJAuth authenticates against djs.pin_hash (not dj_pins)
  - /api/dj/login authenticates against djs.pin_hash, uses djRow.type for isResident check
  - Persistent lockout via djs.failed_attempts and djs.locked_until (survives restarts)
  - lib/lockout.js module with createLockoutFunctions() factory for testability
  - 12 unit tests for all three lockout functions with mocked supabase

affects:
  - 08-02 (endpoint migrations that depend on fetchDJs enriched shape and lockout module)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Dependency-injected supabase via factory function for testable async DB functions
    - maybeSingle() instead of single() to avoid PGRST116 on no-match
    - DB-backed lockout: read current state, compute new state, write atomically

key-files:
  created:
    - lib/lockout.js
    - lib/lockout.test.js
  modified:
    - server.js
    - lib/business-logic.test.js

key-decisions:
  - "Lockout extracted to lib/lockout.js with createLockoutFunctions(supabase, constants) factory — enables unit testing with mocked supabase without coupling to server.js globals"
  - "All three lockout migrations in a single commit — split-brain risk if partial (established in STATE.md as blocker)"
  - "clearFailedAttempts uses ilike (name match) while checkLockout uses eq(id) — checkLockout receives the already-fetched djRow with id, clearFailedAttempts receives only the name string"

patterns-established:
  - "Factory pattern for DB-dependent modules: createLockoutFunctions(supabase, constants) — injects deps, returns functions"
  - "Auth flow: fetch djRow with maybeSingle(), check active, check lockout(djRow), compare pin_hash, clear/record attempts"

requirements-completed: [SCHED-01, STAB-01, STAB-02]

# Metrics
duration: 25min
completed: 2026-03-19
---

# Phase 8 Plan 01: Backend Server Cutover (Foundational Functions) Summary

**DB-backed DJ auth and persistent lockout via djs table: fetchDJs() enriched, requireDJAuth and /api/dj/login migrated from dj_pins to djs.pin_hash, lockout survives restarts**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-19T09:00:00Z
- **Completed:** 2026-03-19T09:25:00Z
- **Tasks:** 2
- **Files modified:** 4 (server.js, lib/business-logic.test.js, lib/lockout.js [new], lib/lockout.test.js [new])

## Accomplishments

- fetchDJs() now queries `djs` table and returns enriched objects with type, venues, recurringAvailability, fixedSchedules
- requireDJAuth and /api/dj/login both authenticate against djs.pin_hash with maybeSingle() (no PGRST116 errors)
- All lockout reads/writes use djs.failed_attempts and djs.locked_until — no in-memory Map
- /api/admin/clear-lockout awaits the async clearFailedAttempts() with try-catch
- 12 unit tests cover all lockout behavior cases (checkLockout x4, recordFailedAttempt x4, clearFailedAttempts x2)
- Total test count: 63 (up from 49)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add DB-shaped fixedSchedules test + switch fetchDJs to djs table** - `c6da494` (feat)
2. **Task 2: Write lockout unit tests + convert auth to djs table + persist lockout to DB** - `84f5644` (feat)

_Note: TDD tasks — Task 1 new tests went GREEN immediately (JS string/int key coercion works as expected). Task 2 RED phase confirmed failure (module not found), GREEN phase created lib/lockout.js and updated server.js._

## Files Created/Modified

- `lib/lockout.js` - createLockoutFunctions() factory: async checkLockout, recordFailedAttempt, clearFailedAttempts using supabase
- `lib/lockout.test.js` - 12 unit tests for all three lockout functions with mocked supabase chain
- `server.js` - fetchDJs() migrated to djs table; lockout section replaced with lib/lockout import; requireDJAuth and /api/dj/login migrated from dj_pins to djs; admin clear-lockout gets try-catch and await
- `lib/business-logic.test.js` - 2 new tests: DB string-key fixedSchedules produces identical output to integer-key constant; empty fixedSchedules has no fixed DJ entries

## Decisions Made

- Chose option (a) for lockout extraction: `lib/lockout.js` module with factory function, not `module.exports` at bottom of server.js. Keeps server.js clean and enables isolated unit testing without loading the full server.
- `checkLockout(djRow)` takes the already-fetched row (avoiding extra DB round-trip), while `clearFailedAttempts(djName)` and `recordFailedAttempt(djName)` take just the name string (called from auth paths where only the name is available at the call site).
- `clearFailedAttempts` uses `.ilike('name', djName)` for its update (name-based match). `checkLockout` uses `.eq('id', djRow.id)` when clearing expired lock (has the id from the already-fetched row).

## Deviations from Plan

None — plan executed exactly as written. The RED phase for Task 2 failed as expected (module not found), GREEN phase made all 12 tests pass.

**Note:** One pre-existing `dj_rates` reference found in the admin DJ rename/upsert endpoint (lines 1142-1146) — this endpoint was explicitly out of scope for Plan 01 (not in fetchDJs, requireDJAuth, /api/dj/login, or lockout scope). Logged to `deferred-items.md` for Plan 02 to address.

## Issues Encountered

None — all changes applied cleanly.

## Next Phase Readiness

- Plan 02 (endpoint migrations) can proceed. fetchDJs() now returns enriched data. Lockout module is available for any new auth flows.
- Deferred: Admin DJ rename/upsert endpoint still writes to `dj_rates` — Plan 02 must migrate this.
- FIXED_SCHEDULES and FIXED_AVAILABILITY constants remain in server.js — per STATE.md blocker, keep until ALL call sites confirmed migrated in subsequent plans.

---
*Phase: 08-backend-server-cutover*
*Completed: 2026-03-19*
