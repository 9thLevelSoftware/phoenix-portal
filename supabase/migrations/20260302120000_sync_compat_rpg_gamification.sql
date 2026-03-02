-- Migration: RPG attribute system + gamification stats
-- Adds tables for the mobile app's RPG progression system, earned badges,
-- and aggregated gamification statistics.

-- ============================================================
-- 1. rpg_attributes — per-user RPG character progression
-- ============================================================
CREATE TABLE IF NOT EXISTS rpg_attributes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strength INT NOT NULL DEFAULT 0,
  power INT NOT NULL DEFAULT 0,
  stamina INT NOT NULL DEFAULT 0,
  consistency INT NOT NULL DEFAULT 0,
  mastery INT NOT NULL DEFAULT 0,
  character_class TEXT,
  level INT NOT NULL DEFAULT 1,
  experience_points INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rpg_attributes_user_id_unique UNIQUE (user_id)
);

ALTER TABLE rpg_attributes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own RPG attributes" ON rpg_attributes;
CREATE POLICY "Users can view own RPG attributes"
  ON rpg_attributes FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own RPG attributes" ON rpg_attributes;
CREATE POLICY "Users can insert own RPG attributes"
  ON rpg_attributes FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own RPG attributes" ON rpg_attributes;
CREATE POLICY "Users can update own RPG attributes"
  ON rpg_attributes FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_rpg_attributes_user_id ON rpg_attributes(user_id);

-- ============================================================
-- 2. earned_badges — badge achievements per user
-- ============================================================
CREATE TABLE IF NOT EXISTS earned_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_id TEXT NOT NULL,
  badge_name TEXT NOT NULL,
  badge_description TEXT,
  badge_tier TEXT DEFAULT 'bronze',
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, badge_id)
);

ALTER TABLE earned_badges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own badges" ON earned_badges;
CREATE POLICY "Users can view own badges"
  ON earned_badges FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own badges" ON earned_badges;
CREATE POLICY "Users can insert own badges"
  ON earned_badges FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own badges" ON earned_badges;
CREATE POLICY "Users can delete own badges"
  ON earned_badges FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_earned_badges_user_id ON earned_badges(user_id);

-- ============================================================
-- 3. gamification_stats — aggregated workout statistics
-- ============================================================
CREATE TABLE IF NOT EXISTS gamification_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total_workouts INT NOT NULL DEFAULT 0,
  total_reps INT NOT NULL DEFAULT 0,
  total_volume_kg NUMERIC NOT NULL DEFAULT 0,
  longest_streak INT NOT NULL DEFAULT 0,
  current_streak INT NOT NULL DEFAULT 0,
  total_time_seconds INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gamification_stats_user_id_unique UNIQUE (user_id)
);

ALTER TABLE gamification_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gamification stats" ON gamification_stats;
CREATE POLICY "Users can view own gamification stats"
  ON gamification_stats FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own gamification stats" ON gamification_stats;
CREATE POLICY "Users can insert own gamification stats"
  ON gamification_stats FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own gamification stats" ON gamification_stats;
CREATE POLICY "Users can update own gamification stats"
  ON gamification_stats FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_gamification_stats_user_id ON gamification_stats(user_id);
