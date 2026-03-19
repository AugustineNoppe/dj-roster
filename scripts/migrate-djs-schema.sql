-- Run in Supabase Dashboard > SQL Editor > New query
-- Creates the djs table — the single source of truth for DJ data in v2.0.
-- This script is idempotent: CREATE TABLE IF NOT EXISTS means it is safe to re-run.
-- Do NOT run scripts/drop-legacy-tables.sql until Phase 7 success criteria are verified.

CREATE TABLE IF NOT EXISTS djs (
  id                     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text         UNIQUE NOT NULL,
  pin_hash               text         NOT NULL,
  rate                   integer      NOT NULL DEFAULT 0,
  type                   text         NOT NULL DEFAULT 'casual',
  active                 boolean      NOT NULL DEFAULT true,
  venues                 text[]       DEFAULT '{}',
  recurring_availability jsonb        DEFAULT '{}',
  fixed_schedules        jsonb        DEFAULT '{}',
  failed_attempts        integer      NOT NULL DEFAULT 0,
  locked_until           timestamptz,
  created_at             timestamptz  DEFAULT now()
);

-- Verify all 12 columns were created correctly
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'djs'
ORDER BY ordinal_position;
