-- Historical scalar values retain their original interpretation; only tagged
-- paired cable-work summaries may be projected as watts. No history rewrite.
ALTER TABLE public.rep_summaries
  ADD COLUMN IF NOT EXISTS power_method TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN_V0',
  ADD COLUMN IF NOT EXISTS peak_power_watts NUMERIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.rep_summaries'::regclass AND conname = 'rep_summaries_power_method_check') THEN
    ALTER TABLE public.rep_summaries ADD CONSTRAINT rep_summaries_power_method_check
      CHECK (power_method IN ('PAIRED_CABLE_WORK_V1', 'UNAVAILABLE', 'LEGACY_UNKNOWN_V0'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.rep_summaries'::regclass AND conname = 'rep_summaries_unavailable_power_check') THEN
    ALTER TABLE public.rep_summaries ADD CONSTRAINT rep_summaries_unavailable_power_check
      CHECK (power_method <> 'UNAVAILABLE' OR (power_watts IS NULL AND peak_power_watts IS NULL));
  END IF;
END;
$$;

COMMENT ON COLUMN public.rep_summaries.power_watts IS 'Mean signed paired cable-work proxy W only when power_method=PAIRED_CABLE_WORK_V1; historical values are unverified';
COMMENT ON COLUMN public.rep_summaries.peak_power_watts IS 'Peak signed paired cable-work proxy W only when power_method=PAIRED_CABLE_WORK_V1';

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
  v_payload_telemetry_ids UUID[];
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
    -- Stored samples of the old sets: per-set storage, plus the legacy rows of
    -- a set the backfill has not folded yet (20260925200000). Joined per set
    -- so only the affected sets are unpacked.
    SELECT s.id, m.new_set_id, m.session_id, t.user_id, s.timestamp_ms,
           s.force_n, s.velocity_mps, s.position_mm, s.cable
    FROM set_map m
    JOIN public.set_telemetry t
      ON t.set_id = m.old_set_id AND t.user_id = p_user_id
    CROSS JOIN LATERAL unnest(t.ids, t.timestamp_ms, t.force_n,
                              t.velocity_mps, t.position_mm, t.cable)
      AS s(id, timestamp_ms, force_n, velocity_mps, position_mm, cable)
    UNION ALL
    SELECT l.id, m.new_set_id, m.session_id, l.user_id, l.timestamp_ms,
           l.force_n, l.velocity_mps, l.position_mm, l.cable
    FROM set_map m
    JOIN public.rep_telemetry_legacy l
      ON l.set_id = m.old_set_id AND l.user_id = p_user_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.set_telemetry t2
   WHERE t2.set_id = l.set_id AND t2.user_id = l.user_id
    );

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
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_rep_summaries) AS r
      WHERE r->>'power_method' = 'UNAVAILABLE'
        AND (r->>'power_watts' IS NOT NULL OR r->>'peak_power_watts' IS NOT NULL)
    ) THEN
      RAISE EXCEPTION 'UNAVAILABLE requires null watt values' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.rep_summaries
      (id, set_id, user_id, rep_number, mean_velocity_mps, peak_velocity_mps,
       mean_force_n, peak_force_n, power_watts, peak_power_watts, power_method, rom_mm, tut_ms, left_force_avg,
       right_force_avg, asymmetry_pct, vbt_zone)
    SELECT id, set_id, user_id, rep_number, mean_velocity_mps, peak_velocity_mps,
           mean_force_n, peak_force_n,
           CASE WHEN power_method = 'PAIRED_CABLE_WORK_V1' THEN power_watts ELSE NULL END,
           CASE WHEN power_method = 'PAIRED_CABLE_WORK_V1' THEN peak_power_watts ELSE NULL END,
           COALESCE(power_method, 'LEGACY_UNKNOWN_V0'), rom_mm, tut_ms, left_force_avg,
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
      peak_power_watts NUMERIC,
      power_method TEXT,
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
      peak_power_watts = EXCLUDED.peak_power_watts,
      power_method = EXCLUDED.power_method,
      rom_mm = EXCLUDED.rom_mm,
      tut_ms = EXCLUDED.tut_ms,
      left_force_avg = EXCLUDED.left_force_avg,
      right_force_avg = EXCLUDED.right_force_avg,
      asymmetry_pct = EXCLUDED.asymmetry_pct,
      vbt_zone = EXCLUDED.vbt_zone;
    GET DIAGNOSTICS v_rep_summaries = ROW_COUNT;
  END IF;

  -- 5 + 6. Write telemetry in per-set form (set_telemetry, 20260925200000).
  --    The per-sample semantics are unchanged: payload samples upsert by id
  --    (an id stored for another set moves to this one), and the stashed
  --    samples re-link without overwriting a payload sample. A duplicate id
  --    inside the payload is refused, as the old ON CONFLICT DO UPDATE refused
  --    to touch one row twice.
  IF to_regclass('pg_temp.rsc_telemetry_write') IS NULL THEN
    CREATE TEMP TABLE rsc_telemetry_write (
      id UUID PRIMARY KEY,
      set_id UUID NOT NULL,
      user_id UUID NOT NULL,
      timestamp_ms BIGINT NOT NULL,
      force_n NUMERIC,
      velocity_mps NUMERIC,
      position_mm NUMERIC,
      cable TEXT,
      from_payload BOOLEAN NOT NULL
    ) ON COMMIT DROP;
  ELSE
    DELETE FROM pg_temp.rsc_telemetry_write;
  END IF;

  IF p_rep_telemetry IS NOT NULL AND jsonb_array_length(p_rep_telemetry) > 0 THEN
    INSERT INTO pg_temp.rsc_telemetry_write
      (id, set_id, user_id, timestamp_ms, force_n, velocity_mps, position_mm,
       cable, from_payload)
    SELECT id, set_id, user_id, timestamp_ms, force_n, velocity_mps,
           position_mm, cable, TRUE
    FROM jsonb_to_recordset(p_rep_telemetry) AS x(
      id UUID,
      set_id UUID,
      user_id UUID,
      timestamp_ms BIGINT,
      force_n NUMERIC,
      velocity_mps NUMERIC,
      position_mm NUMERIC,
      cable TEXT
    );
    GET DIAGNOSTICS v_rep_telemetry = ROW_COUNT;

    -- An id already stored for another set moves here.
    SELECT array_agg(w.id) INTO v_payload_telemetry_ids
    FROM pg_temp.rsc_telemetry_write w
    WHERE w.from_payload;

    UPDATE public.set_telemetry t
       SET (sample_count, ids, timestamp_ms, force_n, velocity_mps,
            position_mm, cable, updated_at) = (
         SELECT count(*)::int,
                COALESCE(array_agg(s.id ORDER BY s.ord), '{}'),
                COALESCE(array_agg(s.timestamp_ms ORDER BY s.ord), '{}'),
                COALESCE(array_agg(s.force_n ORDER BY s.ord), '{}'),
                COALESCE(array_agg(s.velocity_mps ORDER BY s.ord), '{}'),
                COALESCE(array_agg(s.position_mm ORDER BY s.ord), '{}'),
                COALESCE(array_agg(s.cable ORDER BY s.ord), '{}'),
                now()
         FROM unnest(t.ids, t.timestamp_ms, t.force_n, t.velocity_mps,
                     t.position_mm, t.cable) WITH ORDINALITY
           AS s(id, timestamp_ms, force_n, velocity_mps, position_mm, cable, ord)
         WHERE NOT (s.id = ANY(v_payload_telemetry_ids))
       )
     WHERE t.ids && v_payload_telemetry_ids;
    DELETE FROM public.set_telemetry t
     WHERE t.sample_count = 0;
    DELETE FROM public.rep_telemetry_legacy l
     WHERE l.id = ANY(v_payload_telemetry_ids);
  END IF;

  INSERT INTO pg_temp.rsc_telemetry_write
    (id, set_id, user_id, timestamp_ms, force_n, velocity_mps, position_mm,
     cable, from_payload)
  SELECT id, set_id, user_id, timestamp_ms, force_n, velocity_mps,
         position_mm, cable, FALSE
  FROM pg_temp.rsc_telemetry_stash
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_rep_telemetry_preserved = ROW_COUNT;

  -- A target set that already holds samples (payload telemetry for a set
  -- outside this push's sessions) keeps them, including legacy rows the
  -- backfill has not folded yet. Payload ids were removed from those rows
  -- above, so nothing here can shadow a payload sample.
  INSERT INTO pg_temp.rsc_telemetry_write
    (id, set_id, user_id, timestamp_ms, force_n, velocity_mps, position_mm,
     cable, from_payload)
  SELECT s.id, t.set_id, t.user_id, s.timestamp_ms, s.force_n, s.velocity_mps,
         s.position_mm, s.cable, FALSE
  FROM public.set_telemetry t
  CROSS JOIN LATERAL unnest(t.ids, t.timestamp_ms, t.force_n, t.velocity_mps,
                            t.position_mm, t.cable)
    AS s(id, timestamp_ms, force_n, velocity_mps, position_mm, cable)
  WHERE t.set_id IN (SELECT DISTINCT w.set_id FROM pg_temp.rsc_telemetry_write w)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO pg_temp.rsc_telemetry_write
    (id, set_id, user_id, timestamp_ms, force_n, velocity_mps, position_mm,
     cable, from_payload)
  SELECT l.id, l.set_id, l.user_id, l.timestamp_ms, l.force_n, l.velocity_mps,
         l.position_mm, l.cable, FALSE
  FROM public.rep_telemetry_legacy l
  WHERE EXISTS (
      SELECT 1 FROM pg_temp.rsc_telemetry_write w
       WHERE w.set_id = l.set_id AND w.user_id = l.user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.set_telemetry t
       WHERE t.set_id = l.set_id AND t.user_id = l.user_id
    )
  ON CONFLICT (id) DO NOTHING;

  DELETE FROM public.set_telemetry t
   WHERE t.set_id IN (SELECT DISTINCT w.set_id FROM pg_temp.rsc_telemetry_write w);

  -- One row per set, samples in (timestamp_ms, id) order. Two owners for one
  -- set collide on the primary key, which rolls the whole call back.
  INSERT INTO public.set_telemetry
    (set_id, user_id, sample_count, ids, timestamp_ms, force_n, velocity_mps,
     position_mm, cable)
  SELECT w.set_id, w.user_id, count(*)::int,
         array_agg(w.id ORDER BY w.timestamp_ms, w.id),
         array_agg(w.timestamp_ms ORDER BY w.timestamp_ms, w.id),
         array_agg(w.force_n ORDER BY w.timestamp_ms, w.id),
         array_agg(w.velocity_mps ORDER BY w.timestamp_ms, w.id),
         array_agg(w.position_mm ORDER BY w.timestamp_ms, w.id),
         array_agg(w.cable ORDER BY w.timestamp_ms, w.id)
  FROM pg_temp.rsc_telemetry_write w
  GROUP BY w.set_id, w.user_id;

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

