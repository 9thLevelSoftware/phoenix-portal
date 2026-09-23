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

DO $$
DECLARE
  cols text;
BEGIN
  -- Every other column, read from the catalog so a drifted table converges.
  -- A column added later is not client-readable until granted here or in a
  -- later migration.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'exercise_progress'
    AND column_name <> 'velocity_estimated_1rm_kg';

  EXECUTE format('GRANT SELECT (%s) ON public.exercise_progress TO authenticated', cols);
END
$$;

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
  WITH gate AS (
    SELECT public.user_has_min_tier('INFERNO') AS inferno
  )
  SELECT masked.*
  FROM public.exercise_progress ep
  CROSS JOIN gate
  CROSS JOIN LATERAL pg_catalog.jsonb_populate_record(
    ep,
    CASE WHEN gate.inferno THEN '{}'::jsonb
         ELSE '{"velocity_estimated_1rm_kg": null}'::jsonb END
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
  WITH gate AS (
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
      jsonb_agg(
        (to_jsonb(r) - 'rn')
          || CASE WHEN gate.inferno THEN '{}'::jsonb
                  ELSE '{"velocity_estimated_1rm_kg": null}'::jsonb END
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
