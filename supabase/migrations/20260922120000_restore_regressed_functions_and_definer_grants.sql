-- Restore behaviour that later migrations silently reverted, and close the
-- browser EXECUTE grants 20260920120000 left on its trigger functions.
--
-- None of this was caught because the pgTAP suite never ran in CI (the
-- migrations workflow failed schema validation before any job started).
-- Every function below keeps its signature and return type, so
-- src/lib/database.types.ts does not change. Each statement is idempotent.
--
-- 1. replace_session_children: 20260920002800 (cable_count) was written from
--    the body before e9b8fa70, so a retained exercise that had no stored sets
--    was treated as removed again and could inherit another row's telemetry.
--    Restores the e9b8fa70 rule: an exercise row is "kept" when it exists for
--    this session and user, not only when it had old sets.
-- 2. update_cycle_with_days: 20260920120000 regenerated every cycle_days id on
--    each portal save, reverting the stable-id contract of 20260920001400
--    (the phone keys per-day state by that id). Keeps 20260920120000's
--    echo / eccentric preservation and adds back 001400's id adoption,
--    uuid validation and duplicate-id check.
-- 3. upsert_training_cycle_lww: 20260920120000 turned the 20260920001800
--    wrapper into a plain overwrite, dropping portal-only configuration such
--    as deload_settings. Restored verbatim; it delegates to
--    merge_training_cycles_from_push, the only cycle write path the push
--    handler uses.
-- 4. private.schedule_sync_queue_jobs: 20260920003100 unscheduled the legacy
--    sync-tombstones-retention job and then re-created it in the same loop,
--    with a new jobid on every run. Tombstones are durable deletion evidence
--    (removed by the auth.users cascade), so the retention row is dropped.
-- 5. guard_profile_ownership_update / guard_profile_ownership_claim
--    (20260920120000) compared local_profile_id strictly, so NULL -> 'default'
--    counted as a cross-profile move. A portal-created row (NULL profile)
--    re-pushed by the phone under 'default' raised
--    profile_ownership_transfer_required inside merge_training_cycles_from_push
--    and the push answered 503 on every retry. NULL and 'default' are the
--    same profile everywhere else (20260920002101); a real move between two
--    named profiles still needs the transfer. The update guard also blocked
--    the ON DELETE SET NULL action of the local_profiles foreign keys, so a
--    local profile that owned any row could not be deleted; a NULL whose old
--    profile no longer exists is now let through. guard_profile_ownership_claim()
--    and guard_training_cycle_lww() are trigger functions: triggers do not
--    check EXECUTE, so no client role needs it.

BEGIN;

-- 1 -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.replace_session_children(
  p_user_id UUID,
  p_session_ids UUID[],
  p_exercises JSONB,
  p_sets JSONB,
  p_rep_summaries JSONB,
  p_rep_telemetry JSONB,
  p_progress JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exercises INT := 0;
  v_sets INT := 0;
  v_rep_summaries INT := 0;
  v_rep_telemetry INT := 0;
  v_rep_telemetry_preserved INT := 0;
  v_exercise_progress INT := 0;
  -- Mirrors MAX_TELEMETRY_POINTS in supabase/functions/mobile-sync-push/index.ts.
  c_max_session_telemetry CONSTANT INT := 50000;
BEGIN
  -- 0. Stash telemetry that can be re-linked unambiguously (see header).
  --    Must run before step 1, whose CASCADE deletes it. The temp table is
  --    dropped at commit; it is cleared first in case the function is called
  --    more than once in the same transaction.
  IF to_regclass('pg_temp.rsc_telemetry_stash') IS NULL THEN
    CREATE TEMP TABLE rsc_telemetry_stash (
      id UUID,
      set_id UUID,
      session_id UUID,
      user_id UUID,
      timestamp_ms BIGINT,
      force_n NUMERIC,
      velocity_mps NUMERIC,
      position_mm NUMERIC,
      cable TEXT
    ) ON COMMIT DROP;
  ELSE
    DELETE FROM pg_temp.rsc_telemetry_stash;
  END IF;

  IF p_session_ids IS NOT NULL AND array_length(p_session_ids, 1) IS NOT NULL THEN
    INSERT INTO pg_temp.rsc_telemetry_stash
      (id, set_id, session_id, user_id, timestamp_ms, force_n, velocity_mps,
       position_mm, cable)
    WITH old_sets AS (
      SELECT
        s.id AS set_id,
        e.id AS exercise_row_id,
        e.session_id,
        COALESCE('id:' || NULLIF(btrim(e.exercise_id), ''),
                 'name:' || lower(btrim(e.name))) AS identity,
        e.order_index,
        s.set_number
      FROM public.exercises e
      JOIN public.sets s ON s.exercise_id = e.id
      WHERE e.session_id = ANY(p_session_ids)
        AND e.user_id = p_user_id
    ),
    new_exercises AS (
      SELECT ne.id, ne.session_id, ne.name, ne.exercise_id, ne.order_index
      FROM jsonb_to_recordset(COALESCE(p_exercises, '[]'::jsonb)) AS ne(
        id UUID,
        session_id UUID,
        user_id UUID,
        name TEXT,
        exercise_id TEXT,
        order_index INT
      )
      WHERE ne.session_id = ANY(p_session_ids)
        AND ne.user_id = p_user_id
    ),
    payload_telemetry_sets AS (
      SELECT DISTINCT t.set_id
      FROM jsonb_to_recordset(COALESCE(p_rep_telemetry, '[]'::jsonb)) AS t(set_id UUID)
    ),
    new_sets AS (
      SELECT
        ns.id AS set_id,
        ne.id AS exercise_row_id,
        ne.session_id,
        COALESCE('id:' || NULLIF(btrim(ne.exercise_id), ''),
                 'name:' || lower(btrim(ne.name))) AS identity,
        ne.order_index,
        ns.set_number,
        EXISTS (
          SELECT 1 FROM payload_telemetry_sets pt WHERE pt.set_id = ns.id
        ) AS has_payload_telemetry
      FROM jsonb_to_recordset(COALESCE(p_sets, '[]'::jsonb)) AS ns(
        id UUID,
        exercise_id UUID,
        set_number INT
      )
      JOIN new_exercises ne ON ne.id = ns.exercise_id
    ),
    -- Uniqueness is counted over ALL sets on each side (including new sets
    -- that carry payload telemetry, and sets outside the tier's candidates),
    -- so ambiguity can never be hidden by a filter.
    old_keys AS (
      SELECT o.*,
             count(*) OVER (PARTITION BY o.session_id, o.exercise_row_id, o.set_number) AS id_key_count,
             count(*) OVER (PARTITION BY o.session_id, o.identity, o.order_index, o.set_number) AS legacy_key_count,
             EXISTS (
               SELECT 1 FROM new_exercises ne
               WHERE ne.id = o.exercise_row_id AND ne.session_id = o.session_id
             ) AS exercise_row_kept
      FROM old_sets o
    ),
    new_keys AS (
      SELECT n.*,
             count(*) OVER (PARTITION BY n.session_id, n.exercise_row_id, n.set_number) AS id_key_count,
             count(*) OVER (PARTITION BY n.session_id, n.identity, n.order_index, n.set_number) AS legacy_key_count,
             EXISTS (
               SELECT 1 FROM public.exercises e
               WHERE e.id = n.exercise_row_id AND e.session_id = n.session_id
                 AND e.user_id = p_user_id
             ) AS exercise_row_kept
      FROM new_sets n
    ),
    set_map AS (
      -- Tier 1: stable exercise row id + set_number.
      SELECT o.set_id AS old_set_id, n.set_id AS new_set_id, n.session_id
      FROM old_keys o
      JOIN new_keys n
        ON n.session_id = o.session_id
       AND n.exercise_row_id = o.exercise_row_id
       AND n.set_number = o.set_number
      WHERE o.id_key_count = 1
        AND n.id_key_count = 1
        AND NOT n.has_payload_telemetry
      UNION ALL
      -- Tier 2: legacy fallback, only between exercises whose row id did not
      -- survive on the other side.
      SELECT o.set_id, n.set_id, n.session_id
      FROM old_keys o
      JOIN new_keys n
        ON n.session_id = o.session_id
       AND n.identity = o.identity
       AND n.order_index = o.order_index
       AND n.set_number = o.set_number
      WHERE NOT o.exercise_row_kept
        AND NOT n.exercise_row_kept
        AND o.legacy_key_count = 1
        AND n.legacy_key_count = 1
        AND NOT n.has_payload_telemetry
    )
    SELECT rt.id, m.new_set_id, m.session_id, rt.user_id, rt.timestamp_ms,
           rt.force_n, rt.velocity_mps, rt.position_mm, rt.cable
    FROM set_map m
    JOIN public.rep_telemetry rt ON rt.set_id = m.old_set_id
    WHERE rt.user_id = p_user_id;

    -- Per-session bound (see header): stash + payload telemetry for the
    -- session must not exceed c_max_session_telemetry, else delete as before.
    DELETE FROM pg_temp.rsc_telemetry_stash st
    USING (
      SELECT k.session_id
      FROM pg_temp.rsc_telemetry_stash k
      GROUP BY k.session_id
      HAVING count(*) + (
        SELECT count(*)
        FROM jsonb_to_recordset(COALESCE(p_rep_telemetry, '[]'::jsonb)) AS t(set_id UUID)
        JOIN jsonb_to_recordset(COALESCE(p_sets, '[]'::jsonb)) AS ns(id UUID, exercise_id UUID)
          ON ns.id = t.set_id
        JOIN jsonb_to_recordset(COALESCE(p_exercises, '[]'::jsonb)) AS ne(id UUID, session_id UUID)
          ON ne.id = ns.exercise_id
        WHERE ne.session_id = k.session_id
      ) > c_max_session_telemetry
    ) over_cap
    WHERE st.session_id = over_cap.session_id;
  END IF;

  -- 1. Clear existing exercises for the affected sessions. ON DELETE CASCADE
  --    removes their sets, rep_summaries and rep_telemetry. Scoped by user_id
  --    as defence-in-depth even though this runs as service_role.
  IF p_session_ids IS NOT NULL AND array_length(p_session_ids, 1) IS NOT NULL THEN
    DELETE FROM public.exercises
    WHERE session_id = ANY(p_session_ids)
      AND user_id = p_user_id;
  END IF;

  -- 2. Re-insert exercises. cable_count (PR 28): absent/null -> NULL
  --    (unknown); the column CHECK rejects anything but 1 or 2.
  IF p_exercises IS NOT NULL AND jsonb_array_length(p_exercises) > 0 THEN
    INSERT INTO public.exercises
      (id, session_id, user_id, name, exercise_id, muscle_group, order_index,
       cable_count)
    SELECT id, session_id, user_id, name, exercise_id, muscle_group, order_index,
           cable_count
    FROM jsonb_to_recordset(p_exercises) AS x(
      id UUID,
      session_id UUID,
      user_id UUID,
      name TEXT,
      exercise_id TEXT,
      muscle_group TEXT,
      order_index INT,
      cable_count SMALLINT
    )
    ON CONFLICT (id) DO UPDATE SET
      session_id = EXCLUDED.session_id,
      user_id = EXCLUDED.user_id,
      name = EXCLUDED.name,
      exercise_id = EXCLUDED.exercise_id,
      muscle_group = EXCLUDED.muscle_group,
      order_index = EXCLUDED.order_index,
      cable_count = EXCLUDED.cable_count;
    GET DIAGNOSTICS v_exercises = ROW_COUNT;
  END IF;

  -- 3. Re-insert sets.
  IF p_sets IS NOT NULL AND jsonb_array_length(p_sets) > 0 THEN
    INSERT INTO public.sets
      (id, exercise_id, user_id, set_number, target_reps, actual_reps,
       weight_kg, rpe, is_pr, notes, workout_mode)
    SELECT id, exercise_id, user_id, set_number, target_reps, actual_reps,
           weight_kg, rpe, is_pr, notes, workout_mode
    FROM jsonb_to_recordset(p_sets) AS x(
      id UUID,
      exercise_id UUID,
      user_id UUID,
      set_number INT,
      target_reps INT,
      actual_reps INT,
      weight_kg NUMERIC,
      rpe NUMERIC,
      is_pr BOOLEAN,
      notes TEXT,
      workout_mode TEXT
    )
    ON CONFLICT (id) DO UPDATE SET
      exercise_id = EXCLUDED.exercise_id,
      user_id = EXCLUDED.user_id,
      set_number = EXCLUDED.set_number,
      target_reps = EXCLUDED.target_reps,
      actual_reps = EXCLUDED.actual_reps,
      weight_kg = EXCLUDED.weight_kg,
      rpe = EXCLUDED.rpe,
      is_pr = EXCLUDED.is_pr,
      notes = EXCLUDED.notes,
      workout_mode = EXCLUDED.workout_mode;
    GET DIAGNOSTICS v_sets = ROW_COUNT;
  END IF;

  -- 4. Re-insert rep_summaries.
  IF p_rep_summaries IS NOT NULL AND jsonb_array_length(p_rep_summaries) > 0 THEN
    INSERT INTO public.rep_summaries
      (id, set_id, user_id, rep_number, mean_velocity_mps, peak_velocity_mps,
       mean_force_n, peak_force_n, power_watts, rom_mm, tut_ms, left_force_avg,
       right_force_avg, asymmetry_pct, vbt_zone)
    SELECT id, set_id, user_id, rep_number, mean_velocity_mps, peak_velocity_mps,
           mean_force_n, peak_force_n, power_watts, rom_mm, tut_ms, left_force_avg,
           right_force_avg, asymmetry_pct, vbt_zone
    FROM jsonb_to_recordset(p_rep_summaries) AS x(
      id UUID,
      set_id UUID,
      user_id UUID,
      rep_number INT,
      mean_velocity_mps NUMERIC,
      peak_velocity_mps NUMERIC,
      mean_force_n NUMERIC,
      peak_force_n NUMERIC,
      power_watts NUMERIC,
      rom_mm NUMERIC,
      tut_ms INT,
      left_force_avg NUMERIC,
      right_force_avg NUMERIC,
      asymmetry_pct NUMERIC,
      vbt_zone TEXT
    )
    ON CONFLICT (id) DO UPDATE SET
      set_id = EXCLUDED.set_id,
      user_id = EXCLUDED.user_id,
      rep_number = EXCLUDED.rep_number,
      mean_velocity_mps = EXCLUDED.mean_velocity_mps,
      peak_velocity_mps = EXCLUDED.peak_velocity_mps,
      mean_force_n = EXCLUDED.mean_force_n,
      peak_force_n = EXCLUDED.peak_force_n,
      power_watts = EXCLUDED.power_watts,
      rom_mm = EXCLUDED.rom_mm,
      tut_ms = EXCLUDED.tut_ms,
      left_force_avg = EXCLUDED.left_force_avg,
      right_force_avg = EXCLUDED.right_force_avg,
      asymmetry_pct = EXCLUDED.asymmetry_pct,
      vbt_zone = EXCLUDED.vbt_zone;
    GET DIAGNOSTICS v_rep_summaries = ROW_COUNT;
  END IF;

  -- 5. Re-insert rep_telemetry. Telemetry is keyed to sets (not gated by the
  --    session-acceptance filter) but a FK violation here still rolls back the
  --    whole transaction, which is the desired all-or-nothing behaviour.
  IF p_rep_telemetry IS NOT NULL AND jsonb_array_length(p_rep_telemetry) > 0 THEN
    INSERT INTO public.rep_telemetry
      (id, set_id, user_id, timestamp_ms, force_n, velocity_mps, position_mm, cable)
    SELECT id, set_id, user_id, timestamp_ms, force_n, velocity_mps, position_mm, cable
    FROM jsonb_to_recordset(p_rep_telemetry) AS x(
      id UUID,
      set_id UUID,
      user_id UUID,
      timestamp_ms BIGINT,
      force_n NUMERIC,
      velocity_mps NUMERIC,
      position_mm NUMERIC,
      cable TEXT
    )
    ON CONFLICT (id) DO UPDATE SET
      set_id = EXCLUDED.set_id,
      user_id = EXCLUDED.user_id,
      timestamp_ms = EXCLUDED.timestamp_ms,
      force_n = EXCLUDED.force_n,
      velocity_mps = EXCLUDED.velocity_mps,
      position_mm = EXCLUDED.position_mm,
      cable = EXCLUDED.cable;
    GET DIAGNOSTICS v_rep_telemetry = ROW_COUNT;
  END IF;

  -- 6. Re-link the stashed telemetry to the new set ids. Payload telemetry
  --    (step 5) always wins: its sets were excluded from the stash, and an id
  --    collision is skipped rather than overwriting a payload row.
  INSERT INTO public.rep_telemetry
    (id, set_id, user_id, timestamp_ms, force_n, velocity_mps, position_mm, cable)
  SELECT id, set_id, user_id, timestamp_ms, force_n, velocity_mps, position_mm, cable
  FROM pg_temp.rsc_telemetry_stash
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_rep_telemetry_preserved = ROW_COUNT;

  -- 7. Refresh exercise_progress for the affected sessions (F-069). Only when
  --    the caller passes p_progress: NULL (today's 6-argument call) leaves
  --    exercise_progress untouched. An empty array clears the sessions' rows
  --    (for example a re-push that removed every exercise). Omitted/NULL
  --    defaulted columns get their column default, as a PostgREST insert that
  --    omits the key would.
  IF p_progress IS NOT NULL
     AND p_session_ids IS NOT NULL
     AND array_length(p_session_ids, 1) IS NOT NULL THEN
    DELETE FROM public.exercise_progress
    WHERE session_id = ANY(p_session_ids)
      AND user_id = p_user_id;

    INSERT INTO public.exercise_progress
      (user_id, local_profile_id, exercise_name, exercise_id, session_id,
       recorded_at, max_weight_kg, total_volume_kg, estimated_1rm_kg,
       velocity_estimated_1rm_kg, max_reps, set_count)
    SELECT p_user_id, x.local_profile_id, x.exercise_name, x.exercise_id,
           x.session_id, COALESCE(x.recorded_at, now()),
           COALESCE(x.max_weight_kg, 0), COALESCE(x.total_volume_kg, 0),
           COALESCE(x.estimated_1rm_kg, 0), x.velocity_estimated_1rm_kg,
           COALESCE(x.max_reps, 0), COALESCE(x.set_count, 0)
    FROM jsonb_to_recordset(p_progress) AS x(
      user_id UUID,
      local_profile_id TEXT,
      exercise_name TEXT,
      exercise_id TEXT,
      session_id UUID,
      recorded_at TIMESTAMPTZ,
      max_weight_kg NUMERIC,
      total_volume_kg NUMERIC,
      estimated_1rm_kg NUMERIC,
      velocity_estimated_1rm_kg NUMERIC,
      max_reps INT,
      set_count INT
    )
    WHERE x.session_id = ANY(p_session_ids)
      AND x.user_id = p_user_id;
    GET DIAGNOSTICS v_exercise_progress = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'exercises', v_exercises,
    'sets', v_sets,
    'rep_summaries', v_rep_summaries,
    'rep_telemetry', v_rep_telemetry,
    'rep_telemetry_preserved', v_rep_telemetry_preserved,
    'exercise_progress', v_exercise_progress
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_session_children(uuid, uuid[], jsonb, jsonb, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_session_children(uuid, uuid[], jsonb, jsonb, jsonb, jsonb, jsonb)
  TO service_role;

-- 2 -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_cycle_with_days(
  p_cycle_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_duration_weeks INT,
  p_workout_days INT,
  p_rest_days INT,
  p_started_at TIMESTAMPTZ,
  p_progression_settings JSONB,
  p_deload_settings JSONB,
  p_days JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_updated UUID;
  v_merged_days JSONB := '[]'::JSONB;
  v_resolved JSONB;
  v_day JSONB;
  v_existing_echo TEXT;
  v_existing_eccentric INT;
  v_existing_day BOOLEAN;
BEGIN
  IF p_days IS NULL OR jsonb_typeof(p_days) <> 'array' THEN
    RAISE EXCEPTION 'invalid_days_payload: expected a JSON array' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_days) AS elem
    WHERE elem ? 'id'
      AND jsonb_typeof(elem->'id') <> 'null'
      AND (
        jsonb_typeof(elem->'id') <> 'string'
        OR elem->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
  ) THEN
    RAISE EXCEPTION 'invalid_day_id: not a uuid' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.training_cycles
     SET name = p_name,
         description = p_description,
         duration_weeks = p_duration_weeks,
         workout_days = p_workout_days,
         rest_days = p_rest_days,
         started_at = p_started_at,
         progression_settings = p_progression_settings,
         deload_settings = p_deload_settings,
         updated_at = NOW()
   WHERE id = p_cycle_id AND user_id = auth.uid()
  RETURNING id INTO v_updated;
  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'cycle_not_found_or_forbidden' USING ERRCODE = 'P0001';
  END IF;

  -- 20260920120000: a day the portal did not send echo/eccentric values for
  -- keeps the stored ones.
  FOR v_day IN SELECT value FROM jsonb_array_elements(p_days) LOOP
    SELECT d.echo_level, d.eccentric_load_percent
      INTO v_existing_echo, v_existing_eccentric
    FROM public.cycle_days d
    WHERE d.cycle_id = p_cycle_id
      AND d.day_number = (v_day->>'day_number')::INT;
    v_existing_day := FOUND;
    IF v_existing_day AND NOT COALESCE((v_day->>'echo_level_present')::BOOLEAN, FALSE) THEN
      v_day := jsonb_set(v_day, '{echo_level}', COALESCE(to_jsonb(v_existing_echo), 'null'::JSONB), TRUE);
    END IF;
    IF v_existing_day AND NOT COALESCE((v_day->>'eccentric_load_percent_present')::BOOLEAN, FALSE) THEN
      v_day := jsonb_set(v_day, '{eccentric_load_percent}', COALESCE(to_jsonb(v_existing_eccentric), 'null'::JSONB), TRUE);
    END IF;
    v_merged_days := v_merged_days || jsonb_build_array(
      v_day - 'echo_level_present' - 'eccentric_load_percent_present'
    );
  END LOOP;

  -- 20260920001400: a day id that is already a child of THIS cycle is kept;
  -- anything else (absent, unknown, another cycle's or user's) gets a new one.
  SELECT COALESCE(jsonb_agg(s.resolved ORDER BY s.ord), '[]'::JSONB)
    INTO v_resolved
  FROM (
    SELECT t.ord,
           t.elem || jsonb_build_object('id', COALESCE(existing.id, gen_random_uuid())) AS resolved
    FROM jsonb_array_elements(v_merged_days) WITH ORDINALITY AS t(elem, ord)
    LEFT JOIN public.cycle_days AS existing
           ON existing.cycle_id = p_cycle_id
          AND existing.id = CASE
                WHEN t.elem ? 'id' AND jsonb_typeof(t.elem->'id') = 'string'
                  THEN (t.elem->>'id')::UUID
              END
  ) AS s;

  IF (SELECT count(*) <> count(DISTINCT elem->>'id') FROM jsonb_array_elements(v_resolved) AS elem) THEN
    RAISE EXCEPTION 'duplicate_day_id: an id appears twice in the payload' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.cycle_days WHERE cycle_id = p_cycle_id;
  IF jsonb_array_length(v_resolved) > 0 THEN
    INSERT INTO public.cycle_days
    SELECT (
      jsonb_populate_record(
        NULL::public.cycle_days,
        elem || jsonb_build_object('cycle_id', p_cycle_id)
      )
    ).*
    FROM jsonb_array_elements(v_resolved) AS elem;
  END IF;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.update_cycle_with_days(UUID, TEXT, TEXT, INT, INT, INT, TIMESTAMPTZ, JSONB, JSONB, JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_cycle_with_days(UUID, TEXT, TEXT, INT, INT, INT, TIMESTAMPTZ, JSONB, JSONB, JSONB)
  TO authenticated;

-- 3 -----------------------------------------------------------------------
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

-- 4 -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.schedule_sync_queue_jobs()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  j record;
  v_jobid bigint;
  v_schedule text;
  v_command text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skip scheduling process-sync-queue and retention jobs';
    RETURN;
  END IF;

  -- Tombstones are durable deletion evidence. Age-based cleanup lets a stale
  -- offline client recreate deleted routines or cycles on its next push. They
  -- are removed by the auth.users ON DELETE CASCADE instead.
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'sync-tombstones-retention'
  ORDER BY jobid
  LIMIT 1;
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  FOR j IN
    SELECT *
    FROM (VALUES
      ('process-sync-queue', '*/5 * * * *',
       'SELECT private.invoke_edge_function(''process-sync-queue'', ''{}''::jsonb)'),
      ('cron-job-run-details-retention', '41 3 * * *',
       'DELETE FROM cron.job_run_details WHERE end_time < now() - interval ''7 days''')
    ) AS v(jobname, schedule, command)
  LOOP
    v_jobid := NULL;
    EXECUTE 'SELECT jobid, schedule, command FROM cron.job WHERE jobname = $1 ORDER BY jobid LIMIT 1'
      INTO v_jobid, v_schedule, v_command
      USING j.jobname;

    IF v_jobid IS NULL THEN
      v_jobid := cron.schedule(j.jobname, j.schedule, j.command);
      IF j.jobname = 'process-sync-queue' THEN
        PERFORM cron.alter_job(v_jobid, active := false);
        RAISE NOTICE 'process-sync-queue scheduled INACTIVE; deploy compatible provider handlers, then activate with cron.alter_job(%, active := true)', v_jobid;
      END IF;
    ELSIF v_schedule IS DISTINCT FROM j.schedule OR v_command IS DISTINCT FROM j.command THEN
      PERFORM cron.alter_job(v_jobid, schedule := j.schedule, command := j.command);
    END IF;
  END LOOP;
END
$fn$;

REVOKE ALL ON FUNCTION private.schedule_sync_queue_jobs()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT private.schedule_sync_queue_jobs();

-- 5 -----------------------------------------------------------------------
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
    RAISE EXCEPTION 'profile_ownership_transfer_required' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_profile_ownership_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entity_type TEXT;
  v_entity_id UUID;
  v_claim RECORD;
BEGIN
  v_entity_type := CASE TG_TABLE_NAME
    WHEN 'workout_sessions' THEN 'workout_session'
    WHEN 'exercise_progress' THEN 'workout_session'
    WHEN 'routines' THEN 'routine'
    WHEN 'training_cycles' THEN 'training_cycle'
    WHEN 'personal_records' THEN 'personal_record'
  END;
  IF TG_TABLE_NAME = 'exercise_progress' THEN
    v_entity_id := (to_jsonb(NEW)->>'session_id')::UUID;
  ELSE
    v_entity_id := (to_jsonb(NEW)->>'id')::UUID;
  END IF;
  IF v_entity_id IS NULL THEN RETURN NEW; END IF;

  SELECT c.user_id, c.target_profile_id INTO v_claim
  FROM public.profile_ownership_claims c
  WHERE c.entity_type = v_entity_type AND c.entity_id = v_entity_id;
  IF FOUND AND (
    v_claim.user_id <> NEW.user_id OR
    COALESCE(v_claim.target_profile_id, 'default') IS DISTINCT FROM COALESCE(NEW.local_profile_id, 'default')
  ) THEN
    RAISE EXCEPTION 'profile_ownership_claim_mismatch' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_profile_ownership_claim() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_training_cycle_lww() FROM PUBLIC, anon, authenticated;

COMMIT;
