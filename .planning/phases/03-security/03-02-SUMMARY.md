---
phase: 03-security
plan: 02
subsystem: auth
tags: [bcrypt, security, timing-safe, password-hashing, admin, manager]

# Dependency graph
requires:
  - phase: 03-security plan 01
    provides: bcrypt already installed and required in server.js
provides:
  - bcrypt.compare for all admin password checks in server.js (/api/auth, requireAdmin, inline checks)
  - bcrypt.compare for all manager password checks in server.js (signoff, signoff-batch, unsignoff-day)
  - timing-safe dual admin/manager check in /api/djs/update
  - hash-password.js utility for generating bcrypt hashes for env vars
affects: [deployment, env-vars, admin-auth, manager-auth]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "All password comparisons use async bcrypt.compare (never string equality)"
    - "Env vars ADMIN_PASSWORD and MANAGER_PASSWORD must contain bcrypt hashes, not plaintext"
    - "Dual auth checks use .catch(() => false) for safe error handling"

key-files:
  created:
    - scripts/hash-password.js
  modified:
    - server.js

key-decisions:
  - "Env vars store bcrypt hashes instead of plaintext — timing-safe and avoids plaintext secrets in environment"
  - "Inline admin checks in GET routes wrap bcrypt.compare with .catch(() => false) for safety"
  - "requireAdmin made async to support await bcrypt.compare"

patterns-established:
  - "Async bcrypt.compare pattern: !password || !(await bcrypt.compare(password, hash))"
  - "Dual-check pattern: const isAdmin = password ? await bcrypt.compare(...).catch(() => false) : false"

requirements-completed: [SEC-02]

# Metrics
duration: 8min
completed: 2026-03-18
---

# Phase 3 Plan 02: Bcrypt Password Comparison for Admin and Manager Summary

**All 9 admin/manager string equality password checks replaced with timing-safe async bcrypt.compare; env vars now expect bcrypt hashes stored via new hash-password.js utility**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-18T08:00:00Z
- **Completed:** 2026-03-18T08:08:00Z
- **Tasks:** 2
- **Files modified:** 2 (server.js, scripts/hash-password.js)

## Accomplishments
- Eliminated all 9 string equality password comparisons in server.js (zero `===`/`!==` against ADMIN_PASSWORD or MANAGER_PASSWORD remain)
- Converted /api/auth and requireAdmin to async functions using bcrypt.compare
- Updated 4 inline admin password checks (submissions, signoffs) and 3 manager password checks (signoff, signoff-batch, unsignoff-day)
- Converted dual admin/manager check in /api/djs/update to parallel bcrypt.compare with .catch(() => false) safety
- Added hash-password.js utility for users to generate bcrypt hashes for .env

## Task Commits

Each task was committed atomically:

1. **Task 1: Convert all admin and manager password checks to async bcrypt.compare** - `8c87689` (feat)
2. **Task 2: Add env var hash generation helper script** - `c6f8dbe` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `server.js` - All 9 password comparison points converted from `===` to `await bcrypt.compare()`; requireAdmin and /api/auth made async; comment block added documenting bcrypt hash requirement
- `scripts/hash-password.js` - Utility to generate bcrypt hashes for ADMIN_PASSWORD/MANAGER_PASSWORD env vars

## Decisions Made
- Env vars must now store bcrypt hashes (not plaintext) — this is a deployment change requiring the user to regenerate .env values
- Inline GET route checks wrap bcrypt.compare with .catch(() => false) rather than try/catch blocks for conciseness
- Dual admin/manager check uses separate isAdmin/isManager variables for clarity

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

**IMPORTANT: Before deploying, update your .env file.** The ADMIN_PASSWORD and MANAGER_PASSWORD env vars must now contain bcrypt hashes, not plaintext passwords.

To generate hashes:
```
node scripts/hash-password.js "your-admin-password"
node scripts/hash-password.js "your-manager-password"
```

Paste the output into your .env file as the values for ADMIN_PASSWORD and MANAGER_PASSWORD.

## Next Phase Readiness
- SEC-02 complete: all admin/manager password comparisons are timing-safe
- Remaining blocker from STATE.md resolved: passwords no longer stored as plaintext in environment
- Ready for Phase 3 Plan 03 (if any) or Phase 4

---
*Phase: 03-security*
*Completed: 2026-03-18*
