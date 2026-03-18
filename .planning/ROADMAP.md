# Roadmap: DJ Roster — ARKbar Beach Club

## Overview

v1.0 Production Readiness takes the existing working app from a broken state to go-live condition. Auto-suggest is an immediate blocker — the root cause is unknown, so Phase 1 is an investigation-first phase. Subsequent phases verify data integrity, harden security, improve stability, and clean up before go-live. No new features are introduced. Every phase fixes or verifies something that currently isn't trustworthy.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Auto-Suggest** - Investigate root cause, fix unavailability violations, add regression logging
- [x] **Phase 2: Data Integrity** - Verify availability saves, sign-off flow, and accounting calculations are correct (completed 2026-03-17)
- [x] **Phase 3: Security** - Hash PINs and passwords, remove sensitive data from logs (completed 2026-03-18)
- [x] **Phase 4: Stability** - Fix rate limiter memory leak, cache invalidation gaps, adopt helmet/express-rate-limit (completed 2026-03-18)
- [ ] **Phase 5: Cleanup** - Remove reset-month feature, add test coverage, remove dead code

## Phase Details

### Phase 1: Auto-Suggest
**Goal**: Auto-suggest reliably respects DJ unavailability and produces a correct roster
**Depends on**: Nothing (first phase)
**Requirements**: ASGN-01, ASGN-02, ASGN-03
**Success Criteria** (what must be TRUE):
  1. Root cause of unavailability violations is documented with a confirmed reproduction case
  2. Running auto-suggest no longer assigns any DJ to a slot they marked unavailable
  3. Auto-suggest output is logged in enough detail to identify if a regression occurs in the future
  4. Existing valid assignments (Davoted fixed schedule, available DJs) are not disrupted by the fix
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — Diagnostic endpoint + root cause investigation
- [ ] 01-02-PLAN.md — Fix auto-suggest block enforcement, dropdown filtering, decision logging
- [ ] 01-03-PLAN.md — Extract roster logic into shared module + Jest test suite

### Phase 2: Data Integrity
**Goal**: Availability saves, sign-off flow, and finalization accounting are verified correct end-to-end
**Depends on**: Phase 1
**Requirements**: DATA-01, DATA-02, DATA-03
**Success Criteria** (what must be TRUE):
  1. A DJ's availability submission persists to Supabase and is reflected correctly on subsequent reads
  2. Admin sign-off and unsign-off actions update the correct record, and last-action-wins is respected on rapid toggles
  3. Batch sign-off applies to exactly the intended set of DJs with no silent failures
  4. Finalization report shows correct hours and costs per DJ per venue using their stored rates
**Plans**: 3 plans

Plans:
- [ ] 02-01-PLAN.md — Fix slot normalization bug in availability save path (DATA-01)
- [ ] 02-02-PLAN.md — Fix timestamp ordering in sign-off read paths, audit batch/unsign (DATA-02)
- [ ] 02-03-PLAN.md — Audit finalization accounting, write offline verification script (DATA-03)

### Phase 3: Security
**Goal**: Credentials are stored securely and sensitive values never appear in log output
**Depends on**: Phase 2
**Requirements**: SEC-01, SEC-02, SEC-03
**Success Criteria** (what must be TRUE):
  1. DJ PINs are stored as bcrypt hashes — a plain-text PIN value is never written to the database
  2. Admin and manager passwords are stored as bcrypt hashes — string equality comparison is removed
  3. Login with the correct PIN or password succeeds; login with an incorrect credential is rejected
  4. No PIN, password, or credential value appears in any server log output under any code path
**Plans**: 2 plans

Plans:
- [ ] 03-01-PLAN.md — Hash DJ PINs with bcrypt, add account lockout, scrub credential values from logs (SEC-01, SEC-03)
- [ ] 03-02-PLAN.md — Replace admin/manager string equality password checks with bcrypt.compare (SEC-02)

### Phase 4: Stability
**Goal**: The server handles sustained load without memory growth and cache state is always consistent
**Depends on**: Phase 3
**Requirements**: STAB-01, STAB-02, STAB-03
**Success Criteria** (what must be TRUE):
  1. Rate limiter data structures are bounded — repeated requests over time do not grow memory unboundedly
  2. Updating a DJ's rate causes all dependent cached values to be invalidated on next read
  3. Security headers and rate limiting are provided by helmet and express-rate-limit, and the custom implementations are removed
**Plans**: 2 plans

Plans:
- [ ] 04-01-PLAN.md — Replace custom rate limiter and security headers with helmet + express-rate-limit (STAB-01, STAB-03)
- [ ] 04-02-PLAN.md — Centralize cache invalidation, fix DJ rate update gap (STAB-02)

### Phase 5: Cleanup
**Goal**: The codebase is safe to ship — dangerous endpoints removed, business logic tested, dead code gone
**Depends on**: Phase 4
**Requirements**: CLN-01, CLN-02, CLN-03
**Success Criteria** (what must be TRUE):
  1. The reset-month endpoint does not exist in the running server and no UI element references it
  2. Jest tests cover availability logic, accounting calculations, and auto-suggest and all pass
  3. No commented-out code blocks, unreachable paths, or orphaned functions remain in server.js
**Plans**: 2 plans

Plans:
- [ ] 05-01-PLAN.md — Remove reset-month endpoint and UI references, audit and remove dead code (CLN-01, CLN-03)
- [ ] 05-02-PLAN.md — Extract business logic into testable module, add Jest test coverage (CLN-02)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Auto-Suggest | 1/3 | In progress | - |
| 2. Data Integrity | 3/3 | Complete    | 2026-03-17 |
| 3. Security | 2/2 | Complete   | 2026-03-18 |
| 4. Stability | 2/2 | Complete   | 2026-03-18 |
| 5. Cleanup | 0/2 | Not started | - |
