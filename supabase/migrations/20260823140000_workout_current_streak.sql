-- UTC workout streak matching src/hooks/useStreak.ts:
-- unique (started_at AT TIME ZONE 'UTC')::date; if today is empty, start from
-- yesterday. Golden: 51 consecutive UTC dates ending yesterday → 51.
-- Owner-checked SECURITY DEFINER aggregate. No unpaged session dump.

CREATE OR REPLACE FUNCTION public.workout_current_streak(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH authorized AS (
    SELECT (auth.uid() IS NOT DISTINCT FROM p_user_id) AS ok
  ),
  days AS (
    SELECT DISTINCT (ws.started_at AT TIME ZONE 'UTC')::date AS d
    FROM public.workout_sessions ws
    WHERE ws.user_id = p_user_id
      AND (SELECT ok FROM authorized)
  ),
  today AS (
    SELECT (timezone('utc', now()))::date AS today
  ),
  anchor AS (
    SELECT CASE
      WHEN EXISTS (
        SELECT 1 FROM days, today WHERE days.d = today.today
      ) THEN (SELECT today FROM today)
      ELSE (SELECT today FROM today) - 1
    END AS start_day
  ),
  ranked AS (
    SELECT
      days.d,
      ROW_NUMBER() OVER (ORDER BY days.d DESC) AS rn,
      ((SELECT start_day FROM anchor) - days.d) AS expected_gap
    FROM days
    WHERE days.d <= (SELECT start_day FROM anchor)
  )
  SELECT COALESCE(
    (SELECT COUNT(*)::integer FROM ranked WHERE expected_gap = rn - 1),
    0
  );
$$;

COMMENT ON FUNCTION public.workout_current_streak(uuid) IS
  'UTC unique workout dates; if today empty start from yesterday. Golden: 51 consecutive UTC dates ending yesterday returns 51.';

REVOKE ALL ON FUNCTION public.workout_current_streak(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workout_current_streak(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.workout_current_streak(uuid) TO authenticated, service_role;
