-- Phase 3.1 — Last-Write-Wins (LWW) upsert RPC functions for sync entities.
--
-- Resolves audit item #1 in phoenix-portal/docs/dto-drift-matrix.md: the
-- asymmetric merge semantics where portal pushed server-wins but mobile
-- pulled local-wins (INSERT OR IGNORE). After this migration, the portal
-- push handler (Phase 3.2, feature-flagged) and the mobile pull merge
-- (Phase 3.3) can both converge on `updated_at`-gated LWW.
--
-- Design notes:
--   * Each function accepts `p_rows jsonb` (a JSON array of row objects).
--   * Each function returns TABLE(id text, accepted boolean,
--     server_updated_at timestamptz) so callers can reconcile state.
--   * LWW gate: an incoming row is accepted when either the existing row
--     is absent OR `existing.updated_at <= incoming.updated_at`. A NULL
--     existing timestamp is treated as older (accept incoming).
--   * Child tables (exercises, sets, rep_summaries, cycle_days) are
--     intentionally NOT gated here. They lack an `updated_at` column and
--     their lifecycle is bound to the parent entity; the Phase 3.2 push
--     handler upserts them unconditionally only after the parent LWW call
--     accepts the parent row.
--   * Append-only tables (rep_telemetry, personal_records, earned_badges)
--     are not LWW candidates — they continue to use INSERT with
--     `ignoreDuplicates: true` on the portal side and INSERT OR IGNORE on
--     the mobile side.
--
-- These functions are additive. They remain unused until the Phase 3.2
-- push handler is deployed with `SYNC_LWW_ENABLED=true`, so applying this
-- migration alone is a zero-behavior-change operation.

-- ---------------------------------------------------------------------------
-- 0. Schema prerequisite: external_activities.updated_at
--    The Row type in database.types.ts did not include an `updated_at`
--    column. Add it (idempotent) so LWW can gate on it. Default to NOW()
--    for backfill; the push handler will overwrite with client `updated_at`
--    on every upsert.
-- ---------------------------------------------------------------------------

ALTER TABLE public.external_activities
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_external_activities_user_updated_at
  ON public.external_activities(user_id, updated_at);

-- Keep updated_at honest on any non-LWW write path (e.g. the garmin-webhook
-- Edge Function) by auto-bumping on UPDATE.
CREATE OR REPLACE FUNCTION public._external_activities_bump_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_external_activities_bump_updated_at
  ON public.external_activities;
CREATE TRIGGER trg_external_activities_bump_updated_at
  BEFORE UPDATE ON public.external_activities
  FOR EACH ROW
  EXECUTE FUNCTION public._external_activities_bump_updated_at();

-- ---------------------------------------------------------------------------
-- 1. workout_sessions — shared-edit LWW
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_workout_session_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
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
-- 2. routines — shared-edit LWW (portal + mobile both write)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_routine_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
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
-- 3. training_cycles — shared-edit LWW (portal-dominant, but mobile edits too)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_training_cycle_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
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
-- 4. external_activities — LWW on (user_id, provider, external_id)
--    A single physical activity can arrive via two paths (mobile import and
--    provider webhook), so LWW on compound unique is the correct gate.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_external_activity_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
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
-- 5. rpg_attributes — single row per user, LWW on user_id
--    Server computes from mobile events; rare portal override possible via
--    support tooling. LWW defends against stale pushes from old devices.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_rpg_attributes_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
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
-- 6. gamification_stats — single row per user, LWW on user_id
--    Aggregated counters. LWW + preserving local-only fields is intentional.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_gamification_stats_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
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

-- ---------------------------------------------------------------------------
-- Verification query (manual):
--   SELECT proname FROM pg_proc WHERE proname LIKE 'upsert_%_lww';
--   -- expect 6 rows:
--   --   upsert_workout_session_lww
--   --   upsert_routine_lww
--   --   upsert_training_cycle_lww
--   --   upsert_external_activity_lww
--   --   upsert_rpg_attributes_lww
--   --   upsert_gamification_stats_lww
-- ---------------------------------------------------------------------------
