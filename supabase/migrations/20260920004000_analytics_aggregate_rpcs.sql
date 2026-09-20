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
-- No function returns more than 1,000 rows per call (PostgREST max_rows), so
-- no result can be silently truncated.
--
-- Profile filter mirrors the SPA's `.eq("local_profile_id", profileId)`:
-- NULL p_profile_id means "all profiles".
--
-- Time zones: p_tz is an IANA zone name (default 'UTC'), validated against
-- pg_timezone_names (22023 otherwise). Calendar days and weeks are computed
-- in that zone, so PR 41 can pass the browser zone and keep the SPA's
-- local-calendar semantics.
--
-- Weights (KD-8): stored volumes are per cable. Nothing here multiplies them;
-- the display layer (PR 30) owns any per-cable / total presentation.
--
-- Tombstones: personal_records rows with deleted_at set are excluded
-- everywhere (same rule as PR 16 / PR 56).
--
-- Idempotency: DROP FUNCTION IF EXISTS <exact signature> + CREATE, so a
-- re-run never leaves a second overload behind (KD-3 rule 3), and
-- CREATE INDEX IF NOT EXISTS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Indexes for the newest-first orders (none of the existing indexes leads
-- with achieved_at / recorded_at after the exercise name). Both tables are
-- small today (thousands of rows), so a plain CREATE INDEX is a short lock.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_personal_records_user_achieved_live
  ON public.personal_records (user_id, achieved_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_exercise_progress_user_exercise_recorded
  ON public.exercise_progress (user_id, exercise_name, recorded_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- exercise_frequency: one row per exercise NAME with the number of distinct
-- sessions it appears in (a name repeated within a session counts once).
-- muscle_group is the most recent non-'General' raw value for that name
-- (by session start, then exercise id), falling back to the most recent raw
-- value. The SPA still classifies by name; this is only the fallback hint.
-- `exercises` has no local_profile_id, so the profile filter goes through the
-- parent workout_sessions row.
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
    (
      array_agg(
        e.muscle_group
        ORDER BY
          (e.muscle_group IS NULL OR e.muscle_group = 'General'),
          ws.started_at DESC,
          e.id DESC
      )
    )[1] AS muscle_group,
    count(DISTINCT e.session_id)::integer AS sessions
  FROM public.exercises e
  JOIN public.workout_sessions ws ON ws.id = e.session_id
  WHERE e.user_id = auth.uid()
    AND ws.user_id = auth.uid()
    AND (p_profile_id IS NULL OR ws.local_profile_id = p_profile_id)
  GROUP BY e.name
  ORDER BY sessions DESC, exercise_name ASC;
$$;

COMMENT ON FUNCTION public.exercise_frequency(text) IS
  'Caller-scoped: one row per exercise name; sessions = distinct sessions containing it; muscle_group = latest non-General raw value. NULL profile = all profiles.';

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
  'Caller-scoped: newest exercise_progress rows for one exercise, recorded_at DESC, id DESC. Limit clamped 1..1000 (NULL/default 500).';

REVOKE ALL ON FUNCTION public.exercise_progress_series(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exercise_progress_series(text, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.exercise_progress_series(text, text, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- exercise_progress_series_many: the batched form for the progression
-- workbench, so it needs one call instead of one per exercise.
--
-- Returns ONE JSONB ARRAY: each element carries one exercise and its newest
-- p_limit_per_exercise exercise_progress rows (full row objects, recorded_at
-- DESC, id DESC). The scalar envelope is one PostgREST result row even when
-- p_exercises is NULL and the user has more than 1,000 distinct exercises.
-- p_exercises NULL = every exercise. p_limit_per_exercise is clamped to
-- 1..1000 (NULL -> 100). Exercises are ordered by their newest row, newest
-- first, then name.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.exercise_progress_series_many(text[], text, integer);

CREATE FUNCTION public.exercise_progress_series_many(
  p_exercises text[] DEFAULT NULL,
  p_profile_id text DEFAULT NULL,
  p_limit_per_exercise integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH ranked AS (
    SELECT
      ep.*,
      ROW_NUMBER() OVER (
        PARTITION BY ep.exercise_name
        ORDER BY ep.recorded_at DESC, ep.id DESC
      ) AS rn
    FROM public.exercise_progress ep
    WHERE ep.user_id = auth.uid()
      AND (p_exercises IS NULL OR ep.exercise_name = ANY (p_exercises))
      AND (p_profile_id IS NULL OR ep.local_profile_id = p_profile_id)
  )
  , grouped AS (
    SELECT
      r.exercise_name,
      max(r.recorded_at) AS latest_recorded_at,
      jsonb_agg(to_jsonb(r) - 'rn' ORDER BY r.recorded_at DESC, r.id DESC) AS rows
    FROM ranked r
    WHERE r.rn <= LEAST(GREATEST(COALESCE(p_limit_per_exercise, 100), 1), 1000)
    GROUP BY r.exercise_name
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'exercise_name', g.exercise_name,
        'latest_recorded_at', g.latest_recorded_at,
        'rows', g.rows
      )
      ORDER BY g.latest_recorded_at DESC, g.exercise_name ASC
    ),
    '[]'::jsonb
  )
  FROM grouped g;
$$;

COMMENT ON FUNCTION public.exercise_progress_series_many(text[], text, integer) IS
  'Caller-scoped: one JSONB array of exercise groups, each with its newest exercise_progress rows (recorded_at DESC, id DESC). Scalar envelope avoids PostgREST row truncation when NULL exercises means all. Per-exercise limit clamped 1..1000 (NULL/default 100).';

REVOKE ALL ON FUNCTION public.exercise_progress_series_many(text[], text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exercise_progress_series_many(text[], text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.exercise_progress_series_many(text[], text, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- personal_record_bests: compact goal-progress input. Returning one JSONB
-- envelope avoids truncating users with more than 1,000 exercise/type groups.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.personal_record_bests(text);

CREATE FUNCTION public.personal_record_bests(p_profile_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(best) ORDER BY best.exercise_name, best.exercise_id, best.record_type), '[]'::jsonb)
  FROM (
    SELECT
      pr.exercise_id,
      pr.exercise_name,
      upper(pr.record_type) AS record_type,
      max(pr.value) AS value
    FROM public.personal_records pr
    WHERE pr.user_id = auth.uid()
      AND pr.deleted_at IS NULL
      AND upper(pr.record_type) IN ('MAX_WEIGHT', '1RM')
      AND (p_profile_id IS NULL OR pr.local_profile_id = p_profile_id)
    GROUP BY pr.exercise_id, pr.exercise_name, upper(pr.record_type)
  ) best;
$$;

COMMENT ON FUNCTION public.personal_record_bests(text) IS
  'Caller-scoped: one JSONB array with the best live MAX_WEIGHT/1RM value per exercise identity and record type. NULL profile = all profiles.';

REVOKE ALL ON FUNCTION public.personal_record_bests(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.personal_record_bests(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.personal_record_bests(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- personal_record_history: keyset pages of live personal records, newest
-- first (achieved_at DESC, id DESC).
--
-- Cursor: pass the LAST row of the previous page back UNCHANGED as
--   p_before    = its `achieved_at` exactly as PostgREST returned it (text,
--                 microsecond precision; never re-serialised through a JS
--                 Date, which truncates to milliseconds);
--   p_before_id = its `id`.
-- Both or neither: one without the other raises 22023. The pair must match
-- a row of the caller's (live or tombstoned) personal records exactly;
-- otherwise 22023 is raised instead of silently skipping rows. That catches
-- a truncated timestamp, a garbled id, and a cursor row whose achieved_at
-- changed since the previous page (restart from the first page).
-- p_limit is clamped to 1..1000 (NULL -> 200). Tombstoned rows
-- (deleted_at IS NOT NULL) are never returned.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.personal_record_history(text, integer, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.personal_record_history(text, integer, text, uuid);

CREATE FUNCTION public.personal_record_history(
  p_profile_id text DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_before text DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
)
RETURNS SETOF public.personal_records
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_before timestamptz;
BEGIN
  IF (p_before IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'personal_record_history: p_before and p_before_id must be passed together'
      USING ERRCODE = '22023';
  END IF;

  IF p_before IS NOT NULL THEN
    BEGIN
      v_before := p_before::timestamptz;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'personal_record_history: p_before is not a timestamp: %', p_before
        USING ERRCODE = '22023';
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM public.personal_records c
      WHERE c.id = p_before_id
        AND c.user_id = auth.uid()
        AND c.achieved_at = v_before
    ) THEN
      RAISE EXCEPTION 'personal_record_history: cursor (%, %) does not match a record; pass the last row''s achieved_at and id unchanged', p_before, p_before_id
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN QUERY
  SELECT pr.*
  FROM public.personal_records pr
  WHERE pr.user_id = auth.uid()
    AND pr.deleted_at IS NULL
    AND (p_profile_id IS NULL OR pr.local_profile_id = p_profile_id)
    AND (v_before IS NULL OR (pr.achieved_at, pr.id) < (v_before, p_before_id))
  ORDER BY pr.achieved_at DESC, pr.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
END;
$$;

COMMENT ON FUNCTION public.personal_record_history(text, integer, text, uuid) IS
  'Caller-scoped keyset pages of live (deleted_at IS NULL) personal records, achieved_at DESC, id DESC. Cursor = last row''s achieved_at (exact text as returned) + id, both or neither, verified against the row (22023 otherwise). Limit clamped 1..1000 (NULL/default 200).';

REVOKE ALL ON FUNCTION public.personal_record_history(text, integer, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.personal_record_history(text, integer, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.personal_record_history(text, integer, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- profile_workout_stats: one row.
--   total_workouts  count of sessions (profile-filtered)
--   total_volume    sum(workout_sessions.total_volume) as STORED (per cable,
--                   KD-8), profile-filtered. No x2: the SPA's current
--                   WEIGHT_MULTIPLIER on this figure is the doubling KD-8
--                   forbids.
--   best_streak     longest run of consecutive calendar days (in p_tz) with a
--                   session. ACCOUNT-WIDE, i.e. p_profile_id is ignored, to
--                   match the current streak the Profile page shows
--                   (useStreak over workoutListOptions(userId), no profile
--                   filter). With p_tz = 'UTC' it uses the same day rule as
--                   workout_current_streak / useStreak, so best >= current
--                   always holds. 0 when there are no sessions.
--   pr_count        live personal records (deleted_at IS NULL), profile-
--                   filtered
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.profile_workout_stats(text);
DROP FUNCTION IF EXISTS public.profile_workout_stats(text, text);

CREATE FUNCTION public.profile_workout_stats(
  p_profile_id text DEFAULT NULL,
  p_tz text DEFAULT 'UTC'
)
RETURNS TABLE (
  total_workouts integer,
  total_volume numeric,
  best_streak integer,
  pr_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_tz IS NULL OR (
    p_tz <> 'UTC'
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names tz WHERE tz.name = p_tz)
  ) THEN
    RAISE EXCEPTION 'profile_workout_stats: unknown time zone %', p_tz
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH sessions AS (
    SELECT ws.started_at, ws.total_volume
    FROM public.workout_sessions ws
    WHERE ws.user_id = auth.uid()
      AND (p_profile_id IS NULL OR ws.local_profile_id = p_profile_id)
  ),
  days AS (
    SELECT DISTINCT (ws.started_at AT TIME ZONE p_tz)::date AS d
    FROM public.workout_sessions ws
    WHERE ws.user_id = auth.uid()
  ),
  islands AS (
    SELECT days.d - (ROW_NUMBER() OVER (ORDER BY days.d))::integer AS grp
    FROM days
  )
  SELECT
    (SELECT count(*)::integer FROM sessions),
    (SELECT COALESCE(sum(s.total_volume), 0)::numeric FROM sessions s),
    COALESCE(
      (SELECT max(runs.n)::integer FROM (SELECT count(*) AS n FROM islands GROUP BY islands.grp) runs),
      0
    ),
    (
      SELECT count(*)::integer
      FROM public.personal_records pr
      WHERE pr.user_id = auth.uid()
        AND pr.deleted_at IS NULL
        AND (p_profile_id IS NULL OR pr.local_profile_id = p_profile_id)
    );
END;
$$;

COMMENT ON FUNCTION public.profile_workout_stats(text, text) IS
  'Caller-scoped profile stats: session count, stored per-cable volume sum (no x2, KD-8) and live PR count (profile-filtered); best consecutive-day streak in p_tz (IANA, default UTC), account-wide like the current streak.';

REVOKE ALL ON FUNCTION public.profile_workout_stats(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_workout_stats(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.profile_workout_stats(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- session_volume_buckets: weekly buckets in the caller's time zone.
-- week_start = the Monday (in p_tz) of the week containing the session's
-- local start, i.e. `date_trunc('week', started_at AT TIME ZONE p_tz)`. This
-- is the SPA's bucketByWeek rule (Analytics.tsx: local getDay/getDate, Sunday
-- belongs to the preceding Monday) when p_tz is the browser zone.
-- p_period mirrors src/queries/analytics.ts periodToDays / periodCutoffISO:
--   '1w' = 7 days, '4w' = 28, '12w' = 84, '52w' = 365, 'all' = no cutoff.
-- The cutoff is "now minus N calendar days" in p_tz (the SPA's local
-- setDate), inclusive. Anything else raises 22023, as does an unknown zone.
-- Volumes are stored per-cable sums (KD-8).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.session_volume_buckets(text, text);
DROP FUNCTION IF EXISTS public.session_volume_buckets(text, text, text);

CREATE FUNCTION public.session_volume_buckets(
  p_period text DEFAULT 'all',
  p_profile_id text DEFAULT NULL,
  p_tz text DEFAULT 'UTC'
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
  v_cutoff timestamptz;
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

  IF p_tz IS NULL OR (
    p_tz <> 'UTC'
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names tz WHERE tz.name = p_tz)
  ) THEN
    RAISE EXCEPTION 'session_volume_buckets: unknown time zone %', p_tz
      USING ERRCODE = '22023';
  END IF;

  IF v_days IS NOT NULL THEN
    v_cutoff := ((now() AT TIME ZONE p_tz) - make_interval(days => v_days)) AT TIME ZONE p_tz;
  END IF;

  RETURN QUERY
  SELECT
    date_trunc('week', ws.started_at AT TIME ZONE p_tz)::date AS week_start,
    count(*)::integer AS sessions,
    COALESCE(sum(ws.total_volume), 0)::numeric AS total_volume,
    COALESCE(sum(ws.duration_seconds), 0)::bigint AS total_duration_seconds,
    COALESCE(sum(ws.set_count), 0)::bigint AS total_sets
  FROM public.workout_sessions ws
  WHERE ws.user_id = auth.uid()
    AND (p_profile_id IS NULL OR ws.local_profile_id = p_profile_id)
    AND (v_cutoff IS NULL OR ws.started_at >= v_cutoff)
  GROUP BY 1
  ORDER BY 1 ASC;
END;
$$;

COMMENT ON FUNCTION public.session_volume_buckets(text, text, text) IS
  'Caller-scoped weekly buckets (Monday week start in p_tz, IANA, default UTC); period 1w|4w|12w|52w|all. Volumes as stored (per cable, KD-8).';

REVOKE ALL ON FUNCTION public.session_volume_buckets(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.session_volume_buckets(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.session_volume_buckets(text, text, text) TO authenticated;
