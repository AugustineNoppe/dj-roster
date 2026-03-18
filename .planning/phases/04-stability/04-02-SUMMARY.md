---
phase: 04-stability
plan: 02
subsystem: api
tags: [cache, invalidation, server.js, bug-fix]

# Dependency graph
requires:
  - phase: 04-stability-01
    provides: helmet and express-rate-limit security middleware in server.js
provides:
  - Centralized invalidateCaches() function with documented cache dependency graph
  - Fix for stale availability data after DJ rate updates
affects: [05-testing]

# Tech tracking
tech-stack:
  added: []
  patterns: [centralized-cache-invalidation]

key-files:
  created: []
  modified:
    - server.js

key-decisions:
  - "Centralize all cache invalidation in invalidateCaches() so cache dependency graph is documented in one place — prevents future gaps"
  - "invalidateCaches('djs') clears both cache.djs AND cache.availability.clear() — DJ rate changes affect all availability months"
  - "Keep invalidateRoster() and invalidateAllRosters() as internal helpers used by invalidateCaches() — not removed"

patterns-established:
  - "All mutation endpoints call invalidateCaches(type, opts) instead of direct cache manipulation"
  - "Cache dependency graph documented in JSDoc comment on invalidateCaches()"

requirements-completed: [STAB-02]

# Metrics
duration: 8min
completed: 2026-03-18
---

# Phase 04 Plan 02: Cache Invalidation Centralization Summary

**Centralized cache invalidation via invalidateCaches() and fixed stale DJ rate data bug where POST /api/djs/update failed to clear cache.availability**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-18T10:50:00Z
- **Completed:** 2026-03-18T10:58:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Fixed bug: POST /api/djs/update now calls `invalidateCaches('djs')` which clears both `cache.djs` and all `cache.availability` entries (previously only cleared `cache.djs`, causing stale DJ rate data for up to 3 minutes)
- Added `invalidateCaches(type, opts)` function with documented cache dependency graph in JSDoc comment
- Replaced all 7 scattered ad-hoc cache clearing calls in endpoint handlers with `invalidateCaches()` calls
- Kept `invalidateRoster()` and `invalidateAllRosters()` as internal helpers used by `invalidateCaches()`

## Task Commits

Each task was committed atomically:

1. **Task 1: Create centralized cache invalidation and fix DJ rate update gap** - `e163650` (feat)

**Plan metadata:** (docs commit — pending)

## Files Created/Modified

- `server.js` - Added `invalidateCaches()` function (lines 237-269); replaced 7 ad-hoc cache clearing calls with `invalidateCaches()` calls throughout endpoint handlers

## Decisions Made

- `invalidateCaches('djs')` clears all availability months (`cache.availability.clear()`) because DJ rate changes can affect any month's availability display context — a full clear is safer than partial
- Cache dependency graph documented in JSDoc on the function itself so future devs understand which caches depend on which data before making changes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Cache invalidation is now centralized and correct; stale availability data after DJ rate changes is fixed
- Phase 5 (testing) can verify cache invalidation behavior via unit tests against `invalidateCaches()`

---
*Phase: 04-stability*
*Completed: 2026-03-18*
