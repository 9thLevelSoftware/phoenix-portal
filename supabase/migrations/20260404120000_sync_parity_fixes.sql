-- =============================================================================
-- Sync Parity Fixes (2026-04-04)
--
-- Fixes:
--   1. session_phase_statistics: add UNIQUE(session_id) so upsert onConflict works
--   2. personal_records: add updated_at column, auto-update trigger, delta sync index
--   3. routines / training_cycles: add missing delta sync indexes
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. session_phase_statistics — UNIQUE constraint on session_id
--    The push Edge Function does .upsert(rows, { onConflict: 'session_id' }).
--    Without this constraint, PostgreSQL rejects the upsert entirely.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_phase_statistics_session_id_key'
  ) THEN
    ALTER TABLE session_phase_statistics
      ADD CONSTRAINT session_phase_statistics_session_id_key UNIQUE (session_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. personal_records — add updated_at for delta sync
--    The pull Edge Function queries .gt('updated_at', lastSyncISO).
--    Column may already exist in live DB (added manually) so use IF NOT EXISTS.
-- ---------------------------------------------------------------------------
ALTER TABLE personal_records
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill: use achieved_at as initial updated_at for existing rows
UPDATE personal_records
  SET updated_at = COALESCE(achieved_at, now())
  WHERE updated_at = now();  -- Only rows that just got the default

-- Auto-update trigger (reuses existing function from fix_sync_delta_columns)
DROP TRIGGER IF EXISTS personal_records_updated_at ON personal_records;
CREATE TRIGGER personal_records_updated_at
  BEFORE UPDATE ON personal_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Delta sync index
CREATE INDEX IF NOT EXISTS idx_personal_records_updated_at
  ON personal_records(user_id, updated_at DESC);

-- Insert RLS policy (if missing — needed for push Edge Function inserts)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'personal_records'
      AND policyname = 'Users can insert own records'
  ) THEN
    CREATE POLICY "Users can insert own records"
      ON personal_records FOR INSERT
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Missing delta sync indexes for routines and training_cycles
--    Pull queries filter on (user_id, updated_at) but only have user_id indexes.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_routines_updated_at
  ON routines(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_training_cycles_updated_at
  ON training_cycles(user_id, updated_at DESC);
