---
phase: 07-database-schema-migration
plan: 01
subsystem: database
tags: [supabase, postgres, jsonb, migration, sql]

# Dependency graph
requires: []
provides:
  - scripts/migrate-djs-schema.sql — CREATE TABLE djs DDL ready for Supabase SQL Editor
  - scripts/migrate-djs-data.js — Node.js data migration script with JSONB seeding
affects:
  - 08-server-code-migration
  - 09-api-routes
  - 10-admin-ui

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SQL migration files for schema changes (CREATE TABLE IF NOT EXISTS), run in Supabase SQL Editor"
    - "Node.js migration scripts: dotenv + startup guard + idempotency check + per-row logging + exit codes"
    - "JSONB seeding: pass raw JS object to Supabase client, never JSON.stringify (avoids double-encoding)"
    - "en-dash/hyphen deduplication: canonicalizeName() normalizes U+2013/U+2014 to hyphen for Map keying only"

key-files:
  created:
    - scripts/migrate-djs-schema.sql
    - scripts/migrate-djs-data.js
  modified: []

key-decisions:
  - "Idempotency via row count check: skip if djs already has rows; --force flag deletes and re-inserts"
  - "Keep first occurrence on duplicate name: logs both variants so operator can verify canonical spelling"
  - "type=resident for Alex RedWhite, Raffo DJ, Sound Bogie; type=casual for all others"
  - "Verification step includes cross-table check against dj_availability using ilike match"

patterns-established:
  - "Migration split: SQL file for schema (SQL Editor), Node.js file for data transforms"
  - "Startup guard pattern: check env vars at top of script, exit 1 immediately if missing"
  - "Error accumulation: collect errorCount throughout run, exit 1 at end if any errors"

requirements-completed: [DB-01, DB-02, DB-03]

# Metrics
duration: 10min
completed: 2026-03-19
---

# Phase 7 Plan 01: Database Schema Migration Summary

**SQL schema + Node.js migration script creating the djs table and seeding it from dj_rates, dj_pins, FIXED_AVAILABILITY (8 DJs), and FIXED_SCHEDULES (Davoted) with en-dash deduplication and JSONB seeding**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-19T08:03:07Z
- **Completed:** 2026-03-19T08:13:00Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments

- Created `scripts/migrate-djs-schema.sql` with all 12 DB-01 columns, idempotent, ends with information_schema verification query
- Created `scripts/migrate-djs-data.js` (340 lines) implementing the full 7-step migration: startup guard, idempotency, legacy reads, deduplication, insert, JSONB seeding, verification output
- Existing 49-test suite passes with zero regressions

## Task Commits

1. **Task 1: Create djs table schema SQL** - `c0cdf87` (feat)
2. **Task 2: Create data migration script** - `74478d0` (feat)

**Plan metadata:** `1062152` (docs: complete plan)

## Files Created/Modified

- `scripts/migrate-djs-schema.sql` — CREATE TABLE IF NOT EXISTS djs with all 12 columns; verification SELECT at end
- `scripts/migrate-djs-data.js` — Full migration script: reads dj_rates + dj_pins, deduplicates names, inserts into djs, seeds JSONB columns from FIXED_AVAILABILITY and FIXED_SCHEDULES constants

## Decisions Made

- Idempotency check uses row count; `--force` flag enables re-run by deleting all rows first
- Duplicate name handling keeps first occurrence and logs both variants for operator review
- JSONB seeding passes raw JS objects directly to Supabase client (never JSON.stringify per PITFALLS.md)
- Cross-table check in verification step uses `.ilike()` to tolerate case differences vs dj_availability rows

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**Scripts are ready to run but require Supabase credentials:**

1. Ensure `.env` has `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
2. Run `scripts/migrate-djs-schema.sql` in Supabase Dashboard > SQL Editor > New query
3. Run `node scripts/migrate-djs-data.js` to populate the table
4. After verifying output: run `scripts/drop-legacy-tables.sql` (DB-04, separate manual step)

## Next Phase Readiness

- `djs` table schema is ready to create in Supabase
- Migration script is ready to run against production database
- Phase 8 (server code migration) can proceed once migration is verified
- Blocker from STATE.md addressed: en-dash/hyphen deduplication is handled in script

---
*Phase: 07-database-schema-migration*
*Completed: 2026-03-19*

## Self-Check: PASSED

- scripts/migrate-djs-schema.sql: FOUND
- scripts/migrate-djs-data.js: FOUND
- .planning/phases/07-database-schema-migration/07-01-SUMMARY.md: FOUND
- Commit c0cdf87: FOUND
- Commit 74478d0: FOUND
