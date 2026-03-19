---
phase: 05-cleanup
plan: 01
subsystem: api
tags: [express, nodejs, cleanup, security]

# Dependency graph
requires:
  - phase: 04-stability
    provides: invalidateCaches() centralized cache invalidation used by reset-month handler (now removed)
provides:
  - server.js without reset-month endpoint — dangerous data-deletion route eliminated
  - public/roster.html without Reset Month Data button or resetMonthData() function
  - server.js with dead code removed (orphaned constants and variables)
affects: [05-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - server.js
    - public/roster.html

key-decisions:
  - "Removed reset-month endpoint entirely per pre-Phase-1 decision — no safeguard or replacement needed, feature is too dangerous for production"
  - "Removed ALL_ARKBAR_SLOTS constant (orphaned, duplicate of local ALL_ARKBAR in getDJTemplateBlocks)"
  - "Removed satLoveToggleMap and satHipToggleMap variables (declared but never read; actual logic uses daySatLoveToggle and daySatHipToggle)"

patterns-established: []

requirements-completed:
  - CLN-01
  - CLN-03

# Metrics
duration: 33min
completed: 2026-03-18
---

# Phase 5 Plan 01: Cleanup — Reset-Month Removal and Dead Code Audit Summary

**Removed dangerous reset-month API endpoint and its UI button/function, plus three orphaned dead-code items from server.js**

## Performance

- **Duration:** ~33 min
- **Started:** 2026-03-18T15:00:00Z
- **Completed:** 2026-03-18T15:33:31Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Deleted `app.post('/api/admin/reset-month')` handler — 35-line block that wiped availability, submissions, and roster assignments for an entire month with no safeguards
- Removed the Reset Month Data button from the roster footer and the `resetMonthData()` async function from roster.html JS
- Removed orphaned `ALL_ARKBAR_SLOTS` module-level constant (defined but never referenced; functionality duplicated by local `ALL_ARKBAR` inside `getDJTemplateBlocks`)
- Removed orphaned `satLoveToggleMap` and `satHipToggleMap` variables inside the diagnostic endpoint (declared but never read)
- No TODO/FIXME/HACK/XXX markers found; all AUDIT documentation comments retained

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove reset-month endpoint and UI references** - `147d1cb` (feat)
2. **Task 2: Audit and remove dead code from server.js** - `af379f8` (chore)

**Plan metadata:** (pending final commit)

## Files Created/Modified
- `server.js` - Removed reset-month endpoint block (35 lines) and three dead-code items
- `public/roster.html` - Removed Reset Month Data button and resetMonthData() function (27 lines)

## Decisions Made
- Removed reset-month entirely with no replacement — this was a pre-Phase-1 decision ("too dangerous for production"), so no alternative implementation was needed
- Retained `diagGetUnavailLookupDate()` function — though it appears trivial (just returns its first argument), it is actively called by the diagnostic endpoint and provides a named hook for future date-shifting logic
- Retained all `/* == SECTION == */` header comments and `// AUDIT (Phase X Plan Y)` comments per plan instructions — these are documentation, not dead code

## Deviations from Plan

None - plan executed exactly as written. The audit identified three items of dead code (one more than the plan explicitly called out: `satLoveToggleMap` and `satHipToggleMap` in addition to the expected post-deletion orphan check). All removed under Rule 1 scope of the standard audit.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- CLN-01 and CLN-03 requirements satisfied
- server.js is clean: no reset-month, no dead code, passes `node -c` syntax check
- roster.html has no dangling references to removed endpoint
- Ready for next cleanup plan (CLN-02 test coverage, if planned)

---
*Phase: 05-cleanup*
*Completed: 2026-03-18*
