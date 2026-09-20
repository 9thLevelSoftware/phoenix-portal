-- F-069 / F-036: refresh exercise_progress when a session is edited, and index
-- the session_id lookups on exercise_progress and personal_records.
--
-- 1. Indexes. exercise_progress.session_id (FK, ON DELETE CASCADE) and
--    personal_records.session_id (FK, ON DELETE SET NULL) were unindexed, so
--    every per-session probe and every session-delete cascade scanned the
--    whole table across all users. Both tables are small (~6k rows), so a
--    plain transactional CREATE INDEX is fine.
--
-- 2. replace_session_children gains p_progress JSONB DEFAULT NULL.
--    Previously the push handler inserted exercise_progress only when no row
--    existed for (session, exercise), so editing a session's weights on mobile
--    and re-pushing left the old max_weight_kg / estimated_1rm_kg in place,
--    and a removed exercise kept its progress row forever. Now:
--      * p_progress IS NULL (every caller that uses today's 6 named
--        arguments): exercise_progress is not touched at all.
--      * p_progress non-NULL (an array, possibly empty): the exercise_progress
--        rows of p_session_ids (scoped to p_user_id) are deleted and the
--        supplied rows inserted, in the same transaction as the child swap.
--        Only rows whose session_id is in p_session_ids and whose user_id is
--        p_user_id are inserted; anything else is ignored.
--    Rows are computed by the Edge handler (_shared/exerciseProgressRows.ts):
--    mobile's estimatedOneRepMaxKg is stored verbatim; the hybrid fallback is
--    unchanged (1RM parity, CLAUDE.md).
--
-- KD-3 rule 3 (R-1 / R-21): adding a defaulted parameter with CREATE OR
-- REPLACE would create a second overload next to the 6-argument one, and a
-- 6-named-argument PostgREST call would become ambiguous (PGRST203). So the
-- old signature is DROPPED and the new one CREATED in this migration (both
-- signatures are dropped first so a re-run is safe), leaving exactly one
-- function; today's 6-named-argument call resolves to it via the default.
--
-- KD-3 rule 3a: the body is PR 20's (20260920002000_replace_session_children_
-- preserve_telemetry.sql) verbatim - including the FINAL RE-LINK KEY
-- telemetry-preservation steps 0 and 6 - plus step 7 below and one additive
-- key in the result ('exercise_progress'). Chain: PR 20 -> PR 24 -> PR 28.
-- KD-3 rule 3b: REVOKE ALL FROM PUBLIC/anon/authenticated, GRANT to
-- service_role only.

CREATE INDEX IF NOT EXISTS idx_exercise_progress_session_id
  ON public.exercise_progress (session_id);

CREATE INDEX IF NOT EXISTS idx_personal_records_session_id
  ON public.personal_records (session_id);

DROP FUNCTION IF EXISTS public.replace_session_children(
  UUID, UUID[], JSONB, JSONB, JSONB, JSONB
);
DROP FUNCTION IF EXISTS public.replace_session_children(
  UUID, UUID[], JSONB, JSONB, JSONB, JSONB, JSONB
);

CREATE FUNCTION public.replace_session_children(
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
               SELECT 1 FROM old_sets o
               WHERE o.exercise_row_id = n.exercise_row_id AND o.session_id = n.session_id
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

  -- 2. Re-insert exercises.
  IF p_exercises IS NOT NULL AND jsonb_array_length(p_exercises) > 0 THEN
    INSERT INTO public.exercises
      (id, session_id, user_id, name, exercise_id, muscle_group, order_index)
    SELECT id, session_id, user_id, name, exercise_id, muscle_group, order_index
    FROM jsonb_to_recordset(p_exercises) AS x(
      id UUID,
      session_id UUID,
      user_id UUID,
      name TEXT,
      exercise_id TEXT,
      muscle_group TEXT,
      order_index INT
    )
    ON CONFLICT (id) DO UPDATE SET
      session_id = EXCLUDED.session_id,
      user_id = EXCLUDED.user_id,
      name = EXCLUDED.name,
      exercise_id = EXCLUDED.exercise_id,
      muscle_group = EXCLUDED.muscle_group,
      order_index = EXCLUDED.order_index;
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

REVOKE ALL ON FUNCTION public.replace_session_children(
  UUID, UUID[], JSONB, JSONB, JSONB, JSONB, JSONB
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_session_children(
  UUID, UUID[], JSONB, JSONB, JSONB, JSONB, JSONB
) FROM anon;
REVOKE ALL ON FUNCTION public.replace_session_children(
  UUID, UUID[], JSONB, JSONB, JSONB, JSONB, JSONB
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.replace_session_children(
  UUID, UUID[], JSONB, JSONB, JSONB, JSONB, JSONB
) TO service_role;
