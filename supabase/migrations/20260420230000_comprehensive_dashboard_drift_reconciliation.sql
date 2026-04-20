-- Migration: Comprehensive dashboard-drift reconciliation
--
-- Context: an audit on 2026-04-20 compared the prod public schema against
-- what `supabase db reset` produces from the migrations folder and found
-- 4 tables, 8 columns on existing tables, 16 RPCs, 2 triggers, and a
-- handful of indexes/policies that were added via the Supabase dashboard
-- and never committed as migrations. Every object below is already present
-- in prod (the migration is a no-op there). The purpose of this file is
-- to make a fresh `supabase db reset` match prod end-to-end so CI can
-- catch any future drift the moment it appears.
--
-- All statements use IF NOT EXISTS / CREATE OR REPLACE guards.
--
-- DDL extracted from prod via:
--   * information_schema.columns / table_constraints
--   * pg_policies, pg_indexes, pg_trigger
--   * pg_get_functiondef / pg_get_indexdef / pg_get_triggerdef
--
-- Out of scope:
--   * Auto-generated unique-constraint indexes (named `*_key`/`*_unique`).
--     These materialize from the UNIQUE clauses in CREATE TABLE statements
--     above or in earlier migrations; no explicit CREATE INDEX required.
--   * `rls_auto_enable` event-trigger registration. The function exists in
--     prod but is not wired to any event_trigger. Left as a plain function
--     here to match prod exactly.
--   * Ghost/dropped columns flagged by the audit as migration-only. Those
--     are tracked separately and don't block clean-apply.

BEGIN;

-- =========================================================================
-- 1. DRIFT TABLES
-- =========================================================================

-- 1a. goal_snapshots — per-snapshot goal progress rows
CREATE TABLE IF NOT EXISTS public.goal_snapshots (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id             uuid        NOT NULL REFERENCES public.user_goals(id) ON DELETE CASCADE,
  current_value       numeric     NOT NULL DEFAULT 0,
  progress_pct        numeric     NOT NULL DEFAULT 0,
  predicted_completion date,
  snapshotted_at      timestamptz NOT NULL DEFAULT now()
);

-- 1b. overload_suggestions — cached progressive-overload recommendations
CREATE TABLE IF NOT EXISTS public.overload_suggestions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_name   text        NOT NULL,
  suggestion_type text        NOT NULL
    CHECK (suggestion_type IN ('weight_increase', 'rep_increase', 'variation', 'deload')),
  current_value   numeric     NOT NULL,
  suggested_value numeric     NOT NULL,
  rationale       text        NOT NULL,
  confidence      numeric     NOT NULL
    CHECK (confidence >= 0 AND confidence <= 1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + '7 days'::interval)
);

-- 1c. telemetry_analysis — async worker output for RFD/sticking-point/etc.
CREATE TABLE IF NOT EXISTS public.telemetry_analysis (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id         uuid        NOT NULL,
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  analysis_type  text        NOT NULL
    CHECK (analysis_type IN ('rfd', 'sticking_point', 'force_velocity_profile', 'form_degradation')),
  result         jsonb       NOT NULL,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  worker_version text
);

-- 1d. wearable_daily_summaries — per-day Garmin/Fitbit recovery rollup
CREATE TABLE IF NOT EXISTS public.wearable_daily_summaries (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  summary_date           date        NOT NULL,
  provider               text        NOT NULL,
  resting_hr             integer,
  hrv_ms                 numeric,
  sleep_score            numeric,
  sleep_duration_minutes integer,
  deep_sleep_minutes     integer,
  rem_sleep_minutes      integer,
  light_sleep_minutes    integer,
  awake_minutes          integer,
  hr_zones               jsonb,
  stress_score           numeric,
  body_battery           integer,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, summary_date, provider)
);

-- =========================================================================
-- 2. EXISTING-TABLE DRIFT COLUMNS
-- =========================================================================

-- 2a. profiles: weekly-digest + feature-flag support
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS digest_frequency    text        DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS digest_last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS feature_flags       jsonb       DEFAULT '{}'::jsonb;

-- 2b. user_goals: cached prediction + snapshot bookkeeping
ALTER TABLE public.user_goals
  ADD COLUMN IF NOT EXISTS last_snapshot_at          timestamptz,
  ADD COLUMN IF NOT EXISTS predicted_completion_date date;

-- 2c. user_integrations: provider-side metadata captured at OAuth exchange
ALTER TABLE public.user_integrations
  ADD COLUMN IF NOT EXISTS provider_user_id text,
  ADD COLUMN IF NOT EXISTS connected_at     timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS error_message    text;

-- =========================================================================
-- 3. RLS ENABLE + POLICIES ON DRIFT TABLES
-- =========================================================================

ALTER TABLE public.goal_snapshots           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overload_suggestions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_analysis       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wearable_daily_summaries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='goal_snapshots'
      AND policyname='Users can view own goal snapshots'
  ) THEN
    CREATE POLICY "Users can view own goal snapshots"
      ON public.goal_snapshots FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='goal_snapshots'
      AND policyname='Users can insert own goal snapshots'
  ) THEN
    CREATE POLICY "Users can insert own goal snapshots"
      ON public.goal_snapshots FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='overload_suggestions'
      AND policyname='Users can view own overload suggestions'
  ) THEN
    CREATE POLICY "Users can view own overload suggestions"
      ON public.overload_suggestions FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='telemetry_analysis'
      AND policyname='Users can view own telemetry analysis'
  ) THEN
    CREATE POLICY "Users can view own telemetry analysis"
      ON public.telemetry_analysis FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='wearable_daily_summaries'
      AND policyname='Users can view own wearable summaries'
  ) THEN
    CREATE POLICY "Users can view own wearable summaries"
      ON public.wearable_daily_summaries FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='wearable_daily_summaries'
      AND policyname='Users can insert own wearable summaries'
  ) THEN
    CREATE POLICY "Users can insert own wearable summaries"
      ON public.wearable_daily_summaries FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- =========================================================================
-- 4. SUPPORTING INDEXES ON DRIFT TABLES (non-auto)
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_goal_snapshots_user       ON public.goal_snapshots       (user_id);
CREATE INDEX IF NOT EXISTS idx_overload_suggestions_user ON public.overload_suggestions (user_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_analysis_user   ON public.telemetry_analysis   (user_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_analysis_set    ON public.telemetry_analysis   (set_id);
CREATE INDEX IF NOT EXISTS idx_wearable_summaries_user_date
  ON public.wearable_daily_summaries (user_id, summary_date DESC);

-- =========================================================================
-- 5. RPC FUNCTIONS
-- =========================================================================

CREATE OR REPLACE FUNCTION public.detect_plateaus(
  p_user_id uuid,
  p_window_sessions integer DEFAULT 10,
  p_variance_threshold numeric DEFAULT 2.0,
  p_profile_id text DEFAULT NULL
)
RETURNS TABLE(
  exercise_name text,
  recent_avg numeric,
  recent_stddev numeric,
  coefficient_of_variation numeric,
  is_plateau boolean,
  session_count bigint
)
LANGUAGE sql STABLE
AS $fn$
  WITH ranked AS (
    SELECT ep.exercise_name, ep.estimated_1rm_kg,
      ROW_NUMBER() OVER (PARTITION BY ep.exercise_name ORDER BY ep.recorded_at DESC) AS rn
    FROM public.exercise_progress ep
    WHERE ep.user_id = p_user_id
      AND (p_profile_id IS NULL OR ep.local_profile_id = p_profile_id)
  ),
  recent AS (
    SELECT exercise_name, estimated_1rm_kg FROM ranked WHERE rn <= p_window_sessions
  )
  SELECT
    exercise_name,
    ROUND(AVG(estimated_1rm_kg), 1) AS recent_avg,
    ROUND(COALESCE(STDDEV(estimated_1rm_kg), 0), 2) AS recent_stddev,
    ROUND(COALESCE(STDDEV(estimated_1rm_kg), 0) / NULLIF(AVG(estimated_1rm_kg), 0) * 100, 1) AS coefficient_of_variation,
    (COALESCE(STDDEV(estimated_1rm_kg), 0) / NULLIF(AVG(estimated_1rm_kg), 0) * 100) < p_variance_threshold AS is_plateau,
    COUNT(*) AS session_count
  FROM recent
  GROUP BY exercise_name
  HAVING COUNT(*) >= 3;
$fn$;

CREATE OR REPLACE FUNCTION public.get_acwr(
  p_user_id uuid,
  p_acute_days integer DEFAULT 7,
  p_chronic_days integer DEFAULT 28
)
RETURNS TABLE(calc_date date, acute_load numeric, chronic_load numeric, acwr numeric, risk_zone text)
LANGUAGE sql STABLE
AS $fn$
  WITH date_series AS (
    SELECT generate_series((CURRENT_DATE - p_chronic_days)::timestamp, CURRENT_DATE::timestamp, '1 day'::interval)::date AS d
  ),
  daily_load AS (
    SELECT (started_at AT TIME ZONE 'UTC')::date AS workout_date, SUM(total_volume) AS daily_volume
    FROM public.workout_sessions
    WHERE user_id = p_user_id
      AND started_at >= (CURRENT_DATE - (p_chronic_days + p_acute_days))::timestamptz
    GROUP BY 1
  ),
  filled AS (
    SELECT ds.d, COALESCE(dl.daily_volume, 0) AS vol
    FROM date_series ds
    LEFT JOIN daily_load dl ON dl.workout_date = ds.d
  ),
  with_loads AS (
    SELECT
      d,
      AVG(vol) OVER w_acute AS acute_load,
      AVG(vol) OVER w_chronic AS chronic_load,
      AVG(vol) OVER w_acute / NULLIF(AVG(vol) OVER w_chronic, 0) AS ratio
    FROM filled
    WINDOW w_acute AS (ORDER BY d ROWS BETWEEN (p_acute_days - 1) PRECEDING AND CURRENT ROW),
           w_chronic AS (ORDER BY d ROWS BETWEEN (p_chronic_days - 1) PRECEDING AND CURRENT ROW)
  )
  SELECT
    wl.d AS calc_date,
    ROUND(wl.acute_load, 1) AS acute_load,
    ROUND(wl.chronic_load, 1) AS chronic_load,
    ROUND(wl.ratio, 2) AS acwr,
    CASE
      WHEN wl.ratio IS NULL THEN 'NO_DATA'
      WHEN wl.ratio > 1.5 THEN 'HIGH_RISK'
      WHEN wl.ratio >= 0.8 AND wl.ratio <= 1.3 THEN 'OPTIMAL'
      WHEN wl.ratio < 0.8 THEN 'UNDERTRAINED'
      ELSE 'ELEVATED'
    END AS risk_zone
  FROM with_loads wl
  ORDER BY wl.d;
$fn$;

CREATE OR REPLACE FUNCTION public.get_exercise_trend(
  p_user_id uuid,
  p_exercise_name text,
  p_lookback_days integer DEFAULT 90,
  p_profile_id text DEFAULT NULL
)
RETURNS TABLE(data_points bigint, trend_slope numeric, weekly_gain numeric, r_squared numeric, trend_direction text)
LANGUAGE sql STABLE
AS $fn$
  WITH progress AS (
    SELECT EXTRACT(EPOCH FROM (recorded_at - MIN(recorded_at) OVER ())) / 86400.0 AS day_num, estimated_1rm_kg
    FROM public.exercise_progress
    WHERE user_id = p_user_id
      AND exercise_name = p_exercise_name
      AND recorded_at >= (CURRENT_DATE - p_lookback_days)::timestamptz
      AND (p_profile_id IS NULL OR local_profile_id = p_profile_id)
  )
  SELECT
    COALESCE(regr_count(estimated_1rm_kg, day_num), 0)::bigint AS data_points,
    ROUND(COALESCE(regr_slope(estimated_1rm_kg, day_num), 0)::numeric, 4) AS trend_slope,
    ROUND((COALESCE(regr_slope(estimated_1rm_kg, day_num), 0) * 7)::numeric, 2) AS weekly_gain,
    ROUND(COALESCE(regr_r2(estimated_1rm_kg, day_num), 0)::numeric, 3) AS r_squared,
    CASE
      WHEN COALESCE(regr_slope(estimated_1rm_kg, day_num), 0) >  0.01 THEN 'IMPROVING'
      WHEN COALESCE(regr_slope(estimated_1rm_kg, day_num), 0) < -0.01 THEN 'DECLINING'
      ELSE 'PLATEAU'
    END AS trend_direction
  FROM progress;
$fn$;

CREATE OR REPLACE FUNCTION public.get_goal_progress_cached(p_user_id uuid)
RETURNS TABLE(
  goal_id uuid, goal_type text, target_value numeric, target_unit text, exercise_name text,
  deadline date, status text, current_value numeric, progress_pct numeric,
  predicted_completion date, snapshotted_at timestamptz
)
LANGUAGE sql STABLE
AS $fn$
  SELECT
    g.id AS goal_id, g.goal_type, g.target_value, g.target_unit, g.exercise_name,
    g.deadline::date, g.status,
    COALESCE(gs.current_value, 0) AS current_value,
    COALESCE(gs.progress_pct, 0) AS progress_pct,
    COALESCE(gs.predicted_completion, g.predicted_completion_date) AS predicted_completion,
    gs.snapshotted_at
  FROM public.user_goals g
  LEFT JOIN LATERAL (
    SELECT s.current_value, s.progress_pct, s.predicted_completion, s.snapshotted_at
    FROM public.goal_snapshots s
    WHERE s.goal_id = g.id
    ORDER BY s.snapshotted_at DESC
    LIMIT 1
  ) gs ON true
  WHERE g.user_id = p_user_id AND g.status IN ('active', 'completed')
  ORDER BY g.created_at DESC;
$fn$;

CREATE OR REPLACE FUNCTION public.get_muscle_distribution(
  p_user_id uuid,
  p_profile_id text DEFAULT NULL
)
RETURNS TABLE(name text, value integer)
LANGUAGE sql STABLE
AS $fn$
  WITH exercise_counts AS (
    SELECT e.muscle_group, COUNT(*)::numeric AS cnt
    FROM public.exercises e
    JOIN public.workout_sessions ws ON e.session_id = ws.id
    WHERE ws.user_id = p_user_id
      AND (p_profile_id IS NULL OR ws.local_profile_id = p_profile_id)
    GROUP BY e.muscle_group
  ),
  total AS (SELECT SUM(cnt) AS total_count FROM exercise_counts)
  SELECT ec.muscle_group::text AS name, ROUND((ec.cnt / NULLIF(t.total_count, 0)) * 100)::int AS value
  FROM exercise_counts ec CROSS JOIN total t
  ORDER BY ec.cnt DESC;
$fn$;

CREATE OR REPLACE FUNCTION public.get_percentile_rank(
  p_user_id uuid,
  p_metric_type text,
  p_metric_key text DEFAULT NULL
)
RETURNS TABLE(user_value numeric, percentile integer, rank_description text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = 'public'
AS $fn$
DECLARE
  v_user_value NUMERIC;
  v_percentile_values JSONB;
  v_total_users INT;
  v_percentile INT := 0;
BEGIN
  SELECT cb.total_users, cb.percentile_values INTO v_total_users, v_percentile_values
  FROM public.community_benchmarks cb
  WHERE cb.metric_type = p_metric_type
    AND (p_metric_key IS NULL OR cb.metric_key = p_metric_key)
  LIMIT 1;

  IF v_total_users IS NULL OR v_total_users < 1 THEN
    RETURN QUERY SELECT 0::numeric, 0, 'Insufficient community data'::text;
    RETURN;
  END IF;

  CASE p_metric_type
    WHEN 'total_volume' THEN
      SELECT COALESCE(SUM(ws.total_volume), 0) INTO v_user_value
      FROM public.workout_sessions ws WHERE ws.user_id = p_user_id;
    WHEN 'weekly_frequency' THEN
      SELECT COUNT(DISTINCT (ws.started_at AT TIME ZONE 'UTC')::date)::numeric
        / GREATEST(EXTRACT(EPOCH FROM (now() - MIN(ws.started_at))) / 604800.0, 1)
      INTO v_user_value
      FROM public.workout_sessions ws WHERE ws.user_id = p_user_id;
    WHEN 'exercise_1rm' THEN
      SELECT COALESCE(MAX(ep.estimated_1rm_kg), 0) INTO v_user_value
      FROM public.exercise_progress ep
      WHERE ep.user_id = p_user_id
        AND (p_metric_key IS NULL OR ep.exercise_name = p_metric_key);
    WHEN 'best_streak' THEN
      SELECT COALESCE(MAX(gs.longest_streak), 0) INTO v_user_value
      FROM public.gamification_stats gs WHERE gs.user_id = p_user_id;
    ELSE
      v_user_value := 0;
  END CASE;

  IF    v_user_value >= (v_percentile_values->>'p95')::numeric THEN v_percentile := 97;
  ELSIF v_user_value >= (v_percentile_values->>'p90')::numeric THEN v_percentile := 92;
  ELSIF v_user_value >= (v_percentile_values->>'p75')::numeric THEN v_percentile := 82;
  ELSIF v_user_value >= (v_percentile_values->>'p50')::numeric THEN v_percentile := 62;
  ELSIF v_user_value >= (v_percentile_values->>'p25')::numeric THEN v_percentile := 37;
  ELSE                                                              v_percentile := 12;
  END IF;
  v_percentile := LEAST(99, GREATEST(1, v_percentile));

  RETURN QUERY SELECT
    ROUND(v_user_value, 1),
    v_percentile,
    CASE
      WHEN v_percentile >= 90 THEN 'Elite (Top 10%)'
      WHEN v_percentile >= 75 THEN 'Advanced (Top 25%)'
      WHEN v_percentile >= 50 THEN 'Intermediate'
      WHEN v_percentile >= 25 THEN 'Developing'
      ELSE 'Beginner'
    END;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_profile_stats(p_user_id uuid)
RETURNS TABLE(
  total_workouts integer, total_volume_kg numeric, best_streak integer,
  pr_count integer, current_streak integer, longest_streak integer
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $fn$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Access denied: can only read own profile stats';
  END IF;
  RETURN QUERY
    SELECT gs.total_workouts, gs.total_volume_kg, gs.best_streak, gs.pr_count,
           gs.current_streak, gs.longest_streak
    FROM public.gamification_stats gs
    WHERE gs.user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0::numeric, 0, 0, 0, 0;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_volume_comparison(
  p_user_id uuid,
  p_days integer DEFAULT 28,
  p_profile_id text DEFAULT NULL
)
RETURNS TABLE(
  period text, total_volume numeric, session_count bigint, total_duration bigint,
  avg_volume numeric, total_sets bigint
)
LANGUAGE sql STABLE
AS $fn$
  SELECT
    CASE WHEN started_at >= (CURRENT_DATE - p_days)::timestamptz THEN 'current' ELSE 'previous' END AS period,
    COALESCE(SUM(total_volume), 0) AS total_volume,
    COUNT(*) AS session_count,
    COALESCE(SUM(duration_seconds), 0)::bigint AS total_duration,
    ROUND(COALESCE(AVG(total_volume), 0), 1) AS avg_volume,
    COALESCE(SUM(set_count), 0)::bigint AS total_sets
  FROM public.workout_sessions
  WHERE user_id = p_user_id
    AND started_at >= (CURRENT_DATE - (p_days * 2))::timestamptz
    AND (p_profile_id IS NULL OR local_profile_id = p_profile_id)
  GROUP BY 1 ORDER BY 1;
$fn$;

CREATE OR REPLACE FUNCTION public.get_volume_rolling_avg(
  p_user_id uuid,
  p_window_days integer DEFAULT 7,
  p_lookback_days integer DEFAULT 90,
  p_profile_id text DEFAULT NULL
)
RETURNS TABLE(workout_date date, daily_volume numeric, rolling_avg numeric)
LANGUAGE sql STABLE
AS $fn$
  WITH date_series AS (
    SELECT generate_series((CURRENT_DATE - p_lookback_days)::timestamp, CURRENT_DATE::timestamp, '1 day'::interval)::date AS d
  ),
  daily AS (
    SELECT (started_at AT TIME ZONE 'UTC')::date AS workout_date, SUM(total_volume) AS daily_volume
    FROM public.workout_sessions
    WHERE user_id = p_user_id
      AND started_at >= (CURRENT_DATE - p_lookback_days)::timestamptz
      AND (p_profile_id IS NULL OR local_profile_id = p_profile_id)
    GROUP BY 1
  )
  SELECT
    ds.d AS workout_date,
    COALESCE(daily.daily_volume, 0) AS daily_volume,
    ROUND(AVG(COALESCE(daily.daily_volume, 0))
          OVER (ORDER BY ds.d ROWS BETWEEN (p_window_days - 1) PRECEDING AND CURRENT ROW), 1) AS rolling_avg
  FROM date_series ds
  LEFT JOIN daily ON daily.workout_date = ds.d
  ORDER BY ds.d;
$fn$;

CREATE OR REPLACE FUNCTION public.get_wearable_trends(
  p_user_id uuid,
  p_lookback_days integer DEFAULT 90
)
RETURNS TABLE(
  summary_date date, hrv_ms numeric, hrv_7d_avg numeric,
  resting_hr integer, resting_hr_7d_avg numeric,
  sleep_score numeric, sleep_score_7d_avg numeric
)
LANGUAGE sql STABLE
AS $fn$
  WITH date_series AS (
    SELECT generate_series((CURRENT_DATE - p_lookback_days)::timestamp, CURRENT_DATE::timestamp, '1 day'::interval)::date AS d
  ),
  daily AS (
    SELECT ws.summary_date, ws.hrv_ms, ws.resting_hr, ws.sleep_score
    FROM public.wearable_daily_summaries ws
    WHERE ws.user_id = p_user_id
      AND ws.summary_date >= (CURRENT_DATE - p_lookback_days)
    ORDER BY ws.summary_date,
             CASE ws.provider WHEN 'garmin' THEN 1 WHEN 'fitbit' THEN 2 ELSE 3 END
  ),
  deduplicated AS (
    SELECT DISTINCT ON (summary_date) summary_date, hrv_ms, resting_hr, sleep_score FROM daily
  )
  SELECT
    ds.d AS summary_date,
    dd.hrv_ms,
    ROUND(AVG(dd.hrv_ms) OVER (ORDER BY ds.d ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 1) AS hrv_7d_avg,
    dd.resting_hr,
    ROUND(AVG(dd.resting_hr) OVER (ORDER BY ds.d ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 1) AS resting_hr_7d_avg,
    dd.sleep_score,
    ROUND(AVG(dd.sleep_score) OVER (ORDER BY ds.d ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 1) AS sleep_score_7d_avg
  FROM date_series ds
  LEFT JOIN deduplicated dd ON dd.summary_date = ds.d
  ORDER BY ds.d;
$fn$;

CREATE OR REPLACE FUNCTION public.get_workout_streak(
  p_user_id uuid,
  p_profile_id text DEFAULT NULL
)
RETURNS integer
LANGUAGE sql STABLE
AS $fn$
  WITH workout_days AS (
    SELECT DISTINCT (started_at AT TIME ZONE 'UTC')::date AS d
    FROM public.workout_sessions
    WHERE user_id = p_user_id AND (p_profile_id IS NULL OR local_profile_id = p_profile_id)
  ),
  with_gaps AS (
    SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::int AS grp FROM workout_days
  ),
  streaks AS (
    SELECT grp, COUNT(*)::int AS len, MAX(d) AS last_day FROM with_gaps GROUP BY grp
  )
  SELECT COALESCE(
    (SELECT len FROM streaks WHERE last_day >= CURRENT_DATE - 1 ORDER BY last_day DESC LIMIT 1),
    0
  );
$fn$;

CREATE OR REPLACE FUNCTION public.refresh_community_benchmarks()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $fn$
DECLARE
  v_exercise RECORD;
BEGIN
  INSERT INTO public.community_benchmarks (metric_type, metric_key, percentile_values, total_users, updated_at)
  SELECT 'total_volume', NULL,
    jsonb_build_object(
      'p25', (percentile_cont(0.25) WITHIN GROUP (ORDER BY user_volume)),
      'p50', (percentile_cont(0.50) WITHIN GROUP (ORDER BY user_volume)),
      'p75', (percentile_cont(0.75) WITHIN GROUP (ORDER BY user_volume)),
      'p90', (percentile_cont(0.90) WITHIN GROUP (ORDER BY user_volume)),
      'p95', (percentile_cont(0.95) WITHIN GROUP (ORDER BY user_volume))
    ), COUNT(*), now()
  FROM (
    SELECT user_id, SUM(total_volume) AS user_volume
    FROM public.workout_sessions
    GROUP BY user_id HAVING COUNT(*) >= 3
  ) vol
  ON CONFLICT (metric_type, COALESCE(metric_key, ''))
  DO UPDATE SET percentile_values = EXCLUDED.percentile_values,
                total_users = EXCLUDED.total_users,
                updated_at = EXCLUDED.updated_at;

  INSERT INTO public.community_benchmarks (metric_type, metric_key, percentile_values, total_users, updated_at)
  SELECT 'weekly_frequency', NULL,
    jsonb_build_object(
      'p25', (percentile_cont(0.25) WITHIN GROUP (ORDER BY avg_per_week)),
      'p50', (percentile_cont(0.50) WITHIN GROUP (ORDER BY avg_per_week)),
      'p75', (percentile_cont(0.75) WITHIN GROUP (ORDER BY avg_per_week)),
      'p90', (percentile_cont(0.90) WITHIN GROUP (ORDER BY avg_per_week)),
      'p95', (percentile_cont(0.95) WITHIN GROUP (ORDER BY avg_per_week))
    ), COUNT(*), now()
  FROM (
    SELECT user_id, COUNT(*)::numeric
      / GREATEST(EXTRACT(EPOCH FROM (now() - MIN(started_at))) / 604800.0, 1) AS avg_per_week
    FROM public.workout_sessions
    GROUP BY user_id HAVING COUNT(*) >= 3
  ) freq
  ON CONFLICT (metric_type, COALESCE(metric_key, ''))
  DO UPDATE SET percentile_values = EXCLUDED.percentile_values,
                total_users = EXCLUDED.total_users,
                updated_at = EXCLUDED.updated_at;

  FOR v_exercise IN
    SELECT exercise_name
    FROM public.exercise_progress
    GROUP BY exercise_name
    HAVING COUNT(DISTINCT user_id) >= 5
    ORDER BY COUNT(DISTINCT user_id) DESC
    LIMIT 50
  LOOP
    INSERT INTO public.community_benchmarks (metric_type, metric_key, percentile_values, total_users, updated_at)
    SELECT 'exercise_1rm', v_exercise.exercise_name,
      jsonb_build_object(
        'p25', (percentile_cont(0.25) WITHIN GROUP (ORDER BY best_1rm)),
        'p50', (percentile_cont(0.50) WITHIN GROUP (ORDER BY best_1rm)),
        'p75', (percentile_cont(0.75) WITHIN GROUP (ORDER BY best_1rm)),
        'p90', (percentile_cont(0.90) WITHIN GROUP (ORDER BY best_1rm)),
        'p95', (percentile_cont(0.95) WITHIN GROUP (ORDER BY best_1rm))
      ), COUNT(*), now()
    FROM (
      SELECT user_id, MAX(estimated_1rm_kg) AS best_1rm
      FROM public.exercise_progress
      WHERE exercise_name = v_exercise.exercise_name
      GROUP BY user_id
    ) user_bests
    ON CONFLICT (metric_type, COALESCE(metric_key, ''))
    DO UPDATE SET percentile_values = EXCLUDED.percentile_values,
                  total_users = EXCLUDED.total_users,
                  updated_at = EXCLUDED.updated_at;
  END LOOP;

  INSERT INTO public.community_benchmarks (metric_type, metric_key, percentile_values, total_users, updated_at)
  SELECT 'best_streak', NULL,
    jsonb_build_object(
      'p25', (percentile_cont(0.25) WITHIN GROUP (ORDER BY longest_streak)),
      'p50', (percentile_cont(0.50) WITHIN GROUP (ORDER BY longest_streak)),
      'p75', (percentile_cont(0.75) WITHIN GROUP (ORDER BY longest_streak)),
      'p90', (percentile_cont(0.90) WITHIN GROUP (ORDER BY longest_streak)),
      'p95', (percentile_cont(0.95) WITHIN GROUP (ORDER BY longest_streak))
    ), COUNT(*), now()
  FROM public.gamification_stats
  WHERE longest_streak > 0
  ON CONFLICT (metric_type, COALESCE(metric_key, ''))
  DO UPDATE SET percentile_values = EXCLUDED.percentile_values,
                total_users = EXCLUDED.total_users,
                updated_at = EXCLUDED.updated_at;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.refresh_hot_scores()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $fn$
BEGIN
  UPDATE public.shared_routines
  SET hot_score = (vote_count + 0.5 * comment_count + 0.3 * COALESCE(save_count, 0))
    / POWER(EXTRACT(EPOCH FROM (now() - shared_at)) / 3600.0 + 2.0, 1.5)
  WHERE shared_at > now() - interval '90 days';

  UPDATE public.shared_cycles
  SET hot_score = (vote_count + 0.5 * comment_count + 0.3 * COALESCE(save_count, 0))
    / POWER(EXTRACT(EPOCH FROM (now() - shared_at)) / 3600.0 + 2.0, 1.5)
  WHERE shared_at > now() - interval '90 days';
END;
$fn$;

-- rls_auto_enable — event-trigger body kept in prod but never wired to an
-- actual event_trigger. Recreated here to preserve fidelity. If a future
-- migration registers it, do so in a separate file.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog'
AS $fn$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL
       AND cmd.schema_name IN ('public')
       AND cmd.schema_name NOT IN ('pg_catalog','information_schema')
       AND cmd.schema_name NOT LIKE 'pg_toast%'
       AND cmd.schema_name NOT LIKE 'pg_temp%'
    THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    ELSE
      RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
                cmd.object_identity, cmd.schema_name;
    END IF;
  END LOOP;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.update_pr_count_on_record()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $fn$
BEGIN
  INSERT INTO public.gamification_stats (user_id, pr_count, updated_at)
  VALUES (NEW.user_id, 1, now())
  ON CONFLICT (user_id)
  DO UPDATE SET pr_count = gamification_stats.pr_count + 1, updated_at = now();
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.update_profile_stats_on_workout()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $fn$
BEGIN
  INSERT INTO public.gamification_stats (user_id, total_workouts, total_volume_kg, total_time_seconds, updated_at)
  VALUES (NEW.user_id, 1, COALESCE(NEW.total_volume, 0), COALESCE(NEW.duration_seconds, 0), now())
  ON CONFLICT (user_id)
  DO UPDATE SET
    total_workouts     = gamification_stats.total_workouts + 1,
    total_volume_kg    = gamification_stats.total_volume_kg + COALESCE(NEW.total_volume, 0),
    total_time_seconds = gamification_stats.total_time_seconds + COALESCE(NEW.duration_seconds, 0),
    updated_at         = now();
  RETURN NEW;
END;
$fn$;

-- =========================================================================
-- 6. TRIGGERS (idempotent — DO block avoids the DROP+CREATE race where
--    a trigger briefly unhooks on prod and writes miss it)
-- =========================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_update_pr_count_on_record'
      AND tgrelid = 'public.personal_records'::regclass
  ) THEN
    CREATE TRIGGER trg_update_pr_count_on_record
      AFTER INSERT ON public.personal_records
      FOR EACH ROW
      EXECUTE FUNCTION public.update_pr_count_on_record();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_update_profile_stats_on_workout'
      AND tgrelid = 'public.workout_sessions'::regclass
  ) THEN
    CREATE TRIGGER trg_update_profile_stats_on_workout
      AFTER INSERT ON public.workout_sessions
      FOR EACH ROW
      EXECUTE FUNCTION public.update_profile_stats_on_workout();
  END IF;
END $$;

COMMIT;
