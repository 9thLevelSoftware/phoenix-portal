BEGIN;

SET LOCAL lock_timeout = '5s';

-- AUD-010: Persist workout_mode on personal_records so pulled PRs preserve the
-- canonical workout mode rather than overloading record_type. Additive & nullable
-- so older mobile clients and legacy rows stay valid.
ALTER TABLE public.personal_records
  ADD COLUMN IF NOT EXISTS workout_mode TEXT NULL;

COMMENT ON COLUMN public.personal_records.workout_mode IS
  'Canonical workout mode name for the PR (e.g. OLD_SCHOOL, ECHO). NULL when unknown or predating AUD-010.';

-- PostgREST's dedicated upsert sends a uniform row shape. An older client
-- contributes NULL for an unknown mode, so preserve the stored value at write
-- time even if another push supplied it after the Edge handler's read.
CREATE OR REPLACE FUNCTION public.preserve_dedicated_personal_record_workout_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.workout_mode := OLD.workout_mode;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_dedicated_personal_record_workout_mode
  ON public.personal_records;
CREATE TRIGGER preserve_dedicated_personal_record_workout_mode
BEFORE UPDATE OF workout_mode ON public.personal_records
FOR EACH ROW
WHEN (NEW.source = 'dedicated' AND NEW.workout_mode IS NULL AND OLD.workout_mode IS NOT NULL)
EXECUTE FUNCTION public.preserve_dedicated_personal_record_workout_mode();

REVOKE ALL ON FUNCTION public.preserve_dedicated_personal_record_workout_mode()
  FROM PUBLIC, anon, authenticated;

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
  v_filled INTEGER;
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
  WHERE (e.elem -> 'fill_missing_workout_mode_only') IS DISTINCT FROM 'true'::jsonb
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

  -- A replay previously matched by Edge deduplication can only fill missing
  -- metadata on an existing live set-derived row. It cannot insert a row,
  -- resurrect a tombstone, or change the measurements or mode already stored.
  UPDATE public.personal_records AS pr
  SET workout_mode = r.workout_mode
  FROM jsonb_array_elements(p_rows) AS e(elem)
  CROSS JOIN LATERAL jsonb_to_record(e.elem) AS r(
    local_profile_id TEXT,
    exercise_id TEXT,
    exercise_name TEXT,
    achieved_at TIMESTAMPTZ,
    record_type TEXT,
    workout_phase TEXT,
    workout_mode TEXT
  )
  WHERE (e.elem -> 'fill_missing_workout_mode_only') = 'true'::jsonb
    AND r.workout_mode IS NOT NULL
    AND pr.user_id = p_user_id
    AND pr.source = 'set_derived'
    AND pr.deleted_at IS NULL
    AND pr.workout_mode IS NULL
    AND COALESCE(pr.local_profile_id, 'default') = COALESCE(r.local_profile_id, 'default')
    AND (CASE WHEN NULLIF(pr.exercise_id, '') IS NOT NULL
      THEN 'id:' || pr.exercise_id ELSE 'name:' || pr.exercise_name END) =
      (CASE WHEN NULLIF(r.exercise_id, '') IS NOT NULL
        THEN 'id:' || r.exercise_id ELSE 'name:' || r.exercise_name END)
    AND date_trunc('milliseconds', pr.achieved_at AT TIME ZONE 'UTC') =
      date_trunc('milliseconds', r.achieved_at AT TIME ZONE 'UTC')
    AND pr.record_type = COALESCE(r.record_type, 'MAX_WEIGHT')
    AND COALESCE(pr.workout_phase, 'COMBINED') = COALESCE(r.workout_phase, 'COMBINED');

  GET DIAGNOSTICS v_filled = ROW_COUNT;
  RETURN v_count + v_filled;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_set_derived_personal_records(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_set_derived_personal_records(UUID, JSONB)
  TO service_role;

-- Additive replacement for the known-tombstone query used by older Edge
-- deployments. Mode repairs use the ordinary personal_records updated_at
-- trigger and therefore share its overlap watermark and pagination order.
CREATE OR REPLACE FUNCTION public.get_known_personal_record_changes(
  p_user_id UUID,
  p_known_ids UUID[],
  p_last_sync_at TIMESTAMPTZ,
  p_profile_id TEXT,
  p_cursor_updated_at TIMESTAMPTZ,
  p_cursor_id UUID,
  p_limit INT
)
RETURNS SETOF public.personal_records
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pr.*
  FROM public.personal_records pr
  WHERE pr.user_id = p_user_id
    AND pr.id = ANY(p_known_ids)
    AND (
      pr.deleted_at IS NOT NULL
      OR (pr.source = 'set_derived' AND pr.workout_mode IS NOT NULL)
    )
    AND pr.updated_at > p_last_sync_at
    AND (
      p_profile_id IS NULL
      OR (p_profile_id = 'default' AND pr.local_profile_id IS NULL)
      OR pr.local_profile_id = p_profile_id
    )
    AND (
      p_cursor_updated_at IS NULL
      OR (pr.updated_at, pr.id) > (p_cursor_updated_at, p_cursor_id)
    )
  ORDER BY pr.updated_at ASC, pr.id ASC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.get_known_personal_record_changes(
  UUID, UUID[], TIMESTAMPTZ, TEXT, TIMESTAMPTZ, UUID, INT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_known_personal_record_changes(
  UUID, UUID[], TIMESTAMPTZ, TEXT, TIMESTAMPTZ, UUID, INT
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
