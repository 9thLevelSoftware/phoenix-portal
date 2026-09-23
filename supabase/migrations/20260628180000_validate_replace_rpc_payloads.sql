-- Harden update_routine_with_exercises / update_cycle_with_days against
-- malformed child payloads.
--
-- Both functions DELETE the existing children, then only re-INSERT when the
-- payload is a non-empty JSON array. The array-type check lived in the INSERT
-- guard, AFTER the delete — so a payload that is null, an object, a string, or
-- any non-array updated the parent, deleted every child, skipped the insert,
-- and returned success: a silent wipe of a routine's exercises / a cycle's days.
-- (The RPCs are EXECUTE-able by `authenticated`, so a buggy or hand-crafted
-- direct call could trigger this on the caller's own rows.)
--
-- Validate the payload shape BEFORE any mutation and RAISE on a non-array, so
-- the whole transaction rolls back and the existing children are preserved. An
-- explicit empty array `[]` remains the valid "clear all children" path.

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
  -- Validate before mutating: a non-array payload must abort, not silently
  -- clear the children below.
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
          'routine_id', p_routine_id
        )
      )
    ).*
    FROM jsonb_array_elements(p_exercises) AS elem;
  END IF;

  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_cycle_with_days(
  p_cycle_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_duration_weeks INT,
  p_workout_days INT,
  p_rest_days INT,
  p_started_at TIMESTAMPTZ,
  p_progression_settings JSONB,
  p_deload_settings JSONB,
  p_days JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_updated UUID;
BEGIN
  -- Validate before mutating: a non-array payload must abort, not silently
  -- clear the days below.
  IF p_days IS NULL OR jsonb_typeof(p_days) <> 'array' THEN
    RAISE EXCEPTION 'invalid_days_payload: expected a JSON array'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.training_cycles
     SET name = p_name,
         description = p_description,
         duration_weeks = p_duration_weeks,
         workout_days = p_workout_days,
         rest_days = p_rest_days,
         started_at = p_started_at,
         progression_settings = p_progression_settings,
         deload_settings = p_deload_settings
   WHERE id = p_cycle_id
     AND user_id = auth.uid()
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'cycle_not_found_or_forbidden'
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.cycle_days WHERE cycle_id = p_cycle_id;

  IF jsonb_array_length(p_days) > 0 THEN
    INSERT INTO public.cycle_days
    SELECT (
      jsonb_populate_record(
        NULL::public.cycle_days,
        elem || jsonb_build_object(
          'id', gen_random_uuid(),
          'cycle_id', p_cycle_id
        )
      )
    ).*
    FROM jsonb_array_elements(p_days) AS elem;
  END IF;

  RETURN v_updated;
END;
$$;
