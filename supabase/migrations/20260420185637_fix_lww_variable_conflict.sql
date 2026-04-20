-- Fix: "column reference 'id' is ambiguous" in all 6 upsert_*_lww RPCs.
--
-- Root cause
-- ----------
-- The LWW RPCs declare `RETURNS TABLE(id text, accepted boolean,
-- server_updated_at timestamptz)`. In PL/pgSQL those OUT columns are visible
-- as variables throughout the function body. The default
-- `#variable_conflict error` then rejects any SQL statement in the body
-- that references a column named `id` (via INSERT column list, ON CONFLICT
-- target, EXCLUDED.id, etc.), because PL/pgSQL cannot tell whether the
-- identifier means the OUT variable or the table column.
--
-- This lay dormant because the functions only execute when
-- SYNC_LWW_ENABLED=true in the mobile-sync-push Edge Function. Once the
-- flag flipped on, every first-time workout sync hit the ambiguity and
-- returned 500 "workout_sessions LWW RPC failed: column reference 'id' is
-- ambiguous".
--
-- Fix
-- ---
-- Add `#variable_conflict use_column` directive at the top of each function
-- body. PL/pgSQL will prefer column references over OUT variables for bare
-- identifiers, which is the correct resolution — the OUT variables are only
-- used via qualified `rec.id` / explicit RETURN QUERY lists, never as bare
-- column references.
--
-- Alternate fixes considered:
--   * Renaming OUT columns (id -> out_id): breaks the mobile client's
--     LwwUpsertRow interface and every consumer. Too invasive.
--   * Dropping the OUT parameter: loses the accepted/rejected feedback the
--     Edge Function uses to build its rejections[] response. Not acceptable.
--
-- This is pragma-only; no behavior change beyond resolving the ambiguity.

-- ---------------------------------------------------------------------------
-- 1. workout_sessions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_workout_session_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  rec record;
  existing_ts timestamptz;
BEGIN
  FOR rec IN
    SELECT * FROM jsonb_populate_recordset(NULL::public.workout_sessions, p_rows)
  LOOP
    SELECT ws.updated_at INTO existing_ts
      FROM public.workout_sessions ws
      WHERE ws.id = rec.id;

    IF existing_ts IS NULL OR rec.updated_at IS NULL OR existing_ts <= rec.updated_at THEN
      INSERT INTO public.workout_sessions AS ws (
        id, user_id, local_profile_id, name, notes, started_at, duration_seconds,
        total_volume, set_count, exercise_count, pr_count, routine_name,
        routine_session_id, workout_mode, warmup_reps, working_reps,
        avg_velocity_mps, avg_asymmetry_pct, velocity_loss_pct, dominant_side,
        strength_profile, form_score, deload_warnings, rom_violations,
        spotter_activations, peak_force_n, estimated_calories, heaviest_lift_kg,
        eccentric_load, echo_level, updated_at
      ) VALUES (
        rec.id, rec.user_id, rec.local_profile_id, rec.name, rec.notes,
        rec.started_at, rec.duration_seconds, rec.total_volume, rec.set_count,
        rec.exercise_count, rec.pr_count, rec.routine_name,
        rec.routine_session_id, rec.workout_mode, rec.warmup_reps,
        rec.working_reps, rec.avg_velocity_mps, rec.avg_asymmetry_pct,
        rec.velocity_loss_pct, rec.dominant_side, rec.strength_profile,
        rec.form_score, rec.deload_warnings, rec.rom_violations,
        rec.spotter_activations, rec.peak_force_n, rec.estimated_calories,
        rec.heaviest_lift_kg, rec.eccentric_load, rec.echo_level,
        COALESCE(rec.updated_at, NOW())
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
        updated_at        = EXCLUDED.updated_at
      WHERE ws.updated_at IS NULL OR ws.updated_at <= EXCLUDED.updated_at;

      RETURN QUERY SELECT rec.id::text, TRUE, COALESCE(rec.updated_at, NOW());
    ELSE
      RETURN QUERY SELECT rec.id::text, FALSE, existing_ts;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_workout_session_lww(jsonb)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. routines
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
  existing_ts timestamptz;
BEGIN
  FOR rec IN
    SELECT * FROM jsonb_populate_recordset(NULL::public.routines, p_rows)
  LOOP
    SELECT r.updated_at INTO existing_ts
      FROM public.routines r
      WHERE r.id = rec.id;

    IF existing_ts IS NULL OR existing_ts <= rec.updated_at THEN
      INSERT INTO public.routines AS r (
        id, user_id, local_profile_id, name, description, estimated_duration,
        exercise_count, is_favorite, last_used_at, tags, times_completed,
        created_at, updated_at
      ) VALUES (
        rec.id, rec.user_id, rec.local_profile_id, rec.name, rec.description,
        rec.estimated_duration, rec.exercise_count, rec.is_favorite,
        rec.last_used_at, rec.tags, rec.times_completed,
        COALESCE(rec.created_at, NOW()),
        COALESCE(rec.updated_at, NOW())
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
        updated_at         = EXCLUDED.updated_at
      WHERE r.updated_at <= EXCLUDED.updated_at;

      RETURN QUERY SELECT rec.id::text, TRUE, COALESCE(rec.updated_at, NOW());
    ELSE
      RETURN QUERY SELECT rec.id::text, FALSE, existing_ts;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_routine_lww(jsonb)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. training_cycles
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_training_cycle_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  rec record;
  existing_ts timestamptz;
BEGIN
  FOR rec IN
    SELECT * FROM jsonb_populate_recordset(NULL::public.training_cycles, p_rows)
  LOOP
    SELECT c.updated_at INTO existing_ts
      FROM public.training_cycles c
      WHERE c.id = rec.id;

    IF existing_ts IS NULL OR existing_ts <= rec.updated_at THEN
      INSERT INTO public.training_cycles AS c (
        id, user_id, local_profile_id, name, description, duration_weeks,
        workout_days, rest_days, current_week, status, started_at,
        last_used_at, progression_settings, deload_settings, updated_at
      ) VALUES (
        rec.id, rec.user_id, rec.local_profile_id, rec.name, rec.description,
        rec.duration_weeks, rec.workout_days, rec.rest_days, rec.current_week,
        rec.status, rec.started_at, rec.last_used_at, rec.progression_settings,
        rec.deload_settings, COALESCE(rec.updated_at, NOW())
      )
      ON CONFLICT (id) DO UPDATE SET
        name                 = EXCLUDED.name,
        description          = EXCLUDED.description,
        duration_weeks       = EXCLUDED.duration_weeks,
        workout_days         = EXCLUDED.workout_days,
        rest_days            = EXCLUDED.rest_days,
        current_week         = EXCLUDED.current_week,
        status               = EXCLUDED.status,
        started_at           = EXCLUDED.started_at,
        last_used_at         = EXCLUDED.last_used_at,
        progression_settings = EXCLUDED.progression_settings,
        deload_settings      = EXCLUDED.deload_settings,
        updated_at           = EXCLUDED.updated_at
      WHERE c.updated_at <= EXCLUDED.updated_at;

      RETURN QUERY SELECT rec.id::text, TRUE, COALESCE(rec.updated_at, NOW());
    ELSE
      RETURN QUERY SELECT rec.id::text, FALSE, existing_ts;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_training_cycle_lww(jsonb)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. external_activities
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_external_activity_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  rec record;
  existing_ts timestamptz;
  existing_id uuid;
BEGIN
  FOR rec IN
    SELECT * FROM jsonb_populate_recordset(NULL::public.external_activities, p_rows)
  LOOP
    SELECT ea.updated_at, ea.id INTO existing_ts, existing_id
      FROM public.external_activities ea
      WHERE ea.user_id = rec.user_id
        AND ea.provider = rec.provider
        AND ea.external_id = rec.external_id;

    IF existing_ts IS NULL OR existing_ts <= rec.updated_at THEN
      INSERT INTO public.external_activities AS ea (
        id, user_id, external_id, provider, name, activity_type, started_at,
        duration_seconds, distance_meters, calories, avg_heart_rate,
        max_heart_rate, elevation_gain_meters, raw_data, synced_at, updated_at
      ) VALUES (
        rec.id, rec.user_id, rec.external_id, rec.provider, rec.name,
        rec.activity_type, rec.started_at, rec.duration_seconds,
        rec.distance_meters, rec.calories, rec.avg_heart_rate,
        rec.max_heart_rate, rec.elevation_gain_meters, rec.raw_data,
        rec.synced_at, COALESCE(rec.updated_at, NOW())
      )
      ON CONFLICT (user_id, provider, external_id) DO UPDATE SET
        name                  = EXCLUDED.name,
        activity_type         = EXCLUDED.activity_type,
        started_at            = EXCLUDED.started_at,
        duration_seconds      = EXCLUDED.duration_seconds,
        distance_meters       = EXCLUDED.distance_meters,
        calories              = EXCLUDED.calories,
        avg_heart_rate        = EXCLUDED.avg_heart_rate,
        max_heart_rate        = EXCLUDED.max_heart_rate,
        elevation_gain_meters = EXCLUDED.elevation_gain_meters,
        raw_data              = EXCLUDED.raw_data,
        synced_at             = EXCLUDED.synced_at,
        updated_at            = EXCLUDED.updated_at
      WHERE ea.updated_at IS NULL OR ea.updated_at <= EXCLUDED.updated_at;

      RETURN QUERY SELECT COALESCE(existing_id, rec.id)::text, TRUE,
        COALESCE(rec.updated_at, NOW());
    ELSE
      RETURN QUERY SELECT existing_id::text, FALSE, existing_ts;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_external_activity_lww(jsonb)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. rpg_attributes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_rpg_attributes_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  rec record;
  existing_ts timestamptz;
BEGIN
  FOR rec IN
    SELECT * FROM jsonb_populate_recordset(NULL::public.rpg_attributes, p_rows)
  LOOP
    SELECT ra.updated_at INTO existing_ts
      FROM public.rpg_attributes ra
      WHERE ra.user_id = rec.user_id;

    IF existing_ts IS NULL OR existing_ts <= rec.updated_at THEN
      INSERT INTO public.rpg_attributes AS ra (
        user_id, strength, power, stamina, consistency, mastery, level,
        experience_points, character_class, updated_at
      ) VALUES (
        rec.user_id, rec.strength, rec.power, rec.stamina, rec.consistency,
        rec.mastery, rec.level, rec.experience_points, rec.character_class,
        COALESCE(rec.updated_at, NOW())
      )
      ON CONFLICT (user_id) DO UPDATE SET
        strength          = EXCLUDED.strength,
        power             = EXCLUDED.power,
        stamina           = EXCLUDED.stamina,
        consistency       = EXCLUDED.consistency,
        mastery           = EXCLUDED.mastery,
        level             = EXCLUDED.level,
        experience_points = EXCLUDED.experience_points,
        character_class   = EXCLUDED.character_class,
        updated_at        = EXCLUDED.updated_at
      WHERE ra.updated_at <= EXCLUDED.updated_at;

      RETURN QUERY SELECT rec.user_id::text, TRUE,
        COALESCE(rec.updated_at, NOW());
    ELSE
      RETURN QUERY SELECT rec.user_id::text, FALSE, existing_ts;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_rpg_attributes_lww(jsonb)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. gamification_stats
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_gamification_stats_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  rec record;
  existing_ts timestamptz;
BEGIN
  FOR rec IN
    SELECT * FROM jsonb_populate_recordset(NULL::public.gamification_stats, p_rows)
  LOOP
    SELECT gs.updated_at INTO existing_ts
      FROM public.gamification_stats gs
      WHERE gs.user_id = rec.user_id;

    IF existing_ts IS NULL OR existing_ts <= rec.updated_at THEN
      INSERT INTO public.gamification_stats AS gs (
        user_id, total_workouts, total_reps, total_volume_kg,
        total_time_seconds, current_streak, longest_streak, best_streak,
        pr_count, updated_at
      ) VALUES (
        rec.user_id, rec.total_workouts, rec.total_reps, rec.total_volume_kg,
        rec.total_time_seconds, rec.current_streak, rec.longest_streak,
        rec.best_streak, rec.pr_count, COALESCE(rec.updated_at, NOW())
      )
      ON CONFLICT (user_id) DO UPDATE SET
        total_workouts     = EXCLUDED.total_workouts,
        total_reps         = EXCLUDED.total_reps,
        total_volume_kg    = EXCLUDED.total_volume_kg,
        total_time_seconds = EXCLUDED.total_time_seconds,
        current_streak     = EXCLUDED.current_streak,
        longest_streak     = EXCLUDED.longest_streak,
        best_streak        = EXCLUDED.best_streak,
        pr_count           = EXCLUDED.pr_count,
        updated_at         = EXCLUDED.updated_at
      WHERE gs.updated_at <= EXCLUDED.updated_at;

      RETURN QUERY SELECT rec.user_id::text, TRUE,
        COALESCE(rec.updated_at, NOW());
    ELSE
      RETURN QUERY SELECT rec.user_id::text, FALSE, existing_ts;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_gamification_stats_lww(jsonb)
  TO authenticated, service_role;
