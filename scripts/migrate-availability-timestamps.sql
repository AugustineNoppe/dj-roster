-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query)
-- Adds created_at and updated_at timestamps to dj_availability

-- Step 1: Add columns
ALTER TABLE dj_availability
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Step 2: Create trigger function to auto-update updated_at on every upsert
CREATE OR REPLACE FUNCTION update_dj_availability_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Attach trigger (drop first if exists to avoid duplicates)
DROP TRIGGER IF EXISTS trg_dj_availability_updated_at ON dj_availability;
CREATE TRIGGER trg_dj_availability_updated_at
  BEFORE INSERT OR UPDATE ON dj_availability
  FOR EACH ROW
  EXECUTE FUNCTION update_dj_availability_updated_at();

-- Step 4: Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'dj_availability'
ORDER BY ordinal_position;
