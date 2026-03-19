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

# Phase 7 Plan 02: Drop Legacy Tables & Human Verification Summary

**Standalone SQL drop script for dj_rates and dj_pins created; human verified all 5 Phase 7 success criteria in live Supabase (17 DJs, correct PINs, correct JSONB) and legacy tables dropped**

## Performance

- **Duration:** ~10 min (script creation + human verification checkpoint)
- **Started:** 2026-03-19T08:07:10Z
- **Completed:** 2026-03-19
- **Tasks:** 2 of 2 (COMPLETE)
- **Files created:** 1

## Accomplishments

- Created `scripts/drop-legacy-tables.sql` with prominent MANUAL-STEP warning header
- 5-point pre-flight checklist covering all Phase 7 success criteria embedded as comments
- DROP TABLE IF EXISTS for both dj_rates and dj_pins (idempotent)
- Verification SELECT after drop to confirm 0 rows remain
- Human verified all 5 Phase 7 success criteria in live Supabase:
  - djs table has 17 DJs with no duplicates
  - DJ logins work with existing PINs
  - recurring_availability and fixed_schedules JSONB data is correct
  - Legacy tables (dj_rates, dj_pins) have been dropped

## Task Commits

1. **Task 1: Create drop legacy tables script** - `f726c22` (feat)
2. **Task 2: Execute migration and verify in live Supabase** - human-verify checkpoint approved; destructive DROP TABLE executed by operator after verification

**Plan metadata:** `c4b0af0` (docs: complete drop-legacy-tables plan)

## Files Created/Modified

- `scripts/drop-legacy-tables.sql` — Manual DROP TABLE script; includes 5-criterion safety checklist, DROP IF EXISTS for dj_rates and dj_pins, and confirmation query returning 0 rows on success

## Decisions Made

- DROP TABLE IF EXISTS used so the script is safe to re-run without error if tables were already dropped
- Script is never called by migrate-djs-data.js or any other automation — strictly manual paste-and-execute in Supabase SQL Editor
- Human checkpoint (checkpoint:human-verify) used as blocking gate before destructive DROP TABLE operation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - all operator steps completed. DB-04 is done.

## Next Phase Readiness

- Phase 7 is fully complete: djs table created, all DJ data migrated, legacy tables dropped, all 5 success criteria verified in live Supabase
- Phase 8 (Backend Server Cutover) can begin: switch server.js and lib/business-logic.js to read from djs table, persist lockout to DB, remove FIXED_AVAILABILITY/FIXED_SCHEDULES constants
- Key blockers for Phase 8:
  - All three lockout functions must convert to async DB in a single commit (split-brain risk)
  - FIXED_SCHEDULES/FIXED_AVAILABILITY constants must stay until ALL call sites confirmed migrated

---
*Phase: 07-database-schema-migration*
*Completed: 2026-03-19*

## Self-Check: PASSED

- scripts/drop-legacy-tables.sql: FOUND
- .planning/phases/07-database-schema-migration/07-02-SUMMARY.md: FOUND
- Commit f726c22: FOUND
- Commit c4b0af0: FOUND
