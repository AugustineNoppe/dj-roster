# Architecture Research

**Domain:** DJ Management & Supabase Consolidation (v2.0 milestone)
**Researched:** 2026-03-19
**Confidence:** HIGH — based on direct inspection of all production source files

---

## Existing System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Clients                                   │
│  ┌────────────┐  ┌─────────────┐  ┌────────────────────────┐    │
│  │  DJ Portal │  │ Admin Roster│  │    Landing Page        │    │
│  │  (dj.html) │  │(roster.html)│  │   (landing.html)       │    │
│  └─────┬──────┘  └──────┬──────┘  └────────────────────────┘    │
└────────┼────────────────┼─────────────────────────────────────-─┘
         │  REST / JSON   │
┌────────┼────────────────┼────────────────────────────────────────┐
│        ▼                ▼              server.js (Express)        │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  Middleware: helmet, rate-limit, CORS, JSON body parser  │     │
│  └─────────────────────────────────────────────────────────┘     │
│  ┌──────────────┐  ┌───────────────┐  ┌───────────────────┐      │
│  │ Auth Helpers │  │  Cache Layer  │  │  Lockout Tracker  │      │
│  │requireAdmin  │  │ djs/avail/    │  │  _loginAttempts   │      │
│  │requireDJAuth │  │ roster/final  │  │  (in-memory Map)  │      │
│  └──────────────┘  └───────────────┘  └───────────────────┘      │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │           Route Handlers (~30 endpoints)                 │     │
│  └─────────────────────────────────────────────────────────┘     │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │         lib/business-logic.js  (pure functions)          │     │
│  │  buildAvailabilityMap, computeFinalizationReport,        │     │
│  │  getDJTemplateBlocks, FIXED_SCHEDULES, DIAG_FIXED_TEMPLATE│    │
│  └─────────────────────────────────────────────────────────┘     │
└────────────────────────────────┬───────────────────────────────-─┘
                                 │  @supabase/supabase-js
┌────────────────────────────────▼───────────────────────────────-─┐
│                         Supabase (PostgreSQL)                     │
│  dj_rates   dj_pins   dj_availability   dj_submissions            │
│  roster_assignments   dj_signoffs   finalized_months              │
└──────────────────────────────────────────────────────────────────┘
```

---

## What v2.0 Changes

### The Core Migration: dj_rates + dj_pins → djs

**Current state (two tables, one read-only concern each):**

| Table | Columns | Used By |
|-------|---------|---------|
| `dj_rates` | name, rate | fetchDJs(), computeFinalizationReport(), diagnostic endpoint |
| `dj_pins` | name, pin (bcrypt hash) | requireDJAuth(), /api/dj/login |

**Target state (single `djs` table):**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid or serial | PK |
| name | text unique | display name, used as FK in all other tables |
| pin_hash | text | bcrypt hash, replaces dj_pins.pin |
| rate | integer | hourly rate, replaces dj_rates.rate |
| type | text | 'resident' / 'casual' / 'guest' |
| active | boolean | soft-delete; false hides from all UIs |
| venues | text[] or jsonb | which venues this DJ plays |
| recurring_availability | jsonb | replaces FIXED_AVAILABILITY[djName] — dow→slot[] map |
| fixed_schedule | jsonb | replaces FIXED_SCHEDULES[djName] — venue→dow→slot[] map |
| lockout_count | integer | replaces in-memory Map for account lockout |
| locked_until | timestamptz | replaces in-memory Map for account lockout |
| created_at | timestamptz | audit trail |

**Recommended Supabase schema migration (clean cutover, no dual-write):**

```sql
-- Step 1: Create djs table
CREATE TABLE djs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text UNIQUE NOT NULL,
  pin_hash      text NOT NULL,
  rate          integer NOT NULL DEFAULT 0,
  type          text NOT NULL DEFAULT 'casual',
  active        boolean NOT NULL DEFAULT true,
  venues        text[] DEFAULT '{}',
  recurring_availability jsonb DEFAULT '{}',
  fixed_schedule         jsonb DEFAULT '{}',
  lockout_count integer NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  created_at    timestamptz DEFAULT now()
);

-- Step 2: Populate from existing tables (run migration script)
INSERT INTO djs (name, pin_hash, rate)
SELECT r.name, p.pin, r.rate
FROM dj_rates r
JOIN dj_pins p ON lower(p.name) = lower(r.name);

-- Step 3: Populate recurring_availability and fixed_schedule
-- (done by a one-time Node.js migration script that reads the hardcoded
--  FIXED_AVAILABILITY and FIXED_SCHEDULES constants and writes to DB)

-- Step 4: Drop old tables (after verifying data integrity)
DROP TABLE dj_rates;
DROP TABLE dj_pins;
```

**Known data issue:** The existing data has duplicate rows with en-dash vs hyphen variants in dj_rates. The migration script must deduplicate (normalizeSlot pattern already exists for slot strings; same approach needed for name canonicalization before insert). Check `lower(trim(name))` as the deduplication key.

---

## Integration Points

### 1. fetchDJs() — reads dj_rates today

**Location:** server.js ~line 255
**Current:** queries `dj_rates`, returns `{ name, rate }`
**v2.0 change:** query `djs` where `active = true`, return `{ name, rate, type, venues, recurringAvailability, fixedSchedule }`

This function is called by:
- `GET /api/djs` (direct response)
- `POST /api/dj/login` (to look up rate and resident status after PIN match)
- `POST /api/roster/finalize` (builds djRateMap for accounting)

**Cache key `djs` invalidated by:** any DJ mutation (add, edit, deactivate, PIN reset). Already exists as `invalidateCaches('djs')`.

### 2. requireDJAuth() — reads dj_pins today

**Location:** server.js ~line 350
**Current:** queries `dj_pins` for pin hash, checks lockout from `_loginAttempts` Map
**v2.0 change:** query `djs` where `lower(name) = lower(input)` and `active = true`, read `pin_hash`, check `lockout_count` / `locked_until` columns

The lockout check/record/clear functions (`checkLockout`, `recordFailedAttempt`, `clearFailedAttempts`) become Supabase UPDATE calls instead of Map mutations. Since these hit the DB on every login attempt, they must be wrapped in try-catch with a graceful fallback (fail open or deny — fail open is safer for usability; deny is safer for security; current behavior is fail-locked since in-memory has no persistence).

### 3. /api/dj/login — reads dj_pins today

**Location:** server.js ~line 768
**Current:** queries `dj_pins`, then `fetchDJs()` for rate+resident
**v2.0 change:** single query to `djs` replaces both queries. `type = 'resident'` replaces RESIDENTS array check.

The hardcoded `RESIDENTS` constant in business-logic.js (`['Alex RedWhite', 'Raffo DJ', 'Sound Bogie']`) should be removed or replaced by `djs.type = 'resident'`. The constant is also used in `buildAvailabilityMap` and the config endpoint. See Section 5 below.

### 4. /api/dj/availability/:name/:month — reads FIXED_SCHEDULES and FIXED_AVAILABILITY

**Location:** server.js ~line 796
**Current:** reads hardcoded `FIXED_SCHEDULES[name]` and `FIXED_AVAILABILITY[name]` to compute calendar defaults
**v2.0 change:** load `recurring_availability` and `fixed_schedule` from `djs` table (already fetched in fetchDJs or via a targeted query). The logic for building `FIXED_PORTAL` (lines 806-820) stays the same — only the data source changes from constants to DB columns.

This endpoint does NOT go through `fetchDJs()` — it accesses FIXED_SCHEDULES and FIXED_AVAILABILITY directly. After migration, it needs either:
- A targeted single-row query: `SELECT recurring_availability, fixed_schedule FROM djs WHERE lower(name) = lower($1)`
- Or `fetchDJs()` enriched to include these fields, with the DJ's data looked up from the cache

Targeted single-row query is cleaner and avoids loading all DJs to get one DJ's schedule config.

### 5. /api/dj/schedule/:name/:month — reads FIXED_SCHEDULES

**Location:** server.js ~line 973
**Current:** `FIXED_SCHEDULES[name]` injects recurring bookings into the schedule display
**v2.0 change:** same targeted single-row query pattern as endpoint 4 above. Load `fixed_schedule` for this DJ from `djs` table.

### 6. fetchAvailability() — reads FIXED_SCHEDULES via buildAvailabilityMap()

**Location:** server.js ~line 270, and lib/business-logic.js ~line 110
**Current:** passes `fixedSchedules: FIXED_SCHEDULES` to `buildAvailabilityMap()`
**v2.0 change:** `fetchAvailability()` must first load all DJs' `fixed_schedule` from `djs` table, then construct the equivalent object shape to pass as `fixedSchedules`. Since `fetchDJs()` is cached (10 min TTL), this is effectively free once enriched.

`buildAvailabilityMap()` signature does NOT need to change — it already accepts `fixedSchedules` as a parameter. Just pass the DB-loaded version instead of the hardcoded constant.

### 7. /api/config — returns RESIDENTS

**Location:** server.js ~line 382
**Current:** returns hardcoded `RESIDENTS` array
**v2.0 change:** return `djs.filter(d => d.type === 'resident').map(d => d.name)` from the cached DJ list. This endpoint is used by roster.html to know which DJs are residents for display purposes.

### 8. /api/fixed-schedules — returns FIXED_SCHEDULES

**Location:** server.js ~line 386
**Current:** returns `FIXED_SCHEDULES` constant directly
**v2.0 change:** return a constructed equivalent object from `djs` table rows where `fixed_schedule` is non-empty. Roster.html and dj.html consume this for display. This endpoint should continue to exist at the same URL — only the data source changes.

### 9. /api/djs/update — writes to dj_rates today

**Location:** server.js ~line 1142
**Current:** upserts name+rate into `dj_rates`
**v2.0 change:** this endpoint's scope expands in v2.0. Rate editing moves to Manage DJs tab (this endpoint either gets replaced or augmented). The current behavior of name+rate update should be replicated against the `djs` table.

### 10. Account Lockout — in-memory Map today

**Location:** server.js ~line 77-105
**Current:** `_loginAttempts` Map, `checkLockout()`, `recordFailedAttempt()`, `clearFailedAttempts()`
**v2.0 change:** all three functions become `async` DB operations against `djs.lockout_count` and `djs.locked_until`. The `/api/admin/clear-lockout` endpoint calls `clearFailedAttempts()` — that call becomes a Supabase UPDATE.

**Critical consideration:** `requireDJAuth()` and `/api/dj/login` currently call lockout functions synchronously. Making them async is a non-breaking change (they're already in async functions), but adds a DB round-trip to every login attempt. Given the small user base, this is acceptable.

---

## New Components Required

### New API Endpoints (server.js additions)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/djs` | GET | List all DJs (active + inactive) for Manage DJs tab |
| `/api/admin/djs` | POST | Add new DJ (name, rate, type, PIN) |
| `/api/admin/djs/:id` | PATCH | Edit DJ (name, rate, type, venues, recurring_availability, fixed_schedule, active) |
| `/api/admin/djs/:id/pin` | POST | Reset DJ PIN (admin generates new 4-digit PIN, hashes it) |
| `/api/admin/djs/:id/lockout` | DELETE | Clear lockout for specific DJ |
| `/api/webhooks/inbound` | POST | Webhook receiver with HMAC signature verification |

All admin DJ endpoints use `requireAdmin` middleware.

### New UI: Manage DJs Tab in roster.html

This is a new tab within the existing `roster.html` single-page admin UI. It does NOT require a new HTML file.

**Tab contents:**
- DJ list table (name, type, rate, active status, actions)
- Add DJ form (name, rate, type, initial PIN)
- Per-DJ edit modal or inline form (all fields)
- Recurring availability editor (day-of-week grid, slot checkboxes)
- Fixed schedule editor (venue + day-of-week + slot checkboxes)
- PIN reset button (generates random 4-digit PIN, shows it once, admin communicates to DJ)
- Deactivate / Reactivate toggle

### Modified: lib/business-logic.js

The `FIXED_SCHEDULES` and `DIAG_FIXED_TEMPLATE` constants in business-logic.js are currently the source of truth for auto-suggest template logic. `DIAG_FIXED_TEMPLATE` is a separate comprehensive template (not the same as FIXED_SCHEDULES) — it defines ALL DJs' expected slots for the diagnostic endpoint and auto-suggest block-enforcement.

**Migration path for FIXED_SCHEDULES:**
- Remove from business-logic.js
- Load from `djs` table at runtime via `fetchDJs()`
- Pass as parameter (already supported by `buildAvailabilityMap(fixedSchedules)` signature)

**Migration path for DIAG_FIXED_TEMPLATE:**
- This is a complete weekly schedule template for ALL DJs across all venues, used for auto-suggest block enforcement and the diagnostic endpoint
- This is much more complex than FIXED_SCHEDULES — it encodes who plays what slot on what day at what venue
- v2.0 scope: move to DB (new `schedule_template` table or a config table) OR keep in code and make editable only via a future milestone
- Recommendation: defer DIAG_FIXED_TEMPLATE to a v3.0 milestone. It's a separate concern from DJ management and the risk of a bad edit breaking auto-suggest is high. For v2.0, only FIXED_SCHEDULES (per-DJ recurring bookings) and FIXED_AVAILABILITY (per-DJ default availability) move to DB.

**RESIDENTS constant:**
- Used in `buildAvailabilityMap` (not actually, it's imported but only used for the config endpoint)
- Used in `/api/config` response
- Used in `/api/dj/login` response (`isResident: RESIDENTS.includes(djName)`)
- v2.0: replace with `djs.type === 'resident'` check; remove RESIDENTS constant from business-logic.js after

---

## Data Flow Changes

### Current Login Flow

```
POST /api/dj/login
  → check _loginAttempts Map (sync)
  → query dj_pins (Supabase)
  → bcrypt.compare(pin, hash)
  → query dj_rates via fetchDJs() (Supabase, cached)
  → RESIDENTS.includes(djName) (sync)
  → response: { name, isResident, rate }
```

### v2.0 Login Flow

```
POST /api/dj/login
  → query djs WHERE lower(name)=lower(input) AND active=true (Supabase)
  → check locked_until column (DB-persisted)
  → bcrypt.compare(pin, pin_hash)
  → on fail: UPDATE djs SET lockout_count++, locked_until=... WHERE id=...
  → on success: UPDATE djs SET lockout_count=0, locked_until=null WHERE id=...
  → response: { name, isResident: type==='resident', rate }
```

Single query replaces two queries. Lockout is now persistent across restarts.

### Current Availability Fetch Flow (fetchAvailability)

```
GET /api/availability?month=...
  → cache check
  → parallel: fetchAllRows(dj_availability) + supabase(dj_submissions)
  → buildAvailabilityMap({ portalRows, submittedNames, month, fixedSchedules: FIXED_SCHEDULES })
  → cache result
  → response
```

### v2.0 Availability Fetch Flow

```
GET /api/availability?month=...
  → cache check
  → parallel: fetchAllRows(dj_availability) + supabase(dj_submissions) + fetchDJs() [cached]
  → build fixedSchedules from djs rows (where fixed_schedule is non-empty)
  → buildAvailabilityMap({ portalRows, submittedNames, month, fixedSchedules })
  → cache result
  → response
```

The `fetchDJs()` call is cheap since it's cached (10-min TTL). `buildAvailabilityMap` signature is unchanged.

### New: DJ Management Flow

```
Admin opens Manage DJs tab
  → GET /api/admin/djs (all DJs, active + inactive)
  → render table with edit controls

Admin edits DJ rate:
  → PATCH /api/admin/djs/:id { rate: 1500 }
  → UPDATE djs SET rate=1500 WHERE id=...
  → invalidateCaches('djs')
  → response { success: true }

Admin edits recurring availability:
  → PATCH /api/admin/djs/:id { recurring_availability: {...} }
  → UPDATE djs SET recurring_availability=... WHERE id=...
  → invalidateCaches('djs')
  → invalidateCaches('availability') — all months (same as current 'djs' invalidation)
  → response { success: true }

Admin resets PIN:
  → POST /api/admin/djs/:id/pin { pin: "1234" }
  → bcrypt.hash("1234", 10)
  → UPDATE djs SET pin_hash=hash WHERE id=...
  → no cache invalidation needed (pin_hash not cached)
  → response { success: true, note: "PIN updated" }
```

---

## Build Order (Dependency-Driven)

The features have strict dependencies. Build order must respect them.

### Phase 1: Database Migration (blocking everything else)

1. Write and run Supabase migration SQL (create `djs` table)
2. Write Node.js migration script: read dj_rates + dj_pins, dedup, insert into djs
3. Populate `recurring_availability` from FIXED_AVAILABILITY constant
4. Populate `fixed_schedule` from FIXED_SCHEDULES constant
5. Verify row counts and spot-check data
6. Drop dj_rates and dj_pins (or keep as backup — drop in a follow-up)

### Phase 2: Backend Swap (server.js changes, no UI changes)

Build in this order — each step is testable in isolation:

1. **fetchDJs()** — change query from `dj_rates` to `djs WHERE active=true`. Add `type`, `recurring_availability`, `fixed_schedule` to returned shape. Existing callers that only use `name`/`rate` are unaffected.

2. **requireDJAuth() + /api/dj/login** — change PIN lookup from `dj_pins` to `djs`. Replace `RESIDENTS.includes()` with `type === 'resident'`. Both endpoints share the same DJ lookup so consolidate into a helper.

3. **Account lockout persistence** — convert `checkLockout`, `recordFailedAttempt`, `clearFailedAttempts` from Map operations to async Supabase calls. The `_loginAttempts` Map and its sync functions are removed. `/api/admin/clear-lockout` now does a Supabase UPDATE.

4. **fetchAvailability()** — augment to pull `fixed_schedule` from `fetchDJs()` cache and pass to `buildAvailabilityMap()`. Remove `FIXED_SCHEDULES` from business-logic.js exports (or keep for tests until step 7).

5. **DJ portal availability endpoint** (`/api/dj/availability/:name/:month`) — replace `FIXED_SCHEDULES[name]` and `FIXED_AVAILABILITY[name]` lookups with a targeted `SELECT recurring_availability, fixed_schedule FROM djs WHERE lower(name) = lower($1)` query.

6. **DJ portal schedule endpoint** (`/api/dj/schedule/:name/:month`) — same targeted query, replace `FIXED_SCHEDULES[name]`.

7. **Remove dead code from business-logic.js** — delete FIXED_SCHEDULES, FIXED_AVAILABILITY, RESIDENTS constants. Update tests (business-logic.test.js) to pass fixture data instead of importing constants. This step must come last — only safe after all callers are migrated.

8. **New admin DJ management endpoints** — add GET/POST/PATCH for `/api/admin/djs`, `/api/admin/djs/:id/pin`, `/api/admin/djs/:id/lockout`.

9. **Webhook signature verification** — add HMAC check to `/api/webhooks/inbound` (or wherever webhook receiver lives). Requires `WEBHOOK_SECRET` env var.

10. **Supabase error handling** — wrap all existing bare `supabase.from(...)` calls that lack try-catch in try-catch blocks. Prioritize the auth and lockout paths first (highest impact).

### Phase 3: Frontend Changes (roster.html)

1. Remove hardcoded DJ array from roster.html (there are likely DJ name arrays in the auto-suggest JavaScript). Replace with data from `/api/djs` (now enriched).
2. Remove rate editing from DJ Hours tab.
3. Add Manage DJs tab with CRUD UI.
4. Recurring availability editor (day-of-week grid).
5. Fixed schedule editor (venue + day-of-week grid).

---

## Component Boundaries After v2.0

| Component | Responsibility | New vs Existing |
|-----------|---------------|-----------------|
| `djs` table | Single source of truth for all DJ config: identity, auth, rate, type, venues, availability defaults, schedule, lockout | NEW — replaces 2 tables |
| `fetchDJs()` | Cached loader for all DJ config; enriched shape; used by all endpoints needing DJ data | MODIFIED |
| `requireDJAuth()` | PIN verification against `djs`; async lockout check | MODIFIED |
| `buildAvailabilityMap()` | Pure function; unchanged signature; data source changes upstream | UNCHANGED |
| `DIAG_FIXED_TEMPLATE` | Full venue schedule template for auto-suggest; stays in code for v2.0 | UNCHANGED (deferred) |
| Admin DJ management endpoints | CRUD for `djs` table; admin-only | NEW |
| Manage DJs tab | Admin UI for DJ lifecycle management | NEW (in roster.html) |
| Lockout persistence | `djs.lockout_count` + `djs.locked_until`; survives restarts | MODIFIED (was Map) |

---

## Migration Path: Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Name deduplication fails (en-dash/hyphen variants) | HIGH (known issue) | Deduplicate by `lower(trim(name))` in migration script; log conflicts |
| RESIDENTS constant removal breaks isResident logic | MEDIUM | Audit all 3 call sites before removal; add test for `type === 'resident'` |
| Lockout Map→DB race condition on concurrent logins | LOW | UPDATE with WHERE clause is atomic; Postgres handles this correctly |
| `buildAvailabilityMap` receives wrong fixedSchedules shape | MEDIUM | Write a test that passes DB-shaped data to verify identical output |
| FIXED_AVAILABILITY shape mismatch in DB (dow keys as int vs string) | MEDIUM | JSON stores keys as strings; code uses `Object.entries()` so string keys work; verify with test |
| `fetchDJs()` cache enrichment slows first load | LOW | Cache TTL 10min; enriched shape adds ~10ms to first fetch |
| Diagnostic endpoint breaks (still references DIAG_FIXED_TEMPLATE) | LOW | DIAG_FIXED_TEMPLATE stays in code for v2.0; no change needed |
| roster.html hardcoded DJ arrays — unknown count | MEDIUM | Grep for string literals matching DJ names before estimating scope |

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Dual-Write During Migration

**What people do:** Write to both old tables and new `djs` table simultaneously during the migration period to "stay safe."

**Why it's wrong:** Dual-write adds complexity, creates sync bugs, and the project explicitly decided on "clean cutover, no dual-write" (PROJECT.md). The migration is a one-time operation on a small dataset (~15 DJs).

**Do this instead:** Migrate once, verify, cutover. Keep a Supabase backup (point-in-time recovery) as the safety net, not dual-write code.

### Anti-Pattern 2: Fetching All DJs on Every DJ Auth Request

**What people do:** Call `fetchDJs()` (which loads all DJs) to find one DJ's PIN hash during login.

**Why it's wrong:** Puts PIN hashes in the general-purpose DJ cache, which has a 10-minute TTL. Not a security breach per se (server-side only), but semantically wrong. The cache is for scheduling data, not auth secrets.

**Do this instead:** Use a targeted single-row query `SELECT pin_hash, lockout_count, locked_until, active FROM djs WHERE lower(name) = lower($1)` in the auth path. Never put pin_hash in the `fetchDJs()` cache.

### Anti-Pattern 3: Synchronous Lockout Check After Async Conversion

**What people do:** Convert `checkLockout()` to async but forget to await it in callers.

**Why it's wrong:** The check silently returns a Promise (truthy), so all accounts appear unlocked.

**Do this instead:** Add `async`/`await` at every call site. Search for all 3 call sites: `requireDJAuth()`, `/api/dj/login`, and `/api/admin/clear-lockout`.

### Anti-Pattern 4: Removing FIXED_SCHEDULES Before All Callers Are Migrated

**What people do:** Delete FIXED_SCHEDULES from business-logic.js as the first step (cleanliness).

**Why it's wrong:** There are 5 call sites in server.js that read FIXED_SCHEDULES. Removing the export before all are migrated causes runtime errors.

**Do this instead:** Migrate all callers first (steps 4-6 in build order above), confirm tests pass, then remove the export in the final cleanup commit.

---

## Sources

- Direct inspection of `server.js` (1,219 LOC, 2026-03-19)
- Direct inspection of `lib/business-logic.js` (314 LOC, 2026-03-19)
- `.planning/PROJECT.md` — v2.0 milestone goals and decisions
- Supabase table list from PROJECT.md context

---

*Architecture research for: DJ Roster v2.0 — DJ Management & Supabase Consolidation*
*Researched: 2026-03-19*
