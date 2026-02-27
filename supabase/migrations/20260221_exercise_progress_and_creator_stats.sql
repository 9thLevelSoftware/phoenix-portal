-- Migration: exercise_progress table + creator_stats view
-- Addresses two missing DB objects referenced by existing queries:
--   1. exercise_progress (src/queries/progress.ts)
--   2. creator_stats (src/queries/community.ts)

-- ============================================================
-- 1. exercise_progress — per-exercise progress snapshots
--    Populated after each workout (via mobile sync or trigger).
--    Queries: exerciseProgressOptions, weeklySummaryOptions
-- ============================================================
CREATE TABLE IF NOT EXISTS exercise_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  max_weight_kg NUMERIC NOT NULL DEFAULT 0,
  total_volume_kg NUMERIC NOT NULL DEFAULT 0,
  estimated_1rm_kg NUMERIC NOT NULL DEFAULT 0,
  max_reps INT NOT NULL DEFAULT 0,
  set_count INT NOT NULL DEFAULT 0
);

ALTER TABLE exercise_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own exercise progress"
  ON exercise_progress FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own exercise progress"
  ON exercise_progress FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_exercise_progress_user_id
  ON exercise_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_exercise_progress_user_exercise
  ON exercise_progress(user_id, exercise_name);
CREATE INDEX IF NOT EXISTS idx_exercise_progress_recorded_at
  ON exercise_progress(user_id, recorded_at DESC);

-- ============================================================
-- 2. creator_stats — aggregated community creator statistics
--    Combines shared_routines + shared_cycles with profile data.
--    Queries: creatorStatsOptions, featuredCreatorsOptions
-- ============================================================
CREATE OR REPLACE VIEW creator_stats AS
SELECT
  p.id AS user_id,
  p.display_name,
  p.avatar_url,
  COALESCE(r.routine_count, 0) + COALESCE(c.cycle_count, 0) AS total_shares,
  COALESCE(r.routine_votes, 0) + COALESCE(c.cycle_votes, 0) AS total_upvotes,
  COALESCE(r.featured_routines, 0) + COALESCE(c.featured_cycles, 0) AS featured_count
FROM profiles p
LEFT JOIN (
  SELECT
    user_id,
    COUNT(*) AS routine_count,
    COALESCE(SUM(vote_count), 0) AS routine_votes,
    COUNT(*) FILTER (WHERE vote_count >= 10) AS featured_routines
  FROM shared_routines
  GROUP BY user_id
) r ON r.user_id = p.id
LEFT JOIN (
  SELECT
    user_id,
    COUNT(*) AS cycle_count,
    COALESCE(SUM(vote_count), 0) AS cycle_votes,
    COUNT(*) FILTER (WHERE vote_count >= 10) AS featured_cycles
  FROM shared_cycles
  GROUP BY user_id
) c ON c.user_id = p.id
WHERE COALESCE(r.routine_count, 0) + COALESCE(c.cycle_count, 0) > 0;
