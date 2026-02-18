-- Phase 11: New Features — Goal Setting & Tracking
-- Creates user_goals table with RLS, goal limit trigger, and indexes

-- ============================================================
-- 1. user_goals
-- ============================================================
CREATE TABLE IF NOT EXISTS user_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_type TEXT NOT NULL CHECK (goal_type IN ('frequency', 'volume', 'pr')),
  target_value NUMERIC NOT NULL,
  target_unit TEXT NOT NULL,
  exercise_name TEXT,
  deadline TIMESTAMPTZ,
  period TEXT NOT NULL DEFAULT 'weekly' CHECK (period IN ('weekly', 'monthly')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_goals ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own goals"
  ON user_goals FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Premium users can create goals"
  ON user_goals FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own goals"
  ON user_goals FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own goals"
  ON user_goals FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================
-- 2. Goal limit enforcement trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_goal_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  active_count INT;
  max_goals INT;
  tier TEXT;
BEGIN
  tier := public.user_subscription_tier();
  IF tier = 'FREE' THEN max_goals := 1;
  ELSE max_goals := 3;
  END IF;
  SELECT COUNT(*) INTO active_count FROM user_goals
    WHERE user_id = NEW.user_id AND status = 'active';
  IF active_count >= max_goals THEN
    RAISE EXCEPTION 'Goal limit reached for your subscription tier'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER enforce_goal_limit BEFORE INSERT ON user_goals
  FOR EACH ROW EXECUTE FUNCTION public.check_goal_limit();

-- ============================================================
-- 3. Indexes
-- ============================================================
CREATE INDEX idx_goals_user_status ON user_goals(user_id, status);
