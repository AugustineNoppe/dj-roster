---
phase: 06-tech-debt
plan: 01
subsystem: api
tags: [cache, imports, dead-code, business-logic]

# Dependency graph
requires:
  - phase: 05-cleanup
    provides: DIAG_FIXED_TEMPLATE extracted to lib/business-logic.js and exported
provides:
  - cache.finalized co-located with other cache entries in cache object literal
  - SHORT_MONTHS removed from server.js imports (unused)
  - DIAG_FIXED_TEMPLATE single source of truth via import from lib/business-logic.js
affects: [server.js, lib/business-logic.js]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Co-locate cache init: all cache entries defined together in cache object literal at top of CACHE LAYER section"
    - "Import-not-copy: constants shared between server.js and lib modules are imported, never duplicated"

key-files:
  created: []
  modified:
    - server.js

key-decisions:
  - "cache.finalized belongs in the cache literal alongside djs/availability/roster — deferred assignment at line 783 was structural fragility with no runtime benefit"
  - "DIAG_FIXED_TEMPLATE is the single canonical copy in lib/business-logic.js; server.js imports it rather than defining a local duplicate"

patterns-established:
  - "Cache co-location: finalized entry added to cache literal so all cache entries are visible together"
  - "No local copies of exported constants: use require destructure instead"

requirements-completed: [STAB-02, CLN-03]

# Metrics
duration: 8min
completed: 2026-03-19
---

# Phase 6 Plan 01: Tech Debt Summary

**Three structural cleanups to server.js: cache.finalized moved into the cache literal, SHORT_MONTHS dead import removed, and DIAG_FIXED_TEMPLATE deduplicated to a single import from lib/business-logic.js**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-19T00:00:00Z
- **Completed:** 2026-03-19T00:08:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Moved `cache.finalized` into the cache object literal alongside djs, availability, and roster — eliminates init-order fragility from deferred assignment at line 783
- Removed unused `SHORT_MONTHS` import from the business-logic destructure block — no dead imports
- Replaced 32-line local `const DIAG_FIXED_TEMPLATE` copy with an import from `lib/business-logic.js` — single source of truth, eliminates drift risk
- All 49 Jest tests continue to pass with zero behavioral change

## Task Commits

Each task was committed atomically:

1. **Task 1: Move cache.finalized into cache literal and remove SHORT_MONTHS** - `63fa788` (refactor)
2. **Task 2: Replace local DIAG_FIXED_TEMPLATE with import from business-logic** - `0bf9660` (refactor)

## Files Created/Modified
- `server.js` - cache.finalized co-located, SHORT_MONTHS removed, DIAG_FIXED_TEMPLATE imported not duplicated

## Decisions Made
- cache.finalized belongs in the cache object literal alongside djs/availability/roster — deferred assignment at line 783 was structural fragility with no runtime benefit
- DIAG_FIXED_TEMPLATE is the single canonical copy in lib/business-logic.js; server.js imports it rather than defining a local duplicate

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The plan's inline verification script used `\!` shell escaping that caused a syntax error in Node 24 on Windows. Verified the same conditions manually via a module-input node script — all checks passed. This is a tooling quirk, not a code issue.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Tech debt from v1.0 audit resolved; server.js imports and cache structure are clean
- No blockers
