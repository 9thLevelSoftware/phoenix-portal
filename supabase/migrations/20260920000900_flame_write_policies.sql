-- PR 9: enforce FLAME server-side for community, sharing, challenges,
-- integrations and portal routine/cycle authoring.
--
-- User decisions (2026-09-18): FLAME writes are enforced server-side;
-- routine/cycle authoring is FLAME-only for browser (authenticated) writes;
-- routines/cycles pushed from mobile stay EMBER. Mobile push goes through
-- the mobile-sync-push Edge Function with the service_role client, which
-- bypasses RLS, so these policies do not affect it.
--
-- Rules applied here:
--   * INSERT and UPDATE policies on the tables below require
--     (select auth.uid()) = owner AND (select public.user_has_min_tier('FLAME')).
--     The (select ...) wrappers make Postgres evaluate each call once per
--     statement as an initPlan instead of once per row.
--   * DELETE policies are NOT touched. On the community tables they stay
--     owner-only with no tier check, so a user who downgrades can still
--     delete comments, unpublish shared routines/cycles, retract votes,
--     unfollow, unsave and leave challenges. routines / training_cycles /
--     routine_exercises / cycle_days DELETE keep their existing EMBER check.
--   * SELECT policies are not touched.
--   * user_blocks and content_reports (safety features) are left ungated.
--   * import_shared_routine / import_shared_cycle (SECURITY DEFINER, so table
--     RLS does not apply inside them) check FLAME instead of EMBER and raise
--     FLAME_REQUIRED. Bodies are otherwise copied verbatim from
--     20260823120000_trust_rls_broadcast_self_leak.sql (latest definition).
--
-- Every statement is idempotent (DROP POLICY IF EXISTS + CREATE POLICY,
-- CREATE OR REPLACE FUNCTION with the unchanged signature).

-- ---------------------------------------------------------------------------
-- 1. Community and sharing
-- ---------------------------------------------------------------------------

-- shared_routines
DROP POLICY IF EXISTS "Users can share own routines" ON public.shared_routines;
CREATE POLICY "Users can share own routines"
  ON public.shared_routines FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  );

DROP POLICY IF EXISTS "Users can update own shared routines" ON public.shared_routines;
CREATE POLICY "Users can update own shared routines"
  ON public.shared_routines FOR UPDATE
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  )
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  );

-- shared_cycles
DROP POLICY IF EXISTS "Users can share own cycles" ON public.shared_cycles;
CREATE POLICY "Users can share own cycles"
  ON public.shared_cycles FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  );

DROP POLICY IF EXISTS "Users can update own shared cycles" ON public.shared_cycles;
CREATE POLICY "Users can update own shared cycles"
  ON public.shared_cycles FOR UPDATE
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  )
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  );

-- community_votes (no UPDATE policy exists; none is added)
DROP POLICY IF EXISTS "Users can insert own votes" ON public.community_votes;
CREATE POLICY "Users can insert own votes"
  ON public.community_votes FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  );

-- community_comments: INSERT was EMBER (tier list), now FLAME. UPDATE keeps
-- its 5-minute edit window and gains FLAME. The owner DELETE policy stays
-- tier-free, so a downgraded user can always remove a comment.
DROP POLICY IF EXISTS "Premium users can post comments" ON public.community_comments;
CREATE POLICY "Premium users can post comments"
  ON public.community_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  );

DROP POLICY IF EXISTS "Users can edit own comments within 5 minutes" ON public.community_comments;
CREATE POLICY "Users can edit own comments within 5 minutes"
  ON public.community_comments FOR UPDATE
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  )
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
    AND created_at > now() - INTERVAL '5 minutes'
  );

-- saved_community_items: feeds save_count and the hot score.
DROP POLICY IF EXISTS "Users can save items" ON public.saved_community_items;
CREATE POLICY "Users can save items"
  ON public.saved_community_items FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  );

-- creator_follows (owner column is follower_id; no UPDATE policy exists)
DROP POLICY IF EXISTS "Users can follow others" ON public.creator_follows;
CREATE POLICY "Users can follow others"
  ON public.creator_follows FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = follower_id
    AND (select public.user_has_min_tier('FLAME'))
  );

-- challenge_participants (no UPDATE policy exists; progress is server-side)
DROP POLICY IF EXISTS "Users can join challenges" ON public.challenge_participants;
CREATE POLICY "Users can join challenges"
  ON public.challenge_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  );

-- ---------------------------------------------------------------------------
-- 2. Integrations
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can insert own integrations" ON public.user_integrations;
CREATE POLICY "Users can insert own integrations"
  ON public.user_integrations FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  );

DROP POLICY IF EXISTS "Users can update own integrations" ON public.user_integrations;
CREATE POLICY "Users can update own integrations"
  ON public.user_integrations FOR UPDATE
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  )
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  );

-- sync_queue (no UPDATE/DELETE policy exists; workers use service_role)
DROP POLICY IF EXISTS "Users can insert own sync tasks" ON public.sync_queue;
CREATE POLICY "Users can insert own sync tasks"
  ON public.sync_queue FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  );

-- ---------------------------------------------------------------------------
-- 3. Portal routine / cycle authoring (was EMBER, now FLAME).
--    Mobile push writes these via service_role and is unaffected.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can insert own routines" ON public.routines;
CREATE POLICY "Users can insert own routines"
  ON public.routines FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  );

DROP POLICY IF EXISTS "Users can update own routines" ON public.routines;
CREATE POLICY "Users can update own routines"
  ON public.routines FOR UPDATE
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  )
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  );

DROP POLICY IF EXISTS "Users can insert own cycles" ON public.training_cycles;
CREATE POLICY "Users can insert own cycles"
  ON public.training_cycles FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  );

DROP POLICY IF EXISTS "Users can update own cycles" ON public.training_cycles;
CREATE POLICY "Users can update own cycles"
  ON public.training_cycles FOR UPDATE
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  )
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
  );

DROP POLICY IF EXISTS "Users can insert exercises in own routines" ON public.routine_exercises;
CREATE POLICY "Users can insert exercises in own routines"
  ON public.routine_exercises FOR INSERT
  TO authenticated
  WITH CHECK (
    routine_id IN (
      SELECT r.id FROM public.routines r WHERE r.user_id = (select auth.uid())
    )
    AND (select public.user_has_min_tier('FLAME'))
  );

DROP POLICY IF EXISTS "Users can update exercises in own routines" ON public.routine_exercises;
CREATE POLICY "Users can update exercises in own routines"
  ON public.routine_exercises FOR UPDATE
  TO authenticated
  USING (
    routine_id IN (
      SELECT r.id FROM public.routines r WHERE r.user_id = (select auth.uid())
    )
    AND (select public.user_has_min_tier('FLAME'))
  )
  WITH CHECK (
    routine_id IN (
      SELECT r.id FROM public.routines r WHERE r.user_id = (select auth.uid())
    )
    AND (select public.user_has_min_tier('FLAME'))
  );

DROP POLICY IF EXISTS "Users can insert days in own cycles" ON public.cycle_days;
CREATE POLICY "Users can insert days in own cycles"
  ON public.cycle_days FOR INSERT
  TO authenticated
  WITH CHECK (
    cycle_id IN (
      SELECT tc.id FROM public.training_cycles tc WHERE tc.user_id = (select auth.uid())
    )
    AND (select public.user_has_min_tier('FLAME'))
  );

DROP POLICY IF EXISTS "Users can update days in own cycles" ON public.cycle_days;
CREATE POLICY "Users can update days in own cycles"
  ON public.cycle_days FOR UPDATE
  TO authenticated
  USING (
    cycle_id IN (
      SELECT tc.id FROM public.training_cycles tc WHERE tc.user_id = (select auth.uid())
    )
    AND (select public.user_has_min_tier('FLAME'))
  )
  WITH CHECK (
    cycle_id IN (
      SELECT tc.id FROM public.training_cycles tc WHERE tc.user_id = (select auth.uid())
    )
    AND (select public.user_has_min_tier('FLAME'))
  );

-- ---------------------------------------------------------------------------
-- 4. DEFINER import RPCs: FLAME instead of EMBER (same signatures).
-- ---------------------------------------------------------------------------
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

  IF NOT public.user_has_min_tier('FLAME') THEN
    RAISE EXCEPTION 'FLAME_REQUIRED';
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
      WHEN COALESCE(v_shared.estimated_duration, 0) <= 0 THEN 0
      WHEN COALESCE(v_shared.estimated_duration, 0) < GREATEST(COALESCE(v_shared.exercise_count, jsonb_array_length(v_snapshot), 1), 1) * 150
        THEN COALESCE(v_shared.estimated_duration, 0) * 60
      ELSE COALESCE(v_shared.estimated_duration, 0)
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

  IF NOT public.user_has_min_tier('FLAME') THEN
    RAISE EXCEPTION 'FLAME_REQUIRED';
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

REVOKE ALL ON FUNCTION public.import_shared_routine(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_shared_routine(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_shared_routine(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.import_shared_cycle(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_shared_cycle(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_shared_cycle(UUID, TEXT) TO authenticated, service_role;
