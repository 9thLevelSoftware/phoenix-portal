BEGIN;

SET LOCAL lock_timeout = '5s';

-- AUD-010: Persist workout_mode on personal_records so pulled PRs preserve the
-- canonical workout mode rather than overloading record_type. Additive & nullable
-- so older mobile clients and legacy rows stay valid.
ALTER TABLE public.personal_records
  ADD COLUMN IF NOT EXISTS workout_mode TEXT NULL;

COMMENT ON COLUMN public.personal_records.workout_mode IS
  'Canonical workout mode name for the PR (e.g. OLD_SCHOOL, ECHO). NULL when unknown or predating AUD-010.';

-- Update set-derived PR upsert RPC to persist workout_mode when provided while
-- preserving an existing non-null workout_mode if an older client omits it.
CREATE OR REPLACE FUNCTION public.upsert_set_derived_personal_records(
  p_user_id UUID,
  p_rows JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22004';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.personal_records AS pr (
    id,
    user_id,
    local_profile_id,
    exercise_name,
    exercise_id,
    muscle_group,
    record_type,
    value,
    weight_kg,
    reps,
    unit,
    session_id,
    achieved_at,
    workout_phase,
    workout_mode,
    source,
    deleted_at
  )
  SELECT DISTINCT ON (
    COALESCE(r.local_profile_id, 'default'),
    (CASE WHEN NULLIF(r.exercise_id, '') IS NOT NULL
      THEN 'id:' || r.exercise_id
      ELSE 'name:' || r.exercise_name END),
    date_trunc('milliseconds', r.achieved_at AT TIME ZONE 'UTC'),
    COALESCE(r.record_type, 'MAX_WEIGHT'),
    COALESCE(r.workout_phase, 'COMBINED')
  )
    gen_random_uuid(),
    p_user_id,
    r.local_profile_id,
    r.exercise_name,
    r.exercise_id,
    COALESCE(r.muscle_group, 'General'),
    COALESCE(r.record_type, 'MAX_WEIGHT'),
    r.value,
    r.weight_kg,
    r.reps,
    COALESCE(r.unit, 'kg'),
    r.session_id,
    date_trunc('milliseconds', r.achieved_at AT TIME ZONE 'UTC'),
    COALESCE(r.workout_phase, 'COMBINED'),
    r.workout_mode,
    'set_derived',
    NULL
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS e(elem, ord)
  CROSS JOIN LATERAL jsonb_to_record(e.elem) AS r(
    local_profile_id TEXT,
    exercise_name TEXT,
    exercise_id TEXT,
    muscle_group TEXT,
    record_type TEXT,
    value NUMERIC,
    weight_kg NUMERIC,
    reps INTEGER,
    unit TEXT,
    session_id UUID,
    achieved_at TIMESTAMPTZ,
    workout_phase TEXT,
    workout_mode TEXT
  )
  ORDER BY
    COALESCE(r.local_profile_id, 'default'),
    (CASE WHEN NULLIF(r.exercise_id, '') IS NOT NULL
      THEN 'id:' || r.exercise_id
      ELSE 'name:' || r.exercise_name END),
    date_trunc('milliseconds', r.achieved_at AT TIME ZONE 'UTC'),
    COALESCE(r.record_type, 'MAX_WEIGHT'),
    COALESCE(r.workout_phase, 'COMBINED'),
    e.ord DESC
  ON CONFLICT (
    user_id,
    (COALESCE(local_profile_id, 'default')),
    (CASE WHEN NULLIF(exercise_id, '') IS NOT NULL
      THEN 'id:' || exercise_id
      ELSE 'name:' || exercise_name END),
    (date_trunc('milliseconds', achieved_at AT TIME ZONE 'UTC')),
    record_type,
    (COALESCE(workout_phase, 'COMBINED'))
  )
  WHERE source = 'set_derived' AND deleted_at IS NULL
  DO UPDATE SET
    exercise_name = EXCLUDED.exercise_name,
    muscle_group = EXCLUDED.muscle_group,
    value = EXCLUDED.value,
    weight_kg = EXCLUDED.weight_kg,
    reps = EXCLUDED.reps,
    unit = EXCLUDED.unit,
    session_id = EXCLUDED.session_id,
    workout_mode = COALESCE(EXCLUDED.workout_mode, pr.workout_mode)
  WHERE (pr.exercise_name, pr.muscle_group, pr.value, pr.weight_kg, pr.reps,
         pr.unit, pr.session_id, pr.workout_mode)
    IS DISTINCT FROM
        (EXCLUDED.exercise_name, EXCLUDED.muscle_group, EXCLUDED.value,
         EXCLUDED.weight_kg, EXCLUDED.reps, EXCLUDED.unit, EXCLUDED.session_id,
         COALESCE(EXCLUDED.workout_mode, pr.workout_mode));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_set_derived_personal_records(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_set_derived_personal_records(UUID, JSONB)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
