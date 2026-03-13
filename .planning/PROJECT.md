# DJ Roster — ARKbar Beach Club

## What This Is

A DJ scheduling and roster management app for ARKbar Beach Club (Koh Samui, Thailand). Manages DJ availability, roster assignments, attendance sign-offs, and accounting across 3 venues (ARKbar, HIP Restaurant, Love Beach Club) using a Node.js/Express backend with Supabase as the database.

## Core Value

Reliable DJ scheduling across 3 venues — admins can build rosters from DJ availability, managers can sign off attendance, and DJs can view/manage their schedules.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Inferred from existing codebase. -->

- ✓ DJ login via name + 4-digit PIN — v0
- ✓ DJ availability submission per month (available/unavailable per slot) — v0
- ✓ Admin roster grid with drag/assign per venue per month — v0
- ✓ Auto-suggest algorithm for roster population — v0 (currently broken)
- ✓ Fixed recurring schedules for specific DJs (Davoted) — v0
- ✓ Manager sign-off/unsign-off for DJ attendance — v0
- ✓ Month finalization with hours/cost accounting report — v0
- ✓ Multi-venue support (ARKbar, HIP, Love Beach Club) — v0
- ✓ Admin DJ management (add/edit name, rates) — v0
- ✓ Rate limiting on login endpoints — v0
- ✓ In-memory caching with TTL for performance — v0
- ✓ CORS whitelisting for production origins — v0
- ✓ Supabase migration (complete and live) — v0

### Active

<!-- Current scope: v1.0 Production Readiness -->

- [ ] Fix auto-suggest: DJs assigned to slots they marked unavailable (immediate blocker)
- [ ] Verify data integrity: availability saves, sign-off flow, accounting calculations
- [ ] Security hardening: PIN hashing, password hashing, webhook signature verification
- [ ] Stability: Supabase error handling, rate limiter memory leak, cache invalidation gaps
- [ ] Cleanup: remove reset-month feature, add test coverage on business logic

### Out of Scope

- Database migration — Supabase is already live, migration is complete
- New features or feature changes — this milestone is quality/fix only
- OAuth/SSO integration — current PIN/password auth is sufficient for this venue
- CI/CD pipeline setup — out of scope for this pass
- Mobile native app — web-only, responsive is sufficient
- UI polish / mobile responsiveness — not in scope for this milestone

## Context

- Single-file architecture: all server logic in `server.js` (~942 lines, ~11 API endpoints)
- Static HTML pages with embedded JavaScript in `public/` (dj.html, roster.html, landing.html)
- Supabase as database (tables: dj_rates, dj_availability, dj_submissions, roster_assignments, dj_pins, dj_signoffs, finalized_months)
- Custom rate limiter and security headers (helmet/express-rate-limit installed but not used)
- PINs stored in plain text, passwords compared with string equality
- No test framework or test files exist
- Auto-suggest is broken: DJs get assigned to slots they marked unavailable — root cause not confirmed
- Concerns identified: memory leak in rate limiter, race conditions in batch ops, cache invalidation gaps, sensitive data in logs

## Constraints

- **Database**: Supabase is live — no changes to database structure
- **Features**: No functional changes — only fixes and quality improvements
- **Deployment**: App runs as `node server.js` on port 8080 — keep this simple
- **Users**: DJs (mobile-first), admins/managers (desktop or mobile) — all in Thailand timezone
- **Priority**: Auto-suggest bug must be investigated and fixed before any other work

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Investigate auto-suggest before planning | Bug is an immediate blocker — root cause unknown, can't plan fix without understanding it | — Pending |
| Remove reset-month feature | Too dangerous for production — deletes all data without safeguards | — Pending |
| Use bcrypt for PIN hashing | Industry standard, already available in Node.js ecosystem | — Pending |

## Current Milestone: v1.0 Production Readiness

**Goal:** Fix the broken auto-suggest, verify data integrity, harden security, improve stability, and clean up before go-live — without changing any features.

**Target phases (priority order):**
1. Investigate and fix auto-suggest (unavailability not respected)
2. Verify data integrity (availability saves, sign-off flow, accounting)
3. Security hardening (PIN hashing, password hashing, webhook verification)
4. Stability (Supabase error handling, rate limiter leak, cache gaps)
5. Cleanup (remove reset-month, add test coverage on business logic)

---
*Last updated: 2026-03-13 after v1.0 milestone initialization*
