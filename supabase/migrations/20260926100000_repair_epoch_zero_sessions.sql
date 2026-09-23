-- C10 ("1970 session repair" follow-up). Production evidence (2026-09-23,
-- read-only): 10 of 3,621 workout_sessions rows have started_at = epoch 0
-- (1970-01-01T00:00:00Z), all with set_count = 1, and the 7 inspected have no
-- rep_summaries and no telemetry. Root cause: a mobile save raced a reset
-- that set the workout start time to 0L, so the phone pushed startedAt = 0
-- and durationSeconds = now - 0 (the save time, as Unix seconds). The ingest
-- side of this fix (mobile-sync-push/index.ts,
-- repairEpochZeroSessionStarts/normalizeNegativeSessionDurations, documented
-- in docs/sync-reliability-contract.md "Epoch-zero session repair") stops new
-- rows from arriving broken; this migration repairs the rows already stored.
--
-- Approved repair (three groups, matched in this order):
--   A. started_at = epoch 0 AND duration_seconds is a plausible Unix-seconds
--      timestamp (946,684,800 .. extract(epoch from now()) + 86,400):
--        started_at := to_timestamp(duration_seconds), duration_seconds := 0
--   B. started_at < 2000-01-01 otherwise, AND duration_seconds > 86,400:
--        started_at := client_updated_at, duration_seconds := 0
--   C. started_at < 2000-01-01 otherwise, AND duration_seconds <= 86,400:
--        started_at := client_updated_at, duration kept
-- Every corrected row also gets client_updated_at := now(), so a later full
-- re-push from the same device (LWW gate is `<=`) cannot restore the bad
-- values. No rows are deleted.
--
-- Asymmetry with the ingest repair (deliberate, not a bug): the ingest repair
-- treats ANY pushed startedAt before 2000-01-01 as eligible for group A's
-- duration-as-timestamp reinterpretation. This migration's group A requires
-- an EXACT epoch-zero started_at, per the approved table above, because a
-- stored started_at that is merely "before 2000" but not exactly epoch could
-- already be a genuine (if old/wrong) device timestamp rather than the
-- specific 0L-race bug this incident investigated; the narrower match avoids
-- reinterpreting duration_seconds as a timestamp for rows the investigation
-- did not establish that for.
--
-- Rows with client_updated_at NULL are left alone entirely (not repaired,
-- counted separately) -- there is no LWW key to advance and, for groups B/C,
-- no fallback clock to repair from. The same applies to a row that would
-- fall into groups B/C but whose OWN client_updated_at is also before
-- 2000-01-01 (the same device-clock corruption could plausibly have hit both
-- fields together): repairing from a still-implausible clock would leave
-- started_at < 2000-01-01 and make this migration re-match the row on every
-- future re-run, which is not idempotent in any useful sense. Both cases are
-- counted together in the `skipped` result and reported in a NOTICE; none of
-- the known 10 production rows are expected to hit either case.
--
-- Other stored copies of a session's start time, investigated (grep for
-- `session.startedAt` / `session\.started_at` under supabase/functions and
-- supabase/migrations):
--   * exercise_progress.recorded_at -- set verbatim from session.startedAt by
--     _shared/exerciseProgressRows.ts#buildExerciseProgressRows. Repaired
--     here for exact-value matches (WHERE recorded_at = the session's OLD
--     started_at), scoped to the repaired session's own id.
--   * personal_records.achieved_at -- set verbatim from session.startedAt by
--     _shared/personalRecordRow.ts#buildPersonalRecordRows for set-derived
--     records (source = 'set_derived' since 20260920005700, source IS NULL
--     for legacy rows written before it -- both are the same derivation).
--     Dedicated records (source = 'dedicated') carry their own device-sent
--     achievedAt and are NOT derived from the session, so they are not
--     touched by name; in practice the same WHERE achieved_at = the
--     session's OLD started_at (scoped to session_id) is the proof of
--     derivation and naturally excludes them unless a dedicated record
--     coincidentally carries the exact same epoch/implausible instant, which
--     would itself be the same underlying device bug.
--   * leaderboard_snapshots and the leaderboard/analytics aggregate RPCs
--     (20260920005600, 20260920004000) do not store a copy of started_at --
--     they read workout_sessions live on each refresh, so no repair is
--     needed there; the next refresh_leaderboard_snapshots() run reflects
--     the corrected dates automatically.
--   * gamification_stats.last_workout_at / rpg_attributes.last_workout_at are
--     device-reported LWW shadow columns (20260920002500), not a stored copy
--     of a specific session's started_at -- they are out of scope for a
--     direct rewrite. What IS server-derived (total_workouts, total_volume_kg,
--     total_time_seconds, total_reps, pr_count, current_streak,
--     longest_streak, best_streak) only recomputes today on a session/PR
--     delete (recompute_gamification_stats_after_change), so this migration
--     calls public.recompute_gamification_stats(user_id) for every user with
--     a repaired session, exactly as any other importer of workout_sessions
--     must (20260920002500 section 4 comment).
--   * training_cycles.started_at, external_activities.started_at and every
--     other `started_at` column found by grep belong to a different entity
--     (cycles, external activities) and are never set from a
--     workout_sessions row; not touched.
--
-- Triggers on workout_sessions UPDATE (checked so the repair's own UPDATE
-- passes them cleanly, supabase/migrations/20260920002100_client_updated_at_lww.sql
-- and .../20260920002102_owner_immutable.sql):
--   * sessions_updated_at (20260323120000, function redefined by
--     20260920002100 with the phoenix.skip_updated_at escape hatch): fires on
--     every UPDATE and sets updated_at := now() unless
--     phoenix.skip_updated_at = 'on'. This migration does NOT set that GUC,
--     so updated_at advances -- required so mobile-sync-pull re-delivers the
--     corrected row.
--   * workout_sessions_client_updated_at (stamp_client_updated_at_portal_edit):
--     only stamps client_updated_at for auth.role() = 'authenticated'; a
--     migration runs as the migration role, not 'authenticated', so it is a
--     no-op here and this migration sets client_updated_at explicitly.
--   * workout_sessions_owner_immutable (reject_user_id_change): refuses a
--     user_id change; this repair never touches user_id, so it never fires.
--
-- Operator pre-check: run supabase/scripts/preview_epoch_zero_sessions.sql
-- (read-only) before pushing this migration.
--
-- Idempotent: the WHERE clause is started_at < 2000-01-01, which a repaired
-- row no longer satisfies, so re-running matches nothing. Safe to re-run.

BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION private.repair_epoch_zero_sessions()
RETURNS TABLE (
  group_a integer,
  group_b integer,
  group_c integer,
  skipped integer,
  progress_rows integer,
  pr_rows integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_group_a integer := 0;
  v_group_b integer := 0;
  v_group_c integer := 0;
  v_skipped integer := 0;
  v_progress integer := 0;
  v_pr integer := 0;
  v_user_ids uuid[] := ARRAY[]::uuid[];
  v_uid uuid;
BEGIN
  WITH candidates AS (
    SELECT
      ws.id,
      ws.user_id,
      ws.started_at AS old_started_at,
      ws.duration_seconds AS old_duration_seconds,
      ws.client_updated_at,
      CASE
        WHEN ws.started_at = '1970-01-01T00:00:00Z'::timestamptz
          AND ws.duration_seconds BETWEEN 946684800
            AND (floor(extract(epoch FROM now()))::bigint + 86400)
        THEN 'A'
        WHEN ws.duration_seconds > 86400 THEN 'B'
        ELSE 'C'
      END AS repair_group
    FROM public.workout_sessions ws
    WHERE ws.started_at < '2000-01-01T00:00:00Z'::timestamptz
  ),
  repairable AS (
    SELECT
      c.id,
      c.user_id,
      c.old_started_at,
      c.repair_group,
      CASE
        WHEN c.repair_group = 'A' THEN to_timestamp(c.old_duration_seconds)
        ELSE c.client_updated_at
      END AS new_started_at,
      CASE
        WHEN c.repair_group IN ('A', 'B') THEN 0
        ELSE c.old_duration_seconds
      END AS new_duration_seconds
    FROM candidates c
    WHERE c.client_updated_at IS NOT NULL
      AND (
        c.repair_group = 'A'
        OR c.client_updated_at >= '2000-01-01T00:00:00Z'::timestamptz
      )
  ),
  updated_sessions AS (
    UPDATE public.workout_sessions ws
    SET started_at = r.new_started_at,
        duration_seconds = r.new_duration_seconds,
        client_updated_at = now()
    FROM repairable r
    WHERE ws.id = r.id
    RETURNING
      ws.id AS session_id,
      ws.user_id AS session_user_id,
      r.old_started_at,
      r.new_started_at,
      r.repair_group
  ),
  updated_progress AS (
    UPDATE public.exercise_progress ep
    SET recorded_at = us.new_started_at
    FROM updated_sessions us
    WHERE ep.session_id = us.session_id
      AND ep.recorded_at = us.old_started_at
    RETURNING 1
  ),
  updated_prs AS (
    UPDATE public.personal_records pr
    SET achieved_at = us.new_started_at,
        updated_at = now()
    FROM updated_sessions us
    WHERE pr.session_id = us.session_id
      AND pr.achieved_at = us.old_started_at
    RETURNING 1
  )
  SELECT
    (count(*) FILTER (WHERE us.repair_group = 'A'))::integer,
    (count(*) FILTER (WHERE us.repair_group = 'B'))::integer,
    (count(*) FILTER (WHERE us.repair_group = 'C'))::integer,
    ((SELECT count(*) FROM candidates) - count(*))::integer,
    (SELECT count(*)::integer FROM updated_progress),
    (SELECT count(*)::integer FROM updated_prs),
    coalesce(array_agg(DISTINCT us.session_user_id), ARRAY[]::uuid[])
  INTO v_group_a, v_group_b, v_group_c, v_skipped, v_progress, v_pr, v_user_ids
  FROM updated_sessions us;

  -- Server-derived gamification (20260920002500) only recomputes today on a
  -- session/PR delete; any other writer of workout_sessions must call this
  -- itself for every user it touched.
  FOREACH v_uid IN ARRAY v_user_ids
  LOOP
    PERFORM public.recompute_gamification_stats(v_uid);
  END LOOP;

  RETURN QUERY SELECT v_group_a, v_group_b, v_group_c, v_skipped, v_progress, v_pr;
END;
$$;

REVOKE ALL ON FUNCTION private.repair_epoch_zero_sessions()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.repair_epoch_zero_sessions() IS
  'C10: idempotent repair for epoch-zero/pre-2000 workout_sessions.started_at '
  'rows (the "1970 session repair"). Fixes the row, its exercise_progress.'
  'recorded_at and personal_records.achieved_at copies, bumps '
  'client_updated_at and updated_at, and recomputes gamification_stats for '
  'every affected user. Re-runnable; matches nothing once every started_at '
  'is >= 2000-01-01. Called by 20260926100000; owner-only.';

DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM private.repair_epoch_zero_sessions();
  RAISE NOTICE
    'repair_epoch_zero_sessions: group_a=% group_b=% group_c=% skipped=% exercise_progress_rows=% personal_records_rows=%',
    r.group_a, r.group_b, r.group_c, r.skipped, r.progress_rows, r.pr_rows;
  IF r.skipped > 0 THEN
    RAISE NOTICE
      'repair_epoch_zero_sessions: % row(s) left unrepaired (client_updated_at NULL, or its own value still before 2000-01-01) -- needs operator follow-up',
      r.skipped;
  END IF;
END $$;

COMMIT;
