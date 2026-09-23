-- 204-D: a portal-created cycle pushed under a named phone profile makes
-- guard_profile_ownership_update (20260920120000, refined in 20260922120000)
-- raise profile_ownership_transfer_required inside the merge. That failed the
-- whole cycle batch and mobile-sync-push answered 503 partial_write_retry,
-- which the phone retries forever.
--
-- The loop body now runs in a sub-block per cycle. The guard's refusal is
-- caught for that cycle only: its writes roll back, it is returned as
-- accepted = false with the stored LWW key (a structured rejection the phone
-- already handles by keeping the server copy), and the rest of the batch
-- proceeds. The Edge also rejects such rows before the merge; this is the
-- backstop for the window between that check and the write.
--
-- Body otherwise identical to 20260920002101; same signature and return
-- type, so CREATE OR REPLACE keeps grants and database.types.ts.
--
-- guard_profile_ownership_update now raises its refusal under the dedicated
-- SQLSTATE P204D instead of the generic P0001, so the handler below matches a
-- machine-readable code rather than the message text. Nothing else keyed on
-- P0001 for this error; the message is unchanged. Body otherwise identical
-- to 20260922120000 section 5.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_profile_ownership_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(OLD.local_profile_id, 'default') IS DISTINCT FROM COALESCE(NEW.local_profile_id, 'default')
     AND COALESCE(current_setting('phoenix.allow_profile_transfer', TRUE), '') <> 'on'
     -- The profile FKs are ON DELETE SET NULL: deleting a local profile
     -- detaches its rows. The parent is already gone in this transaction.
     AND NOT (
       NEW.local_profile_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.local_profiles lp
         WHERE lp.user_id = OLD.user_id AND lp.id = OLD.local_profile_id
       )
     ) THEN
    RAISE EXCEPTION 'profile_ownership_transfer_required' USING ERRCODE = 'P204D';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_training_cycles_from_push(
  p_user_id UUID,
  p_cycles JSONB,
  p_use_lww BOOLEAN
)
RETURNS TABLE(
  id TEXT,
  accepted BOOLEAN,
  server_updated_at TIMESTAMPTZ,
  structure_applied BOOLEAN,
  client_updated_at TIMESTAMPTZ
)
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
  v_knows_portal_edit BOOLEAN;
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
    -- 204-D: one cycle's profile-guard refusal must not fail the batch.
    BEGIN
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
        updated_at, client_updated_at
      ) VALUES (
        rec.id, p_user_id, rec.local_profile_id, rec.name, COALESCE(rec.description, ''),
        COALESCE(rec.duration_weeks, 4),
        COALESCE(rec.workout_days, 0),
        COALESCE(rec.rest_days, 0),
        COALESCE(rec.current_week, 1),
        COALESCE(rec.status, 'draft'),
        rec.started_at, rec.last_used_at, rec.progression_settings,
        rec.deload_settings, rec.template_id, now(),
        COALESCE(rec.updated_at, now())
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
        id := rec.id::TEXT; accepted := FALSE; server_updated_at := NULL;
        structure_applied := FALSE; client_updated_at := NULL;
        RETURN NEXT;
        CONTINUE;
      END IF;

      IF v_existing.user_id IS DISTINCT FROM p_user_id THEN
        id := rec.id::TEXT; accepted := FALSE; server_updated_at := NULL;
        structure_applied := FALSE; client_updated_at := NULL;
        RETURN NEXT;
        CONTINUE;
      END IF;

      -- R-2: the stored key is a portal stamp this push already knows about
      -- (its base is at or after that edit), so a device clock behind the
      -- server must not lose its genuinely newer edit.
      -- COALESCE is load-bearing: with client_updated_at NULL (a row the
      -- backfill never reached) the `=` yields NULL, and `IF p_use_lww AND
      -- NOT NULL AND ...` is NULL, which plpgsql treats as false — the
      -- rejection branch would be skipped and every stale push accepted.
      v_knows_portal_edit := COALESCE(
        v_has_base
          AND v_existing.portal_edited_at IS NOT NULL
          AND v_existing.client_updated_at = v_existing.portal_edited_at
          AND date_trunc('milliseconds', v_base)
              >= date_trunc('milliseconds', v_existing.portal_edited_at),
        FALSE);

      IF p_use_lww
         AND NOT v_knows_portal_edit
         AND NOT (COALESCE(v_existing.client_updated_at, v_existing.updated_at) IS NULL
                  OR COALESCE(v_existing.client_updated_at, v_existing.updated_at) <= rec.updated_at) THEN
        id := rec.id::TEXT; accepted := FALSE;
        server_updated_at := v_existing.updated_at; structure_applied := FALSE;
        client_updated_at := COALESCE(v_existing.client_updated_at, v_existing.updated_at);
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

      -- updated_at is trigger-owned on UPDATE (cycles_updated_at). The LWW
      -- key follows every applied change but is not part of the no-op check.
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
        template_id          = n_template_id,
        client_updated_at    = COALESCE(rec.updated_at, now())
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
      UPDATE public.training_cycles c
         SET updated_at = now(), client_updated_at = COALESCE(rec.updated_at, now())
       WHERE c.id = rec.id;
    END IF;

    id := rec.id::TEXT;
    accepted := TRUE;
    SELECT c.updated_at, c.client_updated_at
      INTO server_updated_at, client_updated_at
      FROM public.training_cycles c WHERE c.id = rec.id;
    structure_applied := NOT v_stale;
    RETURN NEXT;
    EXCEPTION WHEN SQLSTATE 'P204D' THEN
      -- guard_profile_ownership_update refuses a local_profile_id change
      -- outside an ownership transfer (a portal-created cycle pushed under a
      -- named phone profile), under its own SQLSTATE (below). The
      -- subtransaction rolled back this cycle's writes; report it as a
      -- structured rejection carrying the stored LWW key, keep the stored
      -- profile, and go on with the rest of the batch. Any other error,
      -- P0001 included, still fails the merge.
      id := v_item ->> 'id';
      accepted := FALSE;
      structure_applied := FALSE;
      SELECT c.updated_at, COALESCE(c.client_updated_at, c.updated_at)
        INTO server_updated_at, client_updated_at
        FROM public.training_cycles c
       WHERE c.id = (v_item ->> 'id')::UUID AND c.user_id = p_user_id;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_training_cycles_from_push(UUID, JSONB, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_training_cycles_from_push(UUID, JSONB, BOOLEAN)
  TO service_role;

COMMIT;
