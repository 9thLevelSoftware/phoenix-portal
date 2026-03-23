-- Fix sync delta columns
-- The parity migration (20260319120000) referenced a non-existent created_at
-- column on routines and training_cycles, causing the entire migration to roll
-- back.  This re-applies the necessary schema changes with correct backfills
-- and adds the missing updated_at to workout_sessions for proper delta sync.

-- =============================================================================
-- 1. GAPs 3-6: Session enrichment columns on workout_sessions
--    (Originally in 20260319120000, rolled back due to backfill bug)
-- =============================================================================
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS avg_velocity_mps REAL;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS avg_asymmetry_pct REAL;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS velocity_loss_pct REAL;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS dominant_side TEXT;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS strength_profile TEXT;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS form_score INTEGER;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS deload_warnings INTEGER;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS rom_violations INTEGER;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS spotter_activations INTEGER;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS peak_force_n REAL;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS estimated_calories REAL;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS heaviest_lift_kg REAL;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS eccentric_load INTEGER;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS echo_level INTEGER;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS warmup_reps INTEGER;
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS working_reps INTEGER;

-- =============================================================================
-- 2. GAP 2: workout_phase on personal_records
-- =============================================================================
ALTER TABLE personal_records ADD COLUMN IF NOT EXISTS workout_phase TEXT DEFAULT 'COMBINED';
UPDATE personal_records SET workout_phase = 'COMBINED' WHERE workout_phase IS NULL;

-- =============================================================================
-- 3. Delta-sync updated_at columns (GAP 11 + workout_sessions)
--    Backfills use started_at or now() — NOT the non-existent created_at
-- =============================================================================
ALTER TABLE routines ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE training_cycles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Backfill NULLs with the best available timestamp (never reference created_at)
UPDATE routines SET updated_at = COALESCE(last_used_at, now()) WHERE updated_at IS NULL;
UPDATE training_cycles SET updated_at = COALESCE(started_at, now()) WHERE updated_at IS NULL;
UPDATE workout_sessions SET updated_at = COALESCE(started_at, now()) WHERE updated_at IS NULL;

-- =============================================================================
-- 4. Auto-update triggers
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS routines_updated_at ON routines;
CREATE TRIGGER routines_updated_at
  BEFORE UPDATE ON routines
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS cycles_updated_at ON training_cycles;
CREATE TRIGGER cycles_updated_at
  BEFORE UPDATE ON training_cycles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS sessions_updated_at ON workout_sessions;
CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON workout_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 5. GAP 1: RLS INSERT policy for rep_telemetry
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'rep_telemetry' AND policyname = 'Service role can insert rep_telemetry'
  ) THEN
    CREATE POLICY "Service role can insert rep_telemetry"
      ON rep_telemetry FOR INSERT
      TO service_role
      WITH CHECK (true);
  END IF;
END $$;

-- =============================================================================
-- 6. GAP 7: Phase statistics table
-- =============================================================================
CREATE TABLE IF NOT EXISTS session_phase_statistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  concentric_kg_avg REAL DEFAULT 0,
  concentric_kg_max REAL DEFAULT 0,
  concentric_vel_avg REAL DEFAULT 0,
  concentric_vel_max REAL DEFAULT 0,
  concentric_watt_avg REAL DEFAULT 0,
  concentric_watt_max REAL DEFAULT 0,
  eccentric_kg_avg REAL DEFAULT 0,
  eccentric_kg_max REAL DEFAULT 0,
  eccentric_vel_avg REAL DEFAULT 0,
  eccentric_vel_max REAL DEFAULT 0,
  eccentric_watt_avg REAL DEFAULT 0,
  eccentric_watt_max REAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE session_phase_statistics ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'session_phase_statistics' AND policyname = 'Users can view own phase statistics'
  ) THEN
    CREATE POLICY "Users can view own phase statistics"
      ON session_phase_statistics FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'session_phase_statistics' AND policyname = 'Service role can insert phase statistics'
  ) THEN
    CREATE POLICY "Service role can insert phase statistics"
      ON session_phase_statistics FOR INSERT
      TO service_role
      WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_phase_stats_session_id ON session_phase_statistics(session_id);
CREATE INDEX IF NOT EXISTS idx_phase_stats_user_id ON session_phase_statistics(user_id);

-- =============================================================================
-- 7. GAP 8: Exercise signatures table
-- =============================================================================
CREATE TABLE IF NOT EXISTS exercise_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL,
  rom_mm REAL DEFAULT 0,
  duration_ms BIGINT DEFAULT 0,
  symmetry_ratio REAL DEFAULT 0.5,
  velocity_profile TEXT DEFAULT 'LINEAR',
  cable_config TEXT DEFAULT 'DUAL_SYMMETRIC',
  sample_count INTEGER DEFAULT 1,
  confidence REAL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, exercise_id)
);

ALTER TABLE exercise_signatures ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'exercise_signatures' AND policyname = 'Users can view own exercise signatures'
  ) THEN
    CREATE POLICY "Users can view own exercise signatures"
      ON exercise_signatures FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'exercise_signatures' AND policyname = 'Service role can manage exercise signatures'
  ) THEN
    CREATE POLICY "Service role can manage exercise signatures"
      ON exercise_signatures FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_exercise_sig_user ON exercise_signatures(user_id);

-- =============================================================================
-- 8. GAP 9: VBT assessment results table
-- =============================================================================
CREATE TABLE IF NOT EXISTS vbt_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL,
  estimated_1rm_kg REAL NOT NULL,
  load_velocity_data JSONB,
  assessment_session_id TEXT,
  user_override_kg REAL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE vbt_assessments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'vbt_assessments' AND policyname = 'Users can view own VBT assessments'
  ) THEN
    CREATE POLICY "Users can view own VBT assessments"
      ON vbt_assessments FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'vbt_assessments' AND policyname = 'Service role can insert VBT assessments'
  ) THEN
    CREATE POLICY "Service role can insert VBT assessments"
      ON vbt_assessments FOR INSERT
      TO service_role
      WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vbt_user ON vbt_assessments(user_id);
CREATE INDEX IF NOT EXISTS idx_vbt_exercise ON vbt_assessments(exercise_id);

-- =============================================================================
-- 9. Performance index for session delta sync
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_workout_sessions_updated_at
  ON workout_sessions(user_id, updated_at DESC);
