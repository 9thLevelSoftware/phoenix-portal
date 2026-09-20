-- KD-6 (PR 18): merge mobile-pushed training cycles in SQL instead of
-- overwriting portal-authored settings, and judge whether a push's structure
-- is stale against a clock that only portal edits advance.
--
-- 1. training_cycles.portal_edited_at: stamped by triggers only for
--    authenticated (portal) writes to a cycle or its days. Non-authenticated
--    writers (service-role pushes, migrations, cron) never stamp it, so
--    migrations and backfills need nothing special. An authenticated write
--    is exempt only while phoenix.skip_updated_at = 'on'.
-- 2. merge_training_cycles_from_push(p_user_id, p_cycles, p_use_lww):
--    service-role only. One call replaces the push's cycle upsert, its
--    cycle_days upsert and the orphan-day cleanup.
-- 3. upsert_training_cycle_lww(p_rows) delegates to the same merge, so both
--    SYNC_LWW_ENABLED paths store identical rows. Kept (service role only)
--    so an Edge deployment older than this migration keeps working during
--    rollout and on rollback; the current push calls the merge directly.
--
-- Field ownership on push (decision, review R-5):
--   * structure (name, description, workout_days, rest_days, day list):
--     portal wins when the push is stale (portal edited after the device's
--     baseUpdatedAt); otherwise the push wins.
--   * runtime progress (status, current_week, started_at, last_used_at,
--     local_profile_id): device-owned; always taken from the push, even when
--     stale. The phone is where a cycle is run.
--   * config: merged, see merge_training_cycles_from_push below.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.training_cycles
  ADD COLUMN IF NOT EXISTS portal_edited_at TIMESTAMPTZ;

ALTER TABLE public.training_cycles
  ADD COLUMN IF NOT EXISTS portal_duration_set_at TIMESTAMPTZ;

COMMENT ON COLUMN public.training_cycles.portal_duration_set_at IS
  'Last time duration_weeks itself was set by a portal (authenticated) write. A mobile push of the derived default keeps a portal-set duration (KD-6).';

COMMENT ON COLUMN public.training_cycles.portal_edited_at IS
  'Last portal (authenticated) edit of the cycle or its days. Mobile push structure is ignored when this is newer than the push''s baseUpdatedAt (KD-6).';

-- ---------------------------------------------------------------------------
-- Stamp triggers
-- ---------------------------------------------------------------------------

-- BEFORE INSERT OR UPDATE on training_cycles. Only assigns to NEW, so it
-- runs with the caller's rights (SECURITY INVOKER).
CREATE OR REPLACE FUNCTION public.stamp_training_cycle_portal_edit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() = 'authenticated'
     AND current_setting('phoenix.skip_updated_at', true) IS DISTINCT FROM 'on' THEN
    NEW.portal_edited_at := now();
    -- duration_weeks set on the portal (not just any portal touch).
    IF TG_OP = 'INSERT' THEN
      NEW.portal_duration_set_at := now();
    ELSIF NEW.duration_weeks IS DISTINCT FROM OLD.duration_weeks THEN
      NEW.portal_duration_set_at := now();
    END IF;
    -- A pulled cycle's updatedAt is the device's base. Keep
    -- updated_at >= portal_edited_at so a freshly pulled base is never
    -- stale (an INSERT may carry an explicit older updated_at; UPDATEs get
    -- now() from cycles_updated_at).
    IF TG_OP = 'INSERT'
       AND (NEW.updated_at IS NULL OR NEW.updated_at < NEW.portal_edited_at) THEN
      NEW.updated_at := NEW.portal_edited_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_training_cycle_portal_edit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS training_cycles_portal_edited_at ON public.training_cycles;
CREATE TRIGGER training_cycles_portal_edited_at
  BEFORE INSERT OR UPDATE ON public.training_cycles
  FOR EACH ROW EXECUTE FUNCTION public.stamp_training_cycle_portal_edit();

-- AFTER INSERT OR UPDATE OR DELETE on cycle_days: a portal day edit is an
-- edit of the parent cycle. The parent UPDATE also fires cycles_updated_at,
-- so the pull cursor advances. SECURITY DEFINER so the parent UPDATE does
-- not depend on the caller's RLS (e.g. the routine-delete ON DELETE SET NULL
-- cascade); auth.role()/auth.uid() still read the request JWT, and only the
-- acting user's own cycles are ever stamped.
CREATE OR REPLACE FUNCTION public.stamp_training_cycle_portal_edit_from_day()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cycle_ids UUID[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR current_setting('phoenix.skip_updated_at', true) IS NOT DISTINCT FROM 'on' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_cycle_ids := ARRAY[NEW.cycle_id];
  ELSIF TG_OP = 'UPDATE' THEN
    v_cycle_ids := ARRAY[NEW.cycle_id, OLD.cycle_id];
  ELSE
    v_cycle_ids := ARRAY[OLD.cycle_id];
  END IF;

  -- now() is fixed per transaction, so a multi-row day replace updates the
  -- parent once. A parent deleted in this statement (cascade) matches
  -- nothing.
  UPDATE public.training_cycles c
     SET portal_edited_at = now()
   WHERE c.id = ANY (v_cycle_ids)
     AND c.user_id = auth.uid()
     AND c.portal_edited_at IS DISTINCT FROM now();

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_training_cycle_portal_edit_from_day() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cycle_days_portal_edited_at ON public.cycle_days;
CREATE TRIGGER cycle_days_portal_edited_at
  AFTER INSERT OR UPDATE OR DELETE ON public.cycle_days
  FOR EACH ROW EXECUTE FUNCTION public.stamp_training_cycle_portal_edit_from_day();

-- ---------------------------------------------------------------------------
-- merge_training_cycles_from_push
-- ---------------------------------------------------------------------------
-- p_cycles: JSON array of training_cycles rows (snake_case columns) with two
-- optional extra keys:
--   days             array of cycle_days rows (snake_case). A missing key
--                    leaves the cycle's days untouched (the
--                    upsert_training_cycle_lww wrapper path).
--   base_updated_at  the server updated_at the device last received for the
--                    cycle. Absent/NULL = older build (legacy rules).
--
-- Per cycle:
--   * Ownership: user_id is always p_user_id; a row owned by another user is
--     never touched (accepted = false).
--   * LWW (p_use_lww): accept only when the stored updated_at is NULL or
--     <= incoming updated_at, exactly as upsert_training_cycle_lww did.
--   * Stale: base present and ms-truncated portal_edited_at > ms-truncated
--     base. Then structure (name, description, workout_days, rest_days and
--     the whole day list) is kept; only the config merge applies.
--   * A NULL name/description/duration/status/count keeps the stored value;
--     the INSERT applies the column defaults.
--   * Config merge (always):
--       deload_settings = COALESCE(incoming, existing);
--       template_id = COALESCE(incoming, existing);
--       progression_settings: per key. The keys the mobile CycleProgression
--         DTO models (Project-Phoenix-MP PortalSyncAdapter
--         .toPortalTrainingCycle / SqlDelightSyncRepository.mergePortalCycles):
--           frequencyCycles, weightIncreasePercent, echoLevelIncrease,
--           eccentricLoadIncreasePercent
--         are owned by the push, including removals (mobile encodes them
--         sparsely: an absent key means off/cleared). Every other key is
--         portal-only and survives. A NULL incoming clears the mobile keys;
--         if nothing is left the column is NULL.
--       duration_weeks: keeps the stored value only when duration_weeks was
--         set on the portal (portal_duration_set_at IS NOT NULL; stamped by
--         the authenticated trigger when the value changes or on INSERT) and
--         the incoming value
--         equals mobile's derived default (ceil(days/7), 1 for no days);
--         otherwise the incoming value wins, so mobile-created cycles follow
--         the phone.
--   * Days (structure applied): upsert on (cycle_id, day_number). rest_type
--     keeps the stored value on NULL only while day_type is unchanged (a day
--     switching rest <-> workout takes the incoming rest_type). A routine_id
--     not owned by p_user_id is written as NULL. Orphans: with a base,
--     day_number NOT IN payload; without one, day_number > max(payload)
--     (legacy rule).
--   * No-op writes are skipped, so an unchanged push does not move
--     updated_at. When only days changed, the parent's updated_at is bumped
--     so delta pulls re-send the cycle.
-- Returns one row per input cycle: accepted, the stored updated_at, and
-- whether the push's structure was applied.
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

-- ---------------------------------------------------------------------------
-- upsert_training_cycle_lww: same signature and result shape, now a thin
-- wrapper over the merge (LWW on). Rows carry no `days` key, so days are left
-- to the caller as before. Starts from the 20260707130000 body; the
-- ownership, LWW compare and template_id COALESCE live in the merge.
-- It now resolves to a service-role-only SECURITY DEFINER function, so it is
-- service-role only too (the portal never called it).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_training_cycle_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_user_id UUID;
BEGIN
  FOR v_user_id IN
    SELECT DISTINCT (e.value ->> 'user_id')::UUID
      FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS e
  LOOP
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'upsert_training_cycle_lww: user_id is required'
        USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
      SELECT m.id, m.accepted, m.server_updated_at
        FROM public.merge_training_cycles_from_push(
          v_user_id,
          (SELECT jsonb_agg(e.value)
             FROM jsonb_array_elements(p_rows) AS e
            WHERE (e.value ->> 'user_id')::UUID = v_user_id),
          TRUE
        ) AS m;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_training_cycle_lww(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_training_cycle_lww(jsonb) TO service_role;
