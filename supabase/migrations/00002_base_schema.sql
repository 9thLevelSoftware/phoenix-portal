-- Base schema: Core tables synced from mobile app + portal-specific tables
-- These tables must exist before phase 10-13 migrations can run.
-- Data is populated by mobile app sync (workout_sessions, exercises, sets, etc.)
-- and by portal features (shared_routines, community_votes, etc.)

-- ============================================================
-- 1. profiles — extend existing table with portal columns
--    Existing table has: id (UUID PK), created_at, updated_at
--    Portal queries use user_id, so we add it as a generated column
-- ============================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_id UUID GENERATED ALWAYS AS (id) STORED;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS weight_unit TEXT NOT NULL DEFAULT 'kg';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_digests BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_notifications BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS streak_reminders BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS challenge_updates BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_visible BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS leaderboard_participation BOOLEAN NOT NULL DEFAULT true;

-- RLS policies may already exist; create only if missing
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can view own profile') THEN
    CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can update own profile') THEN
    CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
  END IF;
END $$;

-- ============================================================
-- 2. routines — user-created workout templates
-- ============================================================
CREATE TABLE IF NOT EXISTS routines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  exercise_count INT NOT NULL DEFAULT 0,
  estimated_duration INT NOT NULL DEFAULT 0,
  times_completed INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  tags TEXT[],
  is_favorite BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE routines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own routines"
  ON routines FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own routines"
  ON routines FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own routines"
  ON routines FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own routines"
  ON routines FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_routines_user_id ON routines(user_id);

-- ============================================================
-- 3. training_cycles — multi-week training programs
-- ============================================================
CREATE TABLE IF NOT EXISTS training_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  duration_weeks INT NOT NULL DEFAULT 4,
  current_week INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  workout_days INT NOT NULL DEFAULT 0,
  rest_days INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);

ALTER TABLE training_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own cycles"
  ON training_cycles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own cycles"
  ON training_cycles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own cycles"
  ON training_cycles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own cycles"
  ON training_cycles FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_training_cycles_user_id ON training_cycles(user_id);

-- ============================================================
-- 4. workout_sessions — core workout records
-- ============================================================
CREATE TABLE IF NOT EXISTS workout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_seconds INT NOT NULL DEFAULT 0,
  total_volume NUMERIC NOT NULL DEFAULT 0,
  set_count INT NOT NULL DEFAULT 0,
  exercise_count INT NOT NULL DEFAULT 0,
  pr_count INT NOT NULL DEFAULT 0,
  routine_name TEXT,
  workout_mode TEXT
);

ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sessions"
  ON workout_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own sessions"
  ON workout_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_id ON workout_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_started_at ON workout_sessions(user_id, started_at DESC);

-- ============================================================
-- 5. exercises — exercises within a workout session
-- ============================================================
CREATE TABLE IF NOT EXISTS exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  muscle_group TEXT NOT NULL DEFAULT 'General',
  order_index INT NOT NULL DEFAULT 0
);

ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view exercises in own sessions"
  ON exercises FOR SELECT
  USING (session_id IN (SELECT id FROM workout_sessions WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_exercises_session_id ON exercises(session_id);

-- ============================================================
-- 6. sets — individual sets within exercises
-- ============================================================
CREATE TABLE IF NOT EXISTS sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  set_number INT NOT NULL,
  target_reps INT,
  actual_reps INT NOT NULL DEFAULT 0,
  weight_kg NUMERIC NOT NULL DEFAULT 0,
  rpe NUMERIC,
  is_pr BOOLEAN NOT NULL DEFAULT false,
  notes TEXT
);

ALTER TABLE sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view sets in own sessions"
  ON sets FOR SELECT
  USING (exercise_id IN (
    SELECT e.id FROM exercises e
    JOIN workout_sessions ws ON e.session_id = ws.id
    WHERE ws.user_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS idx_sets_exercise_id ON sets(exercise_id);

-- ============================================================
-- 7. personal_records — PR achievements
-- ============================================================
CREATE TABLE IF NOT EXISTS personal_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  muscle_group TEXT NOT NULL DEFAULT 'General',
  record_type TEXT NOT NULL DEFAULT '1RM',
  value NUMERIC NOT NULL,
  unit TEXT NOT NULL DEFAULT 'kg',
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous_value NUMERIC
);

ALTER TABLE personal_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own records"
  ON personal_records FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_personal_records_user_id ON personal_records(user_id);

-- ============================================================
-- 8. rep_summaries — aggregated per-rep metrics (VBT, force, velocity)
-- ============================================================
CREATE TABLE IF NOT EXISTS rep_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id UUID NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  rep_number INT NOT NULL,
  mean_velocity_mps NUMERIC,
  peak_velocity_mps NUMERIC,
  mean_force_n NUMERIC,
  peak_force_n NUMERIC,
  power_watts NUMERIC,
  rom_mm NUMERIC,
  tut_ms INT,
  left_force_avg NUMERIC,
  right_force_avg NUMERIC,
  asymmetry_pct NUMERIC,
  vbt_zone TEXT
);

ALTER TABLE rep_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view rep summaries in own sessions"
  ON rep_summaries FOR SELECT
  USING (set_id IN (
    SELECT s.id FROM sets s
    JOIN exercises e ON s.exercise_id = e.id
    JOIN workout_sessions ws ON e.session_id = ws.id
    WHERE ws.user_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS idx_rep_summaries_set_id ON rep_summaries(set_id);

-- ============================================================
-- 9. rep_telemetry — raw telemetry points (force curves)
-- ============================================================
CREATE TABLE IF NOT EXISTS rep_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id UUID NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  timestamp_ms BIGINT NOT NULL,
  force_n NUMERIC,
  velocity_mps NUMERIC,
  position_mm NUMERIC,
  cable TEXT
);

ALTER TABLE rep_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view telemetry in own sessions"
  ON rep_telemetry FOR SELECT
  USING (set_id IN (
    SELECT s.id FROM sets s
    JOIN exercises e ON s.exercise_id = e.id
    JOIN workout_sessions ws ON e.session_id = ws.id
    WHERE ws.user_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS idx_rep_telemetry_set_id ON rep_telemetry(set_id);

-- Also create telemetry_points as an alias view (some queries use this name)
CREATE OR REPLACE VIEW telemetry_points AS SELECT * FROM rep_telemetry;

-- ============================================================
-- 10. shared_routines — publicly shared routines
-- ============================================================
CREATE TABLE IF NOT EXISTS shared_routines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  routine_id UUID NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  exercise_count INT NOT NULL DEFAULT 0,
  estimated_duration INT NOT NULL DEFAULT 0,
  exercises_snapshot JSONB,
  tags TEXT[] NOT NULL DEFAULT '{}',
  difficulty TEXT NOT NULL DEFAULT 'Intermediate',
  vote_count INT NOT NULL DEFAULT 0,
  save_count INT NOT NULL DEFAULT 0,
  hot_score NUMERIC NOT NULL DEFAULT 0,
  comment_count INT NOT NULL DEFAULT 0,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE shared_routines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view shared routines"
  ON shared_routines FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can share own routines"
  ON shared_routines FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own shared routines"
  ON shared_routines FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_shared_routines_user_id ON shared_routines(user_id);
CREATE INDEX IF NOT EXISTS idx_shared_routines_hot_score ON shared_routines(hot_score DESC);

-- ============================================================
-- 11. shared_cycles — publicly shared training cycles
-- ============================================================
CREATE TABLE IF NOT EXISTS shared_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cycle_id UUID NOT NULL REFERENCES training_cycles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration_weeks INT NOT NULL DEFAULT 4,
  tags TEXT[] NOT NULL DEFAULT '{}',
  difficulty TEXT NOT NULL DEFAULT 'Intermediate',
  vote_count INT NOT NULL DEFAULT 0,
  save_count INT NOT NULL DEFAULT 0,
  hot_score NUMERIC NOT NULL DEFAULT 0,
  comment_count INT NOT NULL DEFAULT 0,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE shared_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view shared cycles"
  ON shared_cycles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can share own cycles"
  ON shared_cycles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own shared cycles"
  ON shared_cycles FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_shared_cycles_user_id ON shared_cycles(user_id);

-- ============================================================
-- 12. community_votes — upvotes on shared content
-- ============================================================
CREATE TABLE IF NOT EXISTS community_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id UUID NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('routine', 'cycle')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, item_id, item_type)
);

ALTER TABLE community_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all votes"
  ON community_votes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert own votes"
  ON community_votes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own votes"
  ON community_votes FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_community_votes_item ON community_votes(item_id, item_type);

-- ============================================================
-- 13. saved_community_items — user bookmarks
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_community_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_item_id UUID NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('routine', 'cycle')),
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, shared_item_id, item_type)
);

ALTER TABLE saved_community_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own saved items"
  ON saved_community_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can save items"
  ON saved_community_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can unsave items"
  ON saved_community_items FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_saved_community_items_user ON saved_community_items(user_id);
