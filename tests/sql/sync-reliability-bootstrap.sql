\set ON_ERROR_STOP on

-- This bootstrap targets only the isolated disposable PostgreSQL contract DB.
-- Reset both fixture schemas so a failed prior psql run is safely repeatable.
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE TABLE IF NOT EXISTS auth.users(id UUID PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID
$$;

CREATE TABLE public.local_profiles(
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  color_index INT NOT NULL DEFAULT 0,
  device_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id,id)
);
CREATE TABLE public.workout_sessions(
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES auth.users(id),
  local_profile_id TEXT, name TEXT, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_seconds INT NOT NULL DEFAULT 0, total_volume NUMERIC NOT NULL DEFAULT 0,
  set_count INT NOT NULL DEFAULT 0, exercise_count INT NOT NULL DEFAULT 0,
  pr_count INT NOT NULL DEFAULT 0, routine_name TEXT, workout_mode TEXT,
  routine_session_id TEXT, notes TEXT, avg_velocity_mps NUMERIC,
  avg_asymmetry_pct NUMERIC, velocity_loss_pct NUMERIC, dominant_side TEXT,
  strength_profile TEXT, form_score NUMERIC, deload_warnings INT,
  rom_violations INT, spotter_activations INT, peak_force_n NUMERIC,
  estimated_calories NUMERIC, heaviest_lift_kg NUMERIC, eccentric_load NUMERIC,
  echo_level NUMERIC, warmup_reps INT, working_reps INT, updated_at TIMESTAMPTZ
);
CREATE TABLE public.routines(
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES auth.users(id),
  local_profile_id TEXT, name TEXT NOT NULL, description TEXT,
  estimated_duration NUMERIC DEFAULT 0, exercise_count INT DEFAULT 0,
  times_completed INT DEFAULT 0, is_favorite BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ
);
ALTER TABLE public.routines ENABLE ROW LEVEL SECURITY;
CREATE POLICY routines_own ON public.routines USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE ON public.routines TO authenticated;
CREATE TABLE public.training_cycles(
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES auth.users(id),
  local_profile_id TEXT, name TEXT NOT NULL, description TEXT,
  duration_weeks INT DEFAULT 4, workout_days INT DEFAULT 0, rest_days INT DEFAULT 0,
  current_week INT DEFAULT 1, status TEXT DEFAULT 'draft', started_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ, progression_settings JSONB, deload_settings JSONB,
  template_id TEXT, updated_at TIMESTAMPTZ
);
CREATE TABLE public.cycle_days(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES public.training_cycles(id) ON DELETE CASCADE,
  day_number INT NOT NULL, day_type TEXT NOT NULL DEFAULT 'workout',
  routine_id UUID, weight_adjustment NUMERIC DEFAULT 0,
  rep_modifier INT DEFAULT 0, rest_override INT, rest_type TEXT, notes TEXT,
  UNIQUE(cycle_id, day_number)
);
CREATE TABLE public.personal_records(
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES auth.users(id),
  local_profile_id TEXT, exercise_name TEXT NOT NULL DEFAULT 'Lift'
);
CREATE TABLE public.exercise_progress(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES auth.users(id),
  local_profile_id TEXT, session_id UUID REFERENCES public.workout_sessions(id) ON DELETE CASCADE,
  exercise_id TEXT, exercise_name TEXT
);
CREATE TABLE public.exercises(
  id UUID PRIMARY KEY, session_id UUID NOT NULL REFERENCES public.workout_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL, name TEXT NOT NULL, exercise_id TEXT,
  muscle_group TEXT, order_index INT
);
CREATE TABLE public.sets(
  id UUID PRIMARY KEY, exercise_id UUID NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  user_id UUID NOT NULL, set_number INT, target_reps INT, actual_reps INT,
  weight_kg NUMERIC, rpe NUMERIC, is_pr BOOLEAN, notes TEXT, workout_mode TEXT
);
CREATE TABLE public.rep_summaries(
  id UUID PRIMARY KEY, set_id UUID NOT NULL REFERENCES public.sets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL, rep_number INT, mean_velocity_mps NUMERIC,
  peak_velocity_mps NUMERIC, mean_force_n NUMERIC, peak_force_n NUMERIC,
  power_watts NUMERIC, rom_mm NUMERIC, tut_ms INT, left_force_avg NUMERIC,
  right_force_avg NUMERIC, asymmetry_pct NUMERIC, vbt_zone TEXT
);
CREATE TABLE public.rep_telemetry(
  id UUID PRIMARY KEY, set_id UUID NOT NULL REFERENCES public.sets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL, timestamp_ms BIGINT, force_n NUMERIC,
  velocity_mps NUMERIC, position_mm NUMERIC, cable TEXT
);

-- Exact prerequisite after 20260420190710_lww_rpc_coalesce_not_null_defaults.sql.
-- This is the latest production definition before the reliability migration. The
-- reliability migration wraps this existing production contract atomically.
CREATE OR REPLACE FUNCTION public.upsert_workout_session_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
#variable_conflict use_column
DECLARE rec record; existing_ts timestamptz;
BEGIN
  FOR rec IN SELECT * FROM jsonb_populate_recordset(NULL::public.workout_sessions, p_rows) LOOP
    SELECT ws.updated_at INTO existing_ts FROM public.workout_sessions ws WHERE ws.id = rec.id;
    IF existing_ts IS NULL OR rec.updated_at IS NULL OR existing_ts <= rec.updated_at THEN
      INSERT INTO public.workout_sessions AS ws (
        id,user_id,local_profile_id,name,notes,started_at,duration_seconds,total_volume,
        set_count,exercise_count,pr_count,routine_name,routine_session_id,workout_mode,
        warmup_reps,working_reps,avg_velocity_mps,avg_asymmetry_pct,velocity_loss_pct,
        dominant_side,strength_profile,form_score,deload_warnings,rom_violations,
        spotter_activations,peak_force_n,estimated_calories,heaviest_lift_kg,
        eccentric_load,echo_level,updated_at
      ) VALUES (
        rec.id,rec.user_id,rec.local_profile_id,rec.name,rec.notes,COALESCE(rec.started_at,NOW()),
        COALESCE(rec.duration_seconds,0),COALESCE(rec.total_volume,0),COALESCE(rec.set_count,0),
        COALESCE(rec.exercise_count,0),COALESCE(rec.pr_count,0),
        rec.routine_name,rec.routine_session_id,rec.workout_mode,rec.warmup_reps,
        rec.working_reps,rec.avg_velocity_mps,rec.avg_asymmetry_pct,rec.velocity_loss_pct,
        rec.dominant_side,rec.strength_profile,rec.form_score,rec.deload_warnings,
        rec.rom_violations,rec.spotter_activations,rec.peak_force_n,rec.estimated_calories,
        rec.heaviest_lift_kg,rec.eccentric_load,rec.echo_level,COALESCE(rec.updated_at,NOW())
      ) ON CONFLICT (id) DO UPDATE SET
        name=EXCLUDED.name,notes=EXCLUDED.notes,started_at=EXCLUDED.started_at,
        duration_seconds=EXCLUDED.duration_seconds,total_volume=EXCLUDED.total_volume,
        set_count=EXCLUDED.set_count,exercise_count=EXCLUDED.exercise_count,
        pr_count=EXCLUDED.pr_count,routine_name=EXCLUDED.routine_name,
        routine_session_id=EXCLUDED.routine_session_id,workout_mode=EXCLUDED.workout_mode,
        warmup_reps=EXCLUDED.warmup_reps,working_reps=EXCLUDED.working_reps,
        avg_velocity_mps=EXCLUDED.avg_velocity_mps,avg_asymmetry_pct=EXCLUDED.avg_asymmetry_pct,
        velocity_loss_pct=EXCLUDED.velocity_loss_pct,dominant_side=EXCLUDED.dominant_side,
        strength_profile=EXCLUDED.strength_profile,form_score=EXCLUDED.form_score,
        deload_warnings=EXCLUDED.deload_warnings,rom_violations=EXCLUDED.rom_violations,
        spotter_activations=EXCLUDED.spotter_activations,peak_force_n=EXCLUDED.peak_force_n,
        estimated_calories=EXCLUDED.estimated_calories,heaviest_lift_kg=EXCLUDED.heaviest_lift_kg,
        eccentric_load=EXCLUDED.eccentric_load,echo_level=EXCLUDED.echo_level,
        updated_at=EXCLUDED.updated_at
      WHERE ws.updated_at IS NULL OR ws.updated_at <= EXCLUDED.updated_at;
      RETURN QUERY SELECT rec.id::text, TRUE, COALESCE(rec.updated_at,NOW());
    ELSE
      RETURN QUERY SELECT rec.id::text, FALSE, existing_ts;
    END IF;
  END LOOP;
END;
$$;
