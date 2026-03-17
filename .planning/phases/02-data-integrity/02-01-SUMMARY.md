---
phase: 02-data-integrity
plan: 01
subsystem: api
tags: [supabase, upsert, normalization, availability]

# Dependency graph
requires: []
provides:
  - "POST /api/dj/availability writes slot values using normalizeSlot() — en-dash canonical format"
  - "CANONICAL slot format convention documented in code"
  - "Full read/write/cache lifecycle audited and verified consistent"
affects: [03-auth-hardening, availability-read, availability-write, upsert-deduplication]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "normalizeSlot() must be applied to all slot values before DB writes and after DB reads"
    - "Upsert key (name,date,slot) requires canonical slot format to avoid silent duplicate rows"

key-files:
  created: []
  modified:
    - server.js

key-decisions:
  - "Use normalizeSlot() on save instead of slot.replace() to match canonical en-dash convention used by all other write paths"
  - "Add CANONICAL comment above normalizeSlot definition as the definitive convention marker for future devs"

patterns-established:
  - "normalizeSlot pattern: all read and write paths normalize slots to en-dash (\\u2013) via normalizeSlot() before use as keys or DB values"

requirements-completed: [DATA-01]

# Metrics
duration: 12min
completed: 2026-03-18
---

# Phase 2 Plan 01: Availability Slot Normalization Fix Summary

**Fixed silent duplicate DB rows in dj_availability by replacing slot.replace(/–/g, '-') with normalizeSlot(slot) in the POST /api/dj/availability save path, and audited all read/write paths for consistency.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-18T00:00:00Z
- **Completed:** 2026-03-18T00:12:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Fixed the upsert bug where POST /api/dj/availability was writing ASCII hyphens while the DB upsert key expects en-dashes, causing silent duplicate rows
- Added CANONICAL slot format comment above normalizeSlot definition to document the convention
- Audited all availability read/write/cache paths and confirmed they all use normalizeSlot consistently
- Added DATA INTEGRITY AUDIT comment block in the POST handler documenting the verified state

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix slot normalization in POST /api/dj/availability** - `20008d1` (fix)
2. **Task 2: Audit full availability read/write lifecycle for remaining inconsistencies** - `53dada2` (feat)

**Plan metadata:** (docs: complete plan — to be added)

## Files Created/Modified
- `server.js` - Fixed slot.replace bug, added CANONICAL comment and audit comment block

## Decisions Made
- Use normalizeSlot() on the save path (POST /api/dj/availability) to match the convention already established in assign, batch-assign, signoff, and signoff-batch write paths — prevents upsert key mismatches between en-dash and ASCII hyphen variants
- Add CANONICAL comment above normalizeSlot definition as the single authoritative marker for this convention

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Data integrity for availability slot normalization is now clean end-to-end
- Any existing duplicate rows from prior saves (en-dash + hyphen variants for the same slot) are a DB-level concern and may need a one-time migration; no code path fix can retroactively resolve already-stored duplicates
- Phase 2 Plan 02 can proceed without availability data integrity concerns

---
*Phase: 02-data-integrity*
*Completed: 2026-03-18*
