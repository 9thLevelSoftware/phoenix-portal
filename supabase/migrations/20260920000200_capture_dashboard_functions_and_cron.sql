-- Capture dashboard-only functions, triggers, the ensure_rls event trigger,
-- the pg_cron jobs and the prod-only tables they depend on into the
-- migration chain.
--
-- Production has 17 functions in `public`, 3 row triggers, one event trigger
-- and 2 pg_cron jobs that were created from the dashboard and exist in no
-- migration (FP-7 / AF-6 / A-036). A clean apply therefore produced a schema
-- without them. The definitions below were captured read-only from prod on
-- 2026-09-18 with pg_get_functiondef / pg_get_triggerdef / cron.job /
-- pg_event_trigger and are transcribed verbatim, with these changes:
--   * search_path is pinned with pg_temp last:
--       - the 7 definers that had `TO 'public'` now have `'public', 'pg_temp'`;
--       - rls_auto_enable keeps its stricter `'pg_catalog'` and gains
--         `'pg_temp'` (never loosened to public);
--       - the 9 SECURITY INVOKER analytics helpers gain
--         `'public', 'pg_temp'` (they had none; advisor lint 0011). Their
--         bodies use only pg_catalog built-ins (prod-evidence 2026-09-18).
--         Trade-off: PostgreSQL never inlines a SQL function that has a SET
--         clause, so these STABLE helpers now run as opaque calls instead of
--         being planned into the caller's query. Negligible at current sizes.
--   * get_profile_stats casts gs.total_workouts to integer. Prod's column is
--     bigint and the declared result column is integer, so prod's verbatim
--     body raises 42804 for any user with a stats row (no caller exists).
--     The cast keeps the signature and fixes it.
--   * Grants (KD-3 rule 3b):
--       - the 8 SECURITY DEFINER functions: REVOKE ALL FROM PUBLIC, anon,
--         authenticated; GRANT EXECUTE TO service_role (PR 1 pattern).
--         Nothing in src/, supabase/functions/ or the mobile app calls them;
--         triggers, the event trigger and pg_cron (running as the owner) do
--         not need the caller to hold EXECUTE.
--       - the 9 SECURITY INVOKER helpers: REVOKE ALL FROM PUBLIC, anon;
--         GRANT EXECUTE TO authenticated, service_role. The PR 2 spec said
--         "search_path only, keep prod grants"; review round 1 (R-11) chose
--         the rule-3b revoke instead, because anon could otherwise drive
--         unbounded generate_series ranges (get_acwr, get_volume_rolling_avg,
--         get_wearable_trends). They have no caller; RLS still applies to
--         authenticated.
--
-- Ownership guard: every CREATE OR REPLACE runs through
-- private.capture_function, which replaces a function only if it is absent
-- or owned by postgres (prod: all definers are owned by postgres). For any
-- other owner it NOTICEs, skips the body, and still attempts the REVOKE (a
-- non-owner REVOKE only warns). The self-check at the end hard-fails if a
-- captured SECURITY DEFINER function is still executable by anon or
-- authenticated, whoever owns it.
--
-- Prod-only tables (subscription_events, paddle_webhook_events,
-- goal_snapshots, wearable_daily_summaries, overload_suggestions,
-- telemetry_analysis) are created only when absent, from the read-only prod
-- DDL captures of 2026-09-18 (prod-evidence.md, "Prod DDL for tables PR 2
-- creates-if-missing" and "More prod-only tables"): columns, NOT NULLs,
-- defaults, PK/FK/UNIQUE/CHECK constraints, indexes and policies. Missing
-- prod columns are added (routines.created_at, found by PR 16;
-- user_goals.predicted_completion_date) and gamification_stats
-- total_workouts / total_time_seconds are converged to prod's bigint.
--
-- Lock safety on prod: every step that would be a catalog no-op on prod is
-- skipped by a catalog check first, so applying to prod takes no
-- ACCESS EXCLUSIVE / SHARE lock on any hot table (workout_sessions,
-- personal_records, subscriptions, gamification_stats, routines,
-- user_goals). lock_timeout bounds any lock a drifted database still needs;
-- a contended apply fails fast and can be retried. Where a table lock is
-- needed, parent tables (subscriptions, workout_sessions, personal_records)
-- are locked before the tables their AFTER INSERT triggers write
-- (subscription_events, gamification_stats), the same order mobile sync
-- pushes take them.
--
-- Idempotent: safe to re-run, and safe on prod where all of these exist.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. Migration helpers (persistent so pgTAP can exercise the ownership guard;
--    schema `private` is not exposed through PostgREST; postgres only).
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- Replaces a captured function unless it exists with an owner other than
-- postgres, then applies the grant pattern for its kind. Returns 'replaced'
-- or 'skipped'.
CREATE OR REPLACE FUNCTION private.capture_function(
  p_signature text,
  p_kind text,
  p_ddl text
) RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_oid regprocedure := to_regprocedure(p_signature);
  v_owner oid;
  v_status text := 'replaced';
BEGIN
  IF p_kind NOT IN ('definer', 'invoker') THEN
    RAISE EXCEPTION 'capture: unknown kind %', p_kind;
  END IF;

  IF v_oid IS NOT NULL THEN
    SELECT p.proowner INTO v_owner FROM pg_proc p WHERE p.oid = v_oid;
  END IF;

  IF v_oid IS NOT NULL AND v_owner IS DISTINCT FROM 'postgres'::regrole::oid THEN
    RAISE NOTICE 'capture: skipped body of % (owned by %, not postgres)',
      p_signature, pg_get_userbyid(v_owner);
    v_status := 'skipped';
  ELSE
    EXECUTE p_ddl;
    v_oid := to_regprocedure(p_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'capture: % does not exist after CREATE', p_signature;
    END IF;
  END IF;

  BEGIN
    IF p_kind = 'definer' THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_oid);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_oid);
    ELSE
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_oid);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_oid);
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'capture: could not change grants on % (%)', p_signature, SQLERRM;
  END;

  RETURN v_status;
END
$fn$;

-- Raises 42501 listing every given SECURITY DEFINER signature that anon or
-- authenticated can still execute, regardless of owner.
CREATE OR REPLACE FUNCTION private.capture_assert_definers_locked(p_signatures text[])
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_offenders text;
BEGIN
  SELECT string_agg(
           format('%s (owner=%s, anon=%s, authenticated=%s)',
                  sig, pg_get_userbyid(p.proowner),
                  has_function_privilege('anon', p.oid, 'EXECUTE'),
                  has_function_privilege('authenticated', p.oid, 'EXECUTE')),
           '; ' ORDER BY sig)
  INTO v_offenders
  FROM unnest(p_signatures) AS sig
  JOIN pg_proc p ON p.oid = to_regprocedure(sig)
  WHERE has_function_privilege('anon', p.oid, 'EXECUTE')
     OR has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'capture: definers still executable by anon/authenticated: %', v_offenders
      USING ERRCODE = '42501';
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION private.capture_function(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.capture_assert_definers_locked(text[]) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Prod-only tables, created only when absent (no lock on prod).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Written by the log_subscription_event() audit trigger (definer).
  IF to_regclass('public.subscription_events') IS NULL THEN
    CREATE TABLE public.subscription_events (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      subscription_row_id uuid,
      user_id uuid,
      operation text NOT NULL
        CONSTRAINT subscription_events_operation_check
        CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
      event_recorded_at timestamptz NOT NULL DEFAULT now(),
      tier text,
      status text,
      current_period_start timestamptz,
      current_period_end timestamptz,
      cancel_at_period_end boolean,
      environment text,
      last_event_id text,
      paddle_customer_id text,
      paddle_subscription_id text,
      price_id text,
      last_event_occurred_at timestamptz,
      subscription_created_at timestamptz,
      subscription_updated_at timestamptz,
      row_snapshot jsonb NOT NULL
    );
    CREATE INDEX subscription_events_last_event_id_idx
      ON public.subscription_events (last_event_id);
    CREATE INDEX subscription_events_paddle_sub_id_idx
      ON public.subscription_events (paddle_subscription_id, event_recorded_at DESC);
    CREATE INDEX subscription_events_user_id_idx
      ON public.subscription_events (user_id, event_recorded_at DESC);
    ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;
  END IF;

  -- Raw Paddle webhook log (prod-only until now; PR 34/36 delete from it).
  IF to_regclass('public.paddle_webhook_events') IS NULL THEN
    CREATE TABLE public.paddle_webhook_events (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      received_at timestamptz NOT NULL DEFAULT now(),
      event_id text,
      event_type text,
      event_occurred_at timestamptz,
      notification_id text,
      environment text,
      paddle_subscription_id text,
      paddle_customer_id text,
      user_id uuid,
      payload jsonb NOT NULL
    );
    CREATE UNIQUE INDEX paddle_webhook_events_event_id_uniq
      ON public.paddle_webhook_events (event_id) WHERE event_id IS NOT NULL;
    CREATE INDEX paddle_webhook_events_sub_id_idx
      ON public.paddle_webhook_events (paddle_subscription_id, received_at DESC);
    CREATE INDEX paddle_webhook_events_type_idx
      ON public.paddle_webhook_events (event_type, received_at DESC);
    CREATE INDEX paddle_webhook_events_user_id_idx
      ON public.paddle_webhook_events (user_id, received_at DESC);
    ALTER TABLE public.paddle_webhook_events ENABLE ROW LEVEL SECURITY;
  END IF;

  -- Read by get_goal_progress_cached (SQL body, validated at CREATE time).
  IF to_regclass('public.goal_snapshots') IS NULL THEN
    CREATE TABLE public.goal_snapshots (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      goal_id uuid NOT NULL
        CONSTRAINT goal_snapshots_goal_id_fkey
        REFERENCES public.user_goals(id) ON DELETE CASCADE,
      current_value numeric NOT NULL DEFAULT 0,
      progress_pct numeric NOT NULL DEFAULT 0,
      predicted_completion date,
      snapshotted_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_goal_snapshots_user ON public.goal_snapshots (user_id);
    ALTER TABLE public.goal_snapshots ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Users can insert own goal snapshots"
      ON public.goal_snapshots FOR INSERT
      WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "Users can view own goal snapshots"
      ON public.goal_snapshots FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  -- Read by get_wearable_trends (SQL body, validated at CREATE time).
  IF to_regclass('public.wearable_daily_summaries') IS NULL THEN
    CREATE TABLE public.wearable_daily_summaries (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      summary_date date NOT NULL,
      provider text NOT NULL,
      resting_hr integer,
      hrv_ms numeric,
      sleep_score numeric,
      sleep_duration_minutes integer,
      deep_sleep_minutes integer,
      rem_sleep_minutes integer,
      light_sleep_minutes integer,
      awake_minutes integer,
      hr_zones jsonb,
      stress_score numeric,
      body_battery integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT wearable_daily_summaries_user_id_summary_date_provider_key
        UNIQUE (user_id, summary_date, provider)
    );
    CREATE INDEX idx_wearable_summaries_user_date
      ON public.wearable_daily_summaries (user_id, summary_date DESC);
    ALTER TABLE public.wearable_daily_summaries ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Users can insert own wearable summaries"
      ON public.wearable_daily_summaries FOR INSERT
      WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "Users can view own wearable summaries"
      ON public.wearable_daily_summaries FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  -- Prod-only (found by PR 36); no reader or writer in the repo yet.
  IF to_regclass('public.overload_suggestions') IS NULL THEN
    CREATE TABLE public.overload_suggestions (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      exercise_name text NOT NULL,
      suggestion_type text NOT NULL
        CHECK (suggestion_type IN ('weight_increase', 'rep_increase', 'variation', 'deload')),
      current_value numeric NOT NULL,
      suggested_value numeric NOT NULL,
      rationale text NOT NULL,
      confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT (now() + '7 days'::interval),
      exercise_id text REFERENCES public.exercise_catalog(id)
    );
    CREATE INDEX idx_overload_suggestions_exercise_id
      ON public.overload_suggestions (exercise_id);
    CREATE INDEX idx_overload_suggestions_user
      ON public.overload_suggestions (user_id);
    ALTER TABLE public.overload_suggestions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Users can view own overload suggestions"
      ON public.overload_suggestions FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  -- Prod-only (found by PR 36); set_id has no FK in prod.
  IF to_regclass('public.telemetry_analysis') IS NULL THEN
    CREATE TABLE public.telemetry_analysis (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      set_id uuid NOT NULL,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      analysis_type text NOT NULL
        CHECK (analysis_type IN ('rfd', 'sticking_point', 'force_velocity_profile', 'form_degradation')),
      result jsonb NOT NULL,
      computed_at timestamptz NOT NULL DEFAULT now(),
      worker_version text
    );
    CREATE INDEX idx_telemetry_analysis_set ON public.telemetry_analysis (set_id);
    CREATE INDEX idx_telemetry_analysis_user ON public.telemetry_analysis (user_id);
    ALTER TABLE public.telemetry_analysis ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Users can view own telemetry analysis"
      ON public.telemetry_analysis FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END
$$;

-- subscription_events / paddle_webhook_events are service-role only (RLS on,
-- no policies). Drop Supabase's default anon/authenticated table grants so a
-- future permissive policy cannot expose them. Nothing in src/, Edge, e2e or
-- mobile reads them with a browser key. Also enable RLS if a drifted DB has
-- it off. Each change runs only when needed (GRANT/REVOKE take no table lock
-- that blocks DML; ENABLE RLS is skipped when already on).
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['public.subscription_events', 'public.paddle_webhook_events'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_table::regclass) THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_table);
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = v_table::regclass
        AND a.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
    ) THEN
      EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', v_table);
    END IF;
    IF NOT has_table_privilege('service_role', v_table, 'SELECT, INSERT, UPDATE, DELETE') THEN
      EXECUTE format('GRANT ALL ON TABLE %s TO service_role', v_table);
    END IF;
  END LOOP;
END
$$;

-- Missing prod columns on tables no captured trigger writes (no lock on
-- prod: each ALTER runs only when the column is absent). They must exist
-- before the SQL-language functions below are validated.
DO $$
BEGIN
  -- routines.created_at exists in prod (timestamptz DEFAULT now(), nullable;
  -- verified read-only 2026-09-18) but in no migration. upsert_routine_lww
  -- inserts it, so from-zero databases failed routine pushes under
  -- SYNC_LWW_ENABLED=true.
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.routines'::regclass AND attname = 'created_at' AND NOT attisdropped
  ) THEN
    ALTER TABLE public.routines ADD COLUMN created_at timestamptz DEFAULT now();
  END IF;

  -- get_goal_progress_cached reads it (added in prod by the stubbed
  -- 20260420210411; COALESCEd into a `date` result column).
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.user_goals'::regclass AND attname = 'predicted_completion_date' AND NOT attisdropped
  ) THEN
    ALTER TABLE public.user_goals ADD COLUMN predicted_completion_date date;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. The 17 captured functions, behind the ownership guard. Function DDL
--    locks no table (SQL bodies take ACCESS SHARE while being validated).
-- ---------------------------------------------------------------------------
SELECT private.capture_function(
  'public.detect_plateaus(uuid, integer, numeric, text)',
  'invoker',
  $capture$CREATE OR REPLACE FUNCTION public.detect_plateaus(p_user_id uuid, p_window_sessions integer DEFAULT 10, p_variance_threshold numeric DEFAULT 2.0, p_profile_id text DEFAULT NULL::text)
 RETURNS TABLE(exercise_name text, recent_avg numeric, recent_stddev numeric, coefficient_of_variation numeric, is_plateau boolean, session_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH ranked AS (
    SELECT ep.exercise_name, ep.estimated_1rm_kg,
      ROW_NUMBER() OVER (PARTITION BY ep.exercise_name ORDER BY ep.recorded_at DESC) AS rn
    FROM exercise_progress ep WHERE ep.user_id = p_user_id AND (p_profile_id IS NULL OR ep.local_profile_id = p_profile_id)
  ), recent AS (SELECT exercise_name, estimated_1rm_kg FROM ranked WHERE rn <= p_window_sessions)
  SELECT exercise_name, ROUND(AVG(estimated_1rm_kg), 1) AS recent_avg,
    ROUND(COALESCE(STDDEV(estimated_1rm_kg), 0), 2) AS recent_stddev,
    ROUND(COALESCE(STDDEV(estimated_1rm_kg), 0) / NULLIF(AVG(estimated_1rm_kg), 0) * 100, 1) AS coefficient_of_variation,
    (COALESCE(STDDEV(estimated_1rm_kg), 0) / NULLIF(AVG(estimated_1rm_kg), 0) * 100) < p_variance_threshold AS is_plateau,
    COUNT(*) AS session_count
  FROM recent GROUP BY exercise_name HAVING COUNT(*) >= 3;
$function$;
$capture$
);

SELECT private.capture_function(
  'public.get_acwr(uuid, integer, integer)',
  'invoker',
  $capture$CREATE OR REPLACE FUNCTION public.get_acwr(p_user_id uuid, p_acute_days integer DEFAULT 7, p_chronic_days integer DEFAULT 28)
 RETURNS TABLE(calc_date date, acute_load numeric, chronic_load numeric, acwr numeric, risk_zone text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH date_series AS (
    SELECT generate_series((CURRENT_DATE - p_chronic_days)::timestamp, CURRENT_DATE::timestamp, '1 day'::interval)::date AS d
  ), daily_load AS (
    SELECT (started_at AT TIME ZONE 'UTC')::date AS workout_date, SUM(total_volume) AS daily_volume
    FROM workout_sessions WHERE user_id = p_user_id AND started_at >= (CURRENT_DATE - (p_chronic_days + p_acute_days))::timestamptz GROUP BY 1
  ), filled AS (
    SELECT ds.d, COALESCE(dl.daily_volume, 0) AS vol FROM date_series ds LEFT JOIN daily_load dl ON dl.workout_date = ds.d
  ), with_loads AS (
    SELECT d, AVG(vol) OVER w_acute AS acute_load, AVG(vol) OVER w_chronic AS chronic_load,
      AVG(vol) OVER w_acute / NULLIF(AVG(vol) OVER w_chronic, 0) AS ratio
    FROM filled
    WINDOW w_acute AS (ORDER BY d ROWS BETWEEN (p_acute_days - 1) PRECEDING AND CURRENT ROW),
           w_chronic AS (ORDER BY d ROWS BETWEEN (p_chronic_days - 1) PRECEDING AND CURRENT ROW)
  )
  SELECT wl.d AS calc_date, ROUND(wl.acute_load, 1) AS acute_load, ROUND(wl.chronic_load, 1) AS chronic_load,
    ROUND(wl.ratio, 2) AS acwr,
    CASE WHEN wl.ratio IS NULL THEN 'NO_DATA' WHEN wl.ratio > 1.5 THEN 'HIGH_RISK'
      WHEN wl.ratio >= 0.8 AND wl.ratio <= 1.3 THEN 'OPTIMAL' WHEN wl.ratio < 0.8 THEN 'UNDERTRAINED' ELSE 'ELEVATED' END AS risk_zone
  FROM with_loads wl ORDER BY wl.d;
$function$;
$capture$
);

SELECT private.capture_function(
  'public.get_exercise_trend(uuid, text, integer, text)',
  'invoker',
  $capture$CREATE OR REPLACE FUNCTION public.get_exercise_trend(p_user_id uuid, p_exercise_name text, p_lookback_days integer DEFAULT 90, p_profile_id text DEFAULT NULL::text)
 RETURNS TABLE(data_points bigint, trend_slope numeric, weekly_gain numeric, r_squared numeric, trend_direction text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH progress AS (
    SELECT EXTRACT(EPOCH FROM (recorded_at - MIN(recorded_at) OVER ())) / 86400.0 AS day_num, estimated_1rm_kg
    FROM exercise_progress WHERE user_id = p_user_id AND exercise_name = p_exercise_name
      AND recorded_at >= (CURRENT_DATE - p_lookback_days)::timestamptz AND (p_profile_id IS NULL OR local_profile_id = p_profile_id)
  )
  SELECT COALESCE(regr_count(estimated_1rm_kg, day_num), 0)::bigint AS data_points,
    ROUND(COALESCE(regr_slope(estimated_1rm_kg, day_num), 0)::numeric, 4) AS trend_slope,
    ROUND((COALESCE(regr_slope(estimated_1rm_kg, day_num), 0) * 7)::numeric, 2) AS weekly_gain,
    ROUND(COALESCE(regr_r2(estimated_1rm_kg, day_num), 0)::numeric, 3) AS r_squared,
    CASE WHEN COALESCE(regr_slope(estimated_1rm_kg, day_num), 0) > 0.01 THEN 'IMPROVING'
      WHEN COALESCE(regr_slope(estimated_1rm_kg, day_num), 0) < -0.01 THEN 'DECLINING' ELSE 'PLATEAU' END AS trend_direction
  FROM progress;
$function$;
$capture$
);

SELECT private.capture_function(
  'public.get_goal_progress_cached(uuid)',
  'invoker',
  $capture$CREATE OR REPLACE FUNCTION public.get_goal_progress_cached(p_user_id uuid)
 RETURNS TABLE(goal_id uuid, goal_type text, target_value numeric, target_unit text, exercise_name text, deadline date, status text, current_value numeric, progress_pct numeric, predicted_completion date, snapshotted_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT g.id AS goal_id, g.goal_type, g.target_value, g.target_unit, g.exercise_name, g.deadline::date, g.status,
    COALESCE(gs.current_value, 0) AS current_value, COALESCE(gs.progress_pct, 0) AS progress_pct,
    COALESCE(gs.predicted_completion, g.predicted_completion_date) AS predicted_completion, gs.snapshotted_at
  FROM user_goals g LEFT JOIN LATERAL (
    SELECT s.current_value, s.progress_pct, s.predicted_completion, s.snapshotted_at
    FROM goal_snapshots s WHERE s.goal_id = g.id ORDER BY s.snapshotted_at DESC LIMIT 1
  ) gs ON true
  WHERE g.user_id = p_user_id AND g.status IN ('active', 'completed') ORDER BY g.created_at DESC;
$function$;
$capture$
);

SELECT private.capture_function(
  'public.get_muscle_distribution(uuid, text)',
  'invoker',
  $capture$CREATE OR REPLACE FUNCTION public.get_muscle_distribution(p_user_id uuid, p_profile_id text DEFAULT NULL::text)
 RETURNS TABLE(name text, value integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH exercise_counts AS (
    SELECT e.muscle_group, COUNT(*)::numeric AS cnt
    FROM exercises e JOIN workout_sessions ws ON e.session_id = ws.id
    WHERE ws.user_id = p_user_id AND (p_profile_id IS NULL OR ws.local_profile_id = p_profile_id)
    GROUP BY e.muscle_group
  ), total AS (SELECT SUM(cnt) AS total_count FROM exercise_counts)
  SELECT ec.muscle_group::text AS name, ROUND((ec.cnt / NULLIF(t.total_count, 0)) * 100)::int AS value
  FROM exercise_counts ec CROSS JOIN total t ORDER BY ec.cnt DESC;
$function$;
$capture$
);

SELECT private.capture_function(
  'public.get_percentile_rank(uuid, text, text)',
  'definer',
  $capture$CREATE OR REPLACE FUNCTION public.get_percentile_rank(p_user_id uuid, p_metric_type text, p_metric_key text DEFAULT NULL::text)
 RETURNS TABLE(user_value numeric, percentile integer, rank_description text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_user_value NUMERIC; v_percentile_values JSONB; v_total_users INT; v_percentile INT := 0;
BEGIN
  SELECT cb.total_users, cb.percentile_values INTO v_total_users, v_percentile_values
  FROM community_benchmarks cb WHERE cb.metric_type = p_metric_type AND (p_metric_key IS NULL OR cb.metric_key = p_metric_key) LIMIT 1;
  IF v_total_users IS NULL OR v_total_users < 1 THEN
    RETURN QUERY SELECT 0::numeric, 0, 'Insufficient community data'::text; RETURN;
  END IF;
  CASE p_metric_type
    WHEN 'total_volume' THEN SELECT COALESCE(SUM(ws.total_volume), 0) INTO v_user_value FROM workout_sessions ws WHERE ws.user_id = p_user_id;
    WHEN 'weekly_frequency' THEN SELECT COUNT(DISTINCT (ws.started_at AT TIME ZONE 'UTC')::date)::numeric / GREATEST(EXTRACT(EPOCH FROM (now() - MIN(ws.started_at))) / 604800.0, 1) INTO v_user_value FROM workout_sessions ws WHERE ws.user_id = p_user_id;
    WHEN 'exercise_1rm' THEN SELECT COALESCE(MAX(ep.estimated_1rm_kg), 0) INTO v_user_value FROM exercise_progress ep WHERE ep.user_id = p_user_id AND (p_metric_key IS NULL OR ep.exercise_name = p_metric_key);
    WHEN 'best_streak' THEN SELECT COALESCE(MAX(gs.longest_streak), 0) INTO v_user_value FROM gamification_stats gs WHERE gs.user_id = p_user_id;
    ELSE v_user_value := 0;
  END CASE;
  IF v_user_value >= (v_percentile_values->>'p95')::numeric THEN v_percentile := 97;
  ELSIF v_user_value >= (v_percentile_values->>'p90')::numeric THEN v_percentile := 92;
  ELSIF v_user_value >= (v_percentile_values->>'p75')::numeric THEN v_percentile := 82;
  ELSIF v_user_value >= (v_percentile_values->>'p50')::numeric THEN v_percentile := 62;
  ELSIF v_user_value >= (v_percentile_values->>'p25')::numeric THEN v_percentile := 37;
  ELSE v_percentile := 12;
  END IF;
  v_percentile := LEAST(99, GREATEST(1, v_percentile));
  RETURN QUERY SELECT ROUND(v_user_value, 1), v_percentile,
    CASE WHEN v_percentile >= 90 THEN 'Elite (Top 10%)' WHEN v_percentile >= 75 THEN 'Advanced (Top 25%)' WHEN v_percentile >= 50 THEN 'Intermediate' WHEN v_percentile >= 25 THEN 'Developing' ELSE 'Beginner' END;
END; $function$;
$capture$
);

SELECT private.capture_function(
  'public.get_profile_stats(uuid)',
  'definer',
  $capture$CREATE OR REPLACE FUNCTION public.get_profile_stats(p_user_id uuid)
 RETURNS TABLE(total_workouts integer, total_volume_kg numeric, best_streak integer, pr_count integer, current_streak integer, longest_streak integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Access denied: can only read own profile stats';
  END IF;
  RETURN QUERY SELECT gs.total_workouts::integer, gs.total_volume_kg, gs.best_streak, gs.pr_count, gs.current_streak, gs.longest_streak
  FROM gamification_stats gs WHERE gs.user_id = p_user_id;
  IF NOT FOUND THEN RETURN QUERY SELECT 0, 0::numeric, 0, 0, 0, 0; END IF;
END; $function$;
$capture$
);

SELECT private.capture_function(
  'public.get_volume_comparison(uuid, integer, text)',
  'invoker',
  $capture$CREATE OR REPLACE FUNCTION public.get_volume_comparison(p_user_id uuid, p_days integer DEFAULT 28, p_profile_id text DEFAULT NULL::text)
 RETURNS TABLE(period text, total_volume numeric, session_count bigint, total_duration bigint, avg_volume numeric, total_sets bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN started_at >= (CURRENT_DATE - p_days)::timestamptz THEN 'current' ELSE 'previous' END AS period,
    COALESCE(SUM(total_volume), 0) AS total_volume, COUNT(*) AS session_count,
    COALESCE(SUM(duration_seconds), 0)::bigint AS total_duration, ROUND(COALESCE(AVG(total_volume), 0), 1) AS avg_volume,
    COALESCE(SUM(set_count), 0)::bigint AS total_sets
  FROM workout_sessions WHERE user_id = p_user_id AND started_at >= (CURRENT_DATE - (p_days * 2))::timestamptz
    AND (p_profile_id IS NULL OR local_profile_id = p_profile_id) GROUP BY 1 ORDER BY 1;
$function$;
$capture$
);

SELECT private.capture_function(
  'public.get_volume_rolling_avg(uuid, integer, integer, text)',
  'invoker',
  $capture$CREATE OR REPLACE FUNCTION public.get_volume_rolling_avg(p_user_id uuid, p_window_days integer DEFAULT 7, p_lookback_days integer DEFAULT 90, p_profile_id text DEFAULT NULL::text)
 RETURNS TABLE(workout_date date, daily_volume numeric, rolling_avg numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH date_series AS (
    SELECT generate_series((CURRENT_DATE - p_lookback_days)::timestamp, CURRENT_DATE::timestamp, '1 day'::interval)::date AS d
  ), daily AS (
    SELECT (started_at AT TIME ZONE 'UTC')::date AS workout_date, SUM(total_volume) AS daily_volume
    FROM workout_sessions WHERE user_id = p_user_id AND started_at >= (CURRENT_DATE - p_lookback_days)::timestamptz
      AND (p_profile_id IS NULL OR local_profile_id = p_profile_id) GROUP BY 1
  )
  SELECT ds.d AS workout_date, COALESCE(daily.daily_volume, 0) AS daily_volume,
    ROUND(AVG(COALESCE(daily.daily_volume, 0)) OVER (ORDER BY ds.d ROWS BETWEEN (p_window_days - 1) PRECEDING AND CURRENT ROW), 1) AS rolling_avg
  FROM date_series ds LEFT JOIN daily ON daily.workout_date = ds.d ORDER BY ds.d;
$function$;
$capture$
);

SELECT private.capture_function(
  'public.get_wearable_trends(uuid, integer)',
  'invoker',
  $capture$CREATE OR REPLACE FUNCTION public.get_wearable_trends(p_user_id uuid, p_lookback_days integer DEFAULT 90)
 RETURNS TABLE(summary_date date, hrv_ms numeric, hrv_7d_avg numeric, resting_hr integer, resting_hr_7d_avg numeric, sleep_score numeric, sleep_score_7d_avg numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH date_series AS (
    SELECT generate_series((CURRENT_DATE - p_lookback_days)::timestamp, CURRENT_DATE::timestamp, '1 day'::interval)::date AS d
  ), daily AS (
    SELECT ws.summary_date, ws.hrv_ms, ws.resting_hr, ws.sleep_score
    FROM wearable_daily_summaries ws WHERE ws.user_id = p_user_id AND ws.summary_date >= (CURRENT_DATE - p_lookback_days)
    ORDER BY ws.summary_date, CASE ws.provider WHEN 'garmin' THEN 1 WHEN 'fitbit' THEN 2 ELSE 3 END
  ), deduplicated AS (SELECT DISTINCT ON (summary_date) summary_date, hrv_ms, resting_hr, sleep_score FROM daily)
  SELECT ds.d AS summary_date, dd.hrv_ms,
    ROUND(AVG(dd.hrv_ms) OVER (ORDER BY ds.d ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 1) AS hrv_7d_avg,
    dd.resting_hr,
    ROUND(AVG(dd.resting_hr) OVER (ORDER BY ds.d ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 1) AS resting_hr_7d_avg,
    dd.sleep_score,
    ROUND(AVG(dd.sleep_score) OVER (ORDER BY ds.d ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 1) AS sleep_score_7d_avg
  FROM date_series ds LEFT JOIN deduplicated dd ON dd.summary_date = ds.d ORDER BY ds.d;
$function$;
$capture$
);

SELECT private.capture_function(
  'public.get_workout_streak(uuid, text)',
  'invoker',
  $capture$CREATE OR REPLACE FUNCTION public.get_workout_streak(p_user_id uuid, p_profile_id text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH workout_days AS (
    SELECT DISTINCT (started_at AT TIME ZONE 'UTC')::date AS d
    FROM workout_sessions WHERE user_id = p_user_id AND (p_profile_id IS NULL OR local_profile_id = p_profile_id)
  ), with_gaps AS (
    SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::int AS grp FROM workout_days
  ), streaks AS (
    SELECT grp, COUNT(*)::int AS len, MAX(d) AS last_day FROM with_gaps GROUP BY grp
  )
  SELECT COALESCE((SELECT len FROM streaks WHERE last_day >= CURRENT_DATE - 1 ORDER BY last_day DESC LIMIT 1), 0);
$function$;
$capture$
);

SELECT private.capture_function(
  'public.log_subscription_event()',
  'definer',
  $capture$CREATE OR REPLACE FUNCTION public.log_subscription_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'DELETE' then
    insert into public.subscription_events (
      subscription_row_id, user_id, operation, tier, status, current_period_start, current_period_end,
      cancel_at_period_end, environment, last_event_id, paddle_customer_id, paddle_subscription_id, price_id,
      last_event_occurred_at, subscription_created_at, subscription_updated_at, row_snapshot
    )
    values (
      old.id, old.user_id, 'DELETE', old.tier, old.status, old.current_period_start, old.current_period_end,
      old.cancel_at_period_end, old.environment, old.last_event_id, old.paddle_customer_id, old.paddle_subscription_id, old.price_id,
      old.last_event_occurred_at, old.created_at, old.updated_at, to_jsonb(old)
    );
    return old;
  else
    insert into public.subscription_events (
      subscription_row_id, user_id, operation, tier, status, current_period_start, current_period_end,
      cancel_at_period_end, environment, last_event_id, paddle_customer_id, paddle_subscription_id, price_id,
      last_event_occurred_at, subscription_created_at, subscription_updated_at, row_snapshot
    )
    values (
      new.id, new.user_id, tg_op, new.tier, new.status, new.current_period_start, new.current_period_end,
      new.cancel_at_period_end, new.environment, new.last_event_id, new.paddle_customer_id, new.paddle_subscription_id, new.price_id,
      new.last_event_occurred_at, new.created_at, new.updated_at, to_jsonb(new)
    );
    return new;
  end if;
end;
$function$;
$capture$
);

SELECT private.capture_function(
  'public.refresh_community_benchmarks()',
  'definer',
  $capture$CREATE OR REPLACE FUNCTION public.refresh_community_benchmarks()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_exercise RECORD;
BEGIN
  INSERT INTO community_benchmarks (metric_type, metric_key, percentile_values, total_users, updated_at)
  SELECT 'total_volume', NULL,
    jsonb_build_object(
      'p25', (percentile_cont(0.25) WITHIN GROUP (ORDER BY user_volume)),
      'p50', (percentile_cont(0.50) WITHIN GROUP (ORDER BY user_volume)),
      'p75', (percentile_cont(0.75) WITHIN GROUP (ORDER BY user_volume)),
      'p90', (percentile_cont(0.90) WITHIN GROUP (ORDER BY user_volume)),
      'p95', (percentile_cont(0.95) WITHIN GROUP (ORDER BY user_volume))
    ), COUNT(*), now()
  FROM (SELECT user_id, SUM(total_volume) AS user_volume FROM workout_sessions GROUP BY user_id HAVING COUNT(*) >= 3) vol
  ON CONFLICT (metric_type, COALESCE(metric_key, ''))
  DO UPDATE SET percentile_values = EXCLUDED.percentile_values, total_users = EXCLUDED.total_users, updated_at = EXCLUDED.updated_at;

  INSERT INTO community_benchmarks (metric_type, metric_key, percentile_values, total_users, updated_at)
  SELECT 'weekly_frequency', NULL,
    jsonb_build_object(
      'p25', (percentile_cont(0.25) WITHIN GROUP (ORDER BY avg_per_week)),
      'p50', (percentile_cont(0.50) WITHIN GROUP (ORDER BY avg_per_week)),
      'p75', (percentile_cont(0.75) WITHIN GROUP (ORDER BY avg_per_week)),
      'p90', (percentile_cont(0.90) WITHIN GROUP (ORDER BY avg_per_week)),
      'p95', (percentile_cont(0.95) WITHIN GROUP (ORDER BY avg_per_week))
    ), COUNT(*), now()
  FROM (
    SELECT user_id, COUNT(*)::numeric / GREATEST(EXTRACT(EPOCH FROM (now() - MIN(started_at))) / 604800.0, 1) AS avg_per_week
    FROM workout_sessions GROUP BY user_id HAVING COUNT(*) >= 3
  ) freq
  ON CONFLICT (metric_type, COALESCE(metric_key, ''))
  DO UPDATE SET percentile_values = EXCLUDED.percentile_values, total_users = EXCLUDED.total_users, updated_at = EXCLUDED.updated_at;

  FOR v_exercise IN
    SELECT exercise_name FROM exercise_progress GROUP BY exercise_name HAVING COUNT(DISTINCT user_id) >= 5 ORDER BY COUNT(DISTINCT user_id) DESC LIMIT 50
  LOOP
    INSERT INTO community_benchmarks (metric_type, metric_key, percentile_values, total_users, updated_at)
    SELECT 'exercise_1rm', v_exercise.exercise_name,
      jsonb_build_object(
        'p25', (percentile_cont(0.25) WITHIN GROUP (ORDER BY best_1rm)),
        'p50', (percentile_cont(0.50) WITHIN GROUP (ORDER BY best_1rm)),
        'p75', (percentile_cont(0.75) WITHIN GROUP (ORDER BY best_1rm)),
        'p90', (percentile_cont(0.90) WITHIN GROUP (ORDER BY best_1rm)),
        'p95', (percentile_cont(0.95) WITHIN GROUP (ORDER BY best_1rm))
      ), COUNT(*), now()
    FROM (SELECT user_id, MAX(estimated_1rm_kg) AS best_1rm FROM exercise_progress WHERE exercise_name = v_exercise.exercise_name GROUP BY user_id) user_bests
    ON CONFLICT (metric_type, COALESCE(metric_key, ''))
    DO UPDATE SET percentile_values = EXCLUDED.percentile_values, total_users = EXCLUDED.total_users, updated_at = EXCLUDED.updated_at;
  END LOOP;

  INSERT INTO community_benchmarks (metric_type, metric_key, percentile_values, total_users, updated_at)
  SELECT 'best_streak', NULL,
    jsonb_build_object(
      'p25', (percentile_cont(0.25) WITHIN GROUP (ORDER BY longest_streak)),
      'p50', (percentile_cont(0.50) WITHIN GROUP (ORDER BY longest_streak)),
      'p75', (percentile_cont(0.75) WITHIN GROUP (ORDER BY longest_streak)),
      'p90', (percentile_cont(0.90) WITHIN GROUP (ORDER BY longest_streak)),
      'p95', (percentile_cont(0.95) WITHIN GROUP (ORDER BY longest_streak))
    ), COUNT(*), now()
  FROM gamification_stats WHERE longest_streak > 0
  ON CONFLICT (metric_type, COALESCE(metric_key, ''))
  DO UPDATE SET percentile_values = EXCLUDED.percentile_values, total_users = EXCLUDED.total_users, updated_at = EXCLUDED.updated_at;
END;
$function$;
$capture$
);

SELECT private.capture_function(
  'public.refresh_hot_scores()',
  'definer',
  $capture$CREATE OR REPLACE FUNCTION public.refresh_hot_scores()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE shared_routines
  SET hot_score = (vote_count + 0.5 * comment_count + 0.3 * COALESCE(save_count, 0))
    / POWER(EXTRACT(EPOCH FROM (now() - shared_at)) / 3600.0 + 2.0, 1.5)
  WHERE shared_at > now() - interval '90 days';

  UPDATE shared_cycles
  SET hot_score = (vote_count + 0.5 * comment_count + 0.3 * COALESCE(save_count, 0))
    / POWER(EXTRACT(EPOCH FROM (now() - shared_at)) / 3600.0 + 2.0, 1.5)
  WHERE shared_at > now() - interval '90 days';
END;
$function$;
$capture$
);

SELECT private.capture_function(
  'public.rls_auto_enable()',
  'definer',
  $capture$CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;
$capture$
);

SELECT private.capture_function(
  'public.update_pr_count_on_record()',
  'definer',
  $capture$CREATE OR REPLACE FUNCTION public.update_pr_count_on_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO gamification_stats (user_id, pr_count, updated_at) VALUES (NEW.user_id, 1, now())
  ON CONFLICT (user_id) DO UPDATE SET pr_count = gamification_stats.pr_count + 1, updated_at = now();
  RETURN NEW;
END; $function$;
$capture$
);

SELECT private.capture_function(
  'public.update_profile_stats_on_workout()',
  'definer',
  $capture$CREATE OR REPLACE FUNCTION public.update_profile_stats_on_workout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO gamification_stats (user_id, total_workouts, total_volume_kg, total_time_seconds, updated_at)
  VALUES (NEW.user_id, 1, COALESCE(NEW.total_volume, 0), COALESCE(NEW.duration_seconds, 0), now())
  ON CONFLICT (user_id) DO UPDATE SET
    total_workouts = gamification_stats.total_workouts + 1,
    total_volume_kg = gamification_stats.total_volume_kg + COALESCE(NEW.total_volume, 0),
    total_time_seconds = gamification_stats.total_time_seconds + COALESCE(NEW.duration_seconds, 0),
    updated_at = now();
  RETURN NEW;
END; $function$;
$capture$
);

-- ---------------------------------------------------------------------------
-- 3. Row triggers, exactly as captured (pg_get_triggerdef). Recreated only
--    when missing or different (function, timing/events, or disabled), so on
--    prod no ACCESS EXCLUSIVE lock is taken on the parent tables and an
--    existing trigger is never silently re-enabled. Parents are processed
--    in a fixed order (subscriptions, workout_sessions, personal_records),
--    each before the table its trigger writes.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT *
    FROM (VALUES
      (1, 'public.subscriptions', 'subscriptions_audit_trigger',
       'public.log_subscription_event()',
       -- ROW | INSERT | DELETE | UPDATE, AFTER
       (1 | 4 | 8 | 16)::smallint,
       'AFTER INSERT OR DELETE OR UPDATE'),
      (2, 'public.workout_sessions', 'trg_update_profile_stats_on_workout',
       'public.update_profile_stats_on_workout()',
       (1 | 4)::smallint,
       'AFTER INSERT'),
      (3, 'public.personal_records', 'trg_update_pr_count_on_record',
       'public.update_pr_count_on_record()',
       (1 | 4)::smallint,
       'AFTER INSERT')
    ) AS v(ord, tbl, tgname, fn, tgtype, timing)
    ORDER BY ord
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_trigger tg
      WHERE tg.tgrelid = t.tbl::regclass
        AND tg.tgname = t.tgname
        AND NOT tg.tgisinternal
        AND tg.tgfoid = t.fn::regprocedure
        AND tg.tgtype = t.tgtype
        AND tg.tgenabled = 'O'
        AND tg.tgnargs = 0
        AND tg.tgqual IS NULL
        AND tg.tgattr = ''::int2vector
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', t.tgname, t.tbl);
    EXECUTE format('CREATE TRIGGER %I %s ON %s FOR EACH ROW EXECUTE FUNCTION %s',
                   t.tgname, t.timing, t.tbl, t.fn);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. gamification_stats columns/types and the benchmarks index the captured
--    bodies depend on. Each ALTER runs only
--    when the catalog differs (on prod: never). gamification_stats comes
--    after its parents (section 3), matching the trigger lock order.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- update_pr_count_on_record / get_profile_stats use these (added by
  -- 20260420191901; re-asserted per the capture).
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.gamification_stats'::regclass AND attname = 'pr_count' AND NOT attisdropped
  ) THEN
    ALTER TABLE public.gamification_stats ADD COLUMN pr_count integer NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.gamification_stats'::regclass AND attname = 'best_streak' AND NOT attisdropped
  ) THEN
    ALTER TABLE public.gamification_stats ADD COLUMN best_streak integer NOT NULL DEFAULT 0;
  END IF;

  -- Prod has bigint for these two counters; the chain created integer.
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.gamification_stats'::regclass AND attname = 'total_workouts'
      AND atttypid = 'integer'::regtype
  ) THEN
    ALTER TABLE public.gamification_stats ALTER COLUMN total_workouts TYPE bigint;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.gamification_stats'::regclass AND attname = 'total_time_seconds'
      AND atttypid = 'integer'::regtype
  ) THEN
    ALTER TABLE public.gamification_stats ALTER COLUMN total_time_seconds TYPE bigint;
  END IF;

  -- refresh_community_benchmarks upserts ON CONFLICT on this expression
  -- index (created by 20260318150000; CREATE INDEX would take a SHARE lock
  -- even with IF NOT EXISTS, so check by name first).
  IF to_regclass('public.idx_community_benchmarks_metric') IS NULL THEN
    CREATE UNIQUE INDEX idx_community_benchmarks_metric
      ON public.community_benchmarks (metric_type, COALESCE(metric_key, ''));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Event trigger ensure_rls: auto-enables RLS on tables created in public.
--    Created only if missing. Environments where postgres may not create
--    event triggers (some branch/CI stacks) get a NOTICE instead of a failed
--    apply, the same pattern 20260823120000 uses for realtime.messages.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls') THEN
    RETURN;
  END IF;

  BEGIN
    EXECUTE $et$
      CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
        WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
        EXECUTE FUNCTION public.rls_auto_enable()
    $et$;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'skip CREATE EVENT TRIGGER ensure_rls: insufficient privilege (SQLSTATE 42501)';
  END;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. pg_cron jobs, as captured. A job is scheduled only when no job of that
--    name exists, and altered in place (same jobid, active flag and
--    run history kept) only when its schedule or command differs. Jobs run
--    as postgres (the function owner), so the service_role-only grants
--    above do not affect them. Skipped where pg_cron is not installed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  j record;
  v_jobid bigint;
  v_schedule text;
  v_command text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skip scheduling refresh jobs';
    RETURN;
  END IF;

  FOR j IN
    SELECT *
    FROM (VALUES
      ('refresh-community-benchmarks', '0 */6 * * *', 'SELECT public.refresh_community_benchmarks()'),
      ('refresh-hot-scores', '*/15 * * * *', 'SELECT public.refresh_hot_scores()')
    ) AS v(jobname, schedule, command)
  LOOP
    EXECUTE 'SELECT jobid, schedule, command FROM cron.job WHERE jobname = $1 ORDER BY jobid LIMIT 1'
      INTO v_jobid, v_schedule, v_command
      USING j.jobname;

    IF v_jobid IS NULL THEN
      PERFORM cron.schedule(j.jobname, j.schedule, j.command);
    ELSIF v_schedule IS DISTINCT FROM j.schedule OR v_command IS DISTINCT FROM j.command THEN
      PERFORM cron.alter_job(v_jobid, schedule := j.schedule, command := j.command);
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 7. public_profiles: the captured body is identical to 20260517173000.
--    Re-issued (security_barrier, NOT security_invoker; see 20260823120000)
--    only if the definition or options drifted, so prod takes no lock on it.
--    CREATE OR REPLACE VIEW keeps the grants PR 1 set.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.public_profiles') IS NULL
     OR regexp_replace(
          replace(pg_get_viewdef('public.public_profiles'::regclass), 'public.', ''),
          '\s+', ' ', 'g'
        ) IS DISTINCT FROM
        ' SELECT id, user_id, display_name, avatar_url FROM profiles WHERE (profile_visible = true);'
     OR NOT coalesce(
          (SELECT reloptions FROM pg_class WHERE oid = 'public.public_profiles'::regclass)
            = ARRAY['security_barrier=true'],
          false
        )
  THEN
    CREATE OR REPLACE VIEW public.public_profiles
      WITH (security_barrier = true)
    AS
    SELECT
      id,
      user_id,
      display_name,
      avatar_url
    FROM public.profiles
    WHERE profile_visible = true;
    RAISE NOTICE 'capture: public_profiles re-issued (definition or options drifted)';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 8. Self-check. Hard-fails if any captured SECURITY DEFINER function is
--    executable by anon/authenticated (whoever owns it). NOTICEs an invoker
--    helper still executable by anon and a function the ownership guard
--    left as-is.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_definers CONSTANT text[] := ARRAY[
    'public.get_percentile_rank(uuid, text, text)',
    'public.get_profile_stats(uuid)',
    'public.log_subscription_event()',
    'public.refresh_community_benchmarks()',
    'public.refresh_hot_scores()',
    'public.rls_auto_enable()',
    'public.update_pr_count_on_record()',
    'public.update_profile_stats_on_workout()'
  ];
  v_invokers CONSTANT text[] := ARRAY[
    'public.detect_plateaus(uuid, integer, numeric, text)',
    'public.get_acwr(uuid, integer, integer)',
    'public.get_exercise_trend(uuid, text, integer, text)',
    'public.get_goal_progress_cached(uuid)',
    'public.get_muscle_distribution(uuid, text)',
    'public.get_volume_comparison(uuid, integer, text)',
    'public.get_volume_rolling_avg(uuid, integer, integer, text)',
    'public.get_wearable_trends(uuid, integer)',
    'public.get_workout_streak(uuid, text)'
  ];
  v_sig text;
  v_owner oid;
  v_offenders text;
BEGIN
  FOREACH v_sig IN ARRAY v_definers || v_invokers LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION 'capture: % is missing after capture', v_sig;
    END IF;
    SELECT p.proowner INTO v_owner FROM pg_proc p WHERE p.oid = to_regprocedure(v_sig);
    IF v_owner IS DISTINCT FROM 'postgres'::regrole::oid THEN
      RAISE NOTICE 'capture: % left as-is (owned by %)', v_sig, pg_get_userbyid(v_owner);
    END IF;
  END LOOP;

  PERFORM private.capture_assert_definers_locked(v_definers);

  SELECT string_agg(sig, ', ' ORDER BY sig)
  INTO v_offenders
  FROM unnest(v_invokers) AS sig
  WHERE has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE');

  -- Invokers are RLS-bound, so a leftover anon grant (only possible for a
  -- function the ownership guard skipped) is reported, not fatal.
  IF v_offenders IS NOT NULL THEN
    RAISE NOTICE 'capture: invoker helpers still executable by anon: %', v_offenders;
  END IF;
END
$$;

COMMIT;
