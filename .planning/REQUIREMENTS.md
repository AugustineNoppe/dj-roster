# Requirements: DJ Roster — ARKbar Beach Club

**Defined:** 2026-03-13
**Core Value:** Reliable DJ scheduling across 3 venues

## v1.0 Requirements

Requirements for production readiness. Each maps to roadmap phases.

### Auto-Suggest

- [x] **ASGN-01**: Investigate root cause of DJs being assigned to slots they marked unavailable
- [ ] **ASGN-02**: Fix auto-suggest to respect DJ unavailability markings
- [ ] **ASGN-03**: Add logging/diagnostics around auto-suggest for future regression detection

### Data Integrity

- [x] **DATA-01**: Verify DJ availability submissions persist correctly to Supabase
- [x] **DATA-02**: Verify sign-off flow end-to-end (sign/unsign/batch-sign, last-action-wins logic)
- [x] **DATA-03**: Verify finalization accounting: hours per DJ by venue, rates, cost calculations

### Security

- [x] **SEC-01**: Hash DJ PINs with bcrypt, use timing-safe comparison, add account lockout
- [x] **SEC-02**: Hash admin/manager passwords, replace string equality comparison with hashed verification
- [x] **SEC-03**: Remove PIN values, passwords, and sensitive data from all log output

### Stability

- [x] **STAB-01**: Fix unbounded memory growth in custom rate limiter
- [x] **STAB-02**: Fix cache invalidation gaps (DJ rate updates not invalidating dependent caches)
- [x] **STAB-03**: Replace custom security headers and rate limiter with helmet and express-rate-limit

### Cleanup

- [ ] **CLN-01**: Remove reset-month endpoint and all UI references to it
- [ ] **CLN-02**: Add Jest test coverage for business logic (availability, accounting, auto-suggest)
- [ ] **CLN-03**: Remove dead code, commented-out blocks, unreachable paths

## v2 Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### Security

- **SEC-04**: Webhook signature verification for inbound hooks

### Stability

- **STAB-04**: Try-catch all Supabase calls, return graceful errors, prevent route crashes

### Admin

- **ADMIN-01**: Admin "Manage DJs" page — add new DJ (name, PIN auto-hashed, rate), edit rate, deactivate DJ (remove from dropdowns/auto-suggest without deleting historical data). When built, remove individual rate edit icons from DJ Hours tab — rate management moves entirely to Manage DJs page.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Database migration | Supabase is already live — migration complete |
| New features | This milestone is fix/quality only |
| UI redesign | Not in scope — only functional fixes |
| Mobile native app | Web-only, responsive sufficient |
| OAuth/SSO | PIN/password auth sufficient for venue use case |
| CI/CD pipeline | Out of scope for this pass |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ASGN-01 | Phase 1 | Complete (Plan 01-01) |
| ASGN-02 | Phase 1 | Pending |
| ASGN-03 | Phase 1 | Pending |
| DATA-01 | Phase 2 | Complete |
| DATA-02 | Phase 2 | Complete |
| DATA-03 | Phase 2 | Complete |
| SEC-01 | Phase 3 | Complete |
| SEC-02 | Phase 3 | Complete |
| SEC-03 | Phase 3 | Complete |
| STAB-01 | Phase 4 | Complete |
| STAB-02 | Phase 4 | Complete |
| STAB-03 | Phase 4 | Complete |
| CLN-01 | Phase 5 | Pending |
| CLN-02 | Phase 5 | Pending |
| CLN-03 | Phase 5 | Pending |

**Coverage:**
- v1.0 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-13*
*Last updated: 2026-03-13 — traceability confirmed after roadmap creation*
