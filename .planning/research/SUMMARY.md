# Project Research Summary

**Project:** DJ Roster App — v2.0 DJ Management & Supabase Consolidation
**Domain:** Internal admin tool — DJ lifecycle management, database consolidation, hardcoded-to-dynamic migration
**Researched:** 2026-03-19
**Confidence:** HIGH

## Executive Summary

The v2.0 milestone consolidates a split data model (dj_rates + dj_pins + multiple hardcoded constants) into a single `djs` table, and adds an admin "Manage DJs" tab that gives the ops team full control over DJ records without code deploys. The app is already in production with a working Node.js/Express + Supabase stack — no new dependencies are needed. Every new feature can be built with packages already installed (`@supabase/supabase-js` 2.99.1, `bcrypt`, Node.js built-in `crypto`). The correct approach is a clean cutover: migrate data fully into `djs`, swap all server code to read from the new table, then drop the old tables. No dual-write period.

The highest-risk element of this milestone is the data migration, not the feature code. Known duplicate DJ name rows in `dj_rates` (en-dash vs hyphen variants) must be deduplicated before INSERT into `djs`, which has a UNIQUE constraint on `name`. Additionally, `FIXED_SCHEDULES` and `FIXED_AVAILABILITY` are consumed in five or more locations across two files — missing any one of those call sites during cutover causes silent data loss (the DJ portal shows no pre-populated slots, but no error is raised). These risks are fully known and have clear prevention strategies: run a deduplication audit before migration, and grep for every constant reference before removing them.

The feature set for v2.0 is well-scoped and internally consistent. All major features depend on the `djs` table being created first, making Phase 1 (schema + data migration) the critical-path blocker. The build order is: (1) database schema and migration, (2) backend server cutover, (3) frontend Manage DJs tab, (4) secondary security hardening (webhook verification). This order eliminates the risk of deploying UI before the DB is ready and ensures each phase is independently testable.

---

## Key Findings

### Recommended Stack

The existing stack handles all v2.0 requirements with zero new packages. This is a meaningful constraint: it means lower maintenance overhead, no version conflict risk, and no new APIs to learn mid-build.

**Core technologies:**
- `@supabase/supabase-js` 2.99.1 — all CRUD, upsert, and JSONB operations for the `djs` table and lockout persistence; already installed
- `bcrypt` ^6.0.0 — PIN hashing for new DJs and PIN resets; unchanged from v1
- Node.js built-in `crypto` — HMAC-SHA256 webhook signature verification via `createHmac` + `timingSafeEqual`; zero dependency overhead
- Plain `.sql` + Node.js migration scripts — established project pattern (see `scripts/migrate-availability-timestamps.sql` and `scripts/hash-existing-pins.js`)

**Critical pattern notes:**
- Webhook routes must use `express.raw({ type: 'application/json' })` not `express.json()` — the raw body bytes are required for HMAC computation
- PIN hashes must never enter the `fetchDJs()` cache — use a targeted single-row query in the auth path
- `JSON.stringify()` must NOT be called before Supabase upsert of JSONB fields — pass the raw JS object

### Expected Features

**Must have (table stakes — v2.0 required):**
- Consolidated `djs` table with full schema: id, name, pin_hash, rate, type, active, venues, recurring_availability (JSONB), fixed_schedules (JSONB), failed_attempts, locked_until
- Data migration from dj_rates + dj_pins into `djs`, including seeding FIXED_AVAILABILITY and FIXED_SCHEDULES as JSONB
- Manage DJs tab in roster.html: add DJ, edit name/rate/type, reset PIN, deactivate/reactivate, clear lockout
- Recurring availability editor (day-of-week checkbox grid) in admin tab
- Fixed schedules editor (venue + day-of-week + slot checkboxes) in admin tab
- Account lockout persisted to `djs` columns (replaces in-memory Map)
- All hardcoded arrays removed: FIXED_AVAILABILITY, FIXED_SCHEDULES, RESIDENTS
- Rate editing removed from DJ Hours tab (consolidated into Manage DJs tab)
- Try-catch coverage sweep for all Supabase calls

**Should have (after core is stable — v2.x):**
- Webhook signature verification (SEC-04 backlog item) — independent of `djs` table, lower urgency
- Lockout status badge visible inline in DJ list

**Defer (v3+):**
- Full audit log for admin DJ changes
- DJ bulk import (CSV)
- Per-venue rate overrides per DJ
- `DIAG_FIXED_TEMPLATE` moved to DB (complex weekly schedule template for auto-suggest — high breakage risk, defer explicitly)
- `HIP_ROTATION`, `LOVE_DJS`, `RESIDENTS_80HR` moved to DB

### Architecture Approach

The architecture stays flat: single Express server, direct Supabase client calls, vanilla JS frontend. The `djs` table becomes the single source of truth for all DJ configuration — replacing two tables and three major hardcoded constants. The existing `fetchDJs()` cache (10-minute TTL) is enriched to include `recurring_availability` and `fixed_schedule`, making those fields available to downstream functions without extra queries. The `buildAvailabilityMap()` function in `lib/business-logic.js` does not change signature — only the data source passed to it changes from a hardcoded constant to a DB-loaded value.

**Major components and their v2.0 changes:**

1. **`djs` table (NEW)** — single source of truth for DJ identity, auth credentials, scheduling config, and lockout state; replaces `dj_rates`, `dj_pins`, in-memory lockout Map, and hardcoded constants
2. **`fetchDJs()` (MODIFIED)** — enriched to return type, active, recurring_availability, fixed_schedules; cached result feeds all downstream endpoints including availability computation and config API
3. **`requireDJAuth()` + lockout functions (MODIFIED)** — reads PIN hash from `djs` directly (not via cache); lockout check/record/clear converted from synchronous Map operations to async Supabase UPDATE calls
4. **Admin DJ management endpoints (NEW)** — GET/POST/PATCH on `/api/admin/djs`, plus `/api/admin/djs/:id/pin` and `/api/admin/djs/:id/lockout`; all behind `requireAdmin` middleware
5. **Manage DJs tab in roster.html (NEW)** — vanilla JS tab, consistent with existing 1,982-line single-page admin UI; no framework
6. **`lib/business-logic.js` (MODIFIED)** — FIXED_SCHEDULES, FIXED_AVAILABILITY, RESIDENTS constants removed after all callers migrated

### Critical Pitfalls

1. **En-dash/hyphen duplicate DJ names survive migration into `djs`** — Run `SELECT name, COUNT(*) FROM dj_rates GROUP BY name HAVING COUNT(*) > 1` before migration; normalize names via `lower(trim(name))` in migration script; `UNIQUE` constraint on `djs.name` catches any that slip through. This is Phase 1 critical path.

2. **FIXED_SCHEDULES / FIXED_AVAILABILITY removed before all 5+ call sites are migrated** — Grep every reference (`FIXED_SCHEDULES`, `FIXED_AVAILABILITY`, `fixedSchedules`, `fixedSched`) before deleting constants; keep constants in place until all callers are confirmed migrated and tests pass. Davoted's DJ portal silently shows no pre-populated slots if even one call site is missed.

3. **Lockout Map and DB used simultaneously (split-brain)** — Replace all three lockout functions (`checkLockout`, `recordFailedAttempt`, `clearFailedAttempts`) in a single commit; update `/api/admin/clear-lockout` in the same commit; never ship a partial lockout migration.

4. **Supabase upsert silently discards fields if column does not exist** — Create the complete `djs` schema (all columns) before writing any application code; use `returning: 'representation'` on upsert calls to verify saved state.

5. **Cache invalidation not called from new admin endpoints** — Centralize all `djs` table writes behind a `saveDJ()` helper that always calls `invalidateCaches('djs')`; a deactivated DJ continues appearing in dropdowns for up to 10 minutes if this is missed.

6. **`checkLockout()` converted to async but not awaited at call sites** — All three callers (`requireDJAuth`, `/api/dj/login`, `/api/admin/clear-lockout`) must add `await`; a missing await makes the lockout check return a truthy Promise and all accounts appear unlocked.

7. **Deactivated DJ can still authenticate if `active` filter is omitted from auth query** — The `requireDJAuth` PIN lookup on `djs` must include `AND active = true`; test by deactivating a DJ and confirming login is rejected.

---

## Implications for Roadmap

The dependency graph is clear and constraining. Everything except webhook verification and the Supabase error handling sweep depends on the `djs` table existing. The safe build order maps directly to three primary phases plus one secondary phase.

### Phase 1: Database Schema and Data Migration

**Rationale:** Every other feature reads from `djs`. The schema must be finalized and populated before any application code can be written against it. Running the migration first also surfaces the en-dash deduplication problem in isolation, where it is cheapest to fix.

**Delivers:** A complete `djs` table with all DJs migrated from `dj_rates` + `dj_pins`, FIXED_AVAILABILITY seeded into `recurring_availability` JSONB, FIXED_SCHEDULES seeded into `fixed_schedules` JSONB, RESIDENTS flagged via `type = 'resident'`. Old tables kept as backup.

**Addresses (from FEATURES.md):** Consolidated `djs` table; lockout columns added to schema.

**Avoids:** Pitfall 1 (duplicate names), Pitfall 4 (upsert discards fields if column missing), Pitfall 2 (name spelling breaks availability lookups if migration renames DJs).

**Verification gate before proceeding:** Every DJ can log in with their existing PIN. Availability reads for each DJ return expected results. `SELECT COUNT(*) FROM djs` matches expected DJ count.

### Phase 2: Backend Server Cutover

**Rationale:** With `djs` populated, server code can be migrated endpoint-by-endpoint in dependency order. Each step is independently testable. UI changes are blocked until this phase is complete.

**Delivers:** All server routes read from `djs` instead of `dj_rates`/`dj_pins`/hardcoded constants. Lockout is persisted to DB. New admin DJ management endpoints are live. FIXED_SCHEDULES, FIXED_AVAILABILITY, RESIDENTS constants are removed from `lib/business-logic.js`. Old tables dropped.

**Build order within this phase (strictly sequential):**
1. `fetchDJs()` — switch to `djs WHERE active = true`, enrich shape with type, recurring_availability, fixed_schedules
2. `requireDJAuth()` + `/api/dj/login` — switch PIN lookup to `djs`, replace `RESIDENTS.includes()` with `type === 'resident'`
3. Lockout persistence — convert all three lockout functions to async DB calls; update admin clear-lockout in same commit
4. `fetchAvailability()` — pull fixed_schedule from `fetchDJs()` cache, pass to `buildAvailabilityMap()`
5. `/api/dj/availability/:name/:month` and `/api/dj/schedule/:name/:month` — targeted single-row query for recurring_availability and fixed_schedule
6. `/api/config` and `/api/fixed-schedules` — derive from `djs` table instead of constants
7. Remove dead constants from `lib/business-logic.js` (LAST step — only after all callers confirmed migrated)
8. New admin DJ management endpoints: GET/POST/PATCH `/api/admin/djs`, `/api/admin/djs/:id/pin`, `/api/admin/djs/:id/lockout`
9. Supabase try-catch sweep across all bare `supabase.from(...)` calls

**Addresses (from FEATURES.md):** Server reads from `djs`, hardcoded arrays removed, account lockout persisted, try-catch coverage, admin CRUD API, rate editing removed from DJ Hours tab (deprecated endpoint).

**Avoids:** Pitfall 3 (missed consumer call sites), Pitfall 5 (lockout split-brain), Pitfall 6 (async lockout not awaited), Pitfall 7 (cache invalidation gaps).

**Uses (from STACK.md):** `@supabase/supabase-js` upsert with `onConflict`, targeted single-row queries without PIN hash in DJ cache, `invalidateCaches('djs')` on all write paths.

### Phase 3: Frontend — Manage DJs Tab

**Rationale:** The new admin endpoints from Phase 2 make this buildable. Frontend changes are last because they depend on a stable API contract.

**Delivers:** Manage DJs tab in roster.html with DJ list table, add DJ form, per-DJ edit (name/rate/type), recurring availability checkbox grid, fixed schedules grid (venue + day-of-week + slot), PIN reset (shows generated PIN once in modal), deactivate/reactivate toggle, lockout status badge and clear button. Rate editing removed from DJ Hours tab.

**Addresses (from FEATURES.md):** Add DJ, edit DJ, reset PIN, deactivate/reactivate, recurring availability editor, fixed schedules editor, clear lockout visible in admin UI, rate editing removed from DJ Hours tab.

**Avoids:** UX pitfalls — disable save button on click to prevent double submission; show PIN reset result in a modal with Copy button; deactivated DJ remains in historical hours data.

**Implements (from ARCHITECTURE.md):** Manage DJs tab using vanilla JS fetch + innerHTML, consistent with existing roster.html pattern. No framework introduced.

### Phase 4: Security Hardening (Secondary)

**Rationale:** Webhook signature verification is independent of the `djs` table and can be done any time. It is lower urgency (no inbound webhooks are currently active), but it is a documented SEC-04 backlog item and low-effort given the established HMAC pattern.

**Delivers:** `/api/webhooks/inbound` endpoint with HMAC-SHA256 signature verification using `express.raw()` for raw body capture and `crypto.timingSafeEqual()` for timing-safe comparison. `WEBHOOK_SECRET` stored in env var.

**Addresses (from FEATURES.md):** Webhook signature verification (v2.x scope).

**Avoids:** Webhook security pitfall — never use `express.json()` on webhook routes; always verify before processing body.

### Phase Ordering Rationale

- Phase 1 before Phase 2: Server code cannot safely read from `djs` until data is migrated and verified. Deploying server changes against an empty table would break all DJ logins.
- Phase 2 before Phase 3: The Manage DJs frontend requires the admin CRUD API endpoints from Phase 2. Building the UI first would require mocking the API, adding rework.
- Dead code removal last within Phase 2: Constants cannot be deleted until all their call sites are migrated. Removing them early causes runtime errors.
- Phase 4 independent: Webhook verification does not interact with any other phase's work. It can be done in parallel with Phase 3 or after.

### Research Flags

Phases with standard, well-documented patterns (skip additional research-phase):
- **Phase 4 (webhook verification):** HMAC-SHA256 with `crypto.timingSafeEqual` is a canonical Node.js pattern; implementation is fully specified in STACK.md.
- **Phase 3 (Manage DJs tab UI):** Vanilla JS fetch + innerHTML is the established roster.html pattern; no architectural decisions needed.

Phases that may warrant extra care during task planning:
- **Phase 1 (migration):** The en-dash deduplication audit is exploratory — run the audit query first to understand the actual extent of the problem before writing the migration script. Scope may widen if more variants exist than currently documented.
- **Phase 2, Step 9 (try-catch sweep):** The full count of bare `supabase.from()` calls without try-catch is not quantified. A grep sweep before writing tasks will scope this accurately.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All findings verified against installed package-lock.json and Node.js official docs. Zero ambiguity — no new dependencies, all patterns already in production. |
| Features | HIGH | Based on direct codebase analysis of server.js, business-logic.js, and roster.html. Feature list derived from actual code, not inference. |
| Architecture | HIGH | All integration points identified by line number in source files. Build order derived from actual import and call dependencies, not assumptions. |
| Pitfalls | HIGH | All pitfalls are directly evidenced from codebase inspection. No speculative risks — each pitfall has a documented warning sign and recovery strategy. |

**Overall confidence: HIGH**

### Gaps to Address

- **`roster.html` hardcoded DJ arrays:** The exact count of places in roster.html that hardcode DJ names (auto-suggest arrays, display logic) is marked as "unknown count" in ARCHITECTURE.md. Run `grep` for DJ name string literals in roster.html before estimating Phase 3 scope. This could widen Phase 3 slightly.

- **`DIAG_FIXED_TEMPLATE` scope boundary:** This large inline template in `lib/business-logic.js` is explicitly deferred to v3+. During Phase 2 development, add a `// TODO v3: move DIAG_FIXED_TEMPLATE to DB` comment so the deferred scope is visible in code, not just in planning documents.

- **Frontend constants scope decision:** `RESIDENTS_80HR`, `HIP_ROTATION`, `LOVE_DJS`, and `TARGETS` in roster.html (lines 610–651) are hardcoded and not addressed by v2.0. Explicitly declare these out-of-scope during Phase 3 task planning, or they may attract scope creep. Add `// v2 hardcoded — not yet in DB` comments during Phase 3.

- **`dj_availability` / `dj_signoffs` name spelling:** If any DJ names in `dj_availability` use the en-dash variant, they will silently return zero rows after migration normalizes the canonical spelling. The Phase 1 migration script should include a cross-table audit: for each migrated DJ name, confirm at least one matching row exists in `dj_availability`.

---

## Sources

### Primary (HIGH confidence)
- `/c/Users/gusno/dj-roster/server.js` — 1,250 LOC inspected directly; all integration points identified by line number
- `/c/Users/gusno/dj-roster/lib/business-logic.js` — 314 LOC inspected directly; all constant definitions and callers identified
- `/c/Users/gusno/dj-roster/public/roster.html` — hardcoded constants identified (lines 605–651)
- `/c/Users/gusno/dj-roster/package-lock.json` — `@supabase/supabase-js` 2.99.1 confirmed installed
- `/c/Users/gusno/dj-roster/scripts/hash-existing-pins.js` — established Node.js migration pattern confirmed
- `/c/Users/gusno/dj-roster/scripts/migrate-availability-timestamps.sql` — established SQL migration pattern confirmed
- `/c/Users/gusno/dj-roster/.planning/PROJECT.md` — v2.0 milestone goals, key decisions, known issues

### Secondary (MEDIUM confidence)
- Node.js v25.8.1 official docs (`nodejs.org/api/crypto.html`) — `createHmac`, `timingSafeEqual` API confirmed
- Supabase JS client documented behavior — JSONB serialization, `.single()` vs `.maybeSingle()`, `onConflict` upsert

---
*Research completed: 2026-03-19*
*Ready for roadmap: yes*
