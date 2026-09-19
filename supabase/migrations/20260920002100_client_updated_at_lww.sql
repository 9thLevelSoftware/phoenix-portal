-- KD-5 (PR 21): split the LWW key from the server write clock.
--
-- updated_at on workout_sessions, routines and training_cycles is rewritten
-- to now() by the *_updated_at BEFORE UPDATE triggers. It is the pull cursor
-- (delta pulls, #116 portal note edits) and stays exactly that. The LWW RPCs
-- compared the device's updatedAt against it, so after any accepted update a
-- device whose clock trails the server was rejected (F-008), and the RPCs
-- reported the client value as server_updated_at and "accepted" rows they
-- never wrote (F-068).
--
-- 1. client_updated_at: the LWW key. Written verbatim from the push under
--    both SYNC_LWW_ENABLED values (Edge LWW-off upsert rows carry it; the
--    LWW RPCs and merge_training_cycles_from_push write it), compared by the
--    LWW RPCs as COALESCE(client_updated_at, updated_at) <= incoming.
-- 2. Backfill client_updated_at = updated_at without moving updated_at:
--    update_updated_at_column() is a no-op while phoenix.skip_updated_at is
--    'on' (not session_replication_role, which would also skip FK triggers).
-- 3. Portal writes advance the LWW key: a BEFORE INSERT OR UPDATE trigger
--    sets client_updated_at := now() for authenticated (portal) writers only.
--    Migrations/operator fixes (postgres, no JWT), cron and service-role
--    pushes never stamp it, so it cannot overwrite the backfill.
-- 4. LWW RPCs decide `accepted` from the guarded upsert's row count
--    (RETURNING ... / FOUND) and return the stored LWW key.
--
-- No wire change. Deploy this migration before the Edge Function: the
-- LWW-off push upsert sends client_updated_at.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.workout_sessions ADD COLUMN IF NOT EXISTS client_updated_at TIMESTAMPTZ;
ALTER TABLE public.routines ADD COLUMN IF NOT EXISTS client_updated_at TIMESTAMPTZ;
ALTER TABLE public.training_cycles ADD COLUMN IF NOT EXISTS client_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.workout_sessions.client_updated_at IS
  'LWW key (KD-5): the pushing device''s updatedAt, or now() for a portal edit. updated_at is the server write clock / pull cursor.';
COMMENT ON COLUMN public.routines.client_updated_at IS
  'LWW key (KD-5): the pushing device''s updatedAt, or now() for a portal edit. updated_at is the server write clock / pull cursor.';
COMMENT ON COLUMN public.training_cycles.client_updated_at IS
  'LWW key (KD-5): the pushing device''s updatedAt, or now() for a portal edit. updated_at is the server write clock / pull cursor.';

-- ---------------------------------------------------------------------------
-- updated_at trigger: skippable for backfills (R-32)
-- ---------------------------------------------------------------------------
-- Starts from 20260324130000. Shared by every *_updated_at trigger.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_setting('phoenix.skip_updated_at', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill (before the stamp trigger exists; the trigger would not stamp a
-- postgres write anyway). A function so the pgTAP suite runs the same code.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_client_updated_at()
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_prev TEXT := current_setting('phoenix.skip_updated_at', true);
BEGIN
  PERFORM set_config('phoenix.skip_updated_at', 'on', true);
  UPDATE public.workout_sessions SET client_updated_at = updated_at WHERE client_updated_at IS NULL;
  UPDATE public.routines SET client_updated_at = updated_at WHERE client_updated_at IS NULL;
  UPDATE public.training_cycles SET client_updated_at = updated_at WHERE client_updated_at IS NULL;
  PERFORM set_config('phoenix.skip_updated_at', COALESCE(v_prev, ''), true);
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_client_updated_at() FROM PUBLIC, anon, authenticated, service_role;

SELECT public.backfill_client_updated_at();

-- ---------------------------------------------------------------------------
-- Portal writes advance the LWW key (R-4, R-20, R-201)
-- ---------------------------------------------------------------------------
-- Only assigns to NEW, so it runs with the caller's rights.
CREATE OR REPLACE FUNCTION public.stamp_client_updated_at_portal_edit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() = 'authenticated'
     AND current_setting('phoenix.skip_updated_at', true) IS DISTINCT FROM 'on' THEN
    NEW.client_updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_client_updated_at_portal_edit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS workout_sessions_client_updated_at ON public.workout_sessions;
CREATE TRIGGER workout_sessions_client_updated_at
  BEFORE INSERT OR UPDATE ON public.workout_sessions
  FOR EACH ROW EXECUTE FUNCTION public.stamp_client_updated_at_portal_edit();

DROP TRIGGER IF EXISTS routines_client_updated_at ON public.routines;
CREATE TRIGGER routines_client_updated_at
  BEFORE INSERT OR UPDATE ON public.routines
  FOR EACH ROW EXECUTE FUNCTION public.stamp_client_updated_at_portal_edit();

DROP TRIGGER IF EXISTS training_cycles_client_updated_at ON public.training_cycles;
CREATE TRIGGER training_cycles_client_updated_at
  BEFORE INSERT OR UPDATE ON public.training_cycles
  FOR EACH ROW EXECUTE FUNCTION public.stamp_client_updated_at_portal_edit();

-- ---------------------------------------------------------------------------
-- upsert_workout_session_lww (starts from 20260420190710)
-- ---------------------------------------------------------------------------
-- Incoming key: client_updated_at, else updated_at, else now() (older
-- builds). The upsert's WHERE is the only gate, so a concurrent newer write
-- makes it update nothing and the row is reported rejected. updated_at in
-- the SET list is overwritten by sessions_updated_at (server clock).
CREATE OR REPLACE FUNCTION public.upsert_workout_session_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  rec record;
  v_incoming timestamptz;
  v_stored timestamptz;
BEGIN
  FOR rec IN
    SELECT * FROM jsonb_populate_recordset(NULL::public.workout_sessions, p_rows)
  LOOP
    v_incoming := COALESCE(rec.client_updated_at, rec.updated_at, NOW());

    INSERT INTO public.workout_sessions AS ws (
      id, user_id, local_profile_id, name, notes, started_at, duration_seconds,
      total_volume, set_count, exercise_count, pr_count, routine_name,
      routine_session_id, workout_mode, warmup_reps, working_reps,
      avg_velocity_mps, avg_asymmetry_pct, velocity_loss_pct, dominant_side,
      strength_profile, form_score, deload_warnings, rom_violations,
      spotter_activations, peak_force_n, estimated_calories, heaviest_lift_kg,
      eccentric_load, echo_level, updated_at, client_updated_at
    ) VALUES (
      rec.id, rec.user_id, rec.local_profile_id, rec.name, rec.notes,
      COALESCE(rec.started_at, NOW()),
      COALESCE(rec.duration_seconds, 0),
      COALESCE(rec.total_volume, 0),
      COALESCE(rec.set_count, 0),
      COALESCE(rec.exercise_count, 0),
      COALESCE(rec.pr_count, 0),
      rec.routine_name, rec.routine_session_id, rec.workout_mode,
      rec.warmup_reps, rec.working_reps, rec.avg_velocity_mps,
      rec.avg_asymmetry_pct, rec.velocity_loss_pct, rec.dominant_side,
      rec.strength_profile, rec.form_score, rec.deload_warnings,
      rec.rom_violations, rec.spotter_activations, rec.peak_force_n,
      rec.estimated_calories, rec.heaviest_lift_kg, rec.eccentric_load,
      rec.echo_level, COALESCE(rec.updated_at, NOW()), v_incoming
    )
    ON CONFLICT (id) DO UPDATE SET
      name              = EXCLUDED.name,
      notes             = EXCLUDED.notes,
      started_at        = EXCLUDED.started_at,
      duration_seconds  = EXCLUDED.duration_seconds,
      total_volume      = EXCLUDED.total_volume,
      set_count         = EXCLUDED.set_count,
      exercise_count    = EXCLUDED.exercise_count,
      pr_count          = EXCLUDED.pr_count,
      routine_name      = EXCLUDED.routine_name,
      routine_session_id = EXCLUDED.routine_session_id,
      workout_mode      = EXCLUDED.workout_mode,
      warmup_reps       = EXCLUDED.warmup_reps,
      working_reps      = EXCLUDED.working_reps,
      avg_velocity_mps  = EXCLUDED.avg_velocity_mps,
      avg_asymmetry_pct = EXCLUDED.avg_asymmetry_pct,
      velocity_loss_pct = EXCLUDED.velocity_loss_pct,
      dominant_side     = EXCLUDED.dominant_side,
      strength_profile  = EXCLUDED.strength_profile,
      form_score        = EXCLUDED.form_score,
      deload_warnings   = EXCLUDED.deload_warnings,
      rom_violations    = EXCLUDED.rom_violations,
      spotter_activations = EXCLUDED.spotter_activations,
      peak_force_n      = EXCLUDED.peak_force_n,
      estimated_calories = EXCLUDED.estimated_calories,
      heaviest_lift_kg  = EXCLUDED.heaviest_lift_kg,
      eccentric_load    = EXCLUDED.eccentric_load,
      echo_level        = EXCLUDED.echo_level,
      updated_at        = EXCLUDED.updated_at,
      client_updated_at = EXCLUDED.client_updated_at
    WHERE COALESCE(ws.client_updated_at, ws.updated_at) IS NULL
       OR COALESCE(ws.client_updated_at, ws.updated_at) <= EXCLUDED.client_updated_at
    RETURNING ws.client_updated_at INTO v_stored;

    IF FOUND THEN
      RETURN QUERY SELECT rec.id::text, TRUE, v_stored;
    ELSE
      RETURN QUERY
        SELECT rec.id::text, FALSE, COALESCE(ws.client_updated_at, ws.updated_at)
          FROM public.workout_sessions ws WHERE ws.id = rec.id;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_workout_session_lww(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_workout_session_lww(jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- upsert_routine_lww (starts from 20260420190710)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_routine_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  rec record;
  v_incoming timestamptz;
  v_stored timestamptz;
BEGIN
  FOR rec IN
    SELECT * FROM jsonb_populate_recordset(NULL::public.routines, p_rows)
  LOOP
    v_incoming := COALESCE(rec.client_updated_at, rec.updated_at, NOW());

    INSERT INTO public.routines AS r (
      id, user_id, local_profile_id, name, description, estimated_duration,
      exercise_count, is_favorite, last_used_at, tags, times_completed,
      created_at, updated_at, client_updated_at
    ) VALUES (
      rec.id, rec.user_id, rec.local_profile_id, rec.name,
      COALESCE(rec.description, ''),
      COALESCE(rec.estimated_duration, 0),
      COALESCE(rec.exercise_count, 0),
      COALESCE(rec.is_favorite, FALSE),
      rec.last_used_at, rec.tags,
      COALESCE(rec.times_completed, 0),
      COALESCE(rec.created_at, NOW()),
      COALESCE(rec.updated_at, NOW()),
      v_incoming
    )
    ON CONFLICT (id) DO UPDATE SET
      name               = EXCLUDED.name,
      description        = EXCLUDED.description,
      estimated_duration = EXCLUDED.estimated_duration,
      exercise_count     = EXCLUDED.exercise_count,
      is_favorite        = EXCLUDED.is_favorite,
      last_used_at       = EXCLUDED.last_used_at,
      tags               = EXCLUDED.tags,
      times_completed    = EXCLUDED.times_completed,
      updated_at         = EXCLUDED.updated_at,
      client_updated_at  = EXCLUDED.client_updated_at
    WHERE COALESCE(r.client_updated_at, r.updated_at) IS NULL
       OR COALESCE(r.client_updated_at, r.updated_at) <= EXCLUDED.client_updated_at
    RETURNING r.client_updated_at INTO v_stored;

    IF FOUND THEN
      RETURN QUERY SELECT rec.id::text, TRUE, v_stored;
    ELSE
      RETURN QUERY
        SELECT rec.id::text, FALSE, COALESCE(r.client_updated_at, r.updated_at)
          FROM public.routines r WHERE r.id = rec.id;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_routine_lww(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_routine_lww(jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- merge_training_cycles_from_push (starts from 20260920001800, KD-3 3a)
-- ---------------------------------------------------------------------------
-- Changes from PR 18:
--   * LWW (p_use_lww) compares COALESCE(client_updated_at, updated_at)
--     against the incoming updated_at instead of the server write clock.
--   * client_updated_at is written under both flag values: the incoming
--     updated_at on INSERT (now() when absent, like updated_at) and on every
--     applied content change; an unchanged push writes nothing, so neither
--     clock moves (the no-op skip is unchanged).
--   * server_updated_at stays the stored updated_at (the pull cursor): the
--     push response's cycleVersions hands it to the device as its
--     baseUpdatedAt, which is compared with portal_edited_at (same clock).
--   * upsert_training_cycle_lww keeps delegating here (unchanged).
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
        updated_at, client_updated_at
      ) VALUES (
        rec.id, p_user_id, rec.local_profile_id, rec.name, COALESCE(rec.description, ''),
        COALESCE(rec.duration_weeks, 4),
        COALESCE(rec.workout_days, 0),
        COALESCE(rec.rest_days, 0),
        COALESCE(rec.current_week, 1),
        COALESCE(rec.status, 'draft'),
        rec.started_at, rec.last_used_at, rec.progression_settings,
        rec.deload_settings, rec.template_id, COALESCE(rec.updated_at, now()),
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
         AND NOT (COALESCE(v_existing.client_updated_at, v_existing.updated_at) IS NULL
                  OR COALESCE(v_existing.client_updated_at, v_existing.updated_at) <= rec.updated_at) THEN
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
      -- Mobile-modelled keys are push-owned (incl. removals); portal-only
      -- keys survive (review R-4).
      IF rec.progression_settings IS NOT NULL
         AND jsonb_typeof(rec.progression_settings) <> 'object' THEN
        n_progression := rec.progression_settings;
      ELSIF v_existing.progression_settings IS NULL
            OR jsonb_typeof(v_existing.progression_settings) <> 'object' THEN
        n_progression := rec.progression_settings;
      ELSE
        n_progression := (v_existing.progression_settings - c_mobile_progression_keys)
                         || COALESCE(rec.progression_settings, '{}'::jsonb);
        IF rec.progression_settings IS NULL AND n_progression = '{}'::jsonb THEN
          n_progression := NULL;
        END IF;
      END IF;
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
