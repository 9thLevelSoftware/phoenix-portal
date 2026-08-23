-- Trust plane: period-open entitlements on existing writes, deletion grace,
-- private Broadcast SELECT, profile opt-in, Garmin token backfill, avatars
-- storage policies.
--
-- Do-no-harm:
--   * SELECT of own rows stays owner-only (no entitlement).
--   * No CREATE POLICY FOR DELETE where HEAD had none.
--   * routine_exercises / cycle_days FOR ALL is SPLIT, not AND-EMBER in place.
--   * public_profiles stays security_barrier (not security_invoker).

-- ---------------------------------------------------------------------------
-- 1. Period-open helper + min-tier predicate (matches Edge/UI)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_subscription_tier()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT s.tier
      FROM public.subscriptions s
      WHERE s.user_id = auth.uid()
        AND s.status IN ('active', 'trialing')
        AND s.current_period_end IS NOT NULL
        AND s.current_period_end > now()
      LIMIT 1
    ),
    'FREE'
  );
$$;

CREATE OR REPLACE FUNCTION public.user_has_min_tier(min_tier text)
RETURNS boolean
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE public.user_subscription_tier()
    WHEN 'INFERNO' THEN 3
    WHEN 'FLAME' THEN 2
    WHEN 'EMBER' THEN 1
    ELSE 0
  END >= CASE min_tier
    WHEN 'INFERNO' THEN 3
    WHEN 'FLAME' THEN 2
    WHEN 'EMBER' THEN 1
    WHEN 'FREE' THEN 0
    ELSE 4
  END;
$$;

GRANT EXECUTE ON FUNCTION public.user_subscription_tier() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.user_has_min_tier(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_min_tier(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_has_min_tier(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Conjunction ≥ EMBER on existing INSERT/UPDATE (and existing DELETE only)
--    SELECT policies on these tables are not touched.
-- ---------------------------------------------------------------------------

-- workout_sessions: INSERT + UPDATE. No DELETE policy — do not add one.
DROP POLICY IF EXISTS "Users can insert own sessions" ON public.workout_sessions;
CREATE POLICY "Users can insert own sessions"
  ON public.workout_sessions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_has_min_tier('EMBER')
  );

DROP POLICY IF EXISTS "Users can update own sessions" ON public.workout_sessions;
CREATE POLICY "Users can update own sessions"
  ON public.workout_sessions FOR UPDATE
  USING (
    auth.uid() = user_id
    AND public.user_has_min_tier('EMBER')
  )
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_has_min_tier('EMBER')
  );

-- exercises / sets / rep_summaries / rep_telemetry: INSERT only. No DELETE.
DROP POLICY IF EXISTS "Users can insert own exercises" ON public.exercises;
CREATE POLICY "Users can insert own exercises"
  ON public.exercises FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND public.user_has_min_tier('EMBER')
  );

DROP POLICY IF EXISTS "Users can insert own sets" ON public.sets;
CREATE POLICY "Users can insert own sets"
  ON public.sets FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND public.user_has_min_tier('EMBER')
  );

DROP POLICY IF EXISTS "Users can insert own rep summaries" ON public.rep_summaries;
CREATE POLICY "Users can insert own rep summaries"
  ON public.rep_summaries FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND public.user_has_min_tier('EMBER')
  );

DROP POLICY IF EXISTS "Users can insert own telemetry" ON public.rep_telemetry;
CREATE POLICY "Users can insert own telemetry"
  ON public.rep_telemetry FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND public.user_has_min_tier('EMBER')
  );

-- routines: INSERT + UPDATE + DELETE (DELETE already existed).
DROP POLICY IF EXISTS "Users can insert own routines" ON public.routines;
CREATE POLICY "Users can insert own routines"
  ON public.routines FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_has_min_tier('EMBER')
  );

DROP POLICY IF EXISTS "Users can update own routines" ON public.routines;
CREATE POLICY "Users can update own routines"
  ON public.routines FOR UPDATE
  USING (
    auth.uid() = user_id
    AND public.user_has_min_tier('EMBER')
  );

DROP POLICY IF EXISTS "Users can delete own routines" ON public.routines;
CREATE POLICY "Users can delete own routines"
  ON public.routines FOR DELETE
  USING (
    auth.uid() = user_id
    AND public.user_has_min_tier('EMBER')
  );

-- training_cycles: INSERT + UPDATE + DELETE (DELETE already existed).
DROP POLICY IF EXISTS "Users can insert own cycles" ON public.training_cycles;
CREATE POLICY "Users can insert own cycles"
  ON public.training_cycles FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_has_min_tier('EMBER')
  );

DROP POLICY IF EXISTS "Users can update own cycles" ON public.training_cycles;
CREATE POLICY "Users can update own cycles"
  ON public.training_cycles FOR UPDATE
  USING (
    auth.uid() = user_id
    AND public.user_has_min_tier('EMBER')
  );

DROP POLICY IF EXISTS "Users can delete own cycles" ON public.training_cycles;
CREATE POLICY "Users can delete own cycles"
  ON public.training_cycles FOR DELETE
  USING (
    auth.uid() = user_id
    AND public.user_has_min_tier('EMBER')
  );

-- personal_records / exercise_progress: INSERT only. No DELETE.
DROP POLICY IF EXISTS "Users can insert own records" ON public.personal_records;
CREATE POLICY "Users can insert own records"
  ON public.personal_records FOR INSERT
  WITH CHECK (
    (select auth.uid()) = user_id
    AND public.user_has_min_tier('EMBER')
  );

DROP POLICY IF EXISTS "Users can insert own exercise progress" ON public.exercise_progress;
CREATE POLICY "Users can insert own exercise progress"
  ON public.exercise_progress FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_has_min_tier('EMBER')
  );

-- local_profiles: INSERT + UPDATE + existing DELETE (conjunction on that DELETE).
DROP POLICY IF EXISTS "Users can insert own local profiles" ON public.local_profiles;
CREATE POLICY "Users can insert own local profiles"
  ON public.local_profiles FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_has_min_tier('EMBER')
  );

DROP POLICY IF EXISTS "Users can update own local profiles" ON public.local_profiles;
CREATE POLICY "Users can update own local profiles"
  ON public.local_profiles FOR UPDATE
  USING (
    auth.uid() = user_id
    AND public.user_has_min_tier('EMBER')
  );

DROP POLICY IF EXISTS "Users can delete own local profiles" ON public.local_profiles;
CREATE POLICY "Users can delete own local profiles"
  ON public.local_profiles FOR DELETE
  USING (
    auth.uid() = user_id
    AND public.user_has_min_tier('EMBER')
  );

-- ---------------------------------------------------------------------------
-- 3. Split FOR ALL on routine_exercises / cycle_days
--    SELECT: parent-join only (no EMBER). Writes: parent-join AND EMBER.
--    DELETE here tightens the existing FOR ALL grant; it is not a new DELETE.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users manage exercises in own routines" ON public.routine_exercises;
DROP POLICY IF EXISTS "Users can view exercises in own routines" ON public.routine_exercises;
DROP POLICY IF EXISTS "Users can insert exercises in own routines" ON public.routine_exercises;
DROP POLICY IF EXISTS "Users can update exercises in own routines" ON public.routine_exercises;
DROP POLICY IF EXISTS "Users can delete exercises in own routines" ON public.routine_exercises;

CREATE POLICY "Users can view exercises in own routines"
  ON public.routine_exercises FOR SELECT
  USING (
    routine_id IN (SELECT id FROM public.routines WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert exercises in own routines"
  ON public.routine_exercises FOR INSERT
  WITH CHECK (
    routine_id IN (SELECT id FROM public.routines WHERE user_id = auth.uid())
    AND public.user_has_min_tier('EMBER')
  );

CREATE POLICY "Users can update exercises in own routines"
  ON public.routine_exercises FOR UPDATE
  USING (
    routine_id IN (SELECT id FROM public.routines WHERE user_id = auth.uid())
    AND public.user_has_min_tier('EMBER')
  )
  WITH CHECK (
    routine_id IN (SELECT id FROM public.routines WHERE user_id = auth.uid())
    AND public.user_has_min_tier('EMBER')
  );

CREATE POLICY "Users can delete exercises in own routines"
  ON public.routine_exercises FOR DELETE
  USING (
    routine_id IN (SELECT id FROM public.routines WHERE user_id = auth.uid())
    AND public.user_has_min_tier('EMBER')
  );

DROP POLICY IF EXISTS "Users manage days in own cycles" ON public.cycle_days;
DROP POLICY IF EXISTS "Users can view days in own cycles" ON public.cycle_days;
DROP POLICY IF EXISTS "Users can insert days in own cycles" ON public.cycle_days;
DROP POLICY IF EXISTS "Users can update days in own cycles" ON public.cycle_days;
DROP POLICY IF EXISTS "Users can delete days in own cycles" ON public.cycle_days;

CREATE POLICY "Users can view days in own cycles"
  ON public.cycle_days FOR SELECT
  USING (
    cycle_id IN (SELECT id FROM public.training_cycles WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert days in own cycles"
  ON public.cycle_days FOR INSERT
  WITH CHECK (
    cycle_id IN (SELECT id FROM public.training_cycles WHERE user_id = auth.uid())
    AND public.user_has_min_tier('EMBER')
  );

CREATE POLICY "Users can update days in own cycles"
  ON public.cycle_days FOR UPDATE
  USING (
    cycle_id IN (SELECT id FROM public.training_cycles WHERE user_id = auth.uid())
    AND public.user_has_min_tier('EMBER')
  )
  WITH CHECK (
    cycle_id IN (SELECT id FROM public.training_cycles WHERE user_id = auth.uid())
    AND public.user_has_min_tier('EMBER')
  );

CREATE POLICY "Users can delete days in own cycles"
  ON public.cycle_days FOR DELETE
  USING (
    cycle_id IN (SELECT id FROM public.training_cycles WHERE user_id = auth.uid())
    AND public.user_has_min_tier('EMBER')
  );

-- ---------------------------------------------------------------------------
-- 4. DEFINER import RPCs: in-function EMBER check (table RLS does not apply)
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

  IF NOT public.user_has_min_tier('EMBER') THEN
    RAISE EXCEPTION 'EMBER_REQUIRED';
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

  IF NOT public.user_has_min_tier('EMBER') THEN
    RAISE EXCEPTION 'EMBER_REQUIRED';
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
REVOKE ALL ON FUNCTION public.import_shared_cycle(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_shared_routine(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_shared_cycle(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. deletion_requests: 30-day floor + freeze scheduled_for
-- ---------------------------------------------------------------------------
-- Drop the freeze trigger first so a re-run can floor leftover short-grace
-- rows without the UPDATE being rejected.
DROP TRIGGER IF EXISTS enforce_deletion_request_grace ON public.deletion_requests;

UPDATE public.deletion_requests
SET scheduled_for = requested_at + INTERVAL '30 days'
WHERE scheduled_for < requested_at + INTERVAL '30 days';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'deletion_requests_scheduled_for_min_grace'
      AND conrelid = 'public.deletion_requests'::regclass
  ) THEN
    ALTER TABLE public.deletion_requests
      ADD CONSTRAINT deletion_requests_scheduled_for_min_grace
      CHECK (scheduled_for >= requested_at + INTERVAL '30 days');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_deletion_request_grace()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Floor against wall clock as well as requested_at so a client-supplied
    -- past requested_at cannot skip the 30-day grace.
    IF NEW.scheduled_for < GREATEST(NEW.requested_at, now()) + INTERVAL '30 days' THEN
      RAISE EXCEPTION 'scheduled_for must be at least 30 days from the request time'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for THEN
    RAISE EXCEPTION 'scheduled_for cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'requested_at cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_deletion_request_grace
  BEFORE INSERT OR UPDATE ON public.deletion_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_deletion_request_grace();

DROP POLICY IF EXISTS "Users can insert own deletion request" ON public.deletion_requests;
CREATE POLICY "Users can insert own deletion request"
  ON public.deletion_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND status = 'pending'
  );

DROP POLICY IF EXISTS "Users can update own deletion request" ON public.deletion_requests;
CREATE POLICY "Users can update own deletion request"
  ON public.deletion_requests FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id AND status = 'pending')
  WITH CHECK ((select auth.uid()) = user_id AND status = 'cancelled');

REVOKE INSERT, UPDATE ON public.deletion_requests FROM PUBLIC;
REVOKE INSERT, UPDATE ON public.deletion_requests FROM anon;
REVOKE INSERT, UPDATE ON public.deletion_requests FROM authenticated;
GRANT INSERT (user_id) ON public.deletion_requests TO authenticated;
GRANT UPDATE (cancelled_at, status) ON public.deletion_requests TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Profiles: opt-in visibility + non-PII placeholder. No backfill.
--    Do not recreate public_profiles as security_invoker.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ALTER COLUMN profile_visible SET DEFAULT false;
ALTER TABLE public.profiles ALTER COLUMN leaderboard_participation SET DEFAULT false;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    INSERT INTO public.profiles (
      id,
      display_name,
      profile_visible,
      leaderboard_participation
    )
    VALUES (NEW.id, 'Athlete', false, false)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.local_profiles (user_id, id, name, device_id)
    VALUES (NEW.id, 'default', 'Default', 'server')
    ON CONFLICT (user_id, id) DO NOTHING;

    RETURN NEW;
END
$function$;

-- ---------------------------------------------------------------------------
-- 7. Private Broadcast SELECT on realtime.messages (CI-safe if relation absent)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN
    RAISE NOTICE 'realtime.messages absent; skip Broadcast RLS';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
  -- KD-29: private Broadcast SELECT needs a table grant; service-role still
  -- sends (no authenticated INSERT policy).
  EXECUTE 'GRANT SELECT ON realtime.messages TO authenticated';

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'phoenix_sync_broadcast_select'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY phoenix_sync_broadcast_select
      ON realtime.messages
      FOR SELECT
      TO authenticated
      USING (
        realtime.messages.extension = 'broadcast'
        AND realtime.topic() = 'sync:' || auth.uid()::text
      )
    $policy$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8. Avatars storage: path-scoped writes (idempotent)
--    Bucket stays public so Profile getPublicUrl keeps working. Do NOT add a
--    SELECT policy — listing must fail closed. Public URLs do not need one.
--    Unknown dashboard-created avatars policies cannot be probed here; drop
--    leftovers named other than the three write policies below by hand.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  TRUE,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public can read avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own avatars" ON storage.objects;

CREATE POLICY "Users can upload own avatars"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND name LIKE (select auth.uid())::text || '/%'
  );

CREATE POLICY "Users can update own avatars"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name LIKE (select auth.uid())::text || '/%'
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND name LIKE (select auth.uid())::text || '/%'
  );

CREATE POLICY "Users can delete own avatars"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name LIKE (select auth.uid())::text || '/%'
  );

-- ---------------------------------------------------------------------------
-- 9. Backfill-null Garmin tokens already stored in browser-readable JSONB
--    Walks nested objects and arrays, not only top-level keys.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jsonb_redact_token_keys(data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  result jsonb;
  entry record;
  i int;
  len int;
BEGIN
  IF data IS NULL THEN
    RETURN NULL;
  ELSIF jsonb_typeof(data) = 'array' THEN
    result := '[]'::jsonb;
    len := jsonb_array_length(data);
    FOR i IN 0 .. GREATEST(len - 1, -1) LOOP
      result := result || jsonb_build_array(public.jsonb_redact_token_keys(data -> i));
    END LOOP;
    RETURN result;
  ELSIF jsonb_typeof(data) = 'object' THEN
    result := '{}'::jsonb;
    FOR entry IN SELECT key, value FROM jsonb_each(data) LOOP
      IF entry.key ~* 'token' THEN
        CONTINUE;
      END IF;
      result := result || jsonb_build_object(
        entry.key,
        public.jsonb_redact_token_keys(entry.value)
      );
    END LOOP;
    RETURN result;
  ELSE
    RETURN data;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.jsonb_redact_token_keys(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jsonb_redact_token_keys(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.jsonb_redact_token_keys(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.jsonb_redact_token_keys(jsonb) TO service_role;

UPDATE public.external_activities
SET raw_data = public.jsonb_redact_token_keys(raw_data)
WHERE raw_data IS NOT NULL
  AND raw_data::text ~* 'token';
