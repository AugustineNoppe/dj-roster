---
phase: 05-cleanup
plan: 02
subsystem: api
tags: [nodejs, jest, testing, refactor, business-logic]

# Dependency graph
requires:
  - phase: 05-cleanup
    plan: 01
    provides: server.js without dead code and reset-month endpoint (clean baseline for extraction)
provides:
  - lib/business-logic.js with extracted pure functions importable in tests and server.js
  - lib/business-logic.test.js with 49 Jest tests covering availability, accounting, auto-suggest
  - server.js wired to import from lib/business-logic.js with no behavioral change
affects: [05-cleanup]

# Tech tracking
tech-stack:
  added:
    - jest@^30.3.0 (dev dependency, test runner)
  patterns:
    - Extract pure functions from Express monolith into testable lib/ module
    - TDD: tests written after extraction, all passing before commit

key-files:
  created:
    - lib/business-logic.js
    - lib/business-logic.test.js
  modified:
    - server.js
    - package.json

key-decisions:
  - "Extracted DIAG_FIXED_TEMPLATE into lib/business-logic.js for test access; server.js retains its own copy (used by getDiagTemplateWarnings which references local constants)"
  - "getDJTemplateBlocks takes optional template param (defaults to DIAG_FIXED_TEMPLATE) so tests can pass custom templates without globals"
  - "buildAvailabilityMap takes fixedSchedules as parameter (not module-global) for test isolation"
  - "server.js fetchAvailability retains DB fetch logic; delegates pure map-building to buildAvailabilityMap()"
  - "computeFinalizationReport takes pre-fetched signoffRows and djRateMap; finalize endpoint retains DB fetches"

patterns-established:
  - lib/ directory for pure, testable business logic (no Express/Supabase dependencies)

requirements-completed:
  - CLN-02

# Metrics
duration: 7min
completed: 2026-03-18
---

# Phase 5 Plan 02: Cleanup — Business Logic Extraction and Jest Test Coverage Summary

**Extracted pure business logic from server.js monolith into lib/business-logic.js and added 49 Jest tests covering availability map building, finalization accounting, and auto-suggest template blocks**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-03-18T15:36:10Z
- **Completed:** 2026-03-18T15:43:00Z
- **Tasks:** 2
- **Files created:** 2 (lib/business-logic.js, lib/business-logic.test.js)
- **Files modified:** 2 (server.js, package.json)

## Accomplishments

- Created `lib/business-logic.js` exporting 13 items: `normalizeSlot`, `pad2`, `makeDateKey`, `parseDateKey`, `RESIDENTS`, `ALL_SLOTS`, `MONTH_NAMES`, `SHORT_MONTHS`, `FIXED_SCHEDULES`, `DIAG_FIXED_TEMPLATE`, `buildAvailabilityMap`, `computeFinalizationReport`, `getDJTemplateBlocks`
- Refactored `server.js` to import all pure functions/constants from `lib/business-logic.js` — no behavioral change, `node -c server.js` passes
- `fetchAvailability()` now delegates map-building to `buildAvailabilityMap({ portalRows, submittedNames, month, fixedSchedules })` — DB fetches stay in server.js
- Finalize endpoint now delegates accounting to `computeFinalizationReport({ signoffRows, djRateMap })` — DB fetches stay in server.js
- `getDJTemplateBlocks` imported from lib with optional `template` parameter for test injection
- Installed Jest as dev dependency and added `"test": "jest"` script to package.json
- Wrote 49 tests across 4 describe blocks — all pass in 0.4s

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract business logic + wire server.js** — `c790cda` (feat)
2. **Task 2: Jest test suite** — `cd4f162` (test)

## Files Created/Modified

- `lib/business-logic.js` — Pure functions and constants extracted from server.js (no Express/Supabase dependencies)
- `lib/business-logic.test.js` — 49 Jest tests across Utility, Availability, Accounting, Auto-suggest describe blocks
- `server.js` — Imports from lib/; inline definitions replaced; availability and finalization logic delegated
- `package.json` — Jest dev dependency added, `npm test` script added

## Test Coverage

**Utility functions (16 tests):**
- `normalizeSlot`: hyphen, en-dash, em-dash, null, undefined, multiple dashes
- `pad2`: single digit, double digit, zero
- `makeDateKey`: single/double digit month and day combinations
- `parseDateKey`: YYYY-MM-DD, D Mon YYYY, M/D/YYYY, YYYY/MM/DD, null, empty, garbage

**Availability logic (8 tests):**
- Empty inputs return Guest DJ on all 31 slots for March 2026
- Submitted DJ with available status is included
- Unsubmitted DJ is excluded (filter by submittedNames)
- Unavailable status slots excluded from DJ list
- Hyphen slot in portal row normalized before lookup
- FIXED_SCHEDULES DJs injected on correct weekdays (Davoted on Thursdays)
- FIXED_SCHEDULES DJs absent on wrong weekdays (Davoted not on Sundays)
- Portal rows for different month are ignored

**Finalization accounting (10 tests):**
- Correct hours per venue for one DJ
- Last-action-wins: sign then unsign = not counted
- Last-action-wins: unsign then sign = counted
- Guest DJ excluded from report
- Cost = total * rate (10 hours * rate 500 = 5000)
- Venue normalization: Love Beach -> love, ARKbar -> arkbar, HIP -> hip
- grandTotal and grandCost aggregate across multiple DJs
- Report sorted alphabetically by DJ name
- Rate 0 when DJ not in djRateMap
- Empty signoffRows returns empty report

**Auto-suggest template blocks (15 tests):**
- Davoted on arkbar Thursday: 1 block [20:00-21:00, 21:00-22:00, 22:00-23:00]
- Unknown DJ returns empty array
- HIP DJ (Tobi Thursday) returns HIP_SLOTS block
- Wrong DJ at hip venue returns empty
- Hip Saturday array toggle index 0 = Pick, index 1 = Tony
- Love weekday blocks (Pick Thursday: afternoon block)
- Multiple non-contiguous blocks (Alex RedWhite Sunday: afternoon + late-night)
- Default template param uses DIAG_FIXED_TEMPLATE

## Decisions Made

- Extracted `DIAG_FIXED_TEMPLATE` into lib for test access; server.js retains its own copy for `getDiagTemplateWarnings()` — double-require is fine (Node module cache, zero overhead)
- `getDJTemplateBlocks` adds optional `template` parameter to avoid global state in tests; defaults to `DIAG_FIXED_TEMPLATE` when not provided (backwards compatible)
- `buildAvailabilityMap` takes `fixedSchedules` as parameter rather than using module-level constant, enabling isolated unit tests
- `server.js` retains all DB fetch logic (Supabase calls) — only pure data transformation is extracted to lib/

## Deviations from Plan

None — plan executed exactly as written. Both TDD steps (extraction, then tests) performed in order. All 49 tests pass.

## Issues Encountered

One test required correction after running: the "multiple blocks" test initially referenced arkbar Monday (dow=1) for Alex RedWhite, but the actual template data shows Alex only has a single contiguous block on Monday. Corrected to use arkbar Sunday (dow=0), where Alex has two non-contiguous blocks (afternoon and late-night). This is a test data verification issue, not a code bug.

## User Setup Required

None — `npm test` runs Jest with no external service configuration required.

## Next Phase Readiness

- CLN-02 requirement satisfied
- `npm test` runs 49 tests in ~0.4s, all passing
- `lib/business-logic.js` is independently importable (no Express/Supabase dependencies)
- server.js behavior unchanged — safe to deploy
- Phase 05 cleanup is now complete (CLN-01, CLN-02, CLN-03 all satisfied)

---
*Phase: 05-cleanup*
*Completed: 2026-03-18*
