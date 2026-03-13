# Codebase Structure

**Analysis Date:** 2026-03-13

## Directory Layout

```
dj-roster/
├── server.js                 # Main Express application (monolithic, 942 lines)
├── package.json              # Node.js dependencies (Express, Supabase client)
├── package-lock.json         # Locked dependency versions
├── public/                   # Static HTML pages with embedded JavaScript
│   ├── landing.html          # Home/entry point (portal navigation)
│   ├── dj.html               # DJ portal (availability submission, schedule view)
│   ├── roster.html           # Admin roster manager (scheduling, finalization)
│   ├── index.html            # Availability form (legacy/alternate entry)
│   └── favicon.svg           # Site icon
├── .planning/                # GSD planning documentation (generated)
└── node_modules/             # Dependencies (not committed)
```

## Directory Purposes

**`/` (Project Root):**
- Purpose: Single-file server + static assets for a self-contained DJ roster application
- Contains: Express app configuration, API routes, database initialization, caching logic, static file serving
- Key files: `server.js` (all server logic), `package.json` (dependencies)

**`public/`:**
- Purpose: Static HTML pages served by Express with embedded JavaScript for client interaction
- Contains: Three main views (landing, DJ portal, admin roster) with inline `<style>` and `<script>` tags
- Key files:
  - `landing.html` - Portal entry point, navigation buttons
  - `dj.html` - DJ-facing interface for availability and schedule
  - `roster.html` - Admin-facing roster editor with batch operations
  - `index.html` - Alternate availability interface (legacy)

## Key File Locations

**Entry Points:**

- `server.js` (line 940): Server startup on PORT 8080, listens on all interfaces
- `public/landing.html`: Browser root `/` entry point, shows navigation options
- `public/dj.html`: DJ portal entry at `/dj`, embedded login + form logic
- `public/roster.html`: Admin roster at `/roster`, embedded login + grid editor

**Configuration:**

- `server.js` (lines 67-120): Constants for RESIDENTS, time slots (all venues), FIXED_SCHEDULES, month/day names, date/slot normalization helpers
- `.env` (not in repo): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_PASSWORD`, `MANAGER_PASSWORD`, `PORT` environment variables
- `server.js` (lines 28-31): ALLOWED_ORIGINS whitelist for CORS (production domain + localhost)

**Core Logic:**

- `server.js` (lines 122-164): Cache layer initialization and invalidation (TTL-based expiry, write-through roster)
- `server.js` (lines 168-181): `fetchDJs()` - Fetch and cache DJ list from `dj_rates` table
- `server.js` (lines 183-259): `fetchAvailability()` - Merge submitted availability, fixed schedules, and Guest DJ fallback
- `server.js` (lines 261-278): `fetchRoster()` - Fetch and cache roster assignments by venue+month
- `server.js` (lines 456-465): `fetchFinalized()` - Fetch and cache list of finalized months
- `server.js` (lines 414-432): POST `/api/roster/batch` - Batch assign with venue-level locking
- `server.js` (lines 838-901): POST `/api/roster/finalize` - Generate hours report and record finalization

**Testing:**

- No test files present. Testing is manual or via external tools.

**API Routes (by category):**

Authentication & Config:
- `server.js` (lines 294-296): POST `/api/auth` - Admin password validation (rate-limited)
- `server.js` (lines 299-304): `requireAdmin()` middleware
- `server.js` (lines 306-329): `requireDJAuth()` middleware with DJ PIN validation
- `server.js` (lines 332-338): GET `/api/config`, GET `/api/fixed-schedules`

DJ Data:
- `server.js` (lines 342-345): GET `/api/djs` - DJ list (cached)
- `server.js` (lines 804-824): POST `/api/djs/update` - Update DJ rate/name

Availability Management:
- `server.js` (lines 347-356): GET `/api/availability` - Merged availability (cached)
- `server.js` (lines 516-587): GET `/api/dj/availability/:name/:month` - DJ form state
- `server.js` (lines 592-627): POST `/api/dj/availability` - Submit availability changes
- `server.js` (lines 630-647): POST `/api/dj/availability/submit` - Mark month as submitted
- `server.js` (lines 650-666): GET `/api/dj/submissions/:month` - View submission statuses (admin)
- `server.js` (lines 368-388): GET `/api/roster/unavailability/:month` - Unavailability map (admin)

Roster Management:
- `server.js` (lines 358-365): GET `/api/roster` - Get current assignments (cached)
- `server.js` (lines 391-411): POST `/api/roster/assign` - Single cell assign/delete
- `server.js` (lines 414-432): POST `/api/roster/batch` - Batch assign with locking
- `server.js` (lines 435-450): POST `/api/roster/clear` - Clear all assignments for venue+month

DJ Schedule & Signoff:
- `server.js` (lines 669-691): GET `/api/dj/schedule/:name/:month` - DJ's schedule across all venues
- `server.js` (lines 694-707): POST `/api/dj/signoff` - Single signoff (manager)
- `server.js` (lines 710-726): POST `/api/dj/signoff-batch` - Batch signoffs (manager)
- `server.js` (lines 729-754): POST `/api/dj/unsignoff-day` - Undo day signoffs (manager)
- `server.js` (lines 757-775): GET `/api/dj/signoffs/:name/:month` - DJ's signoffs
- `server.js` (lines 778-802): GET `/api/signoffs/:month` - All signoffs (admin, for accounting)

Finalization & Admin:
- `server.js` (lines 827-835): GET `/api/finalized` - List finalized months
- `server.js` (lines 838-901): POST `/api/roster/finalize` - Finalize with report generation
- `server.js` (lines 904-937): POST `/api/admin/reset-month` - Clear all data for month (admin)

DJ Portal (Client-Side):
- `public/dj.html` (embedded): Login form, availability calendar, schedule viewer, PIN change

Admin Roster (Client-Side):
- `public/roster.html` (embedded): Login form, month/venue selector, roster grid, hours tracker, batch operations, finalization UI

## Naming Conventions

**Files:**
- `.html` - Static pages served as-is
- `.svg` - Icon files
- `.json` - Package manifests and lock files
- `.js` - Node.js server file (single file containing all logic)

**Directories:**
- `public/` - Static web assets served as-is
- `.planning/` - Generated planning documentation
- `node_modules/` - Dependencies (excluded from git)

**Functions & Variables (from `server.js`):**
- Snake_case for internal cache maps: `_rateCounts`, `_batchLocks`, `ALLOWED_ORIGINS`, `ALL_SLOTS`, `FIXED_SCHEDULES`, `ARKBAR_SLOTS`, `LOVE_WEEKDAY_SLOTS`, `HIP_ROTATION` (used in client code)
- camelCase for helper functions: `parseDateKey()`, `makeDateKey()`, `normalizeSlot()`, `fetchDJs()`, `fetchAvailability()`, `fetchRoster()`, `isFresh()`, `withVenueLock()`, `invalidateRoster()`, `requireAdmin()`, `requireDJAuth()`
- UPPERCASE for constants: `RESIDENTS`, `MONTH_NAMES`, `SHORT_MONTHS`, `RATE_WINDOW_MS`, `RATE_MAX`, `AVAIL_TTL`, `MGMT_SESSION_KEY` (client)

**Client-Side (in HTML files):**
- camelCase for variables: `currentVenue`, `currentYear`, `currentMonth`, `adminPassword`, `availability`, `djList`, `fixedSchedules`
- camelCase for functions: `getMonthString()`, `saveMgmtSession()`, `doLogin()`, `togglePwView()`
- UPPERCASE for constants: `MONTHS`, `DAYS`, `ARKBAR_SLOTS`, `HIP_SLOTS`, `LOVE_WEEKDAY_SLOTS`, `RESIDENTS`, `TARGETS`, `DJ_COLORS`
- $ prefix for DOM queries: `$('id')` helper function returns `document.getElementById(id)`

## Where to Add New Code

**New API Endpoint:**
- Add to `server.js` after line 340 in the appropriate section
- Follow pattern: `app.get/post('/api/path', optionalMiddleware, async (req, res) => { ... })`
- Return `{ success: true, data }` or `{ success: false, error }` JSON
- Use `try-catch` with database calls; catch errors and return error object
- If reading from Supabase, use `await supabase.from('table').select(...)`
- If writing, use `.upsert()`, `.insert()`, or `.delete()`
- Add cache invalidation if endpoint modifies data DJs see

**New Client Feature (DJ Portal):**
- Modify `public/dj.html` - add HTML markup in appropriate section before closing tags
- Add CSS in `<style>` block (lines 12-1000+)
- Add JavaScript in `<script>` block (lines after initial state vars)
- Call API endpoints via `fetch()` with `x-dj-pin` header and DJ name in body
- Use existing helper functions: `$()` for DOM access, `pad2()` for date formatting, `normalizeSlot()` for slot normalization
- Store state in global variables (e.g., `djList`, `availability`)

**New Client Feature (Admin Roster):**
- Modify `public/roster.html` - add HTML in appropriate `<div>` section
- Add CSS in `<style>` block (lines 13-560)
- Add JavaScript in `<script>` block (starting line 569)
- Call API endpoints with `x-admin-password` header for admin operations
- Sync with existing roster grid structure or create new tab (modify month selector or venue tabs)
- Use existing color/styling tokens from CSS variables (--navy, --teal, --orange, --love-pink)

**New Database Table:**
- Add table to Supabase project (outside this repo)
- Reference in `server.js` API routes: `supabase.from('table_name').select(...)`
- No migrations file; schema managed in Supabase dashboard

**New Fixed Schedule or Resident:**
- Update `server.js` (lines 67-120):
  - Add to RESIDENTS array if new resident DJ
  - Add to FIXED_SCHEDULES object with day-of-week keys and venue-specific slots
  - Or update ARKBAR_SLOTS, HIP_SLOTS, LOVE_WEEKDAY_SLOTS if adding venue/slot
- Update `public/roster.html`:
  - Add to RESIDENTS array (line 607)
  - Add to DJ_COLORS object with hex color (lines 615-622)
  - Add to TARGETS object if setting monthly hour target (line 612)
  - Update HIP_ROTATION if changing HIP weekly pattern (line 641)
- Update `public/dj.html` similarly for consistency

## Special Directories

**`.planning/`:**
- Purpose: GSD codebase documentation (generated by mapping agent)
- Generated: Yes
- Committed: Yes (included in git repo)
- Contents: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md (conditional on which focus area is mapped)

**`node_modules/`:**
- Purpose: Installed npm dependencies
- Generated: Yes (by `npm install`)
- Committed: No (excluded by .gitignore)
- Contents: Express, Supabase client, rate-limit middleware, helmet, etc.

---

*Structure analysis: 2026-03-13*
