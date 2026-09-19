-- Dashboard capture (20260920000200_capture_dashboard_functions_and_cron.sql).
--
-- The 17 functions, 3 row triggers, the ensure_rls event trigger and the
-- two pg_cron jobs below used to exist only in prod (created from the
-- dashboard). This file pins that a clean apply now produces them, with
-- search_path pinned, the 8 SECURITY DEFINER functions service_role-only,
-- the 9 analytics helpers SECURITY INVOKER (RLS applies), and the triggers
-- actually firing.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:dashboard-capture-catalog');

CREATE TEMP TABLE captured_functions (sig text PRIMARY KEY, definer boolean NOT NULL)
ON COMMIT DROP;
INSERT INTO captured_functions (sig, definer) VALUES
    ('public.detect_plateaus(uuid, integer, numeric, text)', false),
    ('public.get_acwr(uuid, integer, integer)', false),
    ('public.get_exercise_trend(uuid, text, integer, text)', false),
    ('public.get_goal_progress_cached(uuid)', false),
    ('public.get_muscle_distribution(uuid, text)', false),
    ('public.get_volume_comparison(uuid, integer, text)', false),
    ('public.get_volume_rolling_avg(uuid, integer, integer, text)', false),
    ('public.get_wearable_trends(uuid, integer)', false),
    ('public.get_workout_streak(uuid, text)', false),
    ('public.get_percentile_rank(uuid, text, text)', true),
    ('public.get_profile_stats(uuid)', true),
    ('public.log_subscription_event()', true),
    ('public.refresh_community_benchmarks()', true),
    ('public.refresh_hot_scores()', true),
    ('public.rls_auto_enable()', true),
    ('public.update_pr_count_on_record()', true),
    ('public.update_profile_stats_on_workout()', true);
GRANT SELECT ON captured_functions TO authenticated, anon, service_role;

SELECT is_empty(
    $sql$ SELECT sig FROM captured_functions WHERE to_regprocedure(sig) IS NULL $sql$,
    'all 17 captured functions exist'
);

SELECT is_empty(
    $sql$
        SELECT c.sig
        FROM captured_functions c
        JOIN pg_proc p ON p.oid = to_regprocedure(c.sig)
        WHERE NOT EXISTS (
            SELECT 1
            FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS cfg(setting)
            WHERE cfg.setting IN ('search_path=public, pg_temp', 'search_path=pg_catalog, pg_temp')
        )
    $sql$,
    'every captured function pins search_path with pg_temp last'
);

SELECT set_eq(
    $sql$
        SELECT c.sig, p.prosecdef
        FROM captured_functions c
        JOIN pg_proc p ON p.oid = to_regprocedure(c.sig)
    $sql$,
    $sql$ SELECT sig, definer FROM captured_functions $sql$,
    'the 9 analytics helpers are SECURITY INVOKER and the 8 others SECURITY DEFINER'
);

SELECT is_empty(
    $sql$
        SELECT c.sig
        FROM captured_functions c
        WHERE c.definer
          AND (
              has_function_privilege('anon', to_regprocedure(c.sig), 'EXECUTE')
              OR has_function_privilege('authenticated', to_regprocedure(c.sig), 'EXECUTE')
              OR NOT has_function_privilege('service_role', to_regprocedure(c.sig), 'EXECUTE')
          )
    $sql$,
    'captured SECURITY DEFINER functions are service_role-only'
);

SELECT is_empty(
    $sql$
        SELECT c.sig
        FROM captured_functions c
        JOIN pg_proc p ON p.oid = to_regprocedure(c.sig)
        WHERE pg_get_userbyid(p.proowner) <> 'postgres'
    $sql$,
    'captured functions are owned by postgres'
);

SELECT has_trigger('public', 'subscriptions', 'subscriptions_audit_trigger',
    'subscriptions has subscriptions_audit_trigger');
SELECT has_trigger('public', 'workout_sessions', 'trg_update_profile_stats_on_workout',
    'workout_sessions has trg_update_profile_stats_on_workout');
SELECT has_trigger('public', 'personal_records', 'trg_update_pr_count_on_record',
    'personal_records has trg_update_pr_count_on_record');

SELECT set_eq(
    $sql$
        SELECT pg_get_triggerdef(t.oid)
        FROM pg_trigger t
        WHERE t.tgname IN (
            'subscriptions_audit_trigger',
            'trg_update_profile_stats_on_workout',
            'trg_update_pr_count_on_record'
        )
    $sql$,
    $sql$
        VALUES
            ('CREATE TRIGGER subscriptions_audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION log_subscription_event()'::text),
            ('CREATE TRIGGER trg_update_profile_stats_on_workout AFTER INSERT ON public.workout_sessions FOR EACH ROW EXECUTE FUNCTION update_profile_stats_on_workout()'),
            ('CREATE TRIGGER trg_update_pr_count_on_record AFTER INSERT ON public.personal_records FOR EACH ROW EXECUTE FUNCTION update_pr_count_on_record()')
    $sql$,
    'trigger definitions match the prod capture byte for byte'
);

SELECT has_table('public', 'subscription_events', 'subscription_events exists');
SELECT is(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.subscription_events'::regclass),
    true,
    'subscription_events has RLS enabled'
);
SELECT is_empty(
    $sql$ SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'subscription_events' $sql$,
    'subscription_events has no policies (service-role only)'
);

SELECT has_table('public', 'goal_snapshots', 'goal_snapshots exists');
SELECT has_table('public', 'wearable_daily_summaries', 'wearable_daily_summaries exists');
SELECT has_column('public', 'user_goals', 'predicted_completion_date',
    'user_goals.predicted_completion_date exists');
SELECT has_column('public', 'gamification_stats', 'pr_count', 'gamification_stats.pr_count exists');
SELECT has_column('public', 'gamification_stats', 'best_streak', 'gamification_stats.best_streak exists');
SELECT has_index('public', 'community_benchmarks', 'idx_community_benchmarks_metric',
    'community_benchmarks has the (metric_type, COALESCE(metric_key, '''')) upsert index');

SELECT has_column('public', 'routines', 'created_at', 'routines.created_at exists (prod drift, PR 16)');
SELECT col_type_is('public', 'routines', 'created_at', 'timestamp with time zone',
    'routines.created_at is timestamptz');
SELECT col_default_is('public', 'routines', 'created_at', 'now()',
    'routines.created_at defaults to now()');

SELECT ok(
    (SELECT coalesce('security_barrier=true' = ANY (reloptions), false)
            AND NOT coalesce('security_invoker=true' = ANY (reloptions), false)
     FROM pg_class WHERE oid = 'public.public_profiles'::regclass),
    'public_profiles is security_barrier and not security_invoker'
);

-- Event trigger: postgres may create it locally; environments without the
-- privilege skip it with a NOTICE, so only assert its shape when present.
SELECT ok(
    NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls')
    OR EXISTS (
        SELECT 1 FROM pg_event_trigger
        WHERE evtname = 'ensure_rls'
          AND evtevent = 'ddl_command_end'
          AND evtfoid = 'public.rls_auto_enable()'::regprocedure
          AND evttags @> ARRAY['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']
          AND cardinality(evttags) = 3
    ),
    'ensure_rls (when present) runs rls_auto_enable on ddl_command_end for the captured tags'
);

-- pg_cron is not installed locally/CI; when it is, both jobs match prod.
CREATE OR REPLACE FUNCTION pg_temp.cron_jobs_match() RETURNS boolean
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_count integer;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN true;
    END IF;
    EXECUTE $q$
        SELECT count(*) FROM cron.job
        WHERE (jobname, schedule, command) IN (
            ('refresh-community-benchmarks', '0 */6 * * *', 'SELECT public.refresh_community_benchmarks()'),
            ('refresh-hot-scores', '*/15 * * * *', 'SELECT public.refresh_hot_scores()')
        )
    $q$ INTO v_count;
    RETURN v_count = 2;
END
$fn$;

SELECT ok(pg_temp.cron_jobs_match(), 'pg_cron jobs (when pg_cron is installed) match the prod capture');

SELECT diag('database:dashboard-capture-behaviour');

CREATE OR REPLACE FUNCTION pg_temp.assert_exception(
    statement_sql text,
    expected_sqlstate text,
    expected_message text,
    assertion_description text
) RETURNS text
LANGUAGE plpgsql
AS $assertion$
BEGIN
    EXECUTE statement_sql;
    RETURN extensions.ok(false, assertion_description);
EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE IS DISTINCT FROM expected_sqlstate THEN
        RETURN extensions.is(SQLSTATE, expected_sqlstate, assertion_description || ' (got: ' || SQLERRM || ')');
    END IF;
    RETURN extensions.ok(
        SQLERRM LIKE expected_message,
        assertion_description || ' (got: ' || SQLERRM || ')'
    );
END
$assertion$;

INSERT INTO auth.users (id, email)
VALUES
    ('c3c3c3c3-0000-4000-8000-000000000003'::uuid, 'capture-c@example.test'),
    ('d4d4d4d4-0000-4000-8000-000000000004'::uuid, 'capture-d@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

DELETE FROM public.gamification_stats
WHERE user_id IN (
    'c3c3c3c3-0000-4000-8000-000000000003'::uuid,
    'd4d4d4d4-0000-4000-8000-000000000004'::uuid
);

-- trg_update_profile_stats_on_workout
INSERT INTO public.workout_sessions (user_id, name, total_volume, duration_seconds, started_at)
VALUES ('c3c3c3c3-0000-4000-8000-000000000003'::uuid, 'capture session 1', 100, 600, now());

SELECT results_eq(
    $sql$
        SELECT total_workouts::bigint, total_volume_kg, total_time_seconds::bigint
        FROM public.gamification_stats
        WHERE user_id = 'c3c3c3c3-0000-4000-8000-000000000003'::uuid
    $sql$,
    $values$ VALUES (1::bigint, 100::numeric, 600::bigint) $values$,
    'inserting a workout_sessions row fires trg_update_profile_stats_on_workout (creates the stats row)'
);

INSERT INTO public.workout_sessions (user_id, name, total_volume, duration_seconds, started_at)
VALUES ('c3c3c3c3-0000-4000-8000-000000000003'::uuid, 'capture session 2', 50, 300, now());

SELECT results_eq(
    $sql$
        SELECT total_workouts::bigint, total_volume_kg, total_time_seconds::bigint
        FROM public.gamification_stats
        WHERE user_id = 'c3c3c3c3-0000-4000-8000-000000000003'::uuid
    $sql$,
    $values$ VALUES (2::bigint, 150::numeric, 900::bigint) $values$,
    'a second workout increments the existing stats row'
);

-- trg_update_pr_count_on_record
INSERT INTO public.personal_records (user_id, exercise_name, value)
VALUES ('c3c3c3c3-0000-4000-8000-000000000003'::uuid, 'Capture Press', 80);

SELECT is(
    (SELECT pr_count FROM public.gamification_stats
     WHERE user_id = 'c3c3c3c3-0000-4000-8000-000000000003'::uuid),
    1,
    'inserting a personal_records row fires trg_update_pr_count_on_record'
);

-- subscriptions_audit_trigger
INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES ('d4d4d4d4-0000-4000-8000-000000000004'::uuid, 'EMBER', 'active', now() + INTERVAL '30 days')
ON CONFLICT (user_id) DO UPDATE SET tier = EXCLUDED.tier, status = EXCLUDED.status;

UPDATE public.subscriptions SET status = 'canceled'
WHERE user_id = 'd4d4d4d4-0000-4000-8000-000000000004'::uuid;

DELETE FROM public.subscriptions
WHERE user_id = 'd4d4d4d4-0000-4000-8000-000000000004'::uuid;

SELECT results_eq(
    $sql$
        SELECT operation, tier, status, (row_snapshot ->> 'user_id')::uuid
        FROM public.subscription_events
        WHERE user_id = 'd4d4d4d4-0000-4000-8000-000000000004'::uuid
        ORDER BY event_recorded_at, CASE operation WHEN 'INSERT' THEN 1 WHEN 'UPDATE' THEN 2 ELSE 3 END
    $sql$,
    $values$
        VALUES
            ('INSERT'::text, 'EMBER'::text, 'active'::text, 'd4d4d4d4-0000-4000-8000-000000000004'::uuid),
            ('UPDATE', 'EMBER', 'canceled', 'd4d4d4d4-0000-4000-8000-000000000004'::uuid),
            ('DELETE', 'EMBER', 'canceled', 'd4d4d4d4-0000-4000-8000-000000000004'::uuid)
    $values$,
    'subscriptions_audit_trigger logs INSERT, UPDATE and DELETE into subscription_events'
);

-- The cron targets run against the migrated schema.
INSERT INTO public.routines (id, user_id, name)
VALUES ('c3c3c3c3-1111-4000-8000-000000000003'::uuid, 'c3c3c3c3-0000-4000-8000-000000000003'::uuid, 'capture routine')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.shared_routines (id, user_id, routine_id, name, vote_count, shared_at, hot_score)
VALUES (
    'c3c3c3c3-2222-4000-8000-000000000003'::uuid,
    'c3c3c3c3-0000-4000-8000-000000000003'::uuid,
    'c3c3c3c3-1111-4000-8000-000000000003'::uuid,
    'capture shared routine',
    4,
    now() - INTERVAL '1 hour',
    0
)
ON CONFLICT (id) DO NOTHING;

SELECT lives_ok($sql$ SELECT public.refresh_hot_scores() $sql$, 'refresh_hot_scores runs');

SELECT ok(
    (SELECT hot_score > 0 FROM public.shared_routines
     WHERE id = 'c3c3c3c3-2222-4000-8000-000000000003'::uuid),
    'refresh_hot_scores recomputes hot_score'
);

SELECT lives_ok($sql$ SELECT public.refresh_community_benchmarks() $sql$, 'refresh_community_benchmarks runs');
SELECT lives_ok($sql$ SELECT public.refresh_community_benchmarks() $sql$,
    'refresh_community_benchmarks re-runs (upserts on the metric index)');

SELECT set_has(
    $sql$ SELECT metric_type FROM public.community_benchmarks WHERE metric_key IS NULL $sql$,
    $sql$ VALUES ('total_volume'::text), ('weekly_frequency'), ('best_streak') $sql$,
    'refresh_community_benchmarks writes the global benchmark rows'
);

-- get_profile_stats: body guard, as the owner with a JWT.
SELECT set_config('request.jwt.claims',
    '{"sub":"c3c3c3c3-0000-4000-8000-000000000003","role":"authenticated"}', true);

SELECT results_eq(
    $sql$ SELECT total_workouts, pr_count FROM public.get_profile_stats('c3c3c3c3-0000-4000-8000-000000000003'::uuid) $sql$,
    $values$ VALUES (2, 1) $values$,
    'get_profile_stats returns the caller''s own stats'
);

SELECT pg_temp.assert_exception(
    $sql$ SELECT * FROM public.get_profile_stats('d4d4d4d4-0000-4000-8000-000000000004'::uuid) $sql$,
    'P0001',
    'Access denied: can only read own profile stats',
    'get_profile_stats rejects another user''s id'
);

-- Revoked definers, as the browser roles.
SET LOCAL ROLE authenticated;

SELECT pg_temp.assert_exception(
    $sql$ SELECT * FROM public.get_percentile_rank('d4d4d4d4-0000-4000-8000-000000000004'::uuid, 'total_volume') $sql$,
    '42501',
    'permission denied for function%',
    'authenticated cannot execute get_percentile_rank'
);

SELECT pg_temp.assert_exception(
    $sql$ SELECT public.refresh_hot_scores() $sql$,
    '42501',
    'permission denied for function%',
    'authenticated cannot execute refresh_hot_scores'
);

-- Invoker helpers run under RLS: C sees own sessions, not D's.
SELECT is(
    public.get_workout_streak('c3c3c3c3-0000-4000-8000-000000000003'::uuid),
    1,
    'get_workout_streak (invoker) sees the caller''s own sessions'
);

RESET ROLE;
INSERT INTO public.workout_sessions (user_id, name, total_volume, duration_seconds, started_at)
VALUES ('d4d4d4d4-0000-4000-8000-000000000004'::uuid, 'capture other user', 10, 60, now());

SELECT is(
    public.get_workout_streak('d4d4d4d4-0000-4000-8000-000000000004'::uuid),
    1,
    'as the owner, D has a one-day streak'
);

SET LOCAL ROLE authenticated;

SELECT is(
    public.get_workout_streak('d4d4d4d4-0000-4000-8000-000000000004'::uuid),
    0,
    'get_workout_streak (invoker) cannot see another user''s sessions through RLS'
);

SELECT is_empty(
    $sql$ SELECT * FROM public.get_volume_comparison('d4d4d4d4-0000-4000-8000-000000000004'::uuid) $sql$,
    'get_volume_comparison (invoker) returns nothing for another user'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT pg_temp.assert_exception(
    $sql$ SELECT * FROM public.get_profile_stats('c3c3c3c3-0000-4000-8000-000000000003'::uuid) $sql$,
    '42501',
    'permission denied for function%',
    'anon cannot execute get_profile_stats'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT lives_ok(
    $sql$ SELECT * FROM public.get_percentile_rank('c3c3c3c3-0000-4000-8000-000000000003'::uuid, 'total_volume') $sql$,
    'service_role can execute get_percentile_rank'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- ensure_rls: a new public table gets RLS (only when the event trigger exists).
CREATE TABLE public.capture_rls_probe (id integer);

SELECT ok(
    NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls')
    OR (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.capture_rls_probe'::regclass),
    'ensure_rls (when present) enables RLS on a new public table'
);

SELECT * FROM finish();

ROLLBACK;
