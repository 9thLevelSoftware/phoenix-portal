-- PR 19 review round 1 (R-10, R-4/R-2/R-5).
--
-- 1. normalize_cycle_progression_settings(jsonb): permanent helper. For an
--    object it rewrites every non-string value as its JSON text and drops
--    JSON nulls, so mobile's non-lenient Map<String, String> decode
--    (Project-Phoenix-MP SqlDelightSyncRepository.mergePortalCycles)
--    succeeds. Non-objects and NULL are returned unchanged. It never adds
--    or derives keys: deriving mobile keys here would re-inject values a
--    phone cleared.
-- 2. BEFORE INSERT OR UPDATE OF progression_settings trigger on
--    training_cycles applies it to every write: import_shared_cycle (old
--    community snapshots and creator-controlled snapshot JSON), cached
--    pre-PR-19 portal bundles, direct PostgREST writes, the portal RPCs and
--    the push merge.
--    shared_cycles.cycle_snapshot is intentionally NOT backfilled: mobile
--    never reads snapshots, and the only path from a snapshot to a phone is
--    import_shared_cycle, which writes through training_cycles and so
--    through this trigger. The portal preview renders values with String().
-- 3. merge_training_cycles_from_push redefined from its latest body
--    (20260920001800, KD-3 rule 3a); same signature, SECURITY DEFINER,
--    search_path, and service_role-only grants. Only the progression rule
--    changes:
--      * NULL incoming progression keeps the stored mobile keys (an older
--        build, a phone with no local progression row, or a failed decode
--        is not a user clear). The 20260920001900 backfill's keys therefore
--        survive the phone's next push and reach it on the pull.
--      * A stale push (structure not applied) leaves progression untouched,
--        so a portal progression edit survives a push from a build that
--        sends baseUpdatedAt.
--      * A current push with a non-null object owns the mobile keys it
--        covers, and a mobile key missing from it is removed.
--    Residual (same as the KD-6 structure residual): builds that send no
--    baseUpdatedAt are never stale, so their non-null progression still
--    overwrites a portal progression edit made since their last pull.
--
-- Idempotent: CREATE OR REPLACE / DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.normalize_cycle_progression_settings(p_settings JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN p_settings
    ELSE COALESCE(
      (SELECT jsonb_object_agg(
                e.key,
                CASE WHEN jsonb_typeof(e.value) = 'string' THEN e.value
                     ELSE to_jsonb(e.value #>> '{}')
                END)
         FROM jsonb_each(p_settings) AS e
        WHERE jsonb_typeof(e.value) <> 'null'),
      '{}'::jsonb)
  END
$$;

REVOKE ALL ON FUNCTION public.normalize_cycle_progression_settings(JSONB)
  FROM PUBLIC, anon, authenticated;

-- SECURITY DEFINER so the (revoked) helper runs as the owner whatever role
-- writes the row; it only rewrites NEW.progression_settings.
CREATE OR REPLACE FUNCTION public.normalize_training_cycle_progression()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.progression_settings :=
    public.normalize_cycle_progression_settings(NEW.progression_settings);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_training_cycle_progression()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS training_cycles_normalize_progression ON public.training_cycles;
CREATE TRIGGER training_cycles_normalize_progression
  BEFORE INSERT OR UPDATE OF progression_settings ON public.training_cycles
  FOR EACH ROW EXECUTE FUNCTION public.normalize_training_cycle_progression();

-- ---------------------------------------------------------------------------
-- merge_training_cycles_from_push: see the header (3) for what changed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_training_cycles_from_push(
  p_user_id UUID,
  p_cycles JSONB,
  p_use_lww BOOLEAN
)
RETURNS TABLE(id TEXT, accepted BOOLEAN, server_updated_at TIMESTAMPTZ, structure_applied BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_item JSONB;
  v_day JSONB;
  rec public.training_cycles%ROWTYPE;
  v_existing public.training_cycles%ROWTYPE;
  v_day_rec public.cycle_days%ROWTYPE;
  v_found BOOLEAN;
  v_inserted BOOLEAN;
  v_has_days BOOLEAN;
  v_day_count INT;
  v_derived_weeks INT;
  v_base TIMESTAMPTZ;
  v_has_base BOOLEAN;
  v_stale BOOLEAN;
  v_cycle_changed INT;
  v_days_changed INT;
  v_rows INT;
  v_day_numbers INT[];
  v_routine_id UUID;
  n_name TEXT;
  n_description TEXT;
  n_duration_weeks INT;
  n_workout_days INT;
  n_rest_days INT;
  n_current_week INT;
  n_status TEXT;
  n_progression JSONB;
  n_deload JSONB;
  n_template_id TEXT;
  -- Keys of the mobile CycleProgression DTO (Project-Phoenix-MP
  -- PortalSyncAdapter.toPortalTrainingCycle).
  c_mobile_progression_keys CONSTANT TEXT[] := ARRAY[
    'frequencyCycles', 'weightIncreasePercent', 'echoLevelIncrease',
    'eccentricLoadIncreasePercent'
  ];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'merge_training_cycles_from_push: p_user_id is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_cycles IS NULL OR jsonb_typeof(p_cycles) <> 'array' THEN
    RAISE EXCEPTION 'merge_training_cycles_from_push: p_cycles must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_cycles)
  LOOP
    rec := jsonb_populate_record(NULL::public.training_cycles, v_item);
    IF rec.id IS NULL THEN
      RAISE EXCEPTION 'merge_training_cycles_from_push: cycle id is required'
        USING ERRCODE = '22023';
    END IF;
    rec.user_id := p_user_id;

    v_has_days := jsonb_typeof(v_item -> 'days') = 'array';
    v_day_count := CASE WHEN v_has_days THEN jsonb_array_length(v_item -> 'days') END;
    v_derived_weeks := CASE
      WHEN NOT v_has_days THEN NULL
      WHEN v_day_count = 0 THEN 1
      ELSE ceil(v_day_count / 7.0)::INT
    END;

    v_base := NULL;
    IF jsonb_typeof(v_item -> 'base_updated_at') = 'string' THEN
      BEGIN
        v_base := (v_item ->> 'base_updated_at')::TIMESTAMPTZ;
      EXCEPTION WHEN others THEN
        -- Unparseable base: treat as absent (legacy rules).
        v_base := NULL;
      END;
    END IF;
    v_has_base := v_base IS NOT NULL;

    v_inserted := FALSE;
    SELECT c.* INTO v_existing FROM public.training_cycles c WHERE c.id = rec.id FOR UPDATE;
    v_found := FOUND;

    IF NOT v_found THEN
      INSERT INTO public.training_cycles AS c (
        id, user_id, local_profile_id, name, description, duration_weeks,
        workout_days, rest_days, current_week, status, started_at,
        last_used_at, progression_settings, deload_settings, template_id,
        updated_at
      ) VALUES (
        rec.id, p_user_id, rec.local_profile_id, rec.name, COALESCE(rec.description, ''),
        COALESCE(rec.duration_weeks, 4),
        COALESCE(rec.workout_days, 0),
        COALESCE(rec.rest_days, 0),
        COALESCE(rec.current_week, 1),
        COALESCE(rec.status, 'draft'),
        rec.started_at, rec.last_used_at, rec.progression_settings,
        rec.deload_settings, rec.template_id, COALESCE(rec.updated_at, now())
      )
      ON CONFLICT (id) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 1 THEN
        v_inserted := TRUE;
      ELSE
        -- Lost a race with a concurrent insert of the same id: merge into it.
        SELECT c.* INTO v_existing FROM public.training_cycles c WHERE c.id = rec.id FOR UPDATE;
        v_found := FOUND;
      END IF;
    END IF;

    v_stale := FALSE;
    IF NOT v_inserted THEN
      IF NOT v_found THEN
        -- Inserted and deleted concurrently; nothing to merge into.
        id := rec.id::TEXT; accepted := FALSE; server_updated_at := NULL; structure_applied := FALSE;
        RETURN NEXT;
        CONTINUE;
      END IF;

      IF v_existing.user_id IS DISTINCT FROM p_user_id THEN
        id := rec.id::TEXT; accepted := FALSE; server_updated_at := NULL; structure_applied := FALSE;
        RETURN NEXT;
        CONTINUE;
      END IF;

      IF p_use_lww
         AND NOT (v_existing.updated_at IS NULL OR v_existing.updated_at <= rec.updated_at) THEN
        id := rec.id::TEXT; accepted := FALSE;
        server_updated_at := v_existing.updated_at; structure_applied := FALSE;
        RETURN NEXT;
        CONTINUE;
      END IF;

      v_stale := v_has_base
        AND v_existing.portal_edited_at IS NOT NULL
        AND date_trunc('milliseconds', v_existing.portal_edited_at)
            > date_trunc('milliseconds', v_base);

      n_name := CASE WHEN v_stale THEN v_existing.name
                     ELSE COALESCE(rec.name, v_existing.name) END;
      n_description := CASE WHEN v_stale THEN v_existing.description
                            ELSE COALESCE(rec.description, v_existing.description) END;
      n_workout_days := CASE WHEN v_stale THEN v_existing.workout_days
                             ELSE COALESCE(rec.workout_days, v_existing.workout_days) END;
      n_rest_days := CASE WHEN v_stale THEN v_existing.rest_days
                          ELSE COALESCE(rec.rest_days, v_existing.rest_days) END;
      -- Keep a duration set on the portal against mobile's derived default
      -- only; otherwise (incl. cycles merely renamed/activated on the
      -- portal) the phone's value wins (review R-3, round 2).
      n_duration_weeks := CASE
        WHEN rec.duration_weeks IS NULL THEN v_existing.duration_weeks
        WHEN v_existing.portal_duration_set_at IS NOT NULL
             AND rec.duration_weeks = v_derived_weeks THEN v_existing.duration_weeks
        ELSE rec.duration_weeks
      END;
      n_current_week := COALESCE(rec.current_week, v_existing.current_week);
      n_status := COALESCE(rec.status, v_existing.status);
      -- Progression (PR 19 R-10). Only a current (non-stale) push with a
      -- non-null progression object is authoritative for the mobile keys:
      -- it replaces them, and a mobile key missing from it is removed
      -- (mobile encodes sparsely). A NULL incoming (older build, no local
      -- progression row, or a failed decode) and a stale push keep the
      -- stored settings unchanged. Portal-only keys always survive.
      IF v_stale OR rec.progression_settings IS NULL THEN
        n_progression := v_existing.progression_settings;
      ELSIF jsonb_typeof(rec.progression_settings) <> 'object'
            OR v_existing.progression_settings IS NULL
            OR jsonb_typeof(v_existing.progression_settings) <> 'object' THEN
        n_progression := rec.progression_settings;
      ELSE
        n_progression := (v_existing.progression_settings - c_mobile_progression_keys)
                         || rec.progression_settings;
      END IF;
      -- Same normalization the BEFORE trigger applies, so the no-op check
      -- below compares like with like.
      n_progression := public.normalize_cycle_progression_settings(n_progression);
      n_deload := COALESCE(rec.deload_settings, v_existing.deload_settings);
      n_template_id := COALESCE(rec.template_id, v_existing.template_id);

      -- updated_at is trigger-owned on UPDATE (cycles_updated_at).
      UPDATE public.training_cycles c SET
        local_profile_id     = rec.local_profile_id,
        name                 = n_name,
        description          = n_description,
        duration_weeks       = n_duration_weeks,
        workout_days         = n_workout_days,
        rest_days            = n_rest_days,
        current_week         = n_current_week,
        status               = n_status,
        started_at           = rec.started_at,
        last_used_at         = rec.last_used_at,
        progression_settings = n_progression,
        deload_settings      = n_deload,
        template_id          = n_template_id
      WHERE c.id = rec.id
        AND c.user_id = p_user_id
        AND (
          c.local_profile_id, c.name, c.description, c.duration_weeks,
          c.workout_days, c.rest_days, c.current_week, c.status,
          c.started_at, c.last_used_at, c.progression_settings,
          c.deload_settings, c.template_id
        ) IS DISTINCT FROM (
          rec.local_profile_id, n_name, n_description, n_duration_weeks,
          n_workout_days, n_rest_days, n_current_week, n_status,
          rec.started_at, rec.last_used_at, n_progression,
          n_deload, n_template_id
        );
      GET DIAGNOSTICS v_cycle_changed = ROW_COUNT;
    ELSE
      v_cycle_changed := 1;
    END IF;

    -- Days: only when the push carries a day list and its structure applies.
    v_days_changed := 0;
    IF v_has_days AND NOT v_stale THEN
      v_day_numbers := ARRAY[]::INT[];
      FOR v_day IN SELECT value FROM jsonb_array_elements(v_item -> 'days')
      LOOP
        v_day_rec := jsonb_populate_record(NULL::public.cycle_days, v_day);
        IF v_day_rec.day_number IS NULL THEN
          RAISE EXCEPTION 'merge_training_cycles_from_push: day_number is required'
            USING ERRCODE = '22023';
        END IF;
        v_day_numbers := v_day_numbers || v_day_rec.day_number;

        -- Only the caller's own routines may be referenced; anything else
        -- (deleted meanwhile, missing, foreign) is stored as NULL, matching
        -- the FK's ON DELETE SET NULL.
        v_routine_id := NULL;
        IF v_day_rec.routine_id IS NOT NULL THEN
          SELECT r.id INTO v_routine_id
            FROM public.routines r
           WHERE r.id = v_day_rec.routine_id AND r.user_id = p_user_id;
        END IF;

        INSERT INTO public.cycle_days AS d (
          cycle_id, day_number, day_type, routine_id, weight_adjustment,
          rep_modifier, rest_override, rest_type, notes
        ) VALUES (
          rec.id, v_day_rec.day_number,
          COALESCE(v_day_rec.day_type, 'workout'),
          v_routine_id,
          COALESCE(v_day_rec.weight_adjustment, 0),
          COALESCE(v_day_rec.rep_modifier, 0),
          v_day_rec.rest_override, v_day_rec.rest_type, v_day_rec.notes
        )
        ON CONFLICT (cycle_id, day_number) DO UPDATE SET
          day_type          = EXCLUDED.day_type,
          routine_id        = EXCLUDED.routine_id,
          weight_adjustment = EXCLUDED.weight_adjustment,
          rep_modifier      = EXCLUDED.rep_modifier,
          rest_override     = EXCLUDED.rest_override,
          -- rest_type is kept on NULL only while the day type is unchanged.
          rest_type         = CASE WHEN EXCLUDED.day_type IS NOT DISTINCT FROM d.day_type
                                 THEN COALESCE(EXCLUDED.rest_type, d.rest_type)
                                 ELSE EXCLUDED.rest_type END,
          notes             = EXCLUDED.notes
        WHERE (
          d.day_type, d.routine_id, d.weight_adjustment, d.rep_modifier,
          d.rest_override, d.rest_type, d.notes
        ) IS DISTINCT FROM (
          EXCLUDED.day_type, EXCLUDED.routine_id, EXCLUDED.weight_adjustment,
          EXCLUDED.rep_modifier, EXCLUDED.rest_override,
          CASE WHEN EXCLUDED.day_type IS NOT DISTINCT FROM d.day_type
            THEN COALESCE(EXCLUDED.rest_type, d.rest_type)
            ELSE EXCLUDED.rest_type END,
          EXCLUDED.notes
        );
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_days_changed := v_days_changed + v_rows;
      END LOOP;

      IF v_has_base THEN
        DELETE FROM public.cycle_days d
         WHERE d.cycle_id = rec.id
           AND NOT (d.day_number = ANY (v_day_numbers));
      ELSE
        -- Legacy build: only days beyond the payload's highest day_number.
        DELETE FROM public.cycle_days d
         WHERE d.cycle_id = rec.id
           AND d.day_number > COALESCE(
             (SELECT max(x) FROM unnest(v_day_numbers) AS x), -1);
      END IF;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_days_changed := v_days_changed + v_rows;
    END IF;

    -- Day-only change on an existing cycle: advance the pull cursor.
    IF NOT v_inserted AND v_cycle_changed = 0 AND v_days_changed > 0 THEN
      UPDATE public.training_cycles c SET updated_at = now() WHERE c.id = rec.id;
    END IF;

    id := rec.id::TEXT;
    accepted := TRUE;
    SELECT c.updated_at INTO server_updated_at FROM public.training_cycles c WHERE c.id = rec.id;
    structure_applied := NOT v_stale;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_training_cycles_from_push(UUID, JSONB, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_training_cycles_from_push(UUID, JSONB, BOOLEAN)
  TO service_role;
