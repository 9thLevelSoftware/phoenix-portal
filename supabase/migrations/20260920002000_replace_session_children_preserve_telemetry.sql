-- F-009 / R-23: keep stored force-curve telemetry when a session is re-pushed
-- without it.
--
-- Background: replace_session_children (20260628150000) deletes every exercise
-- of the affected sessions; ON DELETE CASCADE removes their sets, rep_summaries
-- and rep_telemetry, and the payload rows are re-inserted. A re-push can omit
-- telemetry (a non-INFERNO push, or a device that no longer holds the
-- samples), and the cascade then silently destroyed the stored force curves.
--
-- Wire facts this relies on (Project-Phoenix-MP PortalSyncAdapter.kt,
-- buildPortalSession / buildPortalExerciseWithTelemetry):
--   * one mobile workout session (= one performed set) becomes one portal
--     exercise holding exactly one set with set_number = 1; a routine groups
--     them into one portal session with order_index = chronological position;
--   * the portal exercise id is the STABLE mobile session id (issue #33), so
--     it is identical across re-pushes;
--   * only the set id (and its rep/telemetry ids) is regenerated per push.
--
-- This redefinition keeps the exact 6-argument signature (CREATE OR REPLACE;
-- the Edge caller is unchanged) and steps 1-5 verbatim, and adds:
--
--   0. Before the delete, map each stored set to at most one payload set and
--      copy its rep_telemetry into a transaction-local temp table, pointing at
--      the new set id (telemetry ids are kept). KEY RULE (PRs 24/28 inherit):
--        Tier 1 (primary): same exercise row id (old exercises.id =
--          new exercises.id, same session) + set_number.
--        Tier 2 (fallback, only for exercises whose row id is absent on the
--          other side, i.e. legacy clients that regenerated exercise ids):
--          (session_id, identity, order_index, set_number), where identity is
--          'id:' || catalog exercise_id, or 'name:' || lower(btrim(name)) when
--          exercise_id is NULL/blank (namespaced so a catalog id can never
--          equal a free-text name).
--        A pair is re-linked only when its key is unique on BOTH the old side
--        and the new side (counted over all sets of the session, not only the
--        candidates), and the new set carries NO payload telemetry. Anything
--        ambiguous or unmatched is deleted exactly as before: attaching a force
--        curve to the wrong lift is worse than losing it.
--   1-5. Unchanged delete + inserts (payload telemetry still replaces).
--   6. Re-insert the stash (ON CONFLICT DO NOTHING: a payload row always wins).
--
-- Bound: per session, stored telemetry is kept only while stash + payload
-- telemetry for that session stays <= 50000 rows (mirrors
-- MAX_TELEMETRY_POINTS in mobile-sync-push/index.ts, the most one push can
-- deliver). Above that the session falls back to delete, so preserved
-- telemetry can never accumulate past what a single push could carry and the
-- per-call stash is bounded by 50000 x pushed sessions.
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
