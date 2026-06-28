-- Atomic replace RPCs for routine/cycle updates.
--
-- Background: useUpdateRoutine and useUpdateCycle updated the parent row, then
-- DELETEd and re-INSERTed the child rows in separate client requests. If the
-- insert failed after the delete, the routine/cycle was left with no
-- exercises/days (F149/F150/F158). These functions perform the update + child
-- replacement inside a single function body (one transaction), so a failure
-- rolls the whole operation back.
--
-- Security: SECURITY INVOKER (default) so the existing RLS policies on
-- routines / routine_exercises / training_cycles / cycle_days apply to every
-- statement, and the parent UPDATE is additionally scoped to auth.uid(). A
-- caller can therefore only replace children of rows they own.
--
-- The child rows are passed as the exact JSONB the client already builds; we
-- override id/created_at/parent-id and let jsonb_populate_record map the rest,
-- which keeps the function resilient to future column additions. Every NOT NULL
-- child column is supplied by the client builders, and omitted columns are
-- nullable, so populated records are always valid.

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

  IF p_exercises IS NOT NULL
     AND jsonb_typeof(p_exercises) = 'array'
     AND jsonb_array_length(p_exercises) > 0 THEN
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

  IF p_days IS NOT NULL
     AND jsonb_typeof(p_days) = 'array'
     AND jsonb_array_length(p_days) > 0 THEN
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

-- Client-facing RPCs: restrict EXECUTE to authenticated users.
REVOKE ALL ON FUNCTION public.update_routine_with_exercises(UUID, TEXT, TEXT, INT, INT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_routine_with_exercises(UUID, TEXT, TEXT, INT, INT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_routine_with_exercises(UUID, TEXT, TEXT, INT, INT, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.update_cycle_with_days(UUID, TEXT, TEXT, INT, INT, INT, TIMESTAMPTZ, JSONB, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_cycle_with_days(UUID, TEXT, TEXT, INT, INT, INT, TIMESTAMPTZ, JSONB, JSONB, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_cycle_with_days(UUID, TEXT, TEXT, INT, INT, INT, TIMESTAMPTZ, JSONB, JSONB, JSONB) TO authenticated;
