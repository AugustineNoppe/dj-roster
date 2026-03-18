---
phase: 03-security
plan: 01
subsystem: auth
tags: [bcrypt, security, pin-hashing, account-lockout, credential-logging]

# Dependency graph
requires: []
provides:
  - bcrypt-based PIN verification in requireDJAuth, /api/dj/login, /api/dj/change-pin
  - in-memory account lockout after 5 consecutive failed login attempts (15-minute cooldown)
  - scrubbed credential values from all log lines in server.js
  - one-time migration script to hash existing plaintext PINs in dj_pins table
affects:
  - 03-security (subsequent plans depend on secure PIN storage being in place)

# Tech tracking
tech-stack:
  added: [bcrypt@5.x (native bindings, cost factor 10)]
  patterns:
    - bcrypt.compare for PIN verification (never string equality)
    - bcrypt.hash (cost 10) before any DB write of a PIN
    - in-memory Map for lockout tracking (keyed by lowercase DJ name)
    - idempotent migration script that skips already-hashed rows

key-files:
  created: [scripts/hash-existing-pins.js]
  modified: [server.js, package.json, package-lock.json]

key-decisions:
  - "Use bcrypt (not bcryptjs) — native bindings are faster for server use"
  - "Cost factor 10 — industry standard balance between security and latency"
  - "In-memory lockout Map — consistent with existing _rateCounts pattern; no DB write overhead"
  - "Migration script is idempotent — skips $2b$ and $2a$ prefixed hashes, safe to re-run"

patterns-established:
  - "PIN verification pattern: await bcrypt.compare(String(pin).trim(), storedHash)"
  - "PIN storage pattern: await bcrypt.hash(String(pin), 10) before upsert"
  - "Log scrubbing: never log credential values — log DJ name and boolean presence only"

requirements-completed: [SEC-01, SEC-03]

# Metrics
duration: 3min
completed: 2026-03-18
---

# Phase 3 Plan 01: Security — bcrypt PIN Hashing and Account Lockout Summary

**bcrypt PIN hashing across all three DJ auth paths (requireDJAuth, /api/dj/login, /api/dj/change-pin), in-memory 5-attempt lockout with 15-minute cooldown, credential-free logs, and idempotent migration script**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-18T07:38:03Z
- **Completed:** 2026-03-18T07:40:31Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- All three DJ PIN authentication paths now use bcrypt.compare instead of string equality
- New PINs stored as bcrypt hashes (cost factor 10) via bcrypt.hash before every upsert
- Account lockout activates after 5 consecutive failed attempts for the same DJ name, blocks for 15 minutes
- Line 372 credential leak (expected: correctPin, got: pin) removed — logs only DJ name on mismatch
- Migration script ready to hash all existing plaintext PINs in dj_pins table before server restart

## Task Commits

Each task was committed atomically:

1. **Task 1: Install bcrypt, add lockout tracking, hash PINs in all auth paths** - `57b5a2c` (feat)
2. **Task 2: Create one-time PIN migration script** - `9ca46ce` (feat)

## Files Created/Modified
- `server.js` - Added bcrypt require, _loginAttempts Map with lockout helpers, updated requireDJAuth/login/change-pin to use bcrypt.compare and bcrypt.hash, scrubbed all credential log output
- `package.json` - Added bcrypt dependency
- `package-lock.json` - Updated lockfile with bcrypt and its native bindings
- `scripts/hash-existing-pins.js` - One-time migration: hashes plaintext PINs, skips already-hashed rows, exits non-zero on any error

## Decisions Made
- Used bcrypt (not bcryptjs) — native bindings, faster for server workloads
- Cost factor 10 — industry standard; bcrypt.compare is async so it won't block event loop
- In-memory Map for lockout tracking — consistent with existing _rateCounts pattern, zero DB overhead
- Migration script is idempotent (skips $2b$/$2a$ prefixes) so it is safe to re-run if needed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**ACTION REQUIRED before restarting server.js in production:**

Run the migration script once to hash all existing plaintext PINs:

```bash
node scripts/hash-existing-pins.js
```

This must be run BEFORE the updated server.js goes live. If server.js uses bcrypt.compare but PINs are still plaintext, all DJ logins will fail. The script is idempotent and safe to re-run.

## Next Phase Readiness
- bcrypt PIN security is complete; Phase 3 Plan 02 can proceed
- Migration script must be executed in production before server restart
- No blockers for subsequent security plans

---
*Phase: 03-security*
*Completed: 2026-03-18*
