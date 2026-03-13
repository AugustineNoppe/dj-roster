# Architecture

**Analysis Date:** 2026-03-13

## Pattern Overview

**Overall:** Monolithic server-driven MPA (Multi-Page Application) with server-side logic, client-side form submission, and stateless REST API endpoints. Supabase provides managed database and authentication.

**Key Characteristics:**
- Single Node.js/Express server with embedded client-side logic in HTML templates
- Three distinct views (Landing → DJ Portal / Admin Roster) served as static HTML pages with embedded JavaScript
- Multi-venue scheduling system (ARKbar, HIP, Love Beach) with shared backend
- Server-side caching layer (in-memory) for availability, roster, and DJ lists
- Admin and DJ authentication via password/PIN headers
- Request-level rate limiting on login endpoints
- Supabase as primary database (no ORM, direct SQL queries)

## Layers

**Presentation (Client-Side):**
- Purpose: HTML+CSS+inline JS in static pages for user interaction
- Location: `public/` directory
- Contains: Landing page, DJ portal, admin roster management interface
- Depends on: Express static file serving, API endpoints
- Used by: Browser clients (DJ portal users, admin managers)

**API Layer (Express Endpoints):**
- Purpose: Request routing, authentication, request validation, response serialization
- Location: `server.js` (lines 340-937)
- Contains: GET/POST routes for auth, config, availability, roster, signoffs, DJ data
- Depends on: Supabase client, in-memory cache, authentication middleware
- Used by: Client-side JavaScript, external integrations (DJ portal, admin roster)

**Business Logic (Calculation & Processing):**
- Purpose: Scheduling algorithms, availability aggregation, signoff processing, report generation
- Location: `server.js` (mixed throughout, no dedicated module)
- Contains: Fixed schedule merging, unavailability mapping, roster auto-suggest logic (embedded in requests)
- Depends on: Database layer, constants (RESIDENTS, FIXED_SCHEDULES)
- Used by: API endpoints, database writes

**Data Access (Supabase ORM-less):**
- Purpose: Direct database queries via Supabase JavaScript client
- Location: `server.js` (lines 7-11 initialization, queries throughout)
- Contains: Queries to dj_rates, dj_availability, dj_submissions, roster_assignments, dj_pins, dj_signoffs, finalized_months tables
- Depends on: Supabase client library, environment variables for credentials
- Used by: API endpoints, business logic, caching layer

**Cache Layer (In-Memory):**
- Purpose: Reduce database hits for frequently-accessed data
- Location: `server.js` (lines 122-164)
- Contains: DJ list cache (10 min TTL), availability cache (3 min TTL), roster cache (write-through), finalized months cache (5 min TTL)
- Depends on: Date/time checks, entry freshness validation
- Used by: Fetcher functions (fetchDJs, fetchAvailability, fetchRoster, fetchFinalized)

**Configuration (Static Server Constants):**
- Purpose: Define domain-specific constraints and metadata
- Location: `server.js` (lines 67-120)
- Contains: RESIDENTS array, ALL_SLOTS, FIXED_SCHEDULES, venue-specific slots, month/day names, slot normalization helpers
- Depends on: None (hardcoded)
- Used by: Business logic, availability calculation, roster filtering

## Data Flow

**DJ Portal Login:**
1. DJ submits name + PIN in `public/dj.html`
2. POST `/api/dj/login` validates PIN against `dj_pins` table (case-insensitive name match)
3. Response includes: `{ success, name, isResident, rate }` and submission status
4. Client stores session token (not shown in current code, likely cookie/session)

**Availability Submission:**
1. DJ selects dates/slots as available/unavailable in portal
2. POST `/api/dj/availability` with requireDJAuth middleware checks `x-dj-pin` header
3. Server deletes all existing rows for DJ+month, upserts new availability rows
4. Invalidates cache for that month (`cache.availability.delete(month)`)
5. Availability appears in admin's roster view within 3 minutes (cache TTL)

**Roster Building:**
1. Admin loads `/roster` page → shows Login screen (password protected)
2. POST `/api/auth` validates admin password
3. Client fetches data in parallel:
   - `/api/config` → RESIDENTS list
   - `/api/fixed-schedules` → FIXED_SCHEDULES
   - `/api/djs` → DJ list with rates (cached 10 min)
   - `/api/availability?month=X` → merged availability map (cached 3 min)
   - `/api/roster?venue=X&month=Y` → current assignments
4. Admin edits cells in roster grid:
   - Single cell: POST `/api/roster/assign` → upsert/delete one cell
   - Batch: POST `/api/roster/batch` → upsert multiple cells with venue-level mutex lock
5. Cache invalidation on each write prevents stale data

**Signoff (Attendance Tracking):**
1. Manager signs off DJ on Signoff tab or via external system
2. POST `/api/dj/signoff` or POST `/api/dj/signoff-batch` with MANAGER_PASSWORD
3. Entries inserted into `dj_signoffs` audit log (not deletable, append-only)
4. When finalizing month: last action per (dj, date, slot, venue) key wins (sign or unsign)

**Month Finalization:**
1. Admin clicks Finalize on Month Management tab
2. POST `/api/roster/finalize` with admin password
3. Server processes signoff log: counts hours per DJ by venue
4. Generates report with: `[{name, arkbar, hip, love, total, rate, cost}, ...]`
5. Inserts month into `finalized_months` table (write-through, not cached)
6. Report returned to admin for accounting/export

**State Management:**
- Client-side: Session storage (password for admin), DOM state for UI
- Server-side: In-memory caches with TTL, Supabase as source of truth
- No persistent client session storage except admin password (session storage cleared on tab close)

## Key Abstractions

**Availability Aggregation:**
- Purpose: Merge DJ-submitted availability with fixed recurring schedules and fallback "Guest DJ"
- Examples: `fetchAvailability()` (lines 183-259), `GET /api/dj/availability/:name/:month` (lines 517-587)
- Pattern: Build per-DJ per-date-per-slot map from three sources: 1) submitted dj_availability rows, 2) FIXED_SCHEDULES recurring patterns, 3) default "Guest DJ" for all slots

**Signoff Processing:**
- Purpose: Track DJ attendance with audit trail (sign/unsign actions), determine net sign-off status
- Examples: `/api/dj/signoff` (lines 694-707), `/api/dj/unsignoff-day` (lines 729-754), `/api/signoffs/:month` (lines 778-802)
- Pattern: Append-only log with action type, last action per composite key (dj, date, slot, venue) determines current state

**Roster Mutations with Locking:**
- Purpose: Prevent concurrent batch-assign requests from corrupting data
- Examples: `withVenueLock()` (lines 152-158), POST `/api/roster/batch` (lines 414-432)
- Pattern: Per-venue promise-chain lock serializes all writes for a venue

**Date/Slot Normalization:**
- Purpose: Handle multiple input formats (D Mon YYYY, MM/DD/YYYY, YYYY-MM-DD) and slot dash variations (-, –, —)
- Examples: `parseDateKey()` (lines 81-96), `normalizeSlot()` (line 77)
- Pattern: Regex-based parsing to canonical YYYY-MM-DD and en-dash slot format

## Entry Points

**Landing Page (Home):**
- Location: `GET /` → `public/landing.html`
- Triggers: Browser navigation to domain root
- Responsibilities: Display portal options, route to DJ portal or admin roster, show contact info

**DJ Portal:**
- Location: `GET /dj` → `public/dj.html` (embedded JavaScript)
- Triggers: DJ clicks "DJ Portal" from landing page
- Responsibilities: DJ login (name + PIN), availability form submission, schedule view, signoff management

**Admin Roster:**
- Location: `GET /roster` → `public/roster.html` (embedded JavaScript)
- Triggers: Admin clicks "Admin" from landing page
- Responsibilities: Admin authentication, month/venue selection, roster grid editing, batch operations, finalization, DJ management

**API Routes:**
- `/api/config` - Return server config (RESIDENTS)
- `/api/fixed-schedules` - Return fixed recurring schedules
- `/api/djs` - Return DJ list with rates
- `/api/availability` - Return merged availability for month
- `/api/roster` - Return assignments for venue+month
- `/api/roster/unavailability/:month` - Unavailability map (admin only)
- `/api/roster/assign` - Single cell assign (admin only)
- `/api/roster/batch` - Batch assign (admin only)
- `/api/roster/clear` - Clear month for venue (admin only)
- `/api/roster/finalize` - Finalize month with hours report (admin only)
- `/api/dj/login` - DJ login
- `/api/dj/change-pin` - DJ PIN change
- `/api/dj/availability/:name/:month` - Get DJ's availability form state
- POST `/api/dj/availability` - Submit availability changes
- POST `/api/dj/availability/submit` - Mark month as submitted
- `/api/dj/submissions/:month` - View which DJs submitted (admin only)
- `/api/dj/schedule/:name/:month` - View DJ's schedule across all venues
- `/api/dj/signoff` - Single signoff
- `/api/dj/signoff-batch` - Batch signoffs
- `/api/dj/unsignoff-day` - Undo all signoffs for day (manager only)
- `/api/dj/signoffs/:name/:month` - Get DJ's current signoffs
- `/api/signoffs/:month` - Get all signoffs for accounting (admin only)
- POST `/api/djs/update` - Update DJ name/rate (admin or manager)
- `/api/finalized` - Get list of finalized months
- POST `/api/dj/login` - DJ login endpoint (rate-limited)

## Error Handling

**Strategy:** Try-catch blocks at endpoint level, return `{ success: false, error: message }` JSON response. No error codes differentiation beyond HTTP 401/429/400/500.

**Patterns:**
- Database errors: Catch from Supabase response, surface message to client
- Validation errors: Return 400 for malformed month string in clear/finalize endpoints
- Authentication errors: Return 401 for invalid password/PIN, 429 for rate limit exceeded
- Uncaught exceptions: Logged to console with `process.on('uncaughtException')` handler

## Cross-Cutting Concerns

**Logging:** Console.log/console.error calls embedded in endpoint handlers (lines 310-327 for DJ auth errors, line 616 for availability upsert errors). No structured logging framework.

**Validation:** Inline in endpoints:
- Date validation: `parseDateKey()` checks format
- Month validation: `/^[A-Za-z]+ \d{4}$/` regex for clear/finalize
- PIN validation: Exact 4-digit match (`/^\d{4}$/`)
- Slot normalization: `normalizeSlot()` handles dash variants

**Authentication:**
- Admin: `x-admin-password` header matches `process.env.ADMIN_PASSWORD`, middleware `requireAdmin()`
- DJ: `x-dj-pin` header + name in body matched against `dj_pins` table (case-insensitive), middleware `requireDJAuth()`
- Manager: `password` field in request body matches `process.env.MANAGER_PASSWORD` (signoff endpoints)

**Rate Limiting:** Simple in-memory sliding window on `/api/dj/login` and `/api/auth`:
- 10 requests per IP per 60 seconds
- Tracks via `_rateCounts` Map with timestamp array, cleaned per-check
- Returns 429 when limit exceeded

**CORS:** Custom middleware allows only whitelisted origins (production and localhost), validates Origin header, returns 403 if mismatch. Supports OPTIONS preflight.

**Security Headers:** Custom middleware sets CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc. (lines 14-25)

---

*Architecture analysis: 2026-03-13*
