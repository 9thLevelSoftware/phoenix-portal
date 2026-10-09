-- Prevent callers from using the definer's privileges to read another user's
-- private fitness aggregates. Keep service-role access for trusted backends.
CREATE OR REPLACE FUNCTION public.get_percentile_rank(
  p_user_id UUID,
  p_metric_type TEXT,
  p_metric_key TEXT DEFAULT NULL
)
RETURNS TABLE(user_value NUMERIC, percentile INTEGER, rank_description TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_user_value NUMERIC;
  v_percentile_values JSONB;
  v_total_users INT;
  v_percentile INT := 0;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied'
      USING ERRCODE = '42501';
  END IF;

  SELECT cb.total_users, cb.percentile_values
  INTO v_total_users, v_percentile_values
  FROM public.community_benchmarks cb
  WHERE cb.metric_type = p_metric_type
    AND (p_metric_key IS NULL OR cb.metric_key = p_metric_key)
  LIMIT 1;

  IF v_total_users IS NULL OR v_total_users < 1 THEN
    RETURN QUERY
    SELECT 0::NUMERIC, 0, 'Insufficient community data'::TEXT;
    RETURN;
  END IF;

  CASE p_metric_type
    WHEN 'total_volume' THEN
      SELECT COALESCE(SUM(ws.total_volume), 0)
      INTO v_user_value
      FROM public.workout_sessions ws
      WHERE ws.user_id = p_user_id;
    WHEN 'weekly_frequency' THEN
      SELECT COUNT(DISTINCT (ws.started_at AT TIME ZONE 'UTC')::DATE)::NUMERIC
        / GREATEST(EXTRACT(EPOCH FROM (now() - MIN(ws.started_at))) / 604800.0, 1)
      INTO v_user_value
      FROM public.workout_sessions ws
      WHERE ws.user_id = p_user_id;
    WHEN 'exercise_1rm' THEN
      SELECT COALESCE(MAX(ep.estimated_1rm_kg), 0)
      INTO v_user_value
      FROM public.exercise_progress ep
      WHERE ep.user_id = p_user_id
        AND (p_metric_key IS NULL OR ep.exercise_name = p_metric_key);
    WHEN 'best_streak' THEN
      SELECT COALESCE(MAX(gs.longest_streak), 0)
      INTO v_user_value
      FROM public.gamification_stats gs
      WHERE gs.user_id = p_user_id;
    ELSE
      v_user_value := 0;
  END CASE;

  IF v_user_value >= (v_percentile_values->>'p95')::NUMERIC THEN
    v_percentile := 97;
  ELSIF v_user_value >= (v_percentile_values->>'p90')::NUMERIC THEN
    v_percentile := 92;
  ELSIF v_user_value >= (v_percentile_values->>'p75')::NUMERIC THEN
    v_percentile := 82;
  ELSIF v_user_value >= (v_percentile_values->>'p50')::NUMERIC THEN
    v_percentile := 62;
  ELSIF v_user_value >= (v_percentile_values->>'p25')::NUMERIC THEN
    v_percentile := 37;
  ELSE
    v_percentile := 12;
  END IF;
  v_percentile := LEAST(99, GREATEST(1, v_percentile));

  RETURN QUERY
  SELECT
    ROUND(v_user_value, 1),
    v_percentile,
    CASE
      WHEN v_percentile >= 90 THEN 'Elite (Top 10%)'
      WHEN v_percentile >= 75 THEN 'Advanced (Top 25%)'
      WHEN v_percentile >= 50 THEN 'Intermediate'
      WHEN v_percentile >= 25 THEN 'Developing'
      ELSE 'Beginner'
    END;
END;
$$;

-- Service-role-only: this function reads cross-user aggregates from
-- community_benchmarks and is deliberately NOT on the browser allow-list in
-- supabase/tests/database/definer_function_grants.test.sql. The explicit
-- authenticated revoke is required because CREATE OR REPLACE FUNCTION
-- preserves existing privileges.
REVOKE ALL ON FUNCTION public.get_percentile_rank(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_percentile_rank(UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.get_percentile_rank(UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_percentile_rank(UUID, TEXT, TEXT) TO service_role;
