-- F-009 / R-23: keep stored force-curve telemetry when a session is re-pushed
-- without it.
--
-- Background: replace_session_children (20260628150000) deletes every exercise
-- of the affected sessions; ON DELETE CASCADE removes their sets, rep_summaries
-- and rep_telemetry, and the payload rows are re-inserted. Mobile regenerates
-- child UUIDs on every push, and a re-push can omit telemetry (for example a
-- non-INFERNO push, or a device that no longer holds the samples). The cascade
-- then silently destroyed the stored force curves.
--
-- This redefinition keeps the exact 6-argument signature (CREATE OR REPLACE;
-- the Edge caller is unchanged) and body, and adds a re-link step:
--
--   0. Before the delete, stash the stored rep_telemetry rows of each old set
--      that has a unique match among the payload sets that carry NO payload
--      telemetry. The match key is
--        (session_id, exercise identity, set_number)
--      where exercise identity is the catalog exercises.exercise_id, or
--      lower(btrim(name)) when exercise_id is NULL/blank.
--   1-5. Unchanged delete + inserts (payload telemetry still replaces).
--   6. Re-insert the stash pointing at the new set id (old telemetry ids kept;
--      ON CONFLICT DO NOTHING so a payload id can never be overwritten).
--
-- Safety rule: a re-link happens only when the key is unique on BOTH the old
-- and the new side within that session. On any ambiguity (the same exercise
-- identity twice in a session, e.g. several copies defaulted to
-- order_index = 0 by pushPayloadSchema, or a duplicated set_number) or no
-- match, the telemetry is deleted exactly as before: attaching a force curve
-- to the wrong lift is worse than losing it.
--
-- order_index is deliberately NOT part of the match key, so an exercise that
-- was reordered keeps its telemetry by identity rather than by position (the
-- PR 20 spec lists order_index in the key tuple but also requires "a reordered
-- exercise follows its identity, not its position"; both cannot hold, and the
-- identity-only key is the conservative reading: same-identity duplicates are
-- never re-linked).
--
-- The whole function remains one transaction: any failure rolls back the
-- delete, the inserts and the re-link together.
--
-- KD-3 rule 3a: body starts from 20260628150000_atomic_replace_session_children
-- (the latest definition). Chain: PR 20 -> PR 24 -> PR 28.
-- KD-3 rule 3b: REVOKE ALL FROM PUBLIC, then explicit grants.

CREATE OR REPLACE FUNCTION public.replace_session_children(
  p_user_id UUID,
  p_session_ids UUID[],
  p_exercises JSONB,
  p_sets JSONB,
  p_rep_summaries JSONB,
  p_rep_telemetry JSONB
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
  v_telemetry_stash JSONB := '[]'::jsonb;
BEGIN
  -- 0. Stash telemetry that can be re-linked unambiguously (see header).
  --    Must run before step 1, whose CASCADE deletes it.
  IF p_session_ids IS NOT NULL AND array_length(p_session_ids, 1) IS NOT NULL THEN
    WITH old_sets AS (
      SELECT
        s.id AS set_id,
        e.session_id,
        COALESCE(NULLIF(btrim(e.exercise_id), ''), lower(btrim(e.name))) AS identity,
        s.set_number
      FROM public.exercises e
      JOIN public.sets s ON s.exercise_id = e.id
      WHERE e.session_id = ANY(p_session_ids)
        AND e.user_id = p_user_id
    ),
    old_keys AS (
      SELECT o.*,
             count(*) OVER (PARTITION BY o.session_id, o.identity, o.set_number) AS key_count
      FROM old_sets o
    ),
    new_sets AS (
      SELECT
        ns.id AS set_id,
        ne.session_id,
        COALESCE(NULLIF(btrim(ne.exercise_id), ''), lower(btrim(ne.name))) AS identity,
        ns.set_number
      FROM jsonb_to_recordset(COALESCE(p_sets, '[]'::jsonb)) AS ns(
        id UUID,
        exercise_id UUID,
        set_number INT
      )
      JOIN jsonb_to_recordset(COALESCE(p_exercises, '[]'::jsonb)) AS ne(
        id UUID,
        session_id UUID,
        user_id UUID,
        name TEXT,
        exercise_id TEXT
      ) ON ne.id = ns.exercise_id
      WHERE ne.session_id = ANY(p_session_ids)
        AND ne.user_id = p_user_id
    ),
    new_keys AS (
      -- Uniqueness is counted over ALL new sets (including those that carry
      -- payload telemetry) so ambiguity can never be hidden by the filter.
      SELECT n.*,
             count(*) OVER (PARTITION BY n.session_id, n.identity, n.set_number) AS key_count
      FROM new_sets n
    ),
    payload_telemetry_sets AS (
      SELECT DISTINCT t.set_id
      FROM jsonb_to_recordset(COALESCE(p_rep_telemetry, '[]'::jsonb)) AS t(set_id UUID)
    ),
    set_map AS (
      SELECT o.set_id AS old_set_id, n.set_id AS new_set_id
      FROM old_keys o
      JOIN new_keys n
        ON n.session_id = o.session_id
       AND n.identity = o.identity
       AND n.set_number = o.set_number
      WHERE o.key_count = 1
        AND n.key_count = 1
        AND NOT EXISTS (
          SELECT 1 FROM payload_telemetry_sets pt WHERE pt.set_id = n.set_id
        )
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', rt.id,
             'set_id', m.new_set_id,
             'user_id', rt.user_id,
             'timestamp_ms', rt.timestamp_ms,
             'force_n', rt.force_n,
             'velocity_mps', rt.velocity_mps,
             'position_mm', rt.position_mm,
             'cable', rt.cable
           )), '[]'::jsonb)
    INTO v_telemetry_stash
    FROM set_map m
    JOIN public.rep_telemetry rt ON rt.set_id = m.old_set_id
    WHERE rt.user_id = p_user_id;
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
  IF jsonb_array_length(v_telemetry_stash) > 0 THEN
    INSERT INTO public.rep_telemetry
      (id, set_id, user_id, timestamp_ms, force_n, velocity_mps, position_mm, cable)
    SELECT id, set_id, user_id, timestamp_ms, force_n, velocity_mps, position_mm, cable
    FROM jsonb_to_recordset(v_telemetry_stash) AS x(
      id UUID,
      set_id UUID,
      user_id UUID,
      timestamp_ms BIGINT,
      force_n NUMERIC,
      velocity_mps NUMERIC,
      position_mm NUMERIC,
      cable TEXT
    )
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_rep_telemetry_preserved = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'exercises', v_exercises,
    'sets', v_sets,
    'rep_summaries', v_rep_summaries,
    'rep_telemetry', v_rep_telemetry,
    'rep_telemetry_preserved', v_rep_telemetry_preserved
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_session_children(
  UUID, UUID[], JSONB, JSONB, JSONB, JSONB
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_session_children(
  UUID, UUID[], JSONB, JSONB, JSONB, JSONB
) FROM anon;
REVOKE ALL ON FUNCTION public.replace_session_children(
  UUID, UUID[], JSONB, JSONB, JSONB, JSONB
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.replace_session_children(
  UUID, UUID[], JSONB, JSONB, JSONB, JSONB
) TO service_role;
