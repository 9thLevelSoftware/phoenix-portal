-- Follow-up to 20260821120000 (already applied in prod):
-- 1. jsonb_populate_record(NULL::routine_exercises, elem) treats omitted keys
--    as NULL, so a cached/legacy portal payload without drop_set_enabled fails
--    the NOT NULL column. Default omitted/null keys to false.
-- 2. Add CHECK constraints that 20260821120000 could not land in prod.

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
BEGIN
  IF p_exercises IS NULL OR jsonb_typeof(p_exercises) <> 'array' THEN
    RAISE EXCEPTION 'invalid_exercises_payload: expected a JSON array'
      USING ERRCODE = 'P0001';
  END IF;

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

  DELETE FROM public.routine_exercises WHERE routine_id = p_routine_id;

  IF jsonb_array_length(p_exercises) > 0 THEN
    INSERT INTO public.routine_exercises
    SELECT (
      jsonb_populate_record(
        NULL::public.routine_exercises,
        elem || jsonb_build_object(
          'id', gen_random_uuid(),
          'created_at', now(),
          'routine_id', p_routine_id,
          'drop_set_enabled', COALESCE((elem->>'drop_set_enabled')::boolean, false)
        )
      )
    ).*
    FROM jsonb_array_elements(p_exercises) AS elem;
  END IF;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.update_routine_with_exercises(UUID, TEXT, TEXT, INT, INT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_routine_with_exercises(UUID, TEXT, TEXT, INT, INT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_routine_with_exercises(UUID, TEXT, TEXT, INT, INT, JSONB) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'routine_exercises_drop_set_min_weight_nonneg'
      AND conrelid = 'public.routine_exercises'::regclass
  ) THEN
    ALTER TABLE public.routine_exercises
      ADD CONSTRAINT routine_exercises_drop_set_min_weight_nonneg
      CHECK (drop_set_min_weight_kg IS NULL OR drop_set_min_weight_kg >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'routine_exercises_drop_set_floor_required'
      AND conrelid = 'public.routine_exercises'::regclass
  ) THEN
    ALTER TABLE public.routine_exercises
      ADD CONSTRAINT routine_exercises_drop_set_floor_required
      CHECK (NOT drop_set_enabled OR drop_set_min_weight_kg IS NOT NULL);
  END IF;
END $$;
