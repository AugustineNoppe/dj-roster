---
phase: 07-database-schema-migration
plan: 02
subsystem: database
tags: [supabase, postgres, sql, migration, drop]

# Dependency graph
requires:
  - phase: 07-01
    provides: scripts/migrate-djs-schema.sql, scripts/migrate-djs-data.js — schema and data migration ready to run
provides:
  - scripts/drop-legacy-tables.sql — manual DROP TABLE script for dj_rates and dj_pins with safety checklist
affects:
  - 08-server-code-migration

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Standalone drop script pattern: manual paste-and-execute in Supabase SQL Editor, never called by other scripts"
    - "Safety checklist header: enumerate all verification criteria as comments before irreversible statements"

key-files:
  created:
    - scripts/drop-legacy-tables.sql
  modified: []

key-decisions:
  - "Drop script is manual-only — operator must verify all 5 Phase 7 criteria before running"
  - "DROP TABLE IF EXISTS used so script is safe to re-run if tables already dropped"

patterns-established:
  - "Irreversible script pattern: prominent warning header + numbered checklist + confirmation query after execution"

requirements-completed: [DB-04]

# Metrics
duration: 5min
completed: 2026-03-19
---

# Phase 7 Plan 02: Drop Legacy Tables Script Summary

**Standalone SQL drop script for dj_rates and dj_pins with 5-point safety checklist header, gated on human verification of all Phase 7 migration criteria**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-19T08:07:10Z
- **Completed:** 2026-03-19T08:12:00Z
- **Tasks:** 1 of 2 (Task 2 is a human-verify checkpoint — awaiting human sign-off)
- **Files created:** 1

## Accomplishments

- Created `scripts/drop-legacy-tables.sql` with prominent MANUAL-STEP warning header
- 5-point pre-flight checklist covering all Phase 7 success criteria embedded as comments
- DROP TABLE IF EXISTS for both dj_rates and dj_pins (idempotent)
- Verification SELECT after drop to confirm 0 rows remain
- Existing 49-test suite passes with zero regressions

## Task Commits

1. **Task 1: Create drop legacy tables script** - `f726c22` (feat)

**Task 2 (human-verify checkpoint):** Awaiting human execution and verification in live Supabase

## Files Created/Modified

- `scripts/drop-legacy-tables.sql` — Manual DROP TABLE script; includes 5-criterion safety checklist, DROP IF EXISTS for dj_rates and dj_pins, and confirmation query returning 0 rows on success

## Decisions Made

- DROP TABLE IF EXISTS used so the script is safe to re-run without error if tables were already dropped
- Script is never called by migrate-djs-data.js or any other automation — strictly manual paste-and-execute in Supabase SQL Editor

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**To complete DB-04, the operator must:**

1. Run `scripts/migrate-djs-schema.sql` in Supabase Dashboard > SQL Editor (if not already done)
2. Run `node scripts/migrate-djs-data.js` to populate the djs table
3. Verify ALL 5 Phase 7 success criteria:
   - `SELECT COUNT(*) FROM djs;` — expected DJ count, no duplicates
   - `SELECT name, pin_hash FROM djs;` — all have bcrypt hashes ($2b$ prefix)
   - `SELECT name, recurring_availability FROM djs WHERE name = 'Mostyx';` — day-of-week keys present
   - `SELECT name, fixed_schedules FROM djs WHERE name = 'Davoted';` — arkbar and loveBeach keys present
   - Test at least 2 DJ logins with existing PINs via the app
4. Only after ALL pass: paste `scripts/drop-legacy-tables.sql` into Supabase SQL Editor and execute
5. Verify confirmation query returns 0 rows

## Next Phase Readiness

- Drop script ready and committed
- Phase 8 (server code migration) can begin once human verifies migration results and drops legacy tables
- Blocker from STATE.md (en-dash/hyphen duplicates) addressed by migrate-djs-data.js from Plan 01

---
*Phase: 07-database-schema-migration*
*Completed: 2026-03-19*

## Self-Check: PASSED

- scripts/drop-legacy-tables.sql: FOUND
- .planning/phases/07-database-schema-migration/07-02-SUMMARY.md: FOUND
- Commit f726c22: FOUND
