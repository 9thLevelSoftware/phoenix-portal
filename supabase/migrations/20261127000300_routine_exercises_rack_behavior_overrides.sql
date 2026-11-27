BEGIN;

SET LOCAL lock_timeout = '5s';

-- AUD-041: Persist per-exercise rack behavior overrides on routine_exercises.
-- Additive & nullable so older mobile clients and community snapshots keep working.
ALTER TABLE public.routine_exercises
  ADD COLUMN IF NOT EXISTS rack_behavior_overrides JSONB NULL;

COMMENT ON COLUMN public.routine_exercises.rack_behavior_overrides IS
  'Optional JSON map of rackItemId -> behavior name overriding profile rack defaults for this routine exercise. SQL NULL when unset, empty object when explicitly cleared.';

-- Preserve mobile rack overrides on same-ID portal exercise replacements.
CREATE OR REPLACE FUNCTION public.update_routine_with_exercises(
  p_routine_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_exercise_count INT,
  p_estimated_duration INT,
  p_exercises JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_updated UUID;
  v_resolved JSONB;
BEGIN
  -- Validate before mutating: a malformed payload must abort, not silently
  -- clear the children below.
  PERFORM public.assert_child_payload(p_exercises, 'invalid_exercises_payload');

  UPDATE public.routines
     SET name = p_name,
         description = p_description,
         exercise_count = p_exercise_count,
         estimated_duration = p_estimated_duration
   WHERE id = p_routine_id
     AND user_id = auth.uid()
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'routine_not_found_or_forbidden'
      USING ERRCODE = 'P0001';
  END IF;

  -- An `id` that is not canonical uuid text is a caller bug, not a request to
  -- mint a new row: fail loudly rather than quietly churning the id.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_exercises) AS elem
    WHERE elem ? 'id'
      AND jsonb_typeof(elem->'id') <> 'null'
      AND (
        jsonb_typeof(elem->'id') <> 'string'
        OR elem->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
  ) THEN
    RAISE EXCEPTION 'invalid_exercise_id: not a uuid'
      USING ERRCODE = 'P0001';
  END IF;

  -- Lock children in a stable order before reading the state carried over by
  -- the delete/reinsert so a concurrent child update cannot be overwritten.
  PERFORM 1
  FROM public.routine_exercises
  WHERE routine_id = p_routine_id
  ORDER BY id
  FOR UPDATE;

  -- Resolve every element's id BEFORE the delete below: keep an id that is
  -- already a child of THIS routine (carrying its created_at with it), mint a
  -- fresh one otherwise. A id belonging to another routine — the caller's or
  -- anyone else's — is not matched here and that row is never touched.
  SELECT COALESCE(jsonb_agg(s.resolved ORDER BY s.ord), '[]'::jsonb)
    INTO v_resolved
  FROM (
    SELECT t.ord,
           t.elem || jsonb_build_object(
             'id', COALESCE(existing.id, gen_random_uuid()),
             'created_at', COALESCE(existing.created_at, now()),
             'rack_behavior_overrides', CASE
               WHEN NOT (t.elem ? 'rack_behavior_overrides')
                 THEN existing.rack_behavior_overrides
               WHEN jsonb_typeof(t.elem->'rack_behavior_overrides') = 'null'
                 THEN '{}'::jsonb
               ELSE t.elem->'rack_behavior_overrides'
             END
           ) AS resolved
    FROM jsonb_array_elements(p_exercises) WITH ORDINALITY AS t(elem, ord)
    LEFT JOIN public.routine_exercises AS existing
           ON existing.routine_id = p_routine_id
          AND existing.id = CASE
                WHEN t.elem ? 'id' AND jsonb_typeof(t.elem->'id') = 'string'
                  THEN (t.elem->>'id')::uuid
              END
  ) AS s;

  IF (
    SELECT count(*) <> count(DISTINCT elem->>'id')
    FROM jsonb_array_elements(v_resolved) AS elem
  ) THEN
    RAISE EXCEPTION 'duplicate_exercise_id: an id appears twice in the payload'
      USING ERRCODE = 'P0001';
  END IF;

  -- Children omitted from the payload are removed; kept ones come straight
  -- back with the same id and created_at.
  DELETE FROM public.routine_exercises WHERE routine_id = p_routine_id;

  IF jsonb_array_length(v_resolved) > 0 THEN
    INSERT INTO public.routine_exercises
    SELECT (
      jsonb_populate_record(
        NULL::public.routine_exercises,
        elem || jsonb_build_object(
          'routine_id', p_routine_id,
          'drop_set_enabled', COALESCE((elem->>'drop_set_enabled')::boolean, false)
        )
      )
    ).*
    FROM jsonb_array_elements(v_resolved) AS elem;
  END IF;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.update_routine_with_exercises(UUID, TEXT, TEXT, INT, INT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_routine_with_exercises(UUID, TEXT, TEXT, INT, INT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_routine_with_exercises(UUID, TEXT, TEXT, INT, INT, JSONB) TO authenticated;

-- Keep community snapshot imports preserving rack_behavior_overrides while
-- retaining the 20260920000100 ownership guard and service_role-only grants.
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
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT EXISTS (
       SELECT 1
       FROM public.routines r
       WHERE r.id = p_routine_id
         AND r.user_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

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
    rack_behavior_overrides,
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
    ex.rack_behavior_overrides,
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
    rack_behavior_overrides JSONB,
    drop_set_enabled BOOLEAN,
    drop_set_min_weight_kg NUMERIC
  )
  ORDER BY COALESCE(ex.order_index, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.insert_routine_exercises_from_snapshot(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_routine_exercises_from_snapshot(UUID, JSONB)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
