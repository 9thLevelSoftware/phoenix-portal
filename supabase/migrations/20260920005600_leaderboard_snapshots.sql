-- PR 56: serve leaderboards from a scheduled snapshot; exclude deleted PRs.
--
-- Before this migration compute-rankings recomputed every leaderboard from raw
-- tables on each page view, with GET `.in('user_id', <every participant>)`
-- lists (URL wall at ~200 participants) and unpaged reads truncated by
-- PostgREST max_rows. The PR count RPCs also counted tombstoned records.
--
-- 1. leaderboard_snapshots(metric, period, user_id, value, rank, computed_at)
--    holds one row per participating profile per metric (zeros included, so
--    count(*) per (metric, period) is the participant total and RANK() ties
--    zero-valued users at "users with a value + 1", as before).
--      period 'all_time'   : total_volume_kg, total_workouts, longest_streak,
--                            current_streak, pr_count, exercise_mastery
--      period 'YYYY-MM-DD' : the UTC ISO-week Monday; total_volume_kg,
--                            total_workouts, pr_count for that week
--    Volumes are summed as stored (per-cable, never x2; KD-8).
--    RLS: FLAME+ authenticated users may SELECT. An opt-out trigger on
--    profiles deletes the user's rows at once, so only participants' rows
--    are ever readable.
-- 2. refresh_leaderboard_snapshots(): SECURITY DEFINER, service_role only.
--    Replaces the all-time rows and the current week's rows in one
--    transaction (readers see the old or the new set, never a mix) and keeps
--    12 weeks of weekly history.
-- 3. pg_cron runs it every 15 minutes as pure SQL (no HTTP, no secret),
--    using the schedule-or-alter pattern from 20260920000200.
-- 4. get_pr_count_rankings / get_user_pr_rank now skip tombstoned PRs
--    (deleted_at IS NULL). get_exercise_mastery_rankings counts `exercises`,
--    which has no tombstone column; it is re-issued unchanged apart from the
--    explicit grants (KD-3 rule 3b).
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Snapshot table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leaderboard_snapshots (
  metric text NOT NULL,
  period text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  value numeric NOT NULL DEFAULT 0,
  rank bigint NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leaderboard_snapshots_pkey PRIMARY KEY (metric, period, user_id),
  CONSTRAINT leaderboard_snapshots_period_check
    CHECK (period = 'all_time' OR period ~ '^\d{4}-\d{2}-\d{2}$')
);

-- Top-N reads: WHERE metric = ? AND period = ? ORDER BY rank, user_id.
CREATE INDEX IF NOT EXISTS idx_leaderboard_snapshots_metric_period_rank
  ON public.leaderboard_snapshots (metric, period, rank, user_id);
-- Per-user reads: WHERE user_id = ? AND period = ?.
CREATE INDEX IF NOT EXISTS idx_leaderboard_snapshots_user_period
  ON public.leaderboard_snapshots (user_id, period);

COMMENT ON TABLE public.leaderboard_snapshots IS
  'Leaderboard values and ranks per participating profile, rebuilt every 15 minutes by refresh_leaderboard_snapshots(). Read by compute-rankings.';

ALTER TABLE public.leaderboard_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.leaderboard_snapshots FROM PUBLIC;
REVOKE ALL ON TABLE public.leaderboard_snapshots FROM anon;
REVOKE ALL ON TABLE public.leaderboard_snapshots FROM authenticated;
GRANT SELECT ON TABLE public.leaderboard_snapshots TO authenticated;
GRANT ALL ON TABLE public.leaderboard_snapshots TO service_role;

-- Authenticated FLAME+ users may read the snapshot. It only ever holds rows
-- of users who take part in leaderboards: the refresh writes participants
-- only, and the opt-out trigger below deletes a user's rows at once. (A
-- participation EXISTS on profiles cannot be used here: profiles RLS lets a
-- caller see only their own profile row.) The tier check mirrors
-- compute-rankings' FLAME gate so a direct PostgREST read cannot bypass it.
-- user_has_min_tier is authenticated-executable (20260920000100 allow-list);
-- the policy is TO authenticated only.
DROP POLICY IF EXISTS "Participants' leaderboard rows are readable" ON public.leaderboard_snapshots;
CREATE POLICY "Participants' leaderboard rows are readable"
  ON public.leaderboard_snapshots
  FOR SELECT
  TO authenticated
  USING (public.user_has_min_tier('FLAME'));

-- Opt-out takes effect immediately, not at the next refresh.
CREATE OR REPLACE FUNCTION public.remove_leaderboard_snapshots_on_opt_out()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.leaderboard_snapshots WHERE user_id = NEW.id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_leaderboard_snapshots_on_opt_out() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_leaderboard_snapshots_on_opt_out() FROM anon;
REVOKE ALL ON FUNCTION public.remove_leaderboard_snapshots_on_opt_out() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.remove_leaderboard_snapshots_on_opt_out() TO service_role;

DROP TRIGGER IF EXISTS trg_leaderboard_snapshots_opt_out ON public.profiles;
CREATE TRIGGER trg_leaderboard_snapshots_opt_out
  AFTER UPDATE OF leaderboard_participation ON public.profiles
  FOR EACH ROW
  WHEN (OLD.leaderboard_participation IS DISTINCT FROM NEW.leaderboard_participation
        AND NEW.leaderboard_participation IS NOT TRUE)
  EXECUTE FUNCTION public.remove_leaderboard_snapshots_on_opt_out();

-- ---------------------------------------------------------------------------
-- 2. Refresh function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_leaderboard_snapshots()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_week_start date := (date_trunc('week', v_now AT TIME ZONE 'UTC'))::date;
  v_week_from timestamptz := (v_week_start::timestamp AT TIME ZONE 'UTC');
  v_week_to timestamptz := ((v_week_start + 7)::timestamp AT TIME ZONE 'UTC');
  v_oldest_kept date := v_week_start - 84;
BEGIN
  -- Serialize overlapping runs (a slow run and the next cron tick).
  PERFORM pg_advisory_xact_lock(hashtext('public.refresh_leaderboard_snapshots'));

  DELETE FROM public.leaderboard_snapshots s
  WHERE s.period = 'all_time'
     OR s.period = v_week_start::text
     OR (s.period <> 'all_time' AND s.period < v_oldest_kept::text);

  WITH participants AS (
    SELECT p.id AS user_id
    FROM public.profiles p
    WHERE p.leaderboard_participation = true
  ),
  pr_all AS (
    SELECT pr.user_id, count(*)::numeric AS value
    FROM public.personal_records pr
    JOIN participants pa ON pa.user_id = pr.user_id
    WHERE pr.deleted_at IS NULL
    GROUP BY pr.user_id
  ),
  exercise_sessions AS (
    SELECT e.user_id, e.name, count(DISTINCT e.session_id) AS session_count
    FROM public.exercises e
    JOIN participants pa ON pa.user_id = e.user_id
    GROUP BY e.user_id, e.name
  ),
  mastery AS (
    SELECT es.user_id, count(*)::numeric AS value
    FROM exercise_sessions es
    WHERE es.session_count >= 10
    GROUP BY es.user_id
  ),
  week_sessions AS (
    SELECT ws.user_id,
           coalesce(sum(ws.total_volume), 0)::numeric AS volume,
           count(*)::numeric AS workouts
    FROM public.workout_sessions ws
    JOIN participants pa ON pa.user_id = ws.user_id
    WHERE ws.started_at >= v_week_from
      AND ws.started_at < v_week_to
    GROUP BY ws.user_id
  ),
  week_prs AS (
    SELECT pr.user_id, count(*)::numeric AS value
    FROM public.personal_records pr
    JOIN participants pa ON pa.user_id = pr.user_id
    WHERE pr.deleted_at IS NULL
      AND pr.achieved_at >= v_week_from
      AND pr.achieved_at < v_week_to
    GROUP BY pr.user_id
  ),
  vals AS (
    SELECT m.metric, 'all_time'::text AS period, pa.user_id,
           coalesce(
             CASE m.metric
               WHEN 'total_volume_kg' THEN gs.total_volume_kg::numeric
               WHEN 'total_workouts' THEN gs.total_workouts::numeric
               WHEN 'longest_streak' THEN gs.longest_streak::numeric
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
    LEFT JOIN pr_all ON pr_all.user_id = pa.user_id
    LEFT JOIN mastery ON mastery.user_id = pa.user_id
    UNION ALL
    SELECT m.metric, v_week_start::text, pa.user_id,
           coalesce(
             CASE m.metric
               WHEN 'total_volume_kg' THEN wk.volume
               WHEN 'total_workouts' THEN wk.workouts
               WHEN 'pr_count' THEN wp.value
             END,
             0
           )
    FROM participants pa
    CROSS JOIN (VALUES ('total_volume_kg'), ('total_workouts'), ('pr_count')) AS m(metric)
    LEFT JOIN week_sessions wk ON wk.user_id = pa.user_id
    LEFT JOIN week_prs wp ON wp.user_id = pa.user_id
  )
  INSERT INTO public.leaderboard_snapshots (metric, period, user_id, value, rank, computed_at)
  SELECT v.metric,
         v.period,
         v.user_id,
         v.value,
         rank() OVER (PARTITION BY v.metric, v.period ORDER BY v.value DESC),
         v_now
  FROM vals v;
END;
$$;

COMMENT ON FUNCTION public.refresh_leaderboard_snapshots() IS
  'Rebuilds all-time and current-week leaderboard_snapshots rows for participating profiles (tombstoned PRs excluded, volumes per-cable as stored). Run by pg_cron every 15 minutes; service_role only.';

REVOKE ALL ON FUNCTION public.refresh_leaderboard_snapshots() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_leaderboard_snapshots() FROM anon;
REVOKE ALL ON FUNCTION public.refresh_leaderboard_snapshots() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_leaderboard_snapshots() TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Ranking RPCs (latest bodies: 20260412_leaderboard_functions.sql).
--    Signatures unchanged, so CREATE OR REPLACE; tombstones excluded.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pr_count_rankings(result_limit int DEFAULT 100)
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
      AND pr.deleted_at IS NULL
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

COMMENT ON FUNCTION public.get_pr_count_rankings(int) IS
  'Returns users ranked by their active (non-tombstoned) personal record count, filtered by leaderboard participation.';

CREATE OR REPLACE FUNCTION public.get_user_pr_rank(target_user_id uuid)
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
      AND pr.deleted_at IS NULL
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

COMMENT ON FUNCTION public.get_user_pr_rank(uuid) IS
  'Returns a specific user''s active (non-tombstoned) PR count and rank among leaderboard participants.';

CREATE OR REPLACE FUNCTION public.get_exercise_mastery_rankings(result_limit int DEFAULT 100)
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

REVOKE ALL ON FUNCTION public.get_pr_count_rankings(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pr_count_rankings(int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pr_count_rankings(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pr_count_rankings(int) TO service_role;

REVOKE ALL ON FUNCTION public.get_user_pr_rank(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_pr_rank(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_pr_rank(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_pr_rank(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.get_exercise_mastery_rankings(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_exercise_mastery_rankings(int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_exercise_mastery_rankings(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_exercise_mastery_rankings(int) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. pg_cron: every 15 minutes, pure SQL. Scheduled only when no job of that
--    name exists; altered in place (same jobid, active flag and history kept)
--    only when schedule or command differ (pattern from 20260920000200).
--    The job runs as postgres (function owner). Skipped without pg_cron.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  j record;
  v_jobid bigint;
  v_schedule text;
  v_command text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skip scheduling refresh-leaderboard-snapshots';
    RETURN;
  END IF;

  FOR j IN
    SELECT *
    FROM (VALUES
      ('refresh-leaderboard-snapshots', '*/15 * * * *', 'SELECT public.refresh_leaderboard_snapshots()')
    ) AS v(jobname, schedule, command)
  LOOP
    EXECUTE 'SELECT jobid, schedule, command FROM cron.job WHERE jobname = $1 ORDER BY jobid LIMIT 1'
      INTO v_jobid, v_schedule, v_command
      USING j.jobname;

    IF v_jobid IS NULL THEN
      PERFORM cron.schedule(j.jobname, j.schedule, j.command);
    ELSIF v_schedule IS DISTINCT FROM j.schedule OR v_command IS DISTINCT FROM j.command THEN
      PERFORM cron.alter_job(v_jobid, schedule := j.schedule, command := j.command);
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Populate once now, so leaderboards are not empty until the first tick.
-- ---------------------------------------------------------------------------
SELECT public.refresh_leaderboard_snapshots();
