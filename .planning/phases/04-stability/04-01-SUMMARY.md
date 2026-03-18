---
phase: 04-stability
plan: 01
subsystem: infra
tags: [helmet, express-rate-limit, security, memory-leak, middleware]

# Dependency graph
requires:
  - phase: 03-security
    provides: account lockout (_loginAttempts Map) that must be preserved during rate limiter replacement
provides:
  - helmet() security headers replacing custom manual res.setHeader() middleware
  - express-rate-limit loginLimiter replacing custom _rateCounts Map sliding-window implementation
  - memory leak elimination — _rateCounts Map no longer grows unboundedly under sustained load
affects: [05-testing]

# Tech tracking
tech-stack:
  added:
    - helmet (was in package.json but unused — now active)
    - express-rate-limit (was in package.json but unused — now active)
  patterns:
    - Route-level rate limiting middleware applied per-endpoint rather than globally
    - helmet() called with explicit CSP/HSTS/frameguard config matching prior custom headers

key-files:
  created: []
  modified:
    - server.js

key-decisions:
  - "Use helmet() with explicit directives to match existing CSP (unsafe-inline preserved for script/style)"
  - "Named loginLimiter (not a global limiter) to make it clear rate limiting is login-only"
  - "Preserve _loginAttempts Map, checkLockout, recordFailedAttempt, clearFailedAttempts — Phase 3 account lockout is a separate concern from IP-based rate limiting"

patterns-established:
  - "Battle-tested library preferred over custom middleware for security primitives"
  - "express-rate-limit keyGenerator explicitly set to match original IP extraction logic"

requirements-completed: [STAB-01, STAB-03]

# Metrics
duration: 8min
completed: 2026-03-18
---

# Phase 4 Plan 01: Security Middleware Replacement Summary

**helmet() and express-rate-limit replace custom security header middleware and leaky _rateCounts Map sliding-window rate limiter**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-18T07:59:30Z
- **Completed:** 2026-03-18T08:07:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Replaced 11-line custom security headers middleware with helmet() call using equivalent CSP, HSTS, frameguard, referrer-policy, and permissions-policy configuration
- Eliminated unbounded _rateCounts Map memory leak — express-rate-limit's built-in MemoryStore auto-prunes expired window entries
- Updated both login routes (/api/auth and /api/dj/login) to use loginLimiter with identical 10 req/IP/60s behavior
- Preserved Phase 3 account lockout system (_loginAttempts, checkLockout, recordFailedAttempt, clearFailedAttempts) untouched

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace custom security headers with helmet** - `d5fc6eb` (feat)
2. **Task 2: Replace custom rate limiter with express-rate-limit** - `b38a398` (feat)

## Files Created/Modified
- `server.js` - helmet() and loginLimiter replace custom implementations; _rateCounts, RATE_WINDOW_MS, RATE_MAX, rateLimiter() removed

## Decisions Made
- Kept `unsafe-inline` in script-src and style-src CSP directives to match existing policy — app uses inline scripts/styles in static HTML files; tightening CSP is a Phase 5 concern
- Named the rate-limit instance `loginLimiter` (not `rateLimiter`) to make clear it's login-specific, not a global limiter
- Used helmet's explicit directives object rather than defaults to ensure parity with the prior custom header set

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- Memory leak from _rateCounts eliminated — server can sustain traffic load without heap growth from this source
- Security header coverage improved (helmet adds X-Permitted-Cross-Domain-Policies, X-DNS-Prefetch-Control, Cross-Origin-* headers beyond what the custom middleware set)
- Phase 5 (testing) can now test login endpoints with rate limiting in place

---
*Phase: 04-stability*
*Completed: 2026-03-18*
