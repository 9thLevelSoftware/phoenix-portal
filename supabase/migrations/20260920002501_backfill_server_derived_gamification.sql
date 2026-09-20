-- One-time reconciliation of the counter drift the add-only dashboard
-- triggers left behind (R-26), split out of 20260920002500 so a slow
-- backfill cannot roll back the schema change itself (R-6).
--
-- Re-runnable and idempotent: recompute_gamification_stats() is UPDATE-only,
-- writes only when the stored values differ from the derived ones, and never
-- touches updated_at — so a second run is a no-op and no phone re-downloads
-- anything.
--
-- ===========================================================================
-- OPERATOR PREVIEW — run this READ-ONLY query BEFORE `supabase db push`
-- (design.md:274, plan risk 6; required of every backfill migration, R-30).
-- It needs 20260920002500 applied (it calls derive_gamification_stats) and
-- must be run as postgres or service_role. It changes nothing.
--
--   SELECT count(*)                                            AS rows_changing,
--          count(*) FILTER (WHERE gs.total_workouts     <> d.total_workouts)     AS workouts_changing,
--          count(*) FILTER (WHERE gs.total_volume_kg    <> d.total_volume_kg)    AS volume_changing,
--          count(*) FILTER (WHERE gs.pr_count           <> d.pr_count)           AS pr_count_changing,
--          count(*) FILTER (WHERE gs.best_streak        >  d.longest_streak)     AS best_streak_dropping,
--          max(gs.total_workouts  - d.total_workouts)                            AS max_workout_overcount,
--          max(gs.total_volume_kg - d.total_volume_kg)                           AS max_volume_overcount,
--          max(gs.best_streak     - d.longest_streak)                            AS max_best_streak_drop
--     FROM public.gamification_stats gs
--     CROSS JOIN LATERAL public.derive_gamification_stats(gs.user_id) d
--    WHERE (gs.total_workouts, gs.total_volume_kg, gs.total_time_seconds,
--           gs.total_reps, gs.pr_count, gs.current_streak, gs.longest_streak,
--           gs.best_streak)
--          IS DISTINCT FROM
--          (d.total_workouts, d.total_volume_kg, d.total_time_seconds,
--           d.total_reps, d.pr_count, d.current_streak, d.longest_streak,
--           d.longest_streak);
--
-- Per-user detail for the worst offenders (same shape, ordered):
--
--   SELECT gs.user_id, gs.total_workouts, d.total_workouts AS derived_workouts,
--          gs.total_volume_kg, d.total_volume_kg AS derived_volume,
--          gs.best_streak, d.longest_streak AS derived_longest
--     FROM public.gamification_stats gs
--     CROSS JOIN LATERAL public.derive_gamification_stats(gs.user_id) d
--    ORDER BY (gs.total_workouts - d.total_workouts) DESC NULLS LAST
--    LIMIT 50;
--
-- WHAT THE OPERATOR IS LOOKING FOR:
--   * `rows_changing` is the blast radius. Every one of those users sees
--     their PORTAL Profile figures and their leaderboard entries move. No
--     phone is affected: mobile-sync-pull serves the device_* shadow columns,
--     which 20260920002500 seeded from the pre-existing values.
--   * `best_streak_dropping` is the only value that can go DOWN in a way a
--     user may notice as a loss: the pre-PR column was device-reported and
--     ratcheted, so a user whose full history was never synced to the server
--     will see a lower best streak. That is the intended trust fix (the value
--     was unverifiable), but it is the line to read out before applying.
--   * Large `max_workout_overcount` / `max_volume_overcount` values are the
--     R-26 drift being corrected, not data loss.
-- ===========================================================================

DO $$
DECLARE
  v_user_id uuid;
  v_count   bigint := 0;
BEGIN
  -- Bound the blast radius of a pathological history: a timeout aborts THIS
  -- migration only, and re-running it resumes from wherever it got to,
  -- because every completed user is already exact and is skipped.
  SET LOCAL lock_timeout = '5s';
  SET LOCAL statement_timeout = '15min';

  -- Only users that already have a stats row matter:
  -- recompute_gamification_stats is UPDATE-only by design (see
  -- 20260920002500 section 3), and a user with sessions but no stats row gets
  -- one on their next push that carries gamificationStats.
  FOR v_user_id IN
    SELECT gs.user_id FROM public.gamification_stats gs ORDER BY gs.user_id
  LOOP
    PERFORM public.recompute_gamification_stats(v_user_id);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'recompute_gamification_stats: reconciled % gamification_stats rows', v_count;
END
$$;
