# Phase 1: Auto-Suggest - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Investigate why auto-suggest assigns DJs to wrong slots, fix the root causes, filter unavailable DJs from the manual dropdown, and add logging for future regression detection. No new features — only fix existing auto-suggest and dropdown behavior.

</domain>

<decisions>
## Implementation Decisions

### Investigation approach
- Build a diagnostic admin endpoint first (`GET /api/admin/diagnostic/:month`)
- Endpoint compares availability data vs. roster assignments, reveals all violations across a month
- Use specific failing cases to validate diagnostic output:
  - Tue 3 March ARKbar: Raffo DJ assigned 11PM only, should be 11PM-2AM (3 slots)
  - Tue 3 March ARKbar: Pick assigned 2PM only, should be 2PM-5PM (3 slots)
  - Tue 10 March HIP 9PM-1AM: dropdown shows unavailable DJs as selectable
  - Mon 30 March: Tony assigned 1 slot instead of 3-hour block
- Diagnostic reveals all failures, not just manually spotted ones

### Fix boundary
- Enforce all-or-nothing block assignment for ARKbar and Love Beach (like HIP already does with `.every()`)
- If any slot in a DJ's template block fails `canAssign()`, skip the entire block — no partial assignments
- Fix the manual dropdown to filter out unavailable DJs for the selected date/slot (Phase 1 scope, not deferred)
- Verify FIXED_TEMPLATE matches reality as part of investigation — template could be stale
- Do NOT change the 3-pass structure (Love → ARKbar → HIP) or add new features

### Logging design
- Decision log: for each DJ+date+slot, log why it was assigned or skipped (unavailable, already placed, not submitted, partial block rejected)
- Console output (not persisted to Supabase)
- Summary toast after auto-suggest: "Assigned X, skipped Y unavailable, Z partial blocks rejected"
- Full detail in browser DevTools console

### Verification method
- Diagnostic endpoint: run on real month before and after fix, compare violation count
- Manual test: user runs auto-suggest and checks the 4 specific failing cases
- Automated test: extract `canAssign()` + auto-suggest logic from roster.html into a shared .js module importable by both browser and Jest
- Jest test simulates auto-suggest with known availability data, asserts no unavailability violations and no partial blocks

### Claude's Discretion
- Exact diagnostic endpoint response format
- How to structure the extracted module (ES modules vs CommonJS)
- Console log formatting and grouping
- Jest test fixture data design

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `canAssign()` in `roster.html:1251-1257` — core assignment check, needs all-or-nothing wrapper
- `getUnavailLookupDate()` in `roster.html:1241-1248` — post-midnight date shifting, may be involved in key mismatch
- `normalizeSlot()` in `server.js:77` — slot format normalization
- `parseDateKey()` in `server.js:81-96` — multi-format date parsing

### Established Patterns
- HIP pass already enforces all-or-nothing: `LOCAL_HIP_SLOTS.every(slot => canAssign(...))` (roster.html:1329)
- ARKbar and Love passes assign slot-by-slot independently — this is the root of truncation
- Unavailability data format: `"djName": ["YYYY-MM-DD|HH:MM–HH:MM", ...]` from server endpoint
- `placedTonight` Map tracks cross-venue conflicts per calendar day

### Integration Points
- `/api/roster/unavailability/:month` (server.js:368) — feeds the `unavailabilityMap` used by `canAssign()`
- `FIXED_TEMPLATE` object (roster.html:1199-1230) — defines expected DJ blocks per venue per day
- DJ dropdown in roster grid — currently no unavailability filter applied
- `submittedDJs` Map — `canAssign()` requires DJ status to be 'submitted'

</code_context>

<specifics>
## Specific Ideas

- "DJs being assigned to fewer slots than their full block" — the user sees 1-slot assignments where 3-slot blocks should appear
- "Unavailable DJs appearing as selectable in dropdown" — the filter is completely missing for manual assignment
- "No way to cross-reference availability data against the roster" — diagnostic endpoint addresses this gap
- User cannot manually verify all cases — data too spread out across venues/dates/slots

</specifics>

<deferred>
## Deferred Ideas

- Moving FIXED_TEMPLATE to database (identified in CONCERNS.md) — separate future phase
- Adding Supabase error handling to the unavailability endpoint — Phase 4 scope
- Cross-referencing UI panel in roster.html — could be useful but would be a new feature

</deferred>

---

*Phase: 01-auto-suggest*
*Context gathered: 2026-03-13*
