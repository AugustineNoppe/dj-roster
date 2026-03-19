# Requirements: DJ Roster — ARKbar Beach Club

**Defined:** 2026-03-19
**Core Value:** Reliable DJ scheduling across 3 venues — admins can build rosters from DJ availability, managers can sign off attendance, and DJs can view/manage their schedules.

## v2.0 Requirements

Requirements for v2.0 DJ Management & Supabase Consolidation. Each maps to roadmap phases.

### Database

- [x] **DB-01**: Single `djs` table created with columns: id, name, pin_hash, rate, type, active, venues, recurring_availability (JSONB), fixed_schedules (JSONB), failed_attempts, locked_until
- [x] **DB-02**: Migration script populates `djs` from dj_rates + dj_pins, deduplicating en-dash/hyphen name variants
- [x] **DB-03**: Migration seeds recurring_availability JSONB from FIXED_AVAILABILITY constants and fixed_schedules JSONB from FIXED_SCHEDULES constants
- [x] **DB-04**: Old tables (dj_rates, dj_pins) dropped after verified cutover

### Admin Management

- [ ] **ADMIN-01**: Admin can view all DJs in a Manage DJs tab with name, rate, type, active status, and lockout status
- [ ] **ADMIN-02**: Admin can add a new DJ with name, rate, type, and PIN
- [ ] **ADMIN-03**: Admin can edit a DJ's name, rate, and type
- [ ] **ADMIN-04**: Admin can deactivate a DJ — DJ disappears from all dropdowns, auto-suggest, and login; historical data preserved
- [ ] **ADMIN-05**: Admin can reactivate a deactivated DJ — fully restored to all UI and login
- [ ] **ADMIN-06**: Admin can reset a DJ's PIN by inputting a new PIN (server hashes it)
- [ ] **ADMIN-07**: Admin can view lockout status and clear lockout for a DJ
- [ ] **ADMIN-08**: Rate editing removed from DJ Hours tab — consolidated into Manage DJs tab

### Scheduling Config

- [ ] **SCHED-01**: Recurring availability (FIXED_AVAILABILITY) read from djs.recurring_availability instead of hardcoded constant
- [ ] **SCHED-02**: Admin can edit a DJ's recurring availability via day-of-week checkbox grid in Manage DJs tab
- [ ] **SCHED-03**: Fixed schedules (FIXED_SCHEDULES) read from djs.fixed_schedules instead of hardcoded constant
- [ ] **SCHED-04**: Admin can edit a DJ's fixed schedule via venue + day + slot grid in Manage DJs tab
- [ ] **SCHED-05**: All hardcoded DJ arrays removed from server.js and roster.html — DJ list read dynamically from Supabase

### Stability

- [ ] **STAB-01**: Account lockout persisted to djs table (failed_attempts, locked_until) — survives server restarts
- [ ] **STAB-02**: All lockout functions converted to async DB calls in a single atomic commit
- [ ] **STAB-03**: Try-catch all bare Supabase calls with graceful error responses

## Future Requirements

Deferred to v3+. Tracked but not in current roadmap.

### Security

- **SEC-04**: Webhook signature verification for inbound hooks (HMAC-SHA256)

### Admin Enhancements

- **ADMIN-09**: Full audit log for admin DJ changes
- **ADMIN-10**: DJ bulk import via CSV
- **ADMIN-11**: Per-venue rate overrides per DJ

### Data Migration

- **DATA-01**: HIP_ROTATION, LOVE_DJS, RESIDENTS_80HR moved from frontend constants to database
- **DATA-02**: DIAG_FIXED_TEMPLATE moved from business-logic.js to database

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Webhook signature verification (SEC-04) | No active inbound webhooks currently — defer to v3 |
| HIP_ROTATION, LOVE_DJS, RESIDENTS_80HR to DB | Focus on djs table consolidation only |
| DIAG_FIXED_TEMPLATE to DB | High breakage risk for auto-suggest, defer to v3+ |
| Audit log for admin DJ changes | v3+ feature |
| DJ bulk import (CSV) | v3+ feature |
| Per-venue rate overrides | v3+ feature |
| Mobile native app | Web-only, responsive is sufficient |
| OAuth/SSO integration | PIN/password auth sufficient for venue |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DB-01 | Phase 7 | Complete |
| DB-02 | Phase 7 | Complete |
| DB-03 | Phase 7 | Complete |
| DB-04 | Phase 7 | Complete |
| ADMIN-01 | Phase 10 | Pending |
| ADMIN-02 | Phase 9 | Pending |
| ADMIN-03 | Phase 9 | Pending |
| ADMIN-04 | Phase 9 | Pending |
| ADMIN-05 | Phase 9 | Pending |
| ADMIN-06 | Phase 9 | Pending |
| ADMIN-07 | Phase 9 | Pending |
| ADMIN-08 | Phase 9 | Pending |
| SCHED-01 | Phase 8 | Pending |
| SCHED-02 | Phase 10 | Pending |
| SCHED-03 | Phase 8 | Pending |
| SCHED-04 | Phase 10 | Pending |
| SCHED-05 | Phase 8 | Pending |
| STAB-01 | Phase 8 | Pending |
| STAB-02 | Phase 8 | Pending |
| STAB-03 | Phase 8 | Pending |

**Coverage:**
- v2.0 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-19*
*Last updated: 2026-03-19 after roadmap creation*
