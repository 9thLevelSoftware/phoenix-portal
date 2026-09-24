-- NF-37: rank-time outlier handling for leaderboard snapshots.
--
-- Session values arrive unbounded (sessionSchema.totalVolume, startedAt), and
-- a Zod ceiling is not an option: mobile classifies a 400 as permanent and
-- never advances lastSync, so one out-of-range row would stop that account
-- syncing for good. The leaderboard is therefore made robust where it ranks,
-- leaving every user's own stored data intact:
--
--   * a session counts for ranking only when started_at is no later than one
--     day past the refresh (future-dated rows inflate nothing);
--   * each session contributes at most c_max_session_volume_kg of volume
--     (winsorized; per cable, as stored — KD-8). No real session approaches it;
--   * longest_streak is recomputed from UTC workout days up to today with the
--     same gaps-and-islands rule as derive_gamification_stats, so sessions on
--     consecutive future dates cannot build a run (current_streak already
--     stops at today and is used as stored);
--   * total_workouts never exceeds the count of non-future sessions;
--   * pr_count and the weekly PR metric ignore future-dated achieved_at;
--   * exercise_mastery counts only non-future sessions.
--
-- mobile-sync-push also clamps and reports implausible session values on
-- ingest (additive `clamped` key); this is the part that needs no mobile
-- release and protects rows already stored.
--
-- Same signature; CREATE OR REPLACE keeps grants. Idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_leaderboard_snapshots()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_today date := (v_now AT TIME ZONE 'UTC')::date;
  v_week_start date := (date_trunc('week', v_now AT TIME ZONE 'UTC'))::date;
  -- Keep exactly 12 weekly periods: the current week and the 11 before it.
  v_oldest_kept date := v_week_start - 77;
  v_week date;
  v_week_from timestamptz;
  v_week_to timestamptz;
  -- NF-37 ranking bounds.
  c_future_grace CONSTANT interval := interval '1 day';
  c_max_session_volume_kg CONSTANT numeric := 100000;
BEGIN
  -- Serialize overlapping runs (a slow run and the next cron tick) and
  -- opt-outs (remove_leaderboard_snapshots_on_opt_out takes the same lock).
  PERFORM pg_advisory_xact_lock(hashtext('public.refresh_leaderboard_snapshots'));

  DELETE FROM public.leaderboard_snapshots s
  WHERE s.period = 'all_time'
     OR s.period = v_week_start::text
     OR s.period = (v_week_start - 7)::text
     OR (s.period <> 'all_time' AND s.period < v_oldest_kept::text);

  -- All-time metrics.
  WITH participants AS (
    SELECT p.id AS user_id
    FROM public.profiles p
    WHERE p.leaderboard_participation = true
  ),
  ranked_sessions AS (
    SELECT ws.id, ws.user_id, ws.started_at,
           LEAST(GREATEST(coalesce(ws.total_volume, 0), 0), c_max_session_volume_kg)::numeric AS volume
    FROM public.workout_sessions ws
    JOIN participants pa ON pa.user_id = ws.user_id
    WHERE ws.started_at <= v_now + c_future_grace
  ),
  session_totals AS (
    SELECT rs.user_id,
           sum(rs.volume)::numeric AS volume,
           count(*)::numeric AS workouts
    FROM ranked_sessions rs
    GROUP BY rs.user_id
  ),
  streak_days AS (
    SELECT DISTINCT rs.user_id, (rs.started_at AT TIME ZONE 'UTC')::date AS d
    FROM ranked_sessions rs
    WHERE (rs.started_at AT TIME ZONE 'UTC')::date <= v_today
  ),
  streak_runs AS (
    SELECT sd.user_id,
           count(*)::numeric AS run_length
    FROM (
      SELECT sd.user_id,
             sd.d - (row_number() OVER (PARTITION BY sd.user_id ORDER BY sd.d))::integer AS island
      FROM streak_days sd
    ) sd
    GROUP BY sd.user_id, sd.island
  ),
  longest AS (
    SELECT sr.user_id, max(sr.run_length) AS value
    FROM streak_runs sr
    GROUP BY sr.user_id
  ),
  pr_all AS (
    SELECT pr.user_id, count(*)::numeric AS value
    FROM public.personal_records pr
    JOIN participants pa ON pa.user_id = pr.user_id
    WHERE pr.deleted_at IS NULL
      AND pr.achieved_at <= v_now + c_future_grace
    GROUP BY pr.user_id
  ),
  exercise_sessions AS (
    SELECT e.user_id, e.name, count(DISTINCT e.session_id) AS session_count
    FROM public.exercises e
    JOIN ranked_sessions rs ON rs.id = e.session_id
    GROUP BY e.user_id, e.name
  ),
  mastery AS (
    SELECT es.user_id, count(*)::numeric AS value
    FROM exercise_sessions es
    WHERE es.session_count >= 10
    GROUP BY es.user_id
  ),
  vals AS (
    SELECT m.metric, pa.user_id,
           coalesce(
             CASE m.metric
               WHEN 'total_volume_kg' THEN st.volume
               WHEN 'total_workouts' THEN LEAST(gs.total_workouts::numeric, coalesce(st.workouts, 0))
               WHEN 'longest_streak' THEN longest.value
               WHEN 'current_streak' THEN gs.current_streak::numeric
               WHEN 'pr_count' THEN pr_all.value
               WHEN 'exercise_mastery' THEN mastery.value
             END,
             0
           ) AS value
    FROM participants pa
    CROSS JOIN (VALUES
      ('total_volume_kg'), ('total_workouts'), ('longest_streak'),
      ('current_streak'), ('pr_count'), ('exercise_mastery')
    ) AS m(metric)
    LEFT JOIN public.gamification_stats gs ON gs.user_id = pa.user_id
    LEFT JOIN session_totals st ON st.user_id = pa.user_id
    LEFT JOIN longest ON longest.user_id = pa.user_id
    LEFT JOIN pr_all ON pr_all.user_id = pa.user_id
    LEFT JOIN mastery ON mastery.user_id = pa.user_id
  )
  INSERT INTO public.leaderboard_snapshots (metric, period, user_id, value, rank, computed_at)
  SELECT v.metric, 'all_time', v.user_id, v.value,
         rank() OVER (PARTITION BY v.metric ORDER BY v.value DESC),
         v_now
  FROM vals v;

  -- Weekly metrics for the current and the previous UTC ISO week.
  FOREACH v_week IN ARRAY ARRAY[v_week_start, v_week_start - 7] LOOP
    v_week_from := (v_week::timestamp AT TIME ZONE 'UTC');
    v_week_to := ((v_week + 7)::timestamp AT TIME ZONE 'UTC');

    WITH participants AS (
      SELECT p.id AS user_id
      FROM public.profiles p
      WHERE p.leaderboard_participation = true
    ),
    week_sessions AS (
      SELECT ws.user_id,
             coalesce(sum(LEAST(GREATEST(coalesce(ws.total_volume, 0), 0), c_max_session_volume_kg)), 0)::numeric AS volume,
             count(*)::numeric AS workouts
      FROM public.workout_sessions ws
      JOIN participants pa ON pa.user_id = ws.user_id
      WHERE ws.started_at >= v_week_from
        AND ws.started_at < v_week_to
        AND ws.started_at <= v_now + c_future_grace
      GROUP BY ws.user_id
    ),
    week_prs AS (
      SELECT pr.user_id, count(*)::numeric AS value
      FROM public.personal_records pr
      JOIN participants pa ON pa.user_id = pr.user_id
      WHERE pr.deleted_at IS NULL
        AND pr.achieved_at >= v_week_from
        AND pr.achieved_at < v_week_to
        AND pr.achieved_at <= v_now + c_future_grace
      GROUP BY pr.user_id
    ),
    vals AS (
      SELECT m.metric, pa.user_id,
             coalesce(
               CASE m.metric
                 WHEN 'total_volume_kg' THEN wk.volume
                 WHEN 'total_workouts' THEN wk.workouts
                 WHEN 'pr_count' THEN wp.value
               END,
               0
             ) AS value
      FROM participants pa
      CROSS JOIN (VALUES ('total_volume_kg'), ('total_workouts'), ('pr_count')) AS m(metric)
      LEFT JOIN week_sessions wk ON wk.user_id = pa.user_id
      LEFT JOIN week_prs wp ON wp.user_id = pa.user_id
    )
    INSERT INTO public.leaderboard_snapshots (metric, period, user_id, value, rank, computed_at)
    SELECT v.metric, v_week::text, v.user_id, v.value,
           rank() OVER (PARTITION BY v.metric ORDER BY v.value DESC),
           v_now
    FROM vals v;
  END LOOP;

  -- Re-check participation (a new statement, fresh snapshot) so a user who
  -- opted out while this ran is not left behind.
  DELETE FROM public.leaderboard_snapshots s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = s.user_id
      AND p.leaderboard_participation = true
  );
END;
$$;

COMMENT ON FUNCTION public.refresh_leaderboard_snapshots() IS
  'Rebuilds all-time, current-week and previous-week leaderboard_snapshots rows for participating profiles and keeps 12 weekly periods. Ranks only non-future rows, winsorizes per-session volume (per cable) and recomputes longest_streak up to today (NF-37). Run by pg_cron every 15 minutes; service_role only.';

REVOKE ALL ON FUNCTION public.refresh_leaderboard_snapshots() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_leaderboard_snapshots() FROM anon;
REVOKE ALL ON FUNCTION public.refresh_leaderboard_snapshots() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_leaderboard_snapshots() TO service_role;

COMMIT;
