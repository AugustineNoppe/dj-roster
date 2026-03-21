# DJ Roster — ARKbar Beach Club

## What This Is

A DJ scheduling and roster management app for ARKbar Beach Club (Koh Samui, Thailand). Manages DJ availability, roster assignments, attendance sign-offs, and accounting across 3 venues (ARKbar, HIP Restaurant, Love Beach Club) using a Node.js/Express backend with Supabase as the database. All DJ configuration is database-driven — admins manage DJs, rates, availability, and schedules through a web UI with no code deploys required.

## Core Value

Reliable DJ scheduling across 3 venues — admins can build rosters from DJ availability, managers can sign off attendance, and DJs can view/manage their schedules.

## Requirements

### Validated

- ✓ DJ login via name + 4-digit PIN (bcrypt hashed, account lockout) — v1.0
- ✓ DJ availability submission per month (slot-normalized, upsert-safe) — v1.0
- ✓ Admin roster grid with drag/assign per venue per month — v0
- ✓ Auto-suggest with block enforcement (.every() checks) and decision logging — v1.0
- ✓ Fixed recurring schedules for specific DJs (Davoted) — v0
- ✓ Manager sign-off/unsign-off with timestamp ordering — v1.0
- ✓ Month finalization with verified hours/cost accounting — v1.0
- ✓ Multi-venue support (ARKbar, HIP, Love Beach Club) — v0
- ✓ Admin DJ management (add/edit name, rates) — v0
- ✓ Rate limiting via express-rate-limit (memory-safe) — v1.0
- ✓ In-memory caching with centralized invalidation — v1.0
- ✓ Security headers via helmet — v1.0
- ✓ 49 Jest tests covering business logic — v1.0
- ✓ Supabase migration (complete and live) — v0
- ✓ Single `djs` table consolidating dj_rates + dj_pins with JSONB for recurring availability and fixed schedules — v2.0
- ✓ Manage DJs admin tab (add/edit/deactivate/reactivate, rates, recurring availability grid, fixed schedule grid, PIN reset, lockout clear) — v2.0
- ✓ All hardcoded DJ arrays removed from server.js and roster.html — dynamic from Supabase — v2.0
- ✓ Recurring availability (FIXED_AVAILABILITY) moved to Supabase, editable per DJ via admin UI — v2.0
- ✓ Fixed schedules (FIXED_SCHEDULES) moved to Supabase, editable per DJ via admin UI — v2.0
- ✓ Rate editing consolidated into Manage DJs tab (removed from DJ Hours tab) — v2.0
- ✓ Account lockout persisted to Supabase djs table — survives restarts, clearable from admin UI — v2.0
- ✓ Try-catch all Supabase calls with graceful error handling — v2.0
- ✓ 111 tests (62 new in v2.0) covering admin DJ handlers, lockout, and schedule JSONB operations — v2.0

### Active

(None — planning next milestone)

### Out of Scope

- Mobile native app — web-only, responsive is sufficient
- OAuth/SSO integration — PIN/password auth sufficient for venue
- CI/CD pipeline — out of scope for now
- UI polish / mobile responsiveness — not prioritized
- Webhook signature verification (SEC-04) — no active inbound webhooks currently
- HIP_ROTATION, LOVE_DJS, RESIDENTS_80HR to DB — frontend-only constants, defer to v3+
- DIAG_FIXED_TEMPLATE to DB — high breakage risk for auto-suggest, defer to v3+
- Audit log for admin DJ changes — v3+ feature
- DJ bulk import (CSV) — v3+ feature
- Per-venue rate overrides — v3+ feature

## Context

Shipped v2.0 DJ Management & Supabase Consolidation (2026-03-21).
- server.js: ~1,400 LOC (Node.js/Express)
- public/roster.html: ~4,900 LOC (admin roster UI with Manage DJs tab)
- lib/business-logic.js: 314 LOC (extracted, tested)
- lib/lockout.js: factory for DB-backed lockout functions
- lib/admin-dj.js: factory for admin CRUD handlers (add/edit/deactivate/reactivate/PIN/lockout/schedules)
- Tests: 111 passing (business-logic, lockout, admin-dj, schedule JSONB)
- Supabase tables: djs, dj_availability, dj_submissions, roster_assignments, dj_signoffs, finalized_months
- Legacy tables (dj_rates, dj_pins) dropped after verified migration
- PINs and passwords stored as bcrypt hashes
- helmet + express-rate-limit active
- En-dash/hyphen duplicate DJ names resolved during migration
- Deactivated DJs: hidden from all UI/auto-suggest/login, historical data preserved, reactivatable

## Constraints

- **Database**: Supabase — single `djs` table is authoritative for all DJ data
- **Deployment**: App runs as `node server.js` on port 8080
- **Users**: DJs (mobile-first), admins/managers (desktop or mobile) — Thailand timezone

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Investigate auto-suggest before planning | Bug was immediate blocker — root cause unknown | ✓ Good — root cause found (slot-by-slot iteration), fix applied |
| Remove reset-month feature | Too dangerous for production — deletes all data | ✓ Good — endpoint and UI references removed |
| Use bcrypt for PIN hashing | Industry standard, native bindings fast | ✓ Good — cost factor 10, migration script idempotent |
| bcrypt hashes in env vars for admin/manager passwords | Avoids plaintext secrets in environment | ✓ Good — timing-safe comparison |
| helmet() with explicit CSP directives | Match prior custom headers, preserve unsafe-inline | ✓ Good — express-rate-limit fixed memory leak |
| Centralize cache invalidation | Document dependency graph in one place | ✓ Good — DJ rate changes cascade correctly |
| Extract business logic to lib/ | Enable Jest testing without Express overhead | ✓ Good — 49→111 tests, template drift risk eliminated |
| DJ change-pin route intentionally removed | PINs are admin-allocated only | ✓ Good — simpler security model |
| Consolidate dj_rates + dj_pins into single `djs` table | Single source of truth, JSONB for flexible schedule data | ✓ Good — clean migration, legacy tables dropped |
| Factory pattern for lockout.js and admin-dj.js | Injected deps enable unit testing with mocked Supabase | ✓ Good — 62 new tests, no Express overhead |
| Lockout persisted to djs table (not separate table) | Fewer tables, lockout is a DJ attribute | ✓ Good — survives restarts, admin-clearable |
| 410 Gone for deprecated /api/djs/update | Signal permanent removal, drive Manage DJs tab adoption | ✓ Good — clean break from legacy rate editing |
| JSONB for recurring_availability and fixed_schedules | Flexible schema, no extra tables, Supabase handles natively | ✓ Good — admin UI edits JSONB directly |
| Phase 11 for integration gap closure | Audit found INT-01/INT-02 after Phase 10 — dedicated cleanup phase | ✓ Good — both gaps closed, 111 tests still pass |

---
*Last updated: 2026-03-21 after v2.0 milestone completion*
