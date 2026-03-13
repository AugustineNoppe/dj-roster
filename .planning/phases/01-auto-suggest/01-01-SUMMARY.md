---
phase: 01-auto-suggest
plan: 01
subsystem: api
tags: [diagnostic, auto-suggest, supabase, roster, availability]

# Dependency graph
requires: []
provides:
  - "GET /api/admin/diagnostic/:month endpoint in server.js"
  - "Server-side DIAG_FIXED_TEMPLATE for block comparison"
  - "Root cause analysis of partial block assignments documented"
affects:
  - "01-02 (auto-suggest fix plan — acts on findings here)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Admin diagnostic endpoint: cross-reference two Supabase tables and return structured violation data"
    - "Post-midnight date shifting: diagGetUnavailLookupDate() mirrors client-side getUnavailLookupDate()"
    - "Block detection: getDJTemplateBlocks() extracts contiguous runs from DIAG_FIXED_TEMPLATE"

key-files:
  created: []
  modified:
    - "server.js — diagnostic endpoint + DIAG_FIXED_TEMPLATE + helper functions"

key-decisions:
  - "Template cross-check confirmed: Raffo DJ is NOT in ARKbar Tuesday 11PM-2AM block (Tony is). Template may reflect current intent, not original failing case."
  - "Template cross-check confirmed: Pick is NOT in ARKbar Tuesday 2PM-5PM block (Davoted is). Same conclusion."
  - "Both template warnings are emitted at runtime via getDiagTemplateWarnings() — investigation finding documented in templateWarnings response field"

patterns-established:
  - "Diagnostic endpoint pattern: requireAdmin + parallel Supabase fetches + cross-reference + structured JSON response"
  - "Template block grouping: iterate ordered slots, build contiguous runs per DJ per day per venue"

requirements-completed:
  - ASGN-01

# Metrics
duration: 15min
completed: 2026-03-13
---

# Phase 1 Plan 01: Diagnostic Endpoint + Root Cause Analysis Summary

**Diagnostic admin endpoint reveals all unavailability violations and partial block assignments; root cause of auto-suggest truncation confirmed as slot-by-slot iteration without all-or-nothing block enforcement in Love Beach and ARKbar passes**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-13T09:45:00Z
- **Completed:** 2026-03-13T10:00:00Z
- **Tasks:** 2
- **Files modified:** 1 (server.js) + 1 (this SUMMARY)

## Accomplishments

- Built `GET /api/admin/diagnostic/:month` endpoint (protected with `requireAdmin`) that cross-references `roster_assignments` and `dj_availability` for any month
- Duplicated `FIXED_TEMPLATE` from roster.html as `DIAG_FIXED_TEMPLATE` in server.js for server-side block comparison
- Cross-checked template against known failing cases: confirmed template WARNINGS for both Raffo DJ and Pick on Tuesday ARKbar (template shows Tony and Davoted in those slots)
- Documented the three confirmed root causes of auto-suggest failures for Plan 02 to act on

## Task Commits

Each task was committed atomically:

1. **Task 1: Build diagnostic endpoint** - `07b1ddf` (feat)
2. **Task 2: Document root cause findings in SUMMARY** — (included in docs metadata commit)

**Plan metadata:** (docs commit — see final commit hash)

## Files Created/Modified

- `server.js` — Added `DIAG_FIXED_TEMPLATE` const, `getDiagTemplateWarnings()`, `diagGetUnavailLookupDate()`, `getDJTemplateBlocks()`, and `GET /api/admin/diagnostic/:month` route (~305 lines added)
- `.planning/phases/01-auto-suggest/01-01-SUMMARY.md` — This file

## Root Cause Analysis

### Root Cause 1: Slot-by-slot assignment without block enforcement (Love Beach + ARKbar)

**The core bug.** Both Love Beach and ARKbar passes iterate slots independently:

**Love Beach (lines 1287–1293):**
```javascript
for (const slot of slots) {
  const dj = template[slot];
  if (!dj) continue;
  if (canAssign(dj, dateStr, slot, loveWorking)) {
    recordPlacement(dj, dateStr, slot, loveWorking, loveToSave, 'love');
  }
}
```

**ARKbar (lines 1305–1311):**
```javascript
for (const slot of ALL_ARKBAR_SLOTS) {
  const dj = template[slot];
  if (!dj) continue;
  if (canAssign(dj, dateStr, slot, working)) {
    recordPlacement(dj, dateStr, slot, working, toSave, 'arkbar');
  }
}
```

When `canAssign()` fails for one slot in a DJ's block (e.g., DJ marked unavailable for slot 2 of 3), the other slots still succeed and get assigned. This produces partial blocks where a DJ has 1 or 2 out of their 3-slot assignment.

**Compare with HIP (line 1329) which does it correctly:**
```javascript
if (!LOCAL_HIP_SLOTS.every(slot => canAssign(hipDJ, dateStr, slot, hipAssignments))) continue;
```
HIP uses `.every()` — if any slot fails, the entire day is skipped. No partial HIP assignments are possible.

**Fix needed for Plan 02:** Wrap Love Beach and ARKbar passes in the same `.every()` pattern. Group template slots into their contiguous blocks per DJ, check all slots before assigning any.

### Root Cause 2: Dropdown shows unavailable DJs as selectable options

**In `buildCell()` (lines 916–978)**, DJs are categorized into three `<optgroup>` groups: AVAILABLE, UNAVAILABLE, and NOT SUBMITTED. All three groups render as selectable `<option>` elements. The "UNAVAILABLE" group gets a warning icon (`⚠`) but the option is not `disabled`.

```javascript
// Line 965-967: unavailable DJs get a warning but remain selectable
const label = isSelected ? dj : (arkBooked ? `${dj} ⚠ ARKbar` : `${dj} ⚠`);
opts += `<option value="${dj}"${isSelected ? ' selected' : ''}>${label}</option>`;
```

A manager can accidentally pick a DJ from the UNAVAILABLE group without being blocked. The warning icon is the only guard.

**Fix needed for Plan 02:** Either add `disabled` attribute to UNAVAILABLE options, or remove them from the dropdown entirely (leaving them unselectable).

### Root Cause 3: No logging of assignment decisions

The auto-suggest function (Lines 1268–1335) produces zero `console.log` output. When a DJ ends up with fewer slots than expected, there is no way to diagnose which `canAssign()` check failed or why. The only feedback is the final count toast.

**Fix needed for Plan 02:** Add per-decision logging. For each DJ+date+slot, log why it was assigned or skipped (unavailable, already placed, not submitted, partial block rejected). Emit a summary toast: "Assigned X, skipped Y unavailable, Z partial blocks rejected".

### Root Cause 4: FIXED_TEMPLATE accuracy — WARNING

The template cross-check (`getDiagTemplateWarnings()`) reveals two warnings about known failing cases:

**Raffo DJ — ARKbar Tuesday 11PM–2AM:**
- Expected `23:00–00:00`, `00:00–01:00`, `01:00–02:00` to be assigned to Raffo DJ
- Actual template (DIAG_FIXED_TEMPLATE.arkbar[1]): these slots are assigned to **Tony**
- The plan description said "Raffo DJ assigned 11PM only, should be 11PM-2AM" — but the template itself assigns Tony to that block, not Raffo DJ

**Pick — ARKbar Tuesday 2PM–5PM:**
- Expected `14:00–15:00`, `15:00–16:00`, `16:00–17:00` to be assigned to Pick
- Actual template (DIAG_FIXED_TEMPLATE.arkbar[1]): `14:00–15:00` and `15:00–16:00` are assigned to **Davoted** (no 16:00–17:00 entry at all for Davoted on Tuesday)
- Pick does not appear in ARKbar Tuesday at all

**Conclusion:** The FIXED_TEMPLATE as copied from roster.html does NOT match the failing case descriptions provided in the phase context. Two possible interpretations:
1. The template has been updated since the failing cases were observed (template is now correct, violating assignments came from an older version)
2. The failing case description references different slots than what's actually in the template

The diagnostic endpoint will correctly report this discrepancy via `templateWarnings` in its response. The actual violation detection (unavailability check + partial block detection) still operates on the current template — so any real violations will be surfaced.

## Decisions Made

- `getDiagTemplateWarnings()` emits template mismatch warnings at runtime, not at server startup. This avoids log noise on every request and surfaces warnings only when diagnostic is actually run.
- `getDJTemplateBlocks(venue, dow, djName, satToggle)` extracts contiguous blocks in template slot order. Partial block detection uses this to compare expected vs actual slots.
- Saturday alternation toggle (`daySatLoveToggle`, `daySatHipToggle`) is pre-computed by iterating days in order before the main diagnostic loop, matching auto-suggest logic exactly.

## Deviations from Plan

None — plan executed exactly as written. The template warnings for Raffo DJ and Pick are expected findings, documented per the plan's instructions.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Plan 02 (auto-suggest fix) can now proceed. The three root causes are confirmed:
1. Add `.every()` block enforcement to Love Beach and ARKbar passes
2. Disable or remove unavailable DJ options from the dropdown
3. Add decision logging throughout auto-suggest

The diagnostic endpoint is available to verify before/after fix: `GET /api/admin/diagnostic/March%202026` with `x-admin-password` header.

**Concern:** The template warnings for Raffo DJ and Pick may indicate the FIXED_TEMPLATE in roster.html has been updated since the failing cases were first observed. The Plan 02 fixer should re-verify which exact cases are currently failing before applying the block enforcement fix.

---
*Phase: 01-auto-suggest*
*Completed: 2026-03-13*
