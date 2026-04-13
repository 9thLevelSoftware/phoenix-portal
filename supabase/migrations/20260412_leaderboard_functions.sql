-- Migration: Leaderboard Functions and Events Table
-- Description: Adds RPC functions for leaderboard rankings and special events table

-- =============================================================================
-- 1. PR Count Rankings Function
-- Returns users ranked by their total personal record count
-- =============================================================================

CREATE OR REPLACE FUNCTION get_pr_count_rankings(result_limit int DEFAULT 100)
RETURNS TABLE (
  user_id uuid,
  pr_count bigint,
  rank bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH pr_counts AS (
    SELECT
      pr.user_id,
      COUNT(*) AS pr_count
    FROM personal_records pr
    INNER JOIN profiles p ON p.user_id = pr.user_id
    WHERE p.leaderboard_participation = true
    GROUP BY pr.user_id
  )
  SELECT
    pc.user_id,
    pc.pr_count,
    RANK() OVER (ORDER BY pc.pr_count DESC) AS rank
  FROM pr_counts pc
  ORDER BY pc.pr_count DESC
  LIMIT result_limit;
$$;

COMMENT ON FUNCTION get_pr_count_rankings IS 'Returns users ranked by their total personal record count, filtered by leaderboard participation.';

-- =============================================================================
-- 2. Exercise Mastery Rankings Function
-- Returns users ranked by number of exercises with 10+ sessions (mastered)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_exercise_mastery_rankings(result_limit int DEFAULT 100)
RETURNS TABLE (
  user_id uuid,
  mastered_count bigint,
  rank bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH exercise_session_counts AS (
    -- Count distinct sessions per exercise per user
    SELECT
      e.user_id,
      e.name,
      COUNT(DISTINCT e.session_id) AS session_count
    FROM exercises e
    INNER JOIN profiles p ON p.user_id = e.user_id
    WHERE p.leaderboard_participation = true
    GROUP BY e.user_id, e.name
  ),
  mastered_exercises AS (
    -- Count exercises with 10+ sessions per user
    SELECT
      esc.user_id,
      COUNT(*) AS mastered_count
    FROM exercise_session_counts esc
    WHERE esc.session_count >= 10
    GROUP BY esc.user_id
  )
  SELECT
    me.user_id,
    me.mastered_count,
    RANK() OVER (ORDER BY me.mastered_count DESC) AS rank
  FROM mastered_exercises me
  ORDER BY me.mastered_count DESC
  LIMIT result_limit;
$$;

COMMENT ON FUNCTION get_exercise_mastery_rankings IS 'Returns users ranked by number of exercises with 10+ sessions (mastered), filtered by leaderboard participation.';

-- =============================================================================
-- 3. User PR Rank Function
-- Returns a specific user''s PR count and rank among participants
-- =============================================================================

CREATE OR REPLACE FUNCTION get_user_pr_rank(target_user_id uuid)
RETURNS TABLE (
  user_id uuid,
  pr_count bigint,
  rank bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH pr_counts AS (
    SELECT
      pr.user_id,
      COUNT(*) AS pr_count
    FROM personal_records pr
    INNER JOIN profiles p ON p.user_id = pr.user_id
    WHERE p.leaderboard_participation = true
    GROUP BY pr.user_id
  ),
  ranked AS (
    SELECT
      pc.user_id,
      pc.pr_count,
      RANK() OVER (ORDER BY pc.pr_count DESC) AS rank
    FROM pr_counts pc
  )
  SELECT
    r.user_id,
    r.pr_count,
    r.rank
  FROM ranked r
  WHERE r.user_id = target_user_id;
$$;

COMMENT ON FUNCTION get_user_pr_rank IS 'Returns a specific user''s PR count and rank among leaderboard participants.';

-- =============================================================================
-- 4. Leaderboard Events Table
-- Stores special events that override normal weekly metric rotation
-- =============================================================================

CREATE TABLE IF NOT EXISTS leaderboard_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  metric text NOT NULL,
  metric_label text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_active boolean DEFAULT true,
  prize_description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Ensure end_date is after start_date
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- Index for efficient event lookup by date range
CREATE INDEX IF NOT EXISTS idx_leaderboard_events_dates
  ON leaderboard_events (start_date, end_date)
  WHERE is_active = true;

COMMENT ON TABLE leaderboard_events IS 'Special leaderboard events that override normal weekly metric rotation.';
COMMENT ON COLUMN leaderboard_events.metric IS 'Database column name to rank by (e.g., total_volume_kg, total_workouts).';
COMMENT ON COLUMN leaderboard_events.metric_label IS 'Human-readable label for the metric (e.g., "Total Volume (kg)").';

-- =============================================================================
-- 5. RLS Policies for leaderboard_events
-- =============================================================================

ALTER TABLE leaderboard_events ENABLE ROW LEVEL SECURITY;

-- Anyone can view active events
CREATE POLICY "Anyone can view active leaderboard events"
  ON leaderboard_events
  FOR SELECT
  USING (is_active = true);

-- Only service role can modify events (enforced by lack of INSERT/UPDATE/DELETE policies)
-- This means events must be managed via service role key or migrations

-- =============================================================================
-- 6. Updated_at trigger for leaderboard_events
-- =============================================================================

CREATE OR REPLACE FUNCTION update_leaderboard_events_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_leaderboard_events_updated_at ON leaderboard_events;
CREATE TRIGGER set_leaderboard_events_updated_at
  BEFORE UPDATE ON leaderboard_events
  FOR EACH ROW
  EXECUTE FUNCTION update_leaderboard_events_updated_at();

-- =============================================================================
-- 7. Grant execute permissions on functions
-- =============================================================================

GRANT EXECUTE ON FUNCTION get_pr_count_rankings TO authenticated;
GRANT EXECUTE ON FUNCTION get_pr_count_rankings TO service_role;

GRANT EXECUTE ON FUNCTION get_exercise_mastery_rankings TO authenticated;
GRANT EXECUTE ON FUNCTION get_exercise_mastery_rankings TO service_role;

GRANT EXECUTE ON FUNCTION get_user_pr_rank TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_pr_rank TO service_role;
