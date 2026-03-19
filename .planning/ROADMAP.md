# Roadmap: DJ Roster — ARKbar Beach Club

## Milestones

- ✅ **v1.0 Production Readiness** — Phases 1-6 (shipped 2026-03-19)
- 📋 **v2.0 DJ Management & Supabase Consolidation** — Phases 7-10 (planned)

## Phases

<details>
<summary>✅ v1.0 Production Readiness (Phases 1-6) — SHIPPED 2026-03-19</summary>

- [x] Phase 1: Auto-Suggest (3/3 plans) — completed 2026-03-18
- [x] Phase 2: Data Integrity (3/3 plans) — completed 2026-03-17
- [x] Phase 3: Security (2/2 plans) — completed 2026-03-18
- [x] Phase 4: Stability (2/2 plans) — completed 2026-03-18
- [x] Phase 5: Cleanup (2/2 plans) — completed 2026-03-18
- [x] Phase 6: Tech Debt (1/1 plan) — completed 2026-03-19

</details>

### 📋 v2.0 DJ Management & Supabase Consolidation (Planned)

**Milestone Goal:** Consolidate all DJ data into a single Supabase `djs` table, eliminate all hardcoded DJ arrays, and deliver a fully functional Manage DJs admin tab — making DJ configuration database-driven with no code deploys required for routine changes.

- [x] **Phase 7: Database Schema & Migration** — Create `djs` table and migrate all DJ data from legacy tables (completed 2026-03-19)
- [x] **Phase 8: Backend Server Cutover** — Switch all server code to read from `djs`, persist lockout to DB, remove hardcoded constants (completed 2026-03-19)
- [x] **Phase 9: Admin DJ Management API** — New admin CRUD endpoints for DJ lifecycle management (completed 2026-03-19)
- [ ] **Phase 10: Manage DJs Frontend** — Manage DJs tab in roster.html with full editor UI

## Phase Details

### Phase 7: Database Schema & Migration
**Goal**: A complete, populated `djs` table exists in Supabase — all DJ data migrated from legacy tables, JSONB fields seeded from code constants, old tables dropped after verification
**Depends on**: Nothing (first v2.0 phase)
**Requirements**: DB-01, DB-02, DB-03, DB-04
**Success Criteria** (what must be TRUE):
  1. `SELECT COUNT(*) FROM djs` returns the expected number of DJs with no duplicates
  2. Every DJ can log in with their existing PIN after migration
  3. Availability reads for each DJ return the same results as before migration
  4. `djs.recurring_availability` JSONB contains the same data as the former FIXED_AVAILABILITY constant
  5. `djs.fixed_schedules` JSONB contains the same data as the former FIXED_SCHEDULES constant
  6. Old tables (dj_rates, dj_pins) are dropped only after criteria 1-5 are manually verified — this is a separate, manually-triggered step, not part of the migration script
**Plans:** 2/2 plans complete
Plans:
- [x] 07-01-PLAN.md — Create djs table schema SQL and data migration script
- [x] 07-02-PLAN.md — Drop legacy tables script and human verification checkpoint

### Phase 8: Backend Server Cutover
**Goal**: All server routes read DJ data exclusively from the `djs` table — no hardcoded DJ arrays remain in server.js or business-logic.js, account lockout survives server restarts, all Supabase calls have error handling
**Depends on**: Phase 7
**Requirements**: SCHED-01, SCHED-03, SCHED-05, STAB-01, STAB-02, STAB-03
**Success Criteria** (what must be TRUE):
  1. DJ login and availability reads work correctly after removing FIXED_AVAILABILITY and FIXED_SCHEDULES constants from code
  2. A DJ that fails login 5 times is still locked out after a server restart (lockout persisted to DB)
  3. Clearing a lockout via the existing admin endpoint takes effect immediately with no restart required
  4. Every Supabase call in server.js returns a graceful error response on failure — no unhandled promise rejections crash the server
  5. No hardcoded DJ name arrays remain anywhere in server.js or lib/business-logic.js; grep for FIXED_AVAILABILITY, FIXED_SCHEDULES, RESIDENTS returns no hits
**Plans:** 2/2 plans complete
Plans:
- [x] 08-01-PLAN.md — Switch fetchDJs to djs table, convert auth and lockout to DB-backed (completed 2026-03-19)
- [x] 08-02-PLAN.md — Migrate remaining endpoints, remove dead constants, try-catch sweep (completed 2026-03-19)

### Phase 9: Admin DJ Management API
**Goal**: Admin CRUD endpoints exist for the full DJ lifecycle — add, edit, deactivate, reactivate, reset PIN, clear lockout — all gated behind requireAdmin middleware with cache invalidation on every write
**Depends on**: Phase 7
**Requirements**: ADMIN-02, ADMIN-03, ADMIN-04, ADMIN-05, ADMIN-06, ADMIN-07, ADMIN-08
**Success Criteria** (what must be TRUE):
  1. Admin can add a new DJ via API and that DJ can immediately log in with the assigned PIN
  2. Admin can deactivate a DJ and that DJ is immediately rejected at login and absent from all dropdowns (within cache TTL)
  3. Admin can reset a DJ's PIN via API by supplying the new PIN; the old PIN stops working and the new one works immediately
  4. Admin can clear a locked-out DJ's lockout via API; the DJ can log in again immediately
  5. Rate editing via the DJ Hours tab endpoint returns an error or is removed; rate changes only succeed through the Manage DJs API
**Plans:** 2/2 plans complete
Plans:
- [ ] 09-01-PLAN.md — Create admin DJ handler factory module (lib/admin-dj.js) with unit tests
- [ ] 09-02-PLAN.md — Wire handlers into server.js routes, disable legacy /api/djs/update

### Phase 10: Manage DJs Frontend
**Goal**: The Manage DJs tab in roster.html is fully functional — admins can view all DJs, add/edit/deactivate/reactivate, edit recurring availability and fixed schedules, reset PINs, and clear lockouts, all without touching code or the database directly
**Depends on**: Phase 9
**Requirements**: ADMIN-01, SCHED-02, SCHED-04
**Success Criteria** (what must be TRUE):
  1. Admin can view all DJs in a table showing name, rate, type, active status, and lockout status
  2. Admin can add a new DJ by filling out a form (name, rate, type, PIN) and see the DJ appear in the list immediately
  3. Admin can edit a DJ's recurring availability via a day-of-week checkbox grid and see the change reflected in DJ availability responses
  4. Admin can edit a DJ's fixed schedule via a venue + day + slot grid and see Davoted's pre-populated slots updated accordingly
**Plans:** 1/3 plans executed
Plans:
- [ ] 10-01-PLAN.md — TDD: JSONB schedule handlers + routes (updateRecurringAvailability, updateFixedSchedules)
- [ ] 10-02-PLAN.md — Manage DJs tab with DJ table, Add/Edit/Deactivate/PIN/Lockout UI
- [ ] 10-03-PLAN.md — Recurring availability grid + fixed schedule grid modals + human verification

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Auto-Suggest | v1.0 | 3/3 | Complete | 2026-03-18 |
| 2. Data Integrity | v1.0 | 3/3 | Complete | 2026-03-17 |
| 3. Security | v1.0 | 2/2 | Complete | 2026-03-18 |
| 4. Stability | v1.0 | 2/2 | Complete | 2026-03-18 |
| 5. Cleanup | v1.0 | 2/2 | Complete | 2026-03-18 |
| 6. Tech Debt | v1.0 | 1/1 | Complete | 2026-03-19 |
| 7. Database Schema & Migration | v2.0 | 2/2 | Complete | 2026-03-19 |
| 8. Backend Server Cutover | v2.0 | 2/2 | Complete | 2026-03-19 |
| 9. Admin DJ Management API | 2/2 | Complete    | 2026-03-19 | - |
| 10. Manage DJs Frontend | 1/3 | In Progress|  | - |
