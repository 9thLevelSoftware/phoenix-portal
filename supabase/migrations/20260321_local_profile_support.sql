-- Local Profile Support
-- Adds local_profiles table and local_profile_id FK to profile-scoped data tables.
-- The mobile app supports multiple local profiles per device (e.g. household members
-- sharing one machine). This migration brings profile awareness to the database so
-- the portal can filter and display per-profile data.

-- ============================================================
-- 1. local_profiles — one row per local profile per user
--    Composite PK (user_id, id) allows the same profile ID
--    (e.g. "default") to exist for different users.
-- ============================================================
CREATE TABLE IF NOT EXISTS local_profiles (
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id         TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  color_index INTEGER   NOT NULL DEFAULT 0,
  device_id  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_local_profiles_user_id ON local_profiles(user_id);

ALTER TABLE local_profiles ENABLE ROW LEVEL SECURITY;

-- RLS: users can manage their own profiles
CREATE POLICY "Users can view own local profiles"
  ON local_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own local profiles"
  ON local_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own local profiles"
  ON local_profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own local profiles"
  ON local_profiles FOR DELETE
  USING (auth.uid() = user_id);

-- RLS: service_role bypasses RLS by default in Supabase,
-- but add an explicit full-access policy for clarity.
CREATE POLICY "Service role has full access to local profiles"
  ON local_profiles FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================
-- 2. Add nullable local_profile_id to profile-scoped tables
--    NULL = legacy data or user-global (backward compatible)
-- ============================================================
ALTER TABLE workout_sessions  ADD COLUMN IF NOT EXISTS local_profile_id TEXT;
ALTER TABLE routines          ADD COLUMN IF NOT EXISTS local_profile_id TEXT;
ALTER TABLE training_cycles   ADD COLUMN IF NOT EXISTS local_profile_id TEXT;
ALTER TABLE personal_records  ADD COLUMN IF NOT EXISTS local_profile_id TEXT;
ALTER TABLE exercise_progress ADD COLUMN IF NOT EXISTS local_profile_id TEXT;

-- ============================================================
-- 3. Composite FK constraints linking (user_id, local_profile_id)
--    to local_profiles(user_id, id).
--    NOT VALID skips validation of existing NULL rows.
--    ON DELETE SET NULL: when a profile is deleted, rows revert
--    to profile-unscoped (NULL) rather than being lost.
-- ============================================================
ALTER TABLE workout_sessions
  ADD CONSTRAINT fk_workout_sessions_profile
  FOREIGN KEY (user_id, local_profile_id)
  REFERENCES local_profiles(user_id, id)
  ON DELETE SET NULL
  NOT VALID;

ALTER TABLE routines
  ADD CONSTRAINT fk_routines_profile
  FOREIGN KEY (user_id, local_profile_id)
  REFERENCES local_profiles(user_id, id)
  ON DELETE SET NULL
  NOT VALID;

ALTER TABLE training_cycles
  ADD CONSTRAINT fk_training_cycles_profile
  FOREIGN KEY (user_id, local_profile_id)
  REFERENCES local_profiles(user_id, id)
  ON DELETE SET NULL
  NOT VALID;

ALTER TABLE personal_records
  ADD CONSTRAINT fk_personal_records_profile
  FOREIGN KEY (user_id, local_profile_id)
  REFERENCES local_profiles(user_id, id)
  ON DELETE SET NULL
  NOT VALID;

ALTER TABLE exercise_progress
  ADD CONSTRAINT fk_exercise_progress_profile
  FOREIGN KEY (user_id, local_profile_id)
  REFERENCES local_profiles(user_id, id)
  ON DELETE SET NULL
  NOT VALID;

-- ============================================================
-- 4. Indexes for profile-scoped queries
--    Supports WHERE user_id = ? AND local_profile_id = ? filters
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_workout_sessions_profile  ON workout_sessions(user_id, local_profile_id);
CREATE INDEX IF NOT EXISTS idx_routines_profile          ON routines(user_id, local_profile_id);
CREATE INDEX IF NOT EXISTS idx_training_cycles_profile   ON training_cycles(user_id, local_profile_id);
CREATE INDEX IF NOT EXISTS idx_personal_records_profile  ON personal_records(user_id, local_profile_id);
CREATE INDEX IF NOT EXISTS idx_exercise_progress_profile ON exercise_progress(user_id, local_profile_id);

-- ============================================================
-- Note: No cleanup trigger is needed for profile deletion.
-- The FK constraint with ON DELETE SET NULL automatically nulls
-- out local_profile_id in all referencing rows when a profile
-- is removed, reverting those rows to profile-unscoped state.
-- ============================================================
