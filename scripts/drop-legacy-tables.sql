-- =============================================================================
-- DROP LEGACY TABLES — MANUAL STEP
-- =============================================================================
--
-- WARNING: This script is IRREVERSIBLE. Run it ONLY after verifying ALL 5
-- Phase 7 success criteria listed below. Do NOT run this script automatically
-- or call it from any other script.
--
-- HOW TO RUN:
--   Open Supabase Dashboard > SQL Editor > New query
--   Paste this file's contents and execute manually.
--
-- =============================================================================
-- PRE-FLIGHT CHECKLIST — ALL 5 MUST PASS BEFORE RUNNING DROP STATEMENTS
-- =============================================================================
--
--   [ ] 1. SELECT COUNT(*) FROM djs returns expected DJ count with no duplicates
--
--   [ ] 2. Every DJ can log in with their existing PIN after migration
--          (test at least 2 DJs via the app)
--
--   [ ] 3. Availability reads return same results as before migration
--
--   [ ] 4. djs.recurring_availability contains correct FIXED_AVAILABILITY data
--          Verify: SELECT name, recurring_availability FROM djs WHERE name = 'Mostyx';
--          Expected: JSON object with day-of-week keys
--
--   [ ] 5. djs.fixed_schedules contains correct FIXED_SCHEDULES data
--          Verify: SELECT name, fixed_schedules FROM djs WHERE name = 'Davoted';
--          Expected: JSON object with arkbar and loveBeach keys
--
-- =============================================================================
-- DO NOT PROCEED UNTIL ALL BOXES ABOVE ARE CHECKED
-- =============================================================================

-- Drop legacy tables
DROP TABLE IF EXISTS dj_rates;
DROP TABLE IF EXISTS dj_pins;

-- =============================================================================
-- VERIFICATION — Should return 0 rows if drop was successful
-- =============================================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('dj_rates', 'dj_pins');
-- Expected result: 0 rows returned
