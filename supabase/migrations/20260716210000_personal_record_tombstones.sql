-- Issue #655: propagate personal-record deletion through normal sync without hard-deleting history.
-- A tombstone is a row with deleted_at set; active product reads filter it locally while pull
-- responses retain it so every device converges.

ALTER TABLE public.personal_records
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_personal_records_sync_cursor
  ON public.personal_records (user_id, local_profile_id, updated_at, id);

-- The edge function passes already-owned rows. Apply LWW by stable row UUID and make a
-- tombstone win equal timestamps so a stale active client cannot resurrect a deletion.
CREATE OR REPLACE FUNCTION public.upsert_personal_records_lww(p_rows JSONB)
RETURNS TABLE(id UUID, accepted BOOLEAN, server_updated_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row JSONB;
  incoming_updated_at TIMESTAMPTZ;
  incoming_deleted_at TIMESTAMPTZ;
  current_row public.personal_records%ROWTYPE;
BEGIN
  FOR row IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    incoming_updated_at := COALESCE((row->>'updated_at')::TIMESTAMPTZ, now());
    incoming_deleted_at := NULLIF(row->>'deleted_at', '')::TIMESTAMPTZ;

    SELECT * INTO current_row FROM public.personal_records WHERE personal_records.id = (row->>'id')::UUID;
    IF FOUND AND (
      current_row.updated_at > incoming_updated_at
      OR (
        current_row.updated_at = incoming_updated_at
        AND current_row.deleted_at IS NOT NULL
        AND incoming_deleted_at IS NULL
      )
    ) THEN
      RETURN QUERY SELECT current_row.id, FALSE, current_row.updated_at;
      CONTINUE;
    END IF;

    INSERT INTO public.personal_records (
      id, user_id, local_profile_id, exercise_name, exercise_id, muscle_group,
      record_type, value, weight_kg, reps, unit, session_id, achieved_at,
      updated_at, deleted_at, workout_phase
    ) VALUES (
      (row->>'id')::UUID, (row->>'user_id')::UUID, NULLIF(row->>'local_profile_id', ''),
      row->>'exercise_name', NULLIF(row->>'exercise_id', ''), COALESCE(row->>'muscle_group', 'General'),
      COALESCE(row->>'record_type', '1RM'), (row->>'value')::NUMERIC,
      NULLIF(row->>'weight_kg', '')::NUMERIC, NULLIF(row->>'reps', '')::INT,
      COALESCE(row->>'unit', 'kg'), NULLIF(row->>'session_id', '')::UUID,
      COALESCE((row->>'achieved_at')::TIMESTAMPTZ, now()), incoming_updated_at,
      incoming_deleted_at, COALESCE(row->>'workout_phase', 'COMBINED')
    ) ON CONFLICT (id) DO UPDATE SET
      local_profile_id = EXCLUDED.local_profile_id,
      exercise_name = EXCLUDED.exercise_name,
      exercise_id = EXCLUDED.exercise_id,
      muscle_group = EXCLUDED.muscle_group,
      record_type = EXCLUDED.record_type,
      value = EXCLUDED.value,
      weight_kg = EXCLUDED.weight_kg,
      reps = EXCLUDED.reps,
      unit = EXCLUDED.unit,
      session_id = EXCLUDED.session_id,
      achieved_at = EXCLUDED.achieved_at,
      updated_at = EXCLUDED.updated_at,
      deleted_at = EXCLUDED.deleted_at,
      workout_phase = EXCLUDED.workout_phase;

    RETURN QUERY SELECT (row->>'id')::UUID, TRUE, incoming_updated_at;
  END LOOP;
END;
$$;

-- The legacy RPC is parity-mode's source of truth. Its original signature used BIGINT
-- IDs while dedicated PRs now use UUIDs, so remove that overload before recreating it.
-- Both parity and timestamp pull responses include deleted_at.
DROP FUNCTION IF EXISTS public.get_personal_records_excluding_ids(UUID, BIGINT[], TEXT);
CREATE FUNCTION public.get_personal_records_excluding_ids(
  p_user_id UUID,
  p_known_ids UUID[] DEFAULT '{}',
  p_profile_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID, user_id UUID, exercise_name TEXT, exercise_id TEXT, muscle_group TEXT,
  record_type TEXT, value NUMERIC, weight_kg NUMERIC, reps INT, workout_phase TEXT,
  session_id UUID, achieved_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ,
  local_profile_id TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pr.id, pr.user_id, pr.exercise_name, pr.exercise_id, pr.muscle_group,
         pr.record_type, pr.value, pr.weight_kg, pr.reps, pr.workout_phase,
         pr.session_id, pr.achieved_at, pr.updated_at, pr.deleted_at, pr.local_profile_id
  FROM public.personal_records pr
  WHERE pr.user_id = p_user_id
    AND (array_length(p_known_ids, 1) IS NULL OR pr.id != ALL(p_known_ids))
    AND (
      p_profile_id IS NULL
      OR (p_profile_id = 'default' AND pr.local_profile_id IS NULL)
      OR pr.local_profile_id = p_profile_id
      OR pr.local_profile_id IS NULL
    )
  ORDER BY pr.updated_at ASC, pr.id ASC;
$$;
