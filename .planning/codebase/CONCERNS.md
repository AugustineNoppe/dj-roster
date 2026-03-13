# Codebase Concerns

**Analysis Date:** 2026-03-13

## Memory Leaks in Rate Limiter

**Issue:** Rate limiter accumulates timestamps in memory without cleanup
**Files:** `server.js` lines 50-63
**Impact:** The `_rateCounts` Map grows unbounded over time. Each IP accumulates an array of timestamps that's only filtered (not cleared). After weeks of operation, this will cause memory to grow continuously, potentially causing memory exhaustion and crashes in production.
**Cause:** Timestamps are filtered but the old entries are never removed from the Map. Each IP entry persists forever even after falling out of the rate window.
**Fix approach:**
- Implement a cleanup function that removes IPs with no recent activity
- Use a circular buffer or time-based cleanup to prevent unbounded growth
- Consider using a library like `express-rate-limit` (already in dependencies but not used)

## Missing Password Validation and Sanitization

**Issue:** Passwords accepted as plain request body parameters
**Files:** `server.js` lines 696-697, 712-713, 731-732, 807-808, 840-841
**Impact:** Passwords are logged in error messages (line 321 logs expected vs actual). Attack: Passwords could be captured in logs, error monitoring services, or network inspection. Also supports POST-based password transmission which is weaker than header-based auth.
**Current state:** Uses custom string comparison on passwords from both request body and headers. Inconsistent: some endpoints check headers (lines 300, 651, 779) while others check body (lines 696-697, etc).
**Fix approach:**
- Standardize on header-based auth only (x-admin-password, x-manager-password)
- Remove password from request body entirely
- Audit all error logging to ensure passwords/PINs are never logged
- Use timing-safe comparison for all credential checks

## Race Condition in Batch Assignment

**Issue:** Batch upserts without per-DJ conflict handling
**Files:** `server.js` lines 417-432
**Impact:** When multiple batch assignments for the same venue happen concurrently, venue-level mutex prevents interleaving but doesn't prevent within-batch conflicts. If two assignments target the same cell (date+slot), the last one wins silently without user visibility. Could result in overlapping assignments being stored.
**Current mitigation:** `withVenueLock` serializes per-venue but this is insufficient. Upsert behavior with `onConflict: 'venue,date,slot'` is correct but the client may not see which assignments were overwritten.
**Fix approach:**
- Return conflict details in batch response indicating which assignments replaced existing ones
- Add client-side conflict resolution UI warning
- Consider transaction-level consistency check

## Availability Data Integrity Issue: Delete-Then-Upsert Race

**Issue:** Separate delete and upsert operations without transaction wrapping
**Files:** `server.js` lines 599-620 (POST /api/dj/availability)
**Impact:** Between deletion (lines 600-604) and insertion (lines 612-619), another request could insert conflicting data. If two availability submissions happen within milliseconds, the second could partially overwrite the first. Also, if insertion fails after deletion succeeds, data is lost.
**Current mitigation:** None - these are separate Supabase calls without transaction support
**Fix approach:**
- Use Supabase transactions or batch delete+insert in single call
- Or check for conflicts before deletion and fail early
- Return clear error if partial state results

## Date Parsing Fragility

**Issue:** Multiple date format parsers with incomplete coverage
**Files:** `server.js` lines 81-96 (parseDateKey function)
**Impact:** If Supabase stores dates in format not covered by regexes, they silently parse to null. Code then skips those rows (line 209, 380, 558) without error. User sees blank slots thinking they're unscheduled when they're actually data corruption. Formats supported: YYYY-MM-DD, D Mon YYYY, M/D/YYYY, MM/DD/YYYY, YYYY/MM/DD. Any deviation = silent failure.
**Cause:** Supabase stores dates in multiple formats from different sources (manual input, form submission, legacy data)
**Fix approach:**
- Standardize Supabase to single date format (ISO 8601: YYYY-MM-DD)
- Add logging when parseDateKey returns null (line 81 in particular)
- Data migration to normalize all existing dates

## Missing Helmet Dependency Usage

**Issue:** Helmet listed in package.json but not imported
**Files:** `package.json` line 11 lists helmet, `server.js` has no helmet import
**Impact:** Security headers are manually set (lines 15-25) instead of using Helmet's defaults. Manual approach is error-prone: missing headers like `X-Permitted-Cross-Domain-Policies`, suboptimal CSP with `unsafe-inline`. Helmet auto-updates when vulnerabilities discovered.
**Fix approach:**
- Replace manual headers with `app.use(helmet())`
- Review custom CSP needs and override only if necessary

## CORS Configuration Too Permissive

**Issue:** CORS headers set per-request but Access-Control-Allow-Methods hardcoded to GET, POST, OPTIONS
**Files:** `server.js` lines 27-46
**Impact:** Allows POST to all endpoints (including destructive ones) from whitelisted origins. No CSRF protection beyond origin check. Also: `Vary: Origin` header is set, but `Access-Control-Allow-Credentials` is not checked. If cookies were used for auth, this would be a vulnerability.
**Current mitigation:** Auth is header-based (x-admin-password, x-dj-pin), not cookie-based, so CSRF risk is reduced but not eliminated.
**Fix approach:**
- Require CSRF token for state-changing operations (POST/DELETE)
- Or switch to SameSite cookie-based auth with proper CSRF protection
- Restrict allowed methods per endpoint (DELETE endpoints shouldn't accept GET)

## Signoff Log Doesn't Prevent Duplicate Signs/Unsigns

**Issue:** Signoff log allows multiple sign/unsign actions on same slot without validation
**Files:** `server.js` lines 694-754 (POST /api/dj/signoff endpoints)
**Impact:** Client-side mistake (double-clicking submit) creates duplicate signoff entries. Log processing (lines 766-791) takes "last action wins" which masks the duplication but wastes storage. Accounting report assumes each row = 1 hour of work, but duplication doesn't change final count (last action wins), only makes logs harder to audit.
**Cause:** No idempotency check. Same name+date+slot+venue can be signed multiple times.
**Fix approach:**
- Add unique constraint on dj_signoffs(name, date, slot, venue, action) or
- Implement idempotency key in request (client sends UUID for each action)
- Client-side debounce on submit buttons

## Cache Invalidation Leaks

**Issue:** Cache invalidation is manual and scattered throughout code
**Files:** `server.js` cache operations at lines 147, 162, 621, 642, 819, 896, 926
**Impact:** Developers must remember to invalidate cache after every data mutation. Easy to forget (example: line 819 invalidates `cache.djs.data = null` but doesn't invalidate `cache.availability` even though DJ rates affect availability suggestions). Stale cache shown to users.
**Current issues:**
- Line 819: DJ rate updates don't invalidate availability cache
- Lines 426, 445: Roster batch/clear invalidate correctly but single assign might miss in edge cases
- No audit trail of which mutations invalidated what

**Fix approach:**
- Centralize cache invalidation into a single function that documents dependencies
- Use cache tags/groups (e.g., `invalidateRelated('availability')` clears all dependent caches)
- Add TTL-based auto-expiry to all cache entries (currently only roster lacks TTL)

## CSP unsafe-inline Exposes to XSS

**Issue:** Content-Security-Policy allows `unsafe-inline` for both script-src and style-src
**Files:** `server.js` lines 21-22
**Impact:** Inline JavaScript injection anywhere in HTML bypasses CSP. If HTML files are stored in Supabase or dynamically generated without sanitization, XSS is possible. Current HTML is static files but any future dynamic HTML generation (e.g., server-rendered templates) would be vulnerable.
**Current mitigation:** All HTML is static files, no user input is embedded
**Fix approach:**
- Move all inline styles to external stylesheets
- Move all inline scripts to external files (likely requires bundler like webpack)
- Update CSP to remove `unsafe-inline`

## Availability Endpoint Leaks All DJ Data

**Issue:** GET /api/availability returns availability for all DJs who submitted
**Files:** `server.js` lines 347-356
**Impact:** Frontend gets list of all available DJs per slot. This leaks DJ scheduling info that could be competitive. However, this is by design for roster assignment, so low severity.
**Risk:** If endpoint becomes public (missing auth), schedule is exposed
**Fix approach:**
- Require admin auth on /api/availability endpoint
- Or add rate limiting specifically to this endpoint

## PIN Storage in Plain Text

**Issue:** DJ PINs stored in Supabase dj_pins table without hashing
**Files:** `server.js` lines 314-323, 475-486, 498-514
**Impact:** Database breach exposes all DJ 4-digit PINs. PINs used for DJ authentication. While PINs are only 4 digits (10k combinations, brute-forceable), they should still be hashed for defense-in-depth.
**Current risk:** If Supabase is breached, attacker can login as any DJ
**Fix approach:**
- Hash PINs with bcrypt before storing (bcrypt rounds=10 minimum)
- Use constant-time comparison for PIN verification (crypto.timingSafeEqual)
- Add account lockout after 3 failed PIN attempts
- Add audit log of failed login attempts

## Missing Audit Trail for Admin Actions

**Issue:** Admin roster assignments, batch operations, and clearing don't log who did what
**Files:** `server.js` lines 391-411, 414-432, 435-450
**Impact:** Can't determine which admin made which changes. If someone clears entire month by mistake or intentionally, no record of who. Compliance/accountability issue.
**Current state:** No audit table, no logging of admin actions
**Fix approach:**
- Create audit_log table: (timestamp, admin_user, action, venue, month, details)
- Extract admin identity from x-admin-password header (not ideal, should use session IDs)
- Log all mutations: assign, batch, clear, update DJ rates

## Synchronization Issue in Finalization

**Issue:** Finalization reads signoffs, calculates report, then writes finalized_months without transaction
**Files:** `server.js` lines 837-901
**Impact:** Between reading signoffs (line 847) and marking month as finalized (line 887), another admin could add new signoffs. Final report won't include those signoffs, but month is marked as finalized so no one can edit availability again. Unreconciled hours.
**Current mitigation:** None
**Fix approach:**
- Use Supabase transaction: read signoffs, validate consistency, write finalized record atomically
- Or add signoff lock that prevents new signoffs once finalization starts
- Or query signoffs again and check for new entries before finalizing

## Reset Month Doesn't Verify State Before Deletion

**Issue:** Reset month deletes all data without checking if month is already being edited elsewhere
**Files:** `server.js` lines 904-937
**Impact:** If admin starts reset while another admin is assigning DJs, some assignments get deleted while others are still being written. Data corruption/loss.
**Current mitigation:** Per-venue mutex (withVenueLock) only protects batch operations, not cross-venue reset
**Fix approach:**
- Acquire locks for all venues before resetting
- Check that no other requests are in-flight for that month
- Or mark month as "resetting" and queue requests until complete

## Large Single File Architecture

**Issue:** All server code in single server.js file (942 lines)
**Files:** `server.js`
**Impact:** Code organization makes it hard to reason about concerns. DJ portal, roster management, accounting, and auth logic all mixed. Difficult to test components in isolation. Changes to one feature risk breaking another.
**Current state:** ~942 lines, ~11 API endpoints, ~4 major features
**Fix approach:**
- Extract routes into separate files: `routes/roster.js`, `routes/dj-portal.js`, `routes/auth.js`
- Extract data layers into `lib/db.js` or `services/`
- Extract cache logic into `lib/cache.js`
- Extract utilities into `lib/date-utils.js`

## No Error Recovery or Retry Logic

**Issue:** Failed Supabase requests return errors immediately without retry
**Files:** `server.js` all database operations
**Impact:** Temporary Supabase outages immediately fail requests. Users can't complete operations during brief network hiccups. No resilience.
**Current mitigation:** None
**Fix approach:**
- Implement exponential backoff retry (max 3 attempts) for idempotent operations (GET, upsert)
- Idempotent writes should retry; mutations that can't be retried should fail immediately
- Add circuit breaker to fail fast if Supabase is consistently down

## Logging Includes Sensitive Data

**Issue:** Error logs include PIN values and DJ names in comparison messages
**Files:** `server.js` lines 310, 321 log PIN mismatch details
**Impact:** If logs are shipped to external service (DataDog, Sentry, etc.), authentication failures are logged with details that could aid brute force. PIN is 4 digits so attackable.
**Current logging:** Console.error at line 321: "[requireDJAuth] pin mismatch for {name} — expected: {correctPin} got: {pin}"
**Fix approach:**
- Log authentication failures as generic "Authentication failed" without details
- Log to separate audit stream if needed, with access controls
- Use hashed identifiers instead of plain DJ names in logs

## Roster Assignments Don't Validate Against Availability

**Issue:** Admin can assign DJ to time slot even if DJ marked unavailable
**Files:** `server.js` lines 391-411 (single assign), 414-432 (batch assign)
**Impact:** Admin assigns "Sound Bogie" to slot when "Sound Bogie" marked "unavailable" for that slot. This violates the DJ's stated preferences but doesn't error. Awkward for DJ if assigned despite saying unavailable.
**Current mitigation:** Roster UI probably calls availability endpoint to show unavailable slots, but API doesn't enforce it
**Fix approach:**
- Add server-side validation in /api/roster/assign and /api/roster/batch
- Check unavailability map (line 368 already has this data) before accepting assignment
- Return error if assignment conflicts with DJ's unavailability
- Allow override with specific flag if needed for emergency

## Fixed Schedules Hardcoded in Server

**Issue:** FIXED_SCHEDULES for Davoted is hardcoded in server.js
**Files:** `server.js` lines 101-114
**Impact:** Changing Davoted's schedule requires code deploy + server restart. Can't be edited through UI. If schedule needs temporary adjustment, must redeploy.
**Current state:** Davoted has fixed recurring weekly schedule. Other DJs don't. Manual adjustment required for any change.
**Fix approach:**
- Move FIXED_SCHEDULES to database table: `fixed_schedules(dj_name, day_of_week, venue, slots)`
- Query at startup, cache with 10min TTL
- Provide admin UI to edit (lower priority)

## No Validation of Month Format

**Issue:** Month format assumed to be "Month Year" (e.g., "March 2026") but not validated everywhere
**Files:** `server.js` lines 438, 907 validate with regex `/^[A-Za-z]+ \d{4}$/` but other endpoints don't
**Impact:** Lines 349-351 (GET /api/availability), 368, 516-517, 649-650 don't validate month format. Malformed input could cause parsing failures or SQL injection (though Supabase parameterization should prevent it). Inconsistent validation across endpoints.
**Fix approach:**
- Create validateMonth(month) function
- Use in all endpoints that accept month parameter
- Return 400 Bad Request with clear error if invalid

## Guest DJ Entry in Availability Has No Rate

**Issue:** "Guest DJ" option appears in availability but has no rate defined
**Files:** `server.js` line 235 adds "Guest DJ" to all slots
**Impact:** When guest DJ is assigned and month is finalized, line 881 looks up rate for "Guest DJ" and finds undefined/0. Accounting report shows 0 cost for guest DJ hours, understating costs or confusing accountant.
**Current state:** Guest DJ is placeholder for unknown external DJs. No way to set their rate.
**Fix approach:**
- Add "Guest DJ" as special entry in dj_rates table with default rate (e.g., 0 or placeholder)
- Or exclude "Guest DJ" from finalization report and require manual entry
- Or provide UI to enter guest DJ rate at finalization time

## Slot Normalization Inconsistency

**Issue:** Slot normalization uses Unicode en-dash (–, U+2013) but normalization function also accepts hyphens and em-dashes
**Files:** `server.js` line 77: `normalizeSlot = s => s ? s.replace(/[-\u2013\u2014]/g, '\u2013') : s;`
**Impact:** Multiple formats normalize to same value, which is correct. However, "14:00-15:00", "14:00–15:00", and "14:00—15:00" all normalize to "14:00–15:00". Could cause cache hits/misses if client uses different format.
**Fix approach:**
- Document that canonical form is en-dash (U+2013)
- Validate all slot values at API boundaries to ensure consistency
- Consider using simpler format (e.g., "14:00-15:00" with hyphen) if possible

## No Graceful Shutdown or Cleanup

**Issue:** Server has no SIGTERM handler to gracefully shut down
**Files:** `server.js` line 941 starts server without shutdown handler
**Impact:** If deployed with rolling restarts or container orchestration, in-flight requests are aborted. Caches are lost. No final data flush.
**Fix approach:**
- Add SIGTERM handler: `process.on('SIGTERM', () => { server.close(...) })`
- Drain in-flight requests before closing
- Optionally flush cache entries that haven't been persisted (though cache is read-only)

## Race Condition in DJ Name Case Sensitivity

**Issue:** DJ lookups use ilike (case-insensitive) but data structure keys are case-sensitive
**Files:** `server.js` lines 317-318, 478, 502, 543, 554 use ilike for Supabase query, but lines 854, 880-881 use toLowerCase for map key
**Impact:** If DJ database has "Raffo DJ" but user submits "RAFFO DJ", ilike finds the record, but case-sensitive map lookup fails. Example: line 854 builds djMap with lowercase keys, line 880 looks up with .toLowerCase(). This is correct but fragile: if any code path misses .toLowerCase(), lookup fails silently.
**Fix approach:**
- Normalize DJ names to lowercase everywhere (database constraint + application code)
- Or use Map with custom comparator that does case-insensitive lookup
- Or at minimum, normalize DJ names at table row level before processing

## Silent Failure on Missing DJ Rate

**Issue:** If DJ in signoff log has no rate entry, finalization uses rate = 0
**Files:** `server.js` line 881: `const rate = info ? info.rate : 0;`
**Impact:** Report shows DJ with 0 rate (undershooting actual cost) or calculates cost as $0 regardless of hours worked. Accountant doesn't notice overpaying or underpaying. Silent data loss.
**Cause:** Casual DJs might not have dj_rates entry if added after DJ submits availability
**Fix approach:**
- Require all DJs to have rate before month can be finalized
- Add pre-finalization check: ensure every DJ with signoffs has a rate
- Return error if any DJ is missing rate, preventing finalization

## Batch Size Not Limited

**Issue:** Batch assign endpoint accepts unlimited number of assignments in single request
**Files:** `server.js` lines 414-432
**Impact:** Client could send batch with 10,000 assignments, causing server to insert 10,000 rows, consuming memory/CPU. DoS vector even with rate limiting (10 req/min is high for batch).
**Current mitigation:** Rate limiter allows 10 requests per 60s per IP, but doesn't limit batch size
**Fix approach:**
- Limit batch size to reasonable number (e.g., max 100 assignments per request)
- Return 400 Bad Request if batch exceeds limit
- Log warnings if batch approaches limit for capacity planning

## No Concurrency Limit on Finalization

**Issue:** Multiple admins can start finalization for same month simultaneously
**Files:** `server.js` lines 837-901
**Impact:** Two finalization requests both read signoffs, calculate reports, then write finalized_months. Last one wins, but report sent to first requester is based on incomplete data.
**Current mitigation:** None
**Fix approach:**
- Check finalized_months before starting finalization; if found, return early
- Or use database constraint to prevent duplicate (month) entry
- Or add atomic check-then-set operation

## Temporary Data Loss on Reset During Active Use

**Issue:** Reset-month deletes all data for that month without verifying no one is currently using it
**Files:** `server.js` lines 904-937
**Impact:** Admin hits reset while DJ is submitting availability. Reset deletes dj_availability rows. DJ's submission is lost. Or admin clears roster while another admin is assigning. Partial roster deleted while another is being built.
**Current mitigation:** None - reset is synchronous but doesn't lock other operations
**Fix approach:**
- Rename endpoints from /api/admin/reset-month to /api/admin/danger/reset-month to signal destructiveness
- Require confirmation: send reset request, get back list of what will be deleted, require second request with confirmation token
- Add "are you sure?" double-confirmation in frontend

---

*Concerns audit: 2026-03-13*
