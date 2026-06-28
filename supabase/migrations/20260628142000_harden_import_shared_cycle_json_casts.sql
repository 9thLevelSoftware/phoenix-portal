-- F232: import_shared_cycle() casts creator-controlled JSON snapshot fields
-- directly to INT/NUMERIC (e.g. (v_snapshot ->> 'duration_weeks')::INT,
-- (v_day ->> 'weight_adjustment')::NUMERIC). A malformed numeric string in a
-- shared snapshot raises invalid_text_representation, which makes the import RPC
-- throw for every viewer who tries to import that shared cycle.
--
-- This migration adds guarded JSON->number cast helpers that fall back to a
-- supplied default when a field is absent, NULL, or not a valid number, and
-- redefines import_shared_cycle() to route all snapshot-derived numeric casts
-- through them. Behavior is unchanged for well-formed snapshots; malformed
-- numeric fields now degrade to the same defaults the COALESCE chains already
-- expected instead of aborting the import.
--
-- Idempotent: CREATE OR REPLACE for all functions; grants re-applied.

-- ---------------------------------------------------------------------------
-- Guarded cast helpers. IMMUTABLE/STRICT-friendly; no table access, so a plain
-- empty search_path is sufficient.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.safe_jsonb_int(
  p_obj JSONB,
  p_key TEXT,
  p_default INT
)
RETURNS INT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_text TEXT;
BEGIN
  IF p_obj IS NULL THEN
    RETURN p_default;
  END IF;

  v_text := p_obj ->> p_key;
  IF v_text IS NULL OR v_text = '' THEN
    RETURN p_default;
  END IF;

  -- Accept optionally-signed integers only; anything else falls back.
  IF v_text ~ '^[+-]?\d+$' THEN
    RETURN v_text::INT;
  END IF;

  RETURN p_default;
EXCEPTION
  WHEN others THEN
    RETURN p_default;
END;
$$;

CREATE OR REPLACE FUNCTION public.safe_jsonb_numeric(
  p_obj JSONB,
  p_key TEXT,
  p_default NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_text TEXT;
BEGIN
  IF p_obj IS NULL THEN
    RETURN p_default;
  END IF;

  v_text := p_obj ->> p_key;
  IF v_text IS NULL OR v_text = '' THEN
    RETURN p_default;
  END IF;

  -- Accept optionally-signed decimal numbers only; anything else falls back.
  IF v_text ~ '^[+-]?(\d+(\.\d*)?|\.\d+)$' THEN
    RETURN v_text::NUMERIC;
  END IF;

  RETURN p_default;
EXCEPTION
  WHEN others THEN
    RETURN p_default;
END;
$$;

REVOKE ALL ON FUNCTION public.safe_jsonb_int(JSONB, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.safe_jsonb_numeric(JSONB, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.safe_jsonb_int(JSONB, TEXT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.safe_jsonb_numeric(JSONB, TEXT, NUMERIC) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Redefine import_shared_cycle() with guarded numeric casts. Logic is otherwise
-- identical to 20260526120000_community_snapshots_and_imports.sql.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_shared_cycle(
  p_shared_cycle_id UUID,
  p_local_profile_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_existing_cycle_id UUID;
  v_new_cycle_id UUID;
  v_new_routine_id UUID;
  v_shared RECORD;
  v_snapshot JSONB;
  v_day JSONB;
  v_days JSONB;
  v_routine JSONB;
  v_routine_key TEXT;
  v_routine_map JSONB := '{}'::jsonb;
  v_workout_days INT;
  v_rest_days INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_local_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.local_profiles lp
    WHERE lp.user_id = v_user_id
      AND lp.id = p_local_profile_id
  ) THEN
    RAISE EXCEPTION 'Invalid local profile';
  END IF;

  SELECT sci.imported_cycle_id
  INTO v_existing_cycle_id
  FROM public.saved_community_items sci
  WHERE sci.user_id = v_user_id
    AND sci.shared_item_id = p_shared_cycle_id
    AND sci.item_type = 'cycle'
    AND sci.imported_cycle_id IS NOT NULL
  LIMIT 1;

  IF v_existing_cycle_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.training_cycles tc
    WHERE tc.id = v_existing_cycle_id
      AND tc.user_id = v_user_id
  ) THEN
    RETURN v_existing_cycle_id;
  END IF;

  SELECT *
  INTO v_shared
  FROM public.shared_cycles
  WHERE id = p_shared_cycle_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shared cycle not found';
  END IF;

  v_snapshot := v_shared.cycle_snapshot;
  v_days := v_snapshot -> 'days';

  IF v_snapshot IS NULL OR jsonb_typeof(v_snapshot) <> 'object'
    OR v_days IS NULL OR jsonb_typeof(v_days) <> 'array' THEN
    RAISE EXCEPTION 'Cycle snapshot is unavailable';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE day_item ->> 'day_type' = 'workout'),
    COUNT(*) FILTER (WHERE day_item ->> 'day_type' = 'rest')
  INTO v_workout_days, v_rest_days
  FROM jsonb_array_elements(v_days) AS day_item;

  INSERT INTO public.training_cycles (
    user_id,
    local_profile_id,
    name,
    description,
    duration_weeks,
    current_week,
    status,
    workout_days,
    rest_days,
    started_at,
    progression_settings,
    deload_settings
  )
  VALUES (
    v_user_id,
    p_local_profile_id,
    v_shared.name,
    COALESCE(v_shared.description, ''),
    public.safe_jsonb_int(v_snapshot, 'duration_weeks', v_shared.duration_weeks),
    1,
    'draft',
    public.safe_jsonb_int(v_snapshot, 'workout_days', COALESCE(v_workout_days, 0)),
    public.safe_jsonb_int(v_snapshot, 'rest_days', COALESCE(v_rest_days, 0)),
    NULL,
    v_snapshot -> 'progression_settings',
    v_snapshot -> 'deload_settings'
  )
  RETURNING id INTO v_new_cycle_id;

  FOR v_day IN
    SELECT value
    FROM jsonb_array_elements(v_days)
    ORDER BY public.safe_jsonb_int(value, 'day_number', 0)
  LOOP
    v_new_routine_id := NULL;
    v_routine := v_day -> 'routine';

    IF v_day ->> 'day_type' = 'workout'
      AND v_routine IS NOT NULL
      AND jsonb_typeof(v_routine) = 'object' THEN
      v_routine_key := COALESCE(
        v_day ->> 'routine_id',
        v_routine ->> 'source_routine_id',
        'day-' || COALESCE(v_day ->> 'day_number', 'unknown')
      );

      IF v_routine_map ? v_routine_key THEN
        v_new_routine_id := (v_routine_map ->> v_routine_key)::UUID;
      ELSE
        INSERT INTO public.routines (
          user_id,
          local_profile_id,
          name,
          description,
          exercise_count,
          estimated_duration,
          times_completed,
          tags,
          is_favorite
        )
        VALUES (
          v_user_id,
          p_local_profile_id,
          COALESCE(v_routine ->> 'name', 'Imported Routine'),
          COALESCE(v_routine ->> 'description', ''),
          public.safe_jsonb_int(
            v_routine,
            'exercise_count',
            jsonb_array_length(COALESCE(v_routine -> 'exercises', '[]'::jsonb))
          ),
          public.safe_jsonb_int(v_routine, 'estimated_duration', 0),
          0,
          COALESCE(
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_routine -> 'tags', '[]'::jsonb))),
            '{}'::TEXT[]
          ),
          false
        )
        RETURNING id INTO v_new_routine_id;

        PERFORM public.insert_routine_exercises_from_snapshot(
          v_new_routine_id,
          COALESCE(v_routine -> 'exercises', '[]'::jsonb)
        );

        v_routine_map := v_routine_map || jsonb_build_object(v_routine_key, v_new_routine_id);
      END IF;
    END IF;

    INSERT INTO public.cycle_days (
      cycle_id,
      day_number,
      day_type,
      routine_id,
      weight_adjustment,
      rep_modifier,
      rest_override,
      notes,
      rest_type
    )
    VALUES (
      v_new_cycle_id,
      public.safe_jsonb_int(v_day, 'day_number', 1),
      COALESCE(v_day ->> 'day_type', 'rest'),
      v_new_routine_id,
      public.safe_jsonb_numeric(v_day, 'weight_adjustment', 0),
      public.safe_jsonb_int(v_day, 'rep_modifier', 0),
      public.safe_jsonb_int(v_day, 'rest_override', NULL),
      NULLIF(v_day ->> 'notes', ''),
      NULLIF(v_day ->> 'rest_type', '')
    );
  END LOOP;

  INSERT INTO public.saved_community_items (
    user_id,
    shared_item_id,
    item_type,
    imported_cycle_id
  )
  VALUES (
    v_user_id,
    p_shared_cycle_id,
    'cycle',
    v_new_cycle_id
  )
  ON CONFLICT (user_id, shared_item_id, item_type)
  DO UPDATE SET imported_cycle_id = EXCLUDED.imported_cycle_id;

  RETURN v_new_cycle_id;
END;
$$;

REVOKE ALL ON FUNCTION public.import_shared_cycle(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_shared_cycle(UUID, TEXT) TO authenticated;
