-- Migration: Fix SECURITY DEFINER views flagged by Supabase linter
-- Problem: telemetry_points and creator_stats views run with the view
--          owner's permissions, bypassing RLS for the querying user.
-- Fix:     Recreate both views with security_invoker = true so the
--          calling user's RLS policies are enforced.

-- ============================================================
-- 1. profiles: add public-read policy for community features
--    creator_stats joins profiles to show display_name + avatar_url
--    for other users.  Without this, security_invoker would block
--    cross-user reads because the only SELECT policy is own-row.
--    Scoped to users who opted into public visibility.
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles'
      AND policyname = 'Public profiles are visible to authenticated users'
  ) THEN
    CREATE POLICY "Public profiles are visible to authenticated users"
      ON profiles FOR SELECT
      USING (profile_visible = true AND auth.role() = 'authenticated');
  END IF;
END $$;

-- ============================================================
-- 2. telemetry_points: recreate with security_invoker
--    Simple alias over rep_telemetry which already has proper RLS.
-- ============================================================
CREATE OR REPLACE VIEW telemetry_points
  WITH (security_invoker = true)
  AS SELECT * FROM rep_telemetry;

-- ============================================================
-- 3. creator_stats: recreate with security_invoker
--    Underlying tables already have public SELECT policies:
--      - shared_routines: "Anyone can view shared routines"
--      - shared_cycles:   "Anyone can view shared cycles"
--      - profiles:        new policy above for profile_visible rows
-- ============================================================
CREATE OR REPLACE VIEW creator_stats
  WITH (security_invoker = true)
AS
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
