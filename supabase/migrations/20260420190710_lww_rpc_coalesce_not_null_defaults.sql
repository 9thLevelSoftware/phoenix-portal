-- Defense-in-depth for the LWW RPCs.
--
-- Problem
-- -------
-- Each RPC's INSERT statement passes `rec.<field>` directly for columns that
-- are NOT NULL with a DEFAULT. Postgres only applies DEFAULT when a column is
-- OMITTED from the INSERT column list; an explicit NULL bypasses it and the
-- write fails with "null value in column X violates not-null constraint".
-- That surfaced first on workout_sessions.pr_count.
--
-- Fix
-- ---
-- Wrap every NOT-NULL-DEFAULT scalar column's `rec.X` in COALESCE to the DB
-- default. The edge function already coerces client-side (as of this change),
-- but the RPC is also callable by other paths (tests, tooling, future
-- integrations); keep both layers defended.
--
-- Nullable columns stay raw. Required-without-default columns stay raw
-- (incoming null there is a client bug, surface it as the specific error).
--
-- Pragma #variable_conflict use_column preserved from previous migration.

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
        rec.echo_level, COALESCE(rec.updated_at, NOW())
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
        rec.id, rec.user_id, rec.local_profile_id, rec.name,
        COALESCE(rec.description, ''),
        COALESCE(rec.estimated_duration, 0),
        COALESCE(rec.exercise_count, 0),
        COALESCE(rec.is_favorite, FALSE),
        rec.last_used_at, rec.tags,
        COALESCE(rec.times_completed, 0),
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
        COALESCE(rec.duration_weeks, 4),
        COALESCE(rec.workout_days, 0),
        COALESCE(rec.rest_days, 0),
        COALESCE(rec.current_week, 1),
        COALESCE(rec.status, 'draft'),
        rec.started_at, rec.last_used_at, rec.progression_settings,
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
        rec.user_id,
        COALESCE(rec.strength, 0),
        COALESCE(rec.power, 0),
        COALESCE(rec.stamina, 0),
        COALESCE(rec.consistency, 0),
        COALESCE(rec.mastery, 0),
        COALESCE(rec.level, 1),
        COALESCE(rec.experience_points, 0),
        rec.character_class, COALESCE(rec.updated_at, NOW())
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
        rec.user_id,
        COALESCE(rec.total_workouts, 0),
        COALESCE(rec.total_reps, 0),
        COALESCE(rec.total_volume_kg, 0),
        COALESCE(rec.total_time_seconds, 0),
        COALESCE(rec.current_streak, 0),
        COALESCE(rec.longest_streak, 0),
        COALESCE(rec.best_streak, 0),
        COALESCE(rec.pr_count, 0),
        COALESCE(rec.updated_at, NOW())
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
