-- Community shared content snapshots and personal-library imports.
-- Shared rows store public snapshots so viewers do not need RLS access to the
-- author's private routines, routine_exercises, training_cycles, or cycle_days.

ALTER TABLE public.shared_cycles
  ADD COLUMN IF NOT EXISTS cycle_snapshot JSONB;

ALTER TABLE public.saved_community_items
  ADD COLUMN IF NOT EXISTS imported_routine_id UUID REFERENCES public.routines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS imported_cycle_id UUID REFERENCES public.training_cycles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_saved_community_items_imported_routine
  ON public.saved_community_items(imported_routine_id)
  WHERE imported_routine_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_saved_community_items_imported_cycle
  ON public.saved_community_items(imported_cycle_id)
  WHERE imported_cycle_id IS NOT NULL;

GRANT INSERT (cycle_snapshot) ON TABLE public.shared_cycles TO authenticated;
GRANT UPDATE (cycle_snapshot) ON TABLE public.shared_cycles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.saved_community_items TO authenticated;

-- Backfill routine exercise snapshots from source routines that still exist.
UPDATE public.shared_routines sr
SET exercises_snapshot = COALESCE(
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', re.name,
        'muscle_group', re.muscle_group,
        'exercise_id', re.exercise_id,
        'sets', re.sets,
        'reps', re.reps,
        'weight', re.weight,
        'rest_seconds', re.rest_seconds,
        'duration_seconds', re.duration_seconds,
        'mode', re.mode,
        'order_index', re.order_index,
        'superset_id', re.superset_id,
        'superset_color', re.superset_color,
        'superset_order', re.superset_order,
        'per_set_weights', re.per_set_weights,
        'per_set_rest', re.per_set_rest,
        'per_set_reps', re.per_set_reps,
        'per_set_echo_levels', re.per_set_echo_levels,
        'is_amrap', re.is_amrap,
        'is_bodyweight', re.is_bodyweight,
        'pr_percentage', re.pr_percentage,
        'rep_count_timing', re.rep_count_timing,
        'stop_at_position', re.stop_at_position,
        'stall_detection', re.stall_detection,
        'eccentric_load', re.eccentric_load,
        'echo_level', re.echo_level,
        'warmup_sets', re.warmup_sets
      )
      ORDER BY re.order_index
    )
    FROM public.routine_exercises re
    WHERE re.routine_id = sr.routine_id
  ),
  '[]'::jsonb
)
WHERE sr.exercises_snapshot IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.routines r
    WHERE r.id = sr.routine_id
  );

-- Backfill cycle snapshots, embedding each referenced routine and its exercise
-- snapshot where the source routine still exists.
UPDATE public.shared_cycles sc
SET cycle_snapshot = jsonb_build_object(
  'duration_weeks', tc.duration_weeks,
  'workout_days', tc.workout_days,
  'rest_days', tc.rest_days,
  'progression_settings', tc.progression_settings,
  'deload_settings', tc.deload_settings,
  'days', COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'day_number', cd.day_number,
          'day_type', cd.day_type,
          'routine_id', cd.routine_id,
          'weight_adjustment', cd.weight_adjustment,
          'rep_modifier', cd.rep_modifier,
          'rest_override', cd.rest_override,
          'notes', cd.notes,
          'rest_type', cd.rest_type,
          'routine',
            CASE
              WHEN r.id IS NULL THEN NULL
              ELSE jsonb_build_object(
                'source_routine_id', r.id,
                'name', r.name,
                'description', r.description,
                'exercise_count', r.exercise_count,
                'estimated_duration', r.estimated_duration,
                'tags', COALESCE(to_jsonb(r.tags), '[]'::jsonb),
                'exercises', COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_object(
                        'name', re.name,
                        'muscle_group', re.muscle_group,
                        'exercise_id', re.exercise_id,
                        'sets', re.sets,
                        'reps', re.reps,
                        'weight', re.weight,
                        'rest_seconds', re.rest_seconds,
                        'duration_seconds', re.duration_seconds,
                        'mode', re.mode,
                        'order_index', re.order_index,
                        'superset_id', re.superset_id,
                        'superset_color', re.superset_color,
                        'superset_order', re.superset_order,
                        'per_set_weights', re.per_set_weights,
                        'per_set_rest', re.per_set_rest,
                        'per_set_reps', re.per_set_reps,
                        'per_set_echo_levels', re.per_set_echo_levels,
                        'is_amrap', re.is_amrap,
                        'is_bodyweight', re.is_bodyweight,
                        'pr_percentage', re.pr_percentage,
                        'rep_count_timing', re.rep_count_timing,
                        'stop_at_position', re.stop_at_position,
                        'stall_detection', re.stall_detection,
                        'eccentric_load', re.eccentric_load,
                        'echo_level', re.echo_level,
                        'warmup_sets', re.warmup_sets
                      )
                      ORDER BY re.order_index
                    )
                    FROM public.routine_exercises re
                    WHERE re.routine_id = r.id
                  ),
                  '[]'::jsonb
                )
              )
            END
        )
        ORDER BY cd.day_number
      )
      FROM public.cycle_days cd
      LEFT JOIN public.routines r ON r.id = cd.routine_id
      WHERE cd.cycle_id = tc.id
    ),
    '[]'::jsonb
  )
)
FROM public.training_cycles tc
WHERE tc.id = sc.cycle_id
  AND sc.cycle_snapshot IS NULL;

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
    warmup_sets
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
    ex.warmup_sets
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
    per_set_echo_levels TEXT,
    is_amrap BOOLEAN,
    is_bodyweight BOOLEAN,
    pr_percentage NUMERIC,
    rep_count_timing TEXT,
    stop_at_position TEXT,
    stall_detection BOOLEAN,
    eccentric_load TEXT,
    echo_level TEXT,
    warmup_sets TEXT
  )
  ORDER BY COALESCE(ex.order_index, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.insert_routine_exercises_from_snapshot(UUID, JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.import_shared_routine(
  p_shared_routine_id UUID,
  p_local_profile_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_existing_routine_id UUID;
  v_new_routine_id UUID;
  v_shared RECORD;
  v_snapshot JSONB;
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

  SELECT sci.imported_routine_id
  INTO v_existing_routine_id
  FROM public.saved_community_items sci
  WHERE sci.user_id = v_user_id
    AND sci.shared_item_id = p_shared_routine_id
    AND sci.item_type = 'routine'
    AND sci.imported_routine_id IS NOT NULL
  LIMIT 1;

  IF v_existing_routine_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.routines r
    WHERE r.id = v_existing_routine_id
      AND r.user_id = v_user_id
  ) THEN
    RETURN v_existing_routine_id;
  END IF;

  SELECT *
  INTO v_shared
  FROM public.shared_routines
  WHERE id = p_shared_routine_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shared routine not found';
  END IF;

  v_snapshot := v_shared.exercises_snapshot;
  IF v_snapshot IS NULL OR jsonb_typeof(v_snapshot) <> 'array' THEN
    RAISE EXCEPTION 'Routine snapshot is unavailable';
  END IF;

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
    v_shared.name,
    COALESCE(v_shared.description, ''),
    COALESCE(v_shared.exercise_count, jsonb_array_length(v_snapshot)),
    CASE
      WHEN COALESCE(v_shared.estimated_duration, 0) > 300 THEN v_shared.estimated_duration
      ELSE COALESCE(v_shared.estimated_duration, 0) * 60
    END,
    0,
    COALESCE(v_shared.tags, '{}'::TEXT[]),
    false
  )
  RETURNING id INTO v_new_routine_id;

  PERFORM public.insert_routine_exercises_from_snapshot(v_new_routine_id, v_snapshot);

  INSERT INTO public.saved_community_items (
    user_id,
    shared_item_id,
    item_type,
    imported_routine_id
  )
  VALUES (
    v_user_id,
    p_shared_routine_id,
    'routine',
    v_new_routine_id
  )
  ON CONFLICT (user_id, shared_item_id, item_type)
  DO UPDATE SET imported_routine_id = EXCLUDED.imported_routine_id;

  RETURN v_new_routine_id;
END;
$$;

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
    COALESCE((v_snapshot ->> 'duration_weeks')::INT, v_shared.duration_weeks),
    1,
    'draft',
    COALESCE((v_snapshot ->> 'workout_days')::INT, v_workout_days, 0),
    COALESCE((v_snapshot ->> 'rest_days')::INT, v_rest_days, 0),
    NULL,
    v_snapshot -> 'progression_settings',
    v_snapshot -> 'deload_settings'
  )
  RETURNING id INTO v_new_cycle_id;

  FOR v_day IN
    SELECT value
    FROM jsonb_array_elements(v_days)
    ORDER BY COALESCE((value ->> 'day_number')::INT, 0)
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
          COALESCE((v_routine ->> 'exercise_count')::INT, jsonb_array_length(COALESCE(v_routine -> 'exercises', '[]'::jsonb))),
          COALESCE((v_routine ->> 'estimated_duration')::INT, 0),
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
      COALESCE((v_day ->> 'day_number')::INT, 1),
      COALESCE(v_day ->> 'day_type', 'rest'),
      v_new_routine_id,
      COALESCE((v_day ->> 'weight_adjustment')::NUMERIC, 0),
      COALESCE((v_day ->> 'rep_modifier')::INT, 0),
      NULLIF(v_day ->> 'rest_override', '')::INT,
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

GRANT EXECUTE ON FUNCTION public.import_shared_routine(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_shared_cycle(UUID, TEXT) TO authenticated;
