-- Phase 10: Wire-up & Mock Purge — Builder persistence tables
-- Creates routine_exercises, cycle_days, challenges, challenge_participants
-- Adds columns to training_cycles for progression/deload settings

-- ============================================================
-- 1. routine_exercises
-- ============================================================
CREATE TABLE IF NOT EXISTS routine_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id UUID NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  muscle_group TEXT NOT NULL DEFAULT 'General',
  sets INT NOT NULL DEFAULT 3,
  reps INT NOT NULL DEFAULT 10,
  weight NUMERIC NOT NULL DEFAULT 0,
  rest_seconds INT NOT NULL DEFAULT 90,
  mode TEXT NOT NULL DEFAULT 'Old School',
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE routine_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage exercises in own routines"
  ON routine_exercises FOR ALL
  USING (routine_id IN (SELECT id FROM routines WHERE user_id = auth.uid()))
  WITH CHECK (routine_id IN (SELECT id FROM routines WHERE user_id = auth.uid()));

-- ============================================================
-- 2. training_cycles — add columns
-- ============================================================
ALTER TABLE training_cycles ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE training_cycles ADD COLUMN IF NOT EXISTS progression_settings JSONB;
ALTER TABLE training_cycles ADD COLUMN IF NOT EXISTS deload_settings JSONB;

-- ============================================================
-- 3. cycle_days
-- ============================================================
CREATE TABLE IF NOT EXISTS cycle_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES training_cycles(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  day_type TEXT NOT NULL DEFAULT 'workout',
  routine_id UUID REFERENCES routines(id) ON DELETE SET NULL,
  weight_adjustment NUMERIC NOT NULL DEFAULT 0,
  rep_modifier INT NOT NULL DEFAULT 0,
  rest_override INT,
  notes TEXT,
  rest_type TEXT,
  UNIQUE(cycle_id, day_number)
);

ALTER TABLE cycle_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage days in own cycles"
  ON cycle_days FOR ALL
  USING (cycle_id IN (SELECT id FROM training_cycles WHERE user_id = auth.uid()))
  WITH CHECK (cycle_id IN (SELECT id FROM training_cycles WHERE user_id = auth.uid()));

-- ============================================================
-- 4. challenges
-- ============================================================
CREATE TABLE IF NOT EXISTS challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  challenge_type TEXT NOT NULL CHECK (challenge_type IN ('volume', 'frequency', 'streak', 'pr_count')),
  target_value NUMERIC NOT NULL,
  target_unit TEXT,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  prize TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view challenges"
  ON challenges FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- 5. challenge_participants
-- ============================================================
CREATE TABLE IF NOT EXISTS challenge_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(challenge_id, user_id)
);

ALTER TABLE challenge_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own participation"
  ON challenge_participants FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can join challenges"
  ON challenge_participants FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 6. Seed data — curated challenges
-- ============================================================
INSERT INTO challenges (name, description, challenge_type, target_value, target_unit, start_date, end_date, difficulty, prize) VALUES
  ('30-Day Volume Challenge', 'Accumulate 50,000 kg of total training volume in 30 days. Every rep counts!', 'volume', 50000, 'kg', now(), now() + INTERVAL '30 days', 'medium', 'Volume King Badge'),
  ('Workout Warrior', 'Complete 20 workouts in 30 days. Consistency is key!', 'frequency', 20, 'workouts', now(), now() + INTERVAL '30 days', 'medium', 'Warrior Badge'),
  ('Streak Master', 'Train for 14 consecutive days without missing a single day.', 'streak', 14, 'days', now(), now() + INTERVAL '30 days', 'hard', 'Streak Master Badge'),
  ('PR Hunter', 'Hit 5 personal records in any exercise within 30 days.', 'pr_count', 5, 'PRs', now(), now() + INTERVAL '30 days', 'hard', 'PR Hunter Badge'),
  ('Iron Month', 'Complete 25 workouts in a single month. Can you go the distance?', 'frequency', 25, 'workouts', now(), now() + INTERVAL '30 days', 'hard', 'Iron Month Badge'),
  ('Beast Mode', 'Accumulate 100,000 kg of total volume in 60 days. Only the dedicated survive.', 'volume', 100000, 'kg', now(), now() + INTERVAL '60 days', 'extreme', 'Beast Mode Badge');
