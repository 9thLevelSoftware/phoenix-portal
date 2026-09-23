-- NF-36: gate exercise_progress.velocity_estimated_1rm_kg at INFERNO.
--
-- APPLY ONLY AFTER THE SPA WITH THE EXPLICIT-COLUMN READER (PR #208,
-- weeklySummaryOptions in src/queries/progress.ts) IS LIVE. The previously
-- deployed SPA read exercise_progress with select("*"), which PostgreSQL
-- refuses outright once any column is unreadable, so shipping this revoke
-- first would break the weekly/monthly summary for every user.
--
-- exercise_progress.velocity_estimated_1rm_kg is a VBT (biomechanics) metric,
-- so it follows the INFERNO read gate of 20260920003800 (vbt_assessments,
-- session_phase_statistics, ...). RLS is row-level, so the gate is a column
-- privilege: client roles may read every exercise_progress column except this
-- one, and the two progress RPCs (now SECURITY DEFINER, still caller-scoped by
-- auth.uid()) return it only when user_has_min_tier('INFERNO'). Signatures and
-- return types are unchanged, so database.types.ts does not change.
--
-- Idempotent throughout; re-applying converges.

BEGIN;

REVOKE SELECT ON public.exercise_progress FROM anon, authenticated;
REVOKE SELECT (velocity_estimated_1rm_kg) ON public.exercise_progress FROM anon, authenticated;

-- A fixed allow-list, never read from the catalog: re-running this file after
-- a later migration adds a column must not make that column browser-readable.
GRANT SELECT (
  id, user_id, exercise_name, session_id, recorded_at, max_weight_kg,
  total_volume_kg, estimated_1rm_kg, max_reps, set_count, local_profile_id,
  exercise_id
) ON public.exercise_progress TO authenticated;

CREATE OR REPLACE FUNCTION public.exercise_progress_series(
  p_exercise text,
  p_profile_id text DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS SETOF public.exercise_progress
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- MATERIALIZED: one entitlement lookup per call, not one per progress row.
  WITH gate AS MATERIALIZED (
    SELECT public.user_has_min_tier('INFERNO') AS inferno
  )
  -- An explicit allow-list: the row type is kept for the signature, but a
  -- column added to exercise_progress later comes back NULL until it is
  -- deliberately listed here (this function is SECURITY DEFINER).
  SELECT masked.*
  FROM public.exercise_progress ep
  CROSS JOIN gate
  CROSS JOIN LATERAL pg_catalog.jsonb_populate_record(
    NULL::public.exercise_progress,
    pg_catalog.jsonb_build_object(
      'id', ep.id, 'user_id', ep.user_id, 'exercise_name', ep.exercise_name,
      'session_id', ep.session_id, 'recorded_at', ep.recorded_at,
      'max_weight_kg', ep.max_weight_kg, 'total_volume_kg', ep.total_volume_kg,
      'estimated_1rm_kg', ep.estimated_1rm_kg, 'max_reps', ep.max_reps,
      'set_count', ep.set_count, 'local_profile_id', ep.local_profile_id,
      'exercise_id', ep.exercise_id,
      'velocity_estimated_1rm_kg',
        CASE WHEN gate.inferno THEN ep.velocity_estimated_1rm_kg END
    )
  ) AS masked
  WHERE ep.user_id = auth.uid()
    AND ep.exercise_name = p_exercise
    AND (p_profile_id IS NULL OR ep.local_profile_id = p_profile_id)
  ORDER BY ep.recorded_at DESC, ep.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
$$;

COMMENT ON FUNCTION public.exercise_progress_series(text, text, integer) IS
  'Caller-scoped (auth.uid()): newest exercise_progress rows for one exercise, recorded_at DESC, id DESC. Limit clamped 1..1000 (NULL/default 500). SECURITY DEFINER only to read velocity_estimated_1rm_kg, which is null below INFERNO.';

REVOKE ALL ON FUNCTION public.exercise_progress_series(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exercise_progress_series(text, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.exercise_progress_series_many(
  p_exercises text[] DEFAULT NULL,
  p_profile_id text DEFAULT NULL,
  p_limit_per_exercise integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- MATERIALIZED: one entitlement lookup per call, not one per progress row.
  WITH gate AS MATERIALIZED (
    SELECT public.user_has_min_tier('INFERNO') AS inferno
  )
  , ranked AS (
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
      -- The same explicit allow-list as exercise_progress_series.
      jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', r.id, 'user_id', r.user_id, 'exercise_name', r.exercise_name,
          'session_id', r.session_id, 'recorded_at', r.recorded_at,
          'max_weight_kg', r.max_weight_kg, 'total_volume_kg', r.total_volume_kg,
          'estimated_1rm_kg', r.estimated_1rm_kg, 'max_reps', r.max_reps,
          'set_count', r.set_count, 'local_profile_id', r.local_profile_id,
          'exercise_id', r.exercise_id,
          'velocity_estimated_1rm_kg',
            CASE WHEN gate.inferno THEN r.velocity_estimated_1rm_kg END
        )
        ORDER BY r.recorded_at DESC, r.id DESC
      ) AS rows
    FROM ranked r
    CROSS JOIN gate
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
  'Caller-scoped (auth.uid()): one JSONB array of exercise groups, each with its newest exercise_progress rows (recorded_at DESC, id DESC). Per-exercise limit clamped 1..1000 (NULL/default 100). SECURITY DEFINER only to read velocity_estimated_1rm_kg, which is null below INFERNO.';

REVOKE ALL ON FUNCTION public.exercise_progress_series_many(text[], text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exercise_progress_series_many(text[], text, integer) TO authenticated;

COMMIT;
