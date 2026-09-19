-- ============================================================================
-- PR 40: SQL aggregate RPCs for analytics, progress, records and profile stats
--
-- The SPA currently reads these through unbounded PostgREST selects:
--   * "fetch every session id, then .in(session_id, ids)" fails once the id
--     list outgrows the URL (~200 sessions) (F-035);
--   * ascending selects are cut at PostgREST's 1,000-row max, so the NEWEST
--     progress rows and personal records are the ones dropped (F-034).
-- These functions move the aggregation / newest-first paging into SQL.
-- The SPA switches to them in PR 41 / PR 42 (KD-3 rule 2: no SPA call to a
-- DB object in the PR that introduces it).
--
-- Every function is:
--   * SECURITY INVOKER, so RLS on the underlying tables still applies;
--   * caller-scoped: it takes no user id and adds `user_id = auth.uid()`
--     explicitly (belt and braces over RLS, and it keeps the plans on the
--     user_id indexes). A caller without a JWT subject gets no rows;
--   * search_path pinned to '' with every relation schema-qualified;
--   * executable by `authenticated` only (KD-3 rule 3b). service_role is not
--     granted: auth.uid() is NULL for it, so it could only ever see nothing.
--
-- Profile filter mirrors the SPA's `.eq("local_profile_id", profileId)`:
-- NULL p_profile_id means "all profiles".
--
-- Weights (KD-8): stored volumes are per cable. Nothing here multiplies them;
-- the display layer (PR 30) owns any per-cable / total presentation.
--
-- Tombstones: personal_records rows with deleted_at set are excluded
-- everywhere (same rule as PR 16 / PR 56).
--
-- Idempotency: DROP FUNCTION IF EXISTS <exact signature> + CREATE, so a
-- re-run never leaves a second overload behind (KD-3 rule 3).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- exercise_frequency: how many sessions each exercise appears in.
-- `exercises` has no local_profile_id, so the profile filter goes through
-- the parent workout_sessions row. muscle_group is returned raw; the SPA
-- classifies by name (the stored column was historically "General").
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.exercise_frequency(text);

CREATE FUNCTION public.exercise_frequency(p_profile_id text DEFAULT NULL)
RETURNS TABLE (exercise_name text, muscle_group text, sessions integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    e.name AS exercise_name,
    e.muscle_group,
    count(DISTINCT e.session_id)::integer AS sessions
  FROM public.exercises e
  JOIN public.workout_sessions ws ON ws.id = e.session_id
  WHERE e.user_id = auth.uid()
    AND ws.user_id = auth.uid()
    AND (p_profile_id IS NULL OR ws.local_profile_id = p_profile_id)
  GROUP BY e.name, e.muscle_group
  ORDER BY sessions DESC, exercise_name ASC, muscle_group ASC;
$$;

COMMENT ON FUNCTION public.exercise_frequency(text) IS
  'Caller-scoped: distinct session count per (exercise name, raw muscle_group). NULL profile = all profiles.';

REVOKE ALL ON FUNCTION public.exercise_frequency(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exercise_frequency(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.exercise_frequency(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- exercise_names: distinct exercise names with progress rows, A-Z.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.exercise_names(text);

CREATE FUNCTION public.exercise_names(p_profile_id text DEFAULT NULL)
RETURNS TABLE (exercise_name text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT DISTINCT ep.exercise_name
  FROM public.exercise_progress ep
  WHERE ep.user_id = auth.uid()
    AND (p_profile_id IS NULL OR ep.local_profile_id = p_profile_id)
  ORDER BY ep.exercise_name ASC;
$$;

COMMENT ON FUNCTION public.exercise_names(text) IS
  'Caller-scoped: distinct exercise_progress.exercise_name values, ascending. NULL profile = all profiles.';

REVOKE ALL ON FUNCTION public.exercise_names(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exercise_names(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.exercise_names(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- exercise_progress_series: the newest p_limit progress rows for one
-- exercise, newest first (recorded_at DESC, id DESC). p_limit is clamped to
-- 1..1000 (NULL -> 500). estimated_1rm_kg is returned verbatim as stored from
-- mobile (1RM parity rule: never recomputed here).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.exercise_progress_series(text, text, integer);

CREATE FUNCTION public.exercise_progress_series(
  p_exercise text,
  p_profile_id text DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS SETOF public.exercise_progress
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT ep.*
  FROM public.exercise_progress ep
  WHERE ep.user_id = auth.uid()
    AND ep.exercise_name = p_exercise
    AND (p_profile_id IS NULL OR ep.local_profile_id = p_profile_id)
  ORDER BY ep.recorded_at DESC, ep.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
$$;

COMMENT ON FUNCTION public.exercise_progress_series(text, text, integer) IS
  'Caller-scoped: newest exercise_progress rows for one exercise, recorded_at DESC, id DESC. Limit clamped 1..1000 (default 500).';

REVOKE ALL ON FUNCTION public.exercise_progress_series(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exercise_progress_series(text, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.exercise_progress_series(text, text, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- personal_record_history: keyset pages of live personal records, newest
-- first (achieved_at DESC, id DESC).
--
-- Cursor: pass the LAST row of the previous page as (p_before, p_before_id).
-- Several PRs routinely share one achieved_at (one set can produce
-- MAX_WEIGHT and MAX_VOLUME), so the id tie-break is what makes the pages
-- lossless. p_before without p_before_id falls back to a strict
-- `achieved_at < p_before` (may skip rows tied with the cursor).
-- p_limit is clamped to 1..1000 (NULL -> 200). Tombstoned rows
-- (deleted_at IS NOT NULL) are never returned.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.personal_record_history(text, integer, timestamptz, uuid);

CREATE FUNCTION public.personal_record_history(
  p_profile_id text DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_before timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
)
RETURNS SETOF public.personal_records
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pr.*
  FROM public.personal_records pr
  WHERE pr.user_id = auth.uid()
    AND pr.deleted_at IS NULL
    AND (p_profile_id IS NULL OR pr.local_profile_id = p_profile_id)
    AND (
      p_before IS NULL
      OR (p_before_id IS NULL AND pr.achieved_at < p_before)
      OR (p_before_id IS NOT NULL AND (pr.achieved_at, pr.id) < (p_before, p_before_id))
    )
  ORDER BY pr.achieved_at DESC, pr.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
$$;

COMMENT ON FUNCTION public.personal_record_history(text, integer, timestamptz, uuid) IS
  'Caller-scoped keyset pages of live (deleted_at IS NULL) personal records, achieved_at DESC, id DESC. Cursor = last row''s (achieved_at, id). Limit clamped 1..1000 (default 200).';

REVOKE ALL ON FUNCTION public.personal_record_history(text, integer, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.personal_record_history(text, integer, timestamptz, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.personal_record_history(text, integer, timestamptz, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- profile_workout_stats: one row.
--   total_workouts  count of sessions
--   total_volume    sum(workout_sessions.total_volume) as STORED (per cable,
--                   KD-8). No x2: the SPA's current WEIGHT_MULTIPLIER on this
--                   figure is the doubling KD-8 forbids.
--   best_streak     longest run of consecutive UTC calendar days with a
--                   session (same UTC day rule as workout_current_streak);
--                   0 when there are no sessions
--   pr_count        live personal records (deleted_at IS NULL)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.profile_workout_stats(text);

CREATE FUNCTION public.profile_workout_stats(p_profile_id text DEFAULT NULL)
RETURNS TABLE (
  total_workouts integer,
  total_volume numeric,
  best_streak integer,
  pr_count integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH sessions AS (
    SELECT ws.started_at, ws.total_volume
    FROM public.workout_sessions ws
    WHERE ws.user_id = auth.uid()
      AND (p_profile_id IS NULL OR ws.local_profile_id = p_profile_id)
  ),
  days AS (
    SELECT DISTINCT (s.started_at AT TIME ZONE 'UTC')::date AS d
    FROM sessions s
  ),
  islands AS (
    SELECT d - (ROW_NUMBER() OVER (ORDER BY d))::integer AS grp
    FROM days
  )
  SELECT
    (SELECT count(*)::integer FROM sessions),
    (SELECT COALESCE(sum(s.total_volume), 0)::numeric FROM sessions s),
    COALESCE((SELECT max(n)::integer FROM (SELECT count(*) AS n FROM islands GROUP BY grp) runs), 0),
    (
      SELECT count(*)::integer
      FROM public.personal_records pr
      WHERE pr.user_id = auth.uid()
        AND pr.deleted_at IS NULL
        AND (p_profile_id IS NULL OR pr.local_profile_id = p_profile_id)
    );
$$;

COMMENT ON FUNCTION public.profile_workout_stats(text) IS
  'Caller-scoped profile stats: session count, stored per-cable volume sum (no x2, KD-8), best UTC-day streak, live PR count.';

REVOKE ALL ON FUNCTION public.profile_workout_stats(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_workout_stats(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.profile_workout_stats(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- session_volume_buckets: weekly buckets (ISO weeks, Monday start, UTC).
-- p_period mirrors src/queries/analytics.ts periodToDays / periodCutoffISO:
--   '1w' = 7 days, '4w' = 28, '12w' = 84, '52w' = 365, 'all' = no cutoff.
-- Anything else raises 22023. Volumes are stored per-cable sums (KD-8).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.session_volume_buckets(text, text);

CREATE FUNCTION public.session_volume_buckets(
  p_period text DEFAULT 'all',
  p_profile_id text DEFAULT NULL
)
RETURNS TABLE (
  week_start date,
  sessions integer,
  total_volume numeric,
  total_duration_seconds bigint,
  total_sets bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_days integer;
BEGIN
  v_days := CASE p_period
    WHEN '1w' THEN 7
    WHEN '4w' THEN 28
    WHEN '12w' THEN 84
    WHEN '52w' THEN 365
    WHEN 'all' THEN NULL
    ELSE -1
  END;

  IF v_days = -1 OR p_period IS NULL THEN
    RAISE EXCEPTION 'session_volume_buckets: unknown period %', p_period
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    date_trunc('week', ws.started_at AT TIME ZONE 'UTC')::date AS week_start,
    count(*)::integer AS sessions,
    COALESCE(sum(ws.total_volume), 0)::numeric AS total_volume,
    COALESCE(sum(ws.duration_seconds), 0)::bigint AS total_duration_seconds,
    COALESCE(sum(ws.set_count), 0)::bigint AS total_sets
  FROM public.workout_sessions ws
  WHERE ws.user_id = auth.uid()
    AND (p_profile_id IS NULL OR ws.local_profile_id = p_profile_id)
    AND (v_days IS NULL OR ws.started_at >= now() - make_interval(days => v_days))
  GROUP BY 1
  ORDER BY 1 ASC;
END;
$$;

COMMENT ON FUNCTION public.session_volume_buckets(text, text) IS
  'Caller-scoped weekly (ISO week, UTC) session buckets; period 1w|4w|12w|52w|all. Volumes as stored (per cable, KD-8).';

REVOKE ALL ON FUNCTION public.session_volume_buckets(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.session_volume_buckets(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.session_volume_buckets(text, text) TO authenticated;
