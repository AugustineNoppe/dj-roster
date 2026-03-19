# DJ Roster — ARKbar Beach Club

## What This Is

A DJ scheduling and roster management app for ARKbar Beach Club (Koh Samui, Thailand). Manages DJ availability, roster assignments, attendance sign-offs, and accounting across 3 venues (ARKbar, HIP Restaurant, Love Beach Club) using a Node.js/Express backend with Supabase as the database.

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

### Active

- [ ] Single `djs` table consolidating dj_rates + dj_pins (name, PIN hash, rate, type, active status, venues, recurring availability defaults, fixed schedule slots)
- [ ] Manage DJs admin tab — add DJ, edit rate, edit recurring availability, reset PIN, deactivate/reactivate
- [ ] Remove all hardcoded DJ arrays from server.js and roster.html — dynamic from Supabase
- [ ] Recurring availability (FIXED_AVAILABILITY) moved to Supabase, editable per DJ via admin UI
- [ ] Fixed schedules (FIXED_SCHEDULES) moved to Supabase, editable per DJ via admin UI
- [ ] Rate editing removed from DJ Hours tab, consolidated into Manage DJs tab
- [ ] Account lockout moved from in-memory Map to Supabase — persists across restarts, clearable from admin UI
- [ ] Webhook signature verification for inbound hooks (SEC-04)
- [ ] Try-catch all Supabase calls with graceful error handling (STAB-04)

### Out of Scope

- Mobile native app — web-only, responsive is sufficient
- OAuth/SSO integration — PIN/password auth sufficient for venue
- CI/CD pipeline — out of scope for now
- UI polish / mobile responsiveness — not prioritized

## Current Milestone: v2.0 DJ Management & Supabase Consolidation

**Goal:** Consolidate all DJ data into a single Supabase table, build an admin management UI, and eliminate hardcoded DJ arrays — making DJ configuration fully dynamic and database-driven.

**Target features:**
- Single `djs` table replacing dj_rates + dj_pins
- Manage DJs admin tab (add/edit/deactivate, rates, recurring availability, fixed schedules, PIN reset)
- Remove all hardcoded DJ arrays — dynamic from Supabase
- Recurring availability defaults and fixed schedules in Supabase
- Account lockout persisted to Supabase
- Webhook signature verification and Supabase error handling (secondary)

## Context

Shipped v1.0 Production Readiness (2026-03-19).
- server.js: 1,219 LOC (Node.js/Express)
- public/roster.html: 1,982 LOC (admin roster UI)
- lib/business-logic.js: 314 LOC (extracted, tested)
- lib/business-logic.test.js: 450 LOC (49 Jest tests)
- Supabase tables: dj_rates, dj_availability, dj_submissions, roster_assignments, dj_pins, dj_signoffs, finalized_months
- PINs and passwords stored as bcrypt hashes
- helmet + express-rate-limit active
- Known: existing duplicate DB rows (en-dash + hyphen variants) not cleaned up — may need one-time migration
- v2.0: dj_rates and dj_pins will be replaced by consolidated `djs` table — clean cutover, no dual-write
- Deactivated DJs: hidden from all UI/auto-suggest/login, historical data preserved, reactivatable

## Constraints

- **Database**: Supabase — new `djs` table replaces dj_rates + dj_pins (clean cutover with migration)
- **Deployment**: App runs as `node server.js` on port 8080
- **Users**: DJs (mobile-first), admins/managers (desktop or mobile) — Thailand timezone

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Investigate auto-suggest before planning | Bug was immediate blocker — root cause unknown | ✓ Good — root cause found (slot-by-slot iteration), fix applied |
| Remove reset-month feature | Too dangerous for production — deletes all data | ✓ Good — endpoint and UI references removed |
| Use bcrypt for PIN hashing | Industry standard, native bindings fast | ✓ Good — cost factor 10, migration script idempotent |
| bcrypt hashes in env vars for admin/manager passwords | Avoids plaintext secrets in environment | ✓ Good — timing-safe comparison |
| In-memory Map for account lockout | Consistent with existing patterns, zero DB overhead | ✓ Good — separate from IP rate limiting |
| helmet() with explicit CSP directives | Match prior custom headers, preserve unsafe-inline | ✓ Good — express-rate-limit fixed memory leak |
| Centralize cache invalidation | Document dependency graph in one place | ✓ Good — DJ rate changes cascade correctly |
| Extract business logic to lib/ | Enable Jest testing without Express overhead | ✓ Good — 49 tests, template drift risk eliminated |
| DJ change-pin route intentionally removed | PINs are admin-allocated only | ✓ Good — simpler security model |

---
*Last updated: 2026-03-19 after v2.0 milestone start*
