# Deferred Items — Phase 08

## Out-of-scope references discovered during 08-01 execution

### dj_rates reference in DJ rename endpoint (lines 1142-1146)

**Endpoint:** POST /api/admin/dj-name (or similar DJ rate upsert admin route)
**Lines:** ~1142-1146 in server.js
**Issue:** Admin endpoint that renames/updates DJ rate still writes to `dj_rates` table via `.upsert()`.
**Why deferred:** This endpoint migration is out of scope for Plan 01, which only covers fetchDJs(), requireDJAuth(), /api/dj/login, and lockout functions. Plan 02 (endpoint migrations) should address this.
**Action required in Plan 02:** Migrate this upsert to update the `djs` table instead of `dj_rates`.
