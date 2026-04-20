-- Migration: Convert creator_stats materialized view to regular security_invoker view
--
-- Context: the earlier 20260324120000 security-definer-view fix assumed
-- creator_stats was a regular view, but prod has it as a MATERIALIZED view
-- with a hourly pg_cron refresh ('refresh-creator-stats' @ '30 * * * *').
-- Materialized refresh runs as owner, so it bypasses RLS — any user who
-- toggles profile_visible=false remains exposed in the cached snapshot
-- until the next tick (up to 60 min privacy leak window).
--
-- This migration:
--   1. Unschedules the cron refresh (no longer needed — view is now live).
--   2. DROPs the materialized view (CASCADE removes its indexes).
--   3. Recreates creator_stats as a regular VIEW with security_invoker=true.
--      Underlying tables (shared_routines, shared_cycles, profiles) already
--      have the proper RLS; the view honors the caller's policies on every
--      SELECT. Same column shape as before so dependent queries (see
--      src/queries/community.ts in phoenix-portal) keep working unchanged.
--
-- Tradeoff: aggregation now runs per-SELECT. At beta scale this is fine —
-- shared_routines/shared_cycles are small and indexed on user_id. Revisit
-- with either a service-role-populated summary table or HTTP-layer caching
-- if community-page traffic makes the aggregation hot.

BEGIN;

-- 1. Unschedule cron refresh. cron.unschedule is idempotent-ish — it raises
--    when the job name doesn't exist, so wrap in a DO to keep the migration
--    safe to re-run.
DO $$ BEGIN
  PERFORM cron.unschedule('refresh-creator-stats');
EXCEPTION WHEN OTHERS THEN
  -- job already removed, nothing to do
  NULL;
END $$;

-- 2. Drop whichever flavor of creator_stats currently exists.
--    Prod has it as a MATERIALIZED view (relkind='m') — this migration was
--    written to convert it. A fresh `supabase db reset` has it as a regular
--    VIEW (relkind='v'), created earlier by migration 20260221. We branch
--    on relkind because `DROP MATERIALIZED VIEW IF EXISTS` raises when the
--    relation exists but is the wrong flavor (and vice versa for DROP VIEW).
DO $$
DECLARE
  v_kind "char";
BEGIN
  SELECT c.relkind INTO v_kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'creator_stats';

  IF v_kind = 'm' THEN
    EXECUTE 'DROP MATERIALIZED VIEW public.creator_stats CASCADE';
  ELSIF v_kind = 'v' THEN
    EXECUTE 'DROP VIEW public.creator_stats CASCADE';
  END IF;
  -- v_kind NULL = no relation named creator_stats; nothing to drop.
END $$;

-- 3. Recreate as a regular view with security_invoker.
CREATE VIEW public.creator_stats
  WITH (security_invoker = true)
AS
SELECT
  p.id AS user_id,
  p.display_name,
  p.avatar_url,
  COALESCE(r.routine_count, 0) + COALESCE(c.cycle_count, 0) AS total_shares,
  COALESCE(r.routine_votes, 0) + COALESCE(c.cycle_votes, 0) AS total_upvotes,
  COALESCE(r.featured_routines, 0) + COALESCE(c.featured_cycles, 0) AS featured_count
FROM public.profiles p
LEFT JOIN (
  SELECT
    user_id,
    COUNT(*) AS routine_count,
    COALESCE(SUM(vote_count), 0) AS routine_votes,
    COUNT(*) FILTER (WHERE vote_count >= 10) AS featured_routines
  FROM public.shared_routines
  GROUP BY user_id
) r ON r.user_id = p.id
LEFT JOIN (
  SELECT
    user_id,
    COUNT(*) AS cycle_count,
    COALESCE(SUM(vote_count), 0) AS cycle_votes,
    COUNT(*) FILTER (WHERE vote_count >= 10) AS featured_cycles
  FROM public.shared_cycles
  GROUP BY user_id
) c ON c.user_id = p.id
WHERE COALESCE(r.routine_count, 0) + COALESCE(c.cycle_count, 0) > 0;

COMMENT ON VIEW public.creator_stats IS
  'Live aggregate of per-user share + upvote counts across shared_routines and shared_cycles. '
  'security_invoker=true so caller RLS applies — users who opt out via profiles.profile_visible '
  'are excluded in real time. Replaces the hourly-refreshed materialized view dropped in '
  '20260420220000.';

COMMIT;
