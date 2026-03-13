# External Integrations

**Analysis Date:** 2026-03-13

## APIs & External Services

**Supabase (Primary Database + Backend):**
- Database service for all persistent data storage
  - SDK/Client: `@supabase/supabase-js` v2.99.1+
  - Auth: Environment variables `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
  - Connection type: REST API via PostgREST-JS client (included in supabase-js)

## Data Storage

**Databases:**
- **Supabase PostgreSQL** (primary database)
  - Connection: Via `@supabase/supabase-js` client initialized with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (see `server.js` lines 7-11)
  - Client: Supabase JavaScript SDK (PostgREST-JS)

**Tables in use:**
- `dj_rates` - DJ information and pay rates
  - Fields: `name`, `rate`
  - Queries: `select('name, rate')` in `fetchDJs()` (line 171)
- `dj_availability` - DJ availability by date and slot per month
  - Fields: `name`, `date`, `slot`, `month`, `status`
  - Queries: Read/write availability status in `fetchAvailability()` (lines 196), `POST /api/dj/availability` (line 592)
- `dj_pins` - DJ PIN authentication credentials
  - Fields: `name`, `pin`
  - Queries: Read for auth in `requireDJAuth()` (lines 314-318), write in `POST /api/dj/change-pin` (line 506)
- `dj_submissions` - DJ monthly submission status
  - Fields: `name`, `month`, `status`
  - Queries: Read in `fetchAvailability()` (line 197), write in `POST /api/dj/availability/submit` (line 630)
- `roster_assignments` - DJ assignments to specific date/slot/venue/month
  - Fields: `venue`, `date`, `slot`, `month`, `dj`
  - Queries: Read in `fetchRoster()` (line 266), upsert in `POST /api/roster/assign` (line 396), `POST /api/roster/batch` (line 421)
- `dj_signoffs` - Record of DJ sign-off/sign-on actions with timestamps
  - Fields: `name`, `date`, `slot`, `venue`, `month`, `action`
  - Queries: Read in `POST /api/roster/finalize` (line 861), `GET /api/signoffs/:month` (line 778), write in `POST /api/dj/signoff` (line 694)
- `finalized_months` - Track which months have been finalized for payment processing
  - Fields: `month`, `finalized_at`
  - Queries: Read in `fetchFinalized()` (line 459), write in `POST /api/roster/finalize` (line 883)

**File Storage:**
- Not applicable — application uses no external file storage service

**Caching:**
- In-memory cache only
  - DJ list cache: 10-minute TTL (line 135)
  - Availability cache: 3-minute TTL per month (line 140)
  - Roster cache: No TTL, write-through (line 137)
  - Finalized months cache: 10-minute TTL (line 843)
- See `server.js` lines 122-164 for cache implementation and invalidation logic

## Authentication & Identity

**Auth Mechanism:**
- Custom password-based authentication (not OAuth)
  - Admin authentication: `x-admin-password` header vs `ADMIN_PASSWORD` env var (lines 300-303)
  - Manager authentication: `MANAGER_PASSWORD` env var (lines 697, 713, 732, 808)
  - DJ authentication: DJ name + PIN via `x-dj-pin` header (lines 306-329)
- DJ PIN stored in Supabase `dj_pins` table, not external provider

## Monitoring & Observability

**Error Tracking:**
- Not detected — errors logged to console only

**Logs:**
- Console logging via `console.error()` and `console.log()`
- Error logging in exception handler (line 1-3)
- Debug logging in auth paths (lines 310-311, 321-322, 326)

## CI/CD & Deployment

**Hosting:**
- Not configured — any Node.js hosting platform (Heroku, Railway, Fly.io, VPS, etc.)

**CI Pipeline:**
- Not detected — no GitHub Actions, no build workflow

## Environment Configuration

**Required env vars:**
- `SUPABASE_URL` - Supabase project API endpoint
- `SUPABASE_SERVICE_KEY` - Supabase service role key (full database access)
- `ADMIN_PASSWORD` - Administrative user password
- `MANAGER_PASSWORD` - Manager role password (for limited admin functions)
- `PORT` - Server port (optional, defaults to 8080)

**Secrets location:**
- Environment variables stored in deployment platform's secret management (Heroku Config Vars, Railway Secrets, etc.)
- `.env` file present locally but not committed to git (respects .gitignore)

## Webhooks & Callbacks

**Incoming:**
- No webhooks configured to receive external data

**Outgoing:**
- No webhooks configured to call external services

## API Endpoints Summary

**Public:**
- `GET /` - Landing page
- `GET /availability` - DJ availability portal
- `GET /roster` - Read-only roster view
- `GET /dj` - DJ login page
- `POST /api/auth` - Admin password authentication
- `POST /api/dj/login` - DJ PIN authentication
- `GET /api/djs` - List DJ rates
- `GET /api/availability?month=X` - Get availability options for month
- `GET /api/roster?venue=X&month=Y` - Get current roster assignments
- `GET /api/config` - Get config (residents list)
- `GET /api/fixed-schedules` - Get fixed DJ schedules
- Static files via `express.static` from `public/` directory

**DJ Protected (require `x-dj-pin` header):**
- `POST /api/dj/change-pin` - Change PIN
- `POST /api/dj/availability` - Submit availability form
- `POST /api/dj/availability/submit` - Mark submission as complete
- `GET /api/dj/availability/:name/:month` - Get own availability
- `GET /api/dj/schedule/:name/:month` - Get own fixed schedule
- `POST /api/dj/signoff` - Sign off from shift
- `POST /api/dj/signoff-batch` - Bulk sign-off

**Admin Protected (require `x-admin-password` header):**
- `POST /api/roster/assign` - Assign DJ to single slot
- `POST /api/roster/batch` - Batch assign multiple slots
- `POST /api/roster/clear` - Clear entire month roster
- `GET /api/roster/unavailability/:month` - Get unavailability map for auto-suggest
- `POST /api/admin/reset-month` - Reset month data (clear all assignments and availability)
- `POST /api/roster/finalize` - Finalize month for payment reporting

**Manager Protected:**
- `POST /api/dj/signoff` - Sign off from shift (manager can do this)
- `POST /api/dj/signoff-batch` - Bulk sign-off (manager can do this)
- `POST /api/djs/update` - Update DJ rates (manager auth)
- `GET /api/finalized` - View finalized months

---

*Integration audit: 2026-03-13*
