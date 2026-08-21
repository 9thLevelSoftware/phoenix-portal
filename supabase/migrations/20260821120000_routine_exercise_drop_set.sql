-- Opt-in drop-set retry configuration on routine exercises (mobile #673 / PR #707).
-- dropSetEnabled / dropSetMinWeightKg are per-occurrence settings. The floor is
-- kg per cable, matching routine_exercises.weight. Defaults keep existing
-- routines disabled.

ALTER TABLE public.routine_exercises
  ADD COLUMN IF NOT EXISTS drop_set_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS drop_set_min_weight_kg NUMERIC;

COMMENT ON COLUMN public.routine_exercises.drop_set_enabled IS
  'When true, Old School cable working sets may offer a drop-set retry after stall failure.';

COMMENT ON COLUMN public.routine_exercises.drop_set_min_weight_kg IS
  'Per-cable kg floor for drop-set retries. NULL when the feature is disabled.';

-- Community import copies a fixed column list; grow it so share/import does
-- not drop the new settings. Omitted snapshot keys stay disabled/null.
CREATE OR REPLACE FUNCTION public.insert_routine_exercises_from_snapshot(
  p_routine_id UUID,
  p_snapshot JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'array' THEN
    RAISE EXCEPTION 'Routine snapshot is unavailable';
  END IF;

  INSERT INTO public.routine_exercises (
    routine_id,
    name,
    muscle_group,
    exercise_id,
    sets,
    reps,
    weight,
    rest_seconds,
    duration_seconds,
    mode,
    order_index,
    superset_id,
    superset_color,
    superset_order,
    per_set_weights,
    per_set_rest,
    per_set_reps,
    per_set_echo_levels,
    is_amrap,
    is_bodyweight,
    pr_percentage,
    rep_count_timing,
    stop_at_position,
    stall_detection,
    eccentric_load,
    echo_level,
    warmup_sets,
    drop_set_enabled,
    drop_set_min_weight_kg
  )
  SELECT
    p_routine_id,
    COALESCE(ex.name, 'Exercise'),
    COALESCE(ex.muscle_group, 'General'),
    ex.exercise_id,
    COALESCE(ex.sets, 3),
    COALESCE(ex.reps, 10),
    COALESCE(ex.weight, 0),
    COALESCE(ex.rest_seconds, 90),
    ex.duration_seconds,
    COALESCE(ex.mode, 'OLD_SCHOOL'),
    COALESCE(ex.order_index, 0),
    ex.superset_id,
    ex.superset_color,
    ex.superset_order,
    ex.per_set_weights,
    ex.per_set_rest,
    ex.per_set_reps,
    ex.per_set_echo_levels,
    COALESCE(ex.is_amrap, false),
    COALESCE(ex.is_bodyweight, false),
    ex.pr_percentage,
    ex.rep_count_timing,
    ex.stop_at_position,
    COALESCE(ex.stall_detection, true),
    ex.eccentric_load,
    ex.echo_level,
    ex.warmup_sets,
    COALESCE(ex.drop_set_enabled, false),
    ex.drop_set_min_weight_kg
  FROM jsonb_to_recordset(p_snapshot) AS ex(
    name TEXT,
    muscle_group TEXT,
    exercise_id TEXT,
    sets INT,
    reps INT,
    weight NUMERIC,
    rest_seconds INT,
    duration_seconds INT,
    mode TEXT,
    order_index INT,
    superset_id TEXT,
    superset_color TEXT,
    superset_order INT,
    per_set_weights JSONB,
    per_set_rest JSONB,
    per_set_reps JSONB,
    per_set_echo_levels JSONB,
    is_amrap BOOLEAN,
    is_bodyweight BOOLEAN,
    pr_percentage NUMERIC,
    rep_count_timing TEXT,
    stop_at_position TEXT,
    stall_detection BOOLEAN,
    eccentric_load TEXT,
    echo_level TEXT,
    warmup_sets TEXT,
    drop_set_enabled BOOLEAN,
    drop_set_min_weight_kg NUMERIC
  )
  ORDER BY COALESCE(ex.order_index, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.insert_routine_exercises_from_snapshot(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_routine_exercises_from_snapshot(UUID, JSONB) FROM anon;
