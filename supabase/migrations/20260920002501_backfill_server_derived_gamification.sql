-- One-time reconciliation of the counter drift the add-only dashboard
-- triggers left behind (R-26), split out of 20260920002500 so a slow
-- backfill cannot roll back the schema change itself (R-6).
--
-- RE-RUNNABLE and idempotent: recompute_gamification_stats() is UPDATE-only,
-- writes only when the stored values differ from the derived ones, and never
-- touches updated_at — so a second run is a no-op and no phone re-downloads
-- anything.
--
-- NOT RESUMABLE (corrected in review round 2, R-6). An earlier version of
-- this header claimed a timeout "resumes from wherever it got to". It does
-- not: a DO block cannot COMMIT, so a statement timeout or an operator
-- cancel rolls back everything the block did — measured, 0 rows survived.
-- What is true is that re-running it costs nothing extra for users it had
-- already made exact, because those rows no longer differ from the derived
-- values and the UPDATE skips them. So the recovery from a timeout is
-- "run it again", not "it carries on": correct, just not free.
--
-- If the 15 minutes below is ever hit, prefer the read-only preview to see
-- how many rows are still drifting, then re-run
-- `SELECT public.recompute_all_gamification_stats();` out of band (it is
-- service_role-executable and needs no migration) rather than re-pushing.
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

-- The timeouts are HOISTED ABOVE the DO block, inside an explicit
-- transaction (review round 2, R-6 reopened). Two things had to be true and
-- only one of them was:
--
--   1. `statement_timeout` is armed when a statement STARTS, so a
--      `SET LOCAL statement_timeout` written INSIDE the DO block cannot bound
--      the DO block itself — that statement is already running. MEASURED on
--      Postgres 17: a DO block setting '300ms' and then calling pg_sleep(2)
--      prints its completion notice. The previous version of this file had
--      the SET LOCALs inside the block, so the 15-minute bound was absent.
--
--   2. `SET LOCAL` only does anything inside a transaction block. MEASURED:
--      hoisting the SET above the DO but leaving the file in autocommit
--      yields `WARNING: SET LOCAL can only be used in transaction blocks`
--      and the DO block again runs to completion. So hoisting ALONE does not
--      fix it. Wrapped in BEGIN/COMMIT the same script aborts with
--      `ERROR: canceling statement due to statement timeout`, which is the
--      behaviour this guard is for.
--
-- Hence the explicit BEGIN/COMMIT below, following 20260920000200:70-72,
-- which wraps itself the same way for the same reason.
--
-- Both guards were then verified in force against this exact file shape on a
-- local Postgres 17 stack, not reasoned about:
--   * statement_timeout — the file with '300ms' and a pg_sleep(2) inserted
--     ahead of the call aborts with
--     `ERROR: canceling statement due to statement timeout` and ROLLBACK.
--   * lock_timeout — with another session holding ACCESS EXCLUSIVE on
--     gamification_stats, the same block at '1s' aborts with
--     `ERROR: canceling statement due to lock timeout` on
--     `SELECT gs.user_id FROM public.gamification_stats`.
-- The ROLLBACK in both cases is also the direct evidence for the
-- "not resumable" note above.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

DO $$
DECLARE
  v_count bigint;
BEGIN
  -- The selection predicate lives in 20260920002500 as
  -- recompute_all_gamification_stats() so gamification_stats.test.sql can
  -- seed drift for it and invoke it directly (R-19).
  v_count := public.recompute_all_gamification_stats();

  RAISE NOTICE 'recompute_gamification_stats: reconciled % gamification_stats rows', v_count;
END
$$;

COMMIT;
