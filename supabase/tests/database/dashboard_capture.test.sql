-- Dashboard capture (20260920000200_capture_dashboard_functions_and_cron.sql).
--
-- The 17 functions, 3 row triggers, the ensure_rls event trigger and the
-- two pg_cron jobs below used to exist only in prod (created from the
-- dashboard). This file pins that a clean apply now produces them, with
-- search_path pinned, the 8 SECURITY DEFINER functions service_role-only,
-- the 9 analytics helpers SECURITY INVOKER (RLS applies; no anon EXECUTE),
-- the triggers actually firing, the six prod-only tables shaped as in prod
-- (columns, constraints, indexes, policies, grants), gamification_stats
-- counters bigint as in prod, and the ownership guard's skip path.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:dashboard-capture-catalog');

CREATE TEMP TABLE captured_functions (
    sig text PRIMARY KEY,
    definer boolean NOT NULL,
    search_path text NOT NULL
) ON COMMIT DROP;
INSERT INTO captured_functions (sig, definer, search_path) VALUES
    ('public.detect_plateaus(uuid, integer, numeric, text)', false, 'public, pg_temp'),
    ('public.get_acwr(uuid, integer, integer)', false, 'public, pg_temp'),
    ('public.get_exercise_trend(uuid, text, integer, text)', false, 'public, pg_temp'),
    ('public.get_goal_progress_cached(uuid)', false, 'public, pg_temp'),
    ('public.get_muscle_distribution(uuid, text)', false, 'public, pg_temp'),
    ('public.get_volume_comparison(uuid, integer, text)', false, 'public, pg_temp'),
    ('public.get_volume_rolling_avg(uuid, integer, integer, text)', false, 'public, pg_temp'),
    ('public.get_wearable_trends(uuid, integer)', false, 'public, pg_temp'),
    ('public.get_workout_streak(uuid, text)', false, 'public, pg_temp'),
    ('public.get_percentile_rank(uuid, text, text)', true, 'public, pg_temp'),
    ('public.get_profile_stats(uuid)', true, 'public, pg_temp'),
    ('public.log_subscription_event()', true, 'public, pg_temp'),
    ('public.refresh_community_benchmarks()', true, 'public, pg_temp'),
    ('public.refresh_hot_scores()', true, 'public, pg_temp'),
    ('public.rls_auto_enable()', true, 'pg_catalog, pg_temp'),
    ('public.update_pr_count_on_record()', true, 'public, pg_temp'),
    ('public.update_profile_stats_on_workout()', true, 'public, pg_temp');
GRANT SELECT ON captured_functions TO authenticated, anon, service_role;

SELECT is_empty(
    $sql$ SELECT sig FROM captured_functions WHERE to_regprocedure(sig) IS NULL $sql$,
    'all 17 captured functions exist'
);

SELECT set_eq(
    $sql$
        SELECT c.sig, p.proconfig
        FROM captured_functions c
        JOIN pg_proc p ON p.oid = to_regprocedure(c.sig)
    $sql$,
    $sql$ SELECT sig, ARRAY['search_path=' || search_path] FROM captured_functions $sql$,
    'each captured function pins exactly its expected search_path (pg_temp last)'
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
        WHERE NOT c.definer
          AND (
              has_function_privilege('anon', to_regprocedure(c.sig), 'EXECUTE')
              OR NOT has_function_privilege('authenticated', to_regprocedure(c.sig), 'EXECUTE')
              OR NOT has_function_privilege('service_role', to_regprocedure(c.sig), 'EXECUTE')
          )
    $sql$,
    'invoker analytics helpers: no anon/PUBLIC EXECUTE; authenticated and service_role keep it'
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

SELECT ok(
    position('gs.total_workouts::integer' IN
             (SELECT prosrc FROM pg_proc WHERE oid = 'public.get_profile_stats(uuid)'::regprocedure)) > 0,
    'get_profile_stats casts the bigint total_workouts to its declared integer result'
);

SELECT has_trigger('public', 'subscriptions', 'subscriptions_audit_trigger',
    'subscriptions has subscriptions_audit_trigger');
SELECT has_trigger('public', 'workout_sessions', 'trg_update_profile_stats_on_workout',
    'workout_sessions has trg_update_profile_stats_on_workout');
SELECT has_trigger('public', 'personal_records', 'trg_update_pr_count_on_record',
    'personal_records has trg_update_pr_count_on_record');

-- The two add-only counter triggers captured here are dropped again by
-- 20260920002500 (server-derived gamification counters). Their functions stay
-- (asserted above); only the triggers go.
SELECT hasnt_trigger('public', 'workout_sessions', 'trg_update_profile_stats_on_workout',
    'trg_update_profile_stats_on_workout is dropped by 20260920002500');
SELECT hasnt_trigger('public', 'personal_records', 'trg_update_pr_count_on_record',
    'trg_update_pr_count_on_record is dropped by 20260920002500');

SELECT set_eq(
    $sql$
        SELECT pg_get_triggerdef(t.oid), t.tgenabled::text
        FROM pg_trigger t
        WHERE t.tgname IN (
            'subscriptions_audit_trigger',
            'trg_update_profile_stats_on_workout',
            'trg_update_pr_count_on_record'
        )
    $sql$,
    $sql$
        VALUES
            ('CREATE TRIGGER subscriptions_audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION log_subscription_event()'::text, 'O'::text),
            ('CREATE TRIGGER trg_update_profile_stats_on_workout AFTER INSERT ON public.workout_sessions FOR EACH ROW EXECUTE FUNCTION update_profile_stats_on_workout()', 'O'),
            ('CREATE TRIGGER trg_update_pr_count_on_record AFTER INSERT ON public.personal_records FOR EACH ROW EXECUTE FUNCTION update_pr_count_on_record()', 'O')
            ('CREATE TRIGGER subscriptions_audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION log_subscription_event()'::text, 'O'::text)
    $sql$,
    'trigger definitions match the prod capture byte for byte and are enabled'
);

-- Prod-only tables: RLS, policies, constraints and indexes as captured.
SELECT has_table('public', 'subscription_events', 'subscription_events exists');
SELECT has_table('public', 'paddle_webhook_events', 'paddle_webhook_events exists');
SELECT has_table('public', 'goal_snapshots', 'goal_snapshots exists');
SELECT has_table('public', 'wearable_daily_summaries', 'wearable_daily_summaries exists');
SELECT has_table('public', 'overload_suggestions', 'overload_suggestions exists');
SELECT has_table('public', 'telemetry_analysis', 'telemetry_analysis exists');

SELECT is_empty(
    $sql$
        SELECT relname
        FROM pg_class
        WHERE oid IN (
            'public.subscription_events'::regclass,
            'public.paddle_webhook_events'::regclass,
            'public.goal_snapshots'::regclass,
            'public.wearable_daily_summaries'::regclass,
            'public.overload_suggestions'::regclass,
            'public.telemetry_analysis'::regclass
        )
          AND NOT relrowsecurity
    $sql$,
    'all six prod-only tables have RLS enabled'
);

SELECT set_eq(
    $sql$
        SELECT tablename::text, policyname::text, cmd::text, roles::text[],
               coalesce(qual, '') AS qual, coalesce(with_check, '') AS with_check
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('subscription_events', 'paddle_webhook_events',
                            'goal_snapshots', 'wearable_daily_summaries',
                            'overload_suggestions', 'telemetry_analysis')
    $sql$,
    $sql$
        VALUES
            ('goal_snapshots'::text, 'Users can insert own goal snapshots'::text, 'INSERT'::text,
             ARRAY['public']::text[], ''::text, '(auth.uid() = user_id)'::text),
            ('goal_snapshots', 'Users can view own goal snapshots', 'SELECT',
             ARRAY['public'], '(auth.uid() = user_id)', ''),
            ('wearable_daily_summaries', 'Users can insert own wearable summaries', 'INSERT',
             ARRAY['public'], '', '(auth.uid() = user_id)'),
            ('wearable_daily_summaries', 'Users can view own wearable summaries', 'SELECT',
             ARRAY['public'], '(auth.uid() = user_id)', ''),
            ('overload_suggestions', 'Users can view own overload suggestions', 'SELECT',
             ARRAY['public'], '(auth.uid() = user_id)', ''),
            ('telemetry_analysis', 'Users can view own telemetry analysis', 'SELECT',
             ARRAY['public'], '(auth.uid() = user_id)', '')
    $sql$,
    'prod-only table policies match prod (subscription_events / paddle_webhook_events have none)'
);

SELECT set_has(
    $sql$
        SELECT conrelid::regclass::text, conname::text, pg_get_constraintdef(oid)
        FROM pg_constraint
        WHERE conrelid IN (
            'public.subscription_events'::regclass,
            'public.goal_snapshots'::regclass,
            'public.wearable_daily_summaries'::regclass,
            'public.overload_suggestions'::regclass,
            'public.telemetry_analysis'::regclass
        )
    $sql$,
    $sql$
        VALUES
            ('subscription_events'::text, 'subscription_events_operation_check'::text,
             'CHECK ((operation = ANY (ARRAY[''INSERT''::text, ''UPDATE''::text, ''DELETE''::text])))'::text),
            -- 'IGNORED' was added by 20260920004400 (PR 44): apply_subscription_event
            -- records an event from an untracked subscription that it refused to
            -- apply. The other three are prod's original audit-trigger operations.
            ('subscription_events'::text, 'subscription_events_operation_check'::text,
             'CHECK ((operation = ANY (ARRAY[''INSERT''::text, ''UPDATE''::text, ''DELETE''::text, ''IGNORED''::text])))'::text),
            ('subscription_events'::text, 'subscription_events_operation_check'::text,
             'CHECK ((operation = ANY (ARRAY[''INSERT''::text, ''UPDATE''::text, ''DELETE''::text, ''IGNORED''::text])))'::text),
            ('goal_snapshots', 'goal_snapshots_goal_id_fkey',
             'FOREIGN KEY (goal_id) REFERENCES user_goals(id) ON DELETE CASCADE'),
            ('wearable_daily_summaries', 'wearable_daily_summaries_user_id_summary_date_provider_key',
             'UNIQUE (user_id, summary_date, provider)'),
            ('overload_suggestions', 'overload_suggestions_suggestion_type_check',
             'CHECK ((suggestion_type = ANY (ARRAY[''weight_increase''::text, ''rep_increase''::text, ''variation''::text, ''deload''::text])))'),
            ('overload_suggestions', 'overload_suggestions_confidence_check',
             'CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))'),
            ('overload_suggestions', 'overload_suggestions_exercise_id_fkey',
             'FOREIGN KEY (exercise_id) REFERENCES exercise_catalog(id)'),
            ('telemetry_analysis', 'telemetry_analysis_analysis_type_check',
             'CHECK ((analysis_type = ANY (ARRAY[''rfd''::text, ''sticking_point''::text, ''force_velocity_profile''::text, ''form_degradation''::text])))')
    $sql$,
    'prod-only table constraints match prod'
);

SELECT set_has(
    $sql$ SELECT indexname::text FROM pg_indexes WHERE schemaname = 'public' $sql$,
    $sql$
        VALUES
            ('subscription_events_last_event_id_idx'::text),
            ('subscription_events_paddle_sub_id_idx'),
            ('subscription_events_user_id_idx'),
            ('paddle_webhook_events_event_id_uniq'),
            ('paddle_webhook_events_sub_id_idx'),
            ('paddle_webhook_events_type_idx'),
            ('paddle_webhook_events_user_id_idx'),
            ('idx_goal_snapshots_user'),
            ('idx_wearable_summaries_user_date'),
            ('idx_overload_suggestions_exercise_id'),
            ('idx_overload_suggestions_user'),
            ('idx_telemetry_analysis_set'),
            ('idx_telemetry_analysis_user'),
            ('idx_community_benchmarks_metric')
    $sql$,
    'prod-only table indexes (and the benchmarks upsert index) exist'
);

SELECT col_not_null('public', 'subscription_events', 'row_snapshot', 'subscription_events.row_snapshot is NOT NULL');
SELECT col_is_null('public', 'subscription_events', 'user_id', 'subscription_events.user_id is nullable (prod)');
SELECT col_not_null('public', 'paddle_webhook_events', 'payload', 'paddle_webhook_events.payload is NOT NULL');
SELECT col_default_is('public', 'overload_suggestions', 'expires_at', '(now() + ''7 days''::interval)',
    'overload_suggestions.expires_at defaults to now() + 7 days');
SELECT is_empty(
    $sql$
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.telemetry_analysis'::regclass
          AND contype = 'f'
          AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'public.telemetry_analysis'::regclass AND attname = 'set_id')]
    $sql$,
    'telemetry_analysis.set_id has no FK (prod)'
);

SELECT is_empty(
    $sql$
        SELECT t, r
        FROM unnest(ARRAY['public.subscription_events', 'public.paddle_webhook_events']) AS t
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r
        WHERE has_table_privilege(r, t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    $sql$,
    'anon/authenticated hold no table privileges on subscription_events / paddle_webhook_events'
);

SELECT ok(
    has_table_privilege('service_role', 'public.subscription_events', 'SELECT, INSERT, UPDATE, DELETE')
    AND has_table_privilege('service_role', 'public.paddle_webhook_events', 'SELECT, INSERT, UPDATE, DELETE'),
    'service_role keeps full access to subscription_events / paddle_webhook_events'
);

SELECT has_column('public', 'user_goals', 'predicted_completion_date',
    'user_goals.predicted_completion_date exists');
SELECT has_column('public', 'gamification_stats', 'pr_count', 'gamification_stats.pr_count exists');
SELECT has_column('public', 'gamification_stats', 'best_streak', 'gamification_stats.best_streak exists');
SELECT col_type_is('public', 'gamification_stats', 'total_workouts', 'bigint',
    'gamification_stats.total_workouts is bigint (prod)');
SELECT col_type_is('public', 'gamification_stats', 'total_time_seconds', 'bigint',
    'gamification_stats.total_time_seconds is bigint (prod)');

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

-- Event trigger: the Supabase CLI stack (local and CI) lets postgres create
-- it, so it must be present here; only environments without the privilege
-- (some hosted branches) skip it, with a NOTICE, at apply time.
SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_event_trigger
        WHERE evtname = 'ensure_rls'
          AND evtevent = 'ddl_command_end'
          AND evtenabled = 'O'
          AND evtfoid = 'public.rls_auto_enable()'::regprocedure
          AND evttags @> ARRAY['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']
          AND cardinality(evttags) = 3
    ),
    'ensure_rls runs rls_auto_enable on ddl_command_end for the captured tags'
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
        SELECT total_workouts, total_volume_kg, total_time_seconds
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
        SELECT total_workouts, total_volume_kg, total_time_seconds
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
-- The counter triggers are gone (20260920002500): inserting sessions and
-- records no longer touches gamification_stats by itself.
INSERT INTO public.workout_sessions (user_id, name, total_volume, duration_seconds, started_at)
VALUES
    ('c3c3c3c3-0000-4000-8000-000000000003'::uuid, 'capture session 1', 100, 600, now()),
    ('c3c3c3c3-0000-4000-8000-000000000003'::uuid, 'capture session 2', 50, 300, now());

INSERT INTO public.personal_records (user_id, exercise_name, value)
VALUES ('c3c3c3c3-0000-4000-8000-000000000003'::uuid, 'Capture Press', 80);

SELECT is_empty(
    $sql$
        SELECT 1 FROM public.gamification_stats
        WHERE user_id = 'c3c3c3c3-0000-4000-8000-000000000003'::uuid
    $sql$,
    'inserting sessions and records no longer creates a stats row by trigger'
);

-- The derivation that replaced them (see gamification_stats.test.sql for the
-- full contract) produces the same totals the add-only triggers used to.
-- recompute_gamification_stats is UPDATE-only by design (it must never
-- create an all-zero row, or mobile-sync-pull would serve zeroes where it
-- used to serve null), so the row is created the way production creates it:
-- by the LWW RPC on the first push that carries gamificationStats.
SELECT public.upsert_gamification_stats_lww(
    jsonb_build_array(jsonb_build_object(
        'user_id', 'c3c3c3c3-0000-4000-8000-000000000003',
        'device_total_workouts', 2,
        'last_workout_at', now()
    ))
);

SELECT lives_ok(
    $sql$ SELECT public.recompute_gamification_stats('c3c3c3c3-0000-4000-8000-000000000003'::uuid) $sql$,
    'recompute_gamification_stats runs'
);

SELECT results_eq(
    $sql$
        SELECT total_workouts, total_volume_kg, total_time_seconds, pr_count
        FROM public.gamification_stats
        WHERE user_id = 'c3c3c3c3-0000-4000-8000-000000000003'::uuid
    $sql$,
    $values$ VALUES (2::bigint, 150::numeric, 900::bigint, 1) $values$,
    'recompute_gamification_stats derives the counters the dropped triggers used to add'
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

-- ensure_rls: a new public table gets RLS.
CREATE TABLE public.capture_rls_probe (id integer);

SELECT ok(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.capture_rls_probe'::regclass),
    'ensure_rls enables RLS on a new public table'
);

SELECT diag('database:dashboard-capture-ownership-guard');

-- private.capture_function must skip the body of a function postgres does
-- not own, but still revoke where it can; the self-check must hard-fail for
-- a definer that stays exposed, whoever owns it.
CREATE ROLE capture_probe_member NOLOGIN;
CREATE ROLE capture_probe_stranger NOLOGIN;
-- postgres inherits the first role (so its REVOKE acts as the owner) and can
-- only SET ROLE to the second (so its REVOKE cannot touch those grants).
GRANT capture_probe_member TO postgres WITH INHERIT TRUE, SET TRUE;
GRANT capture_probe_stranger TO postgres WITH INHERIT FALSE, SET TRUE;
GRANT USAGE, CREATE ON SCHEMA public TO capture_probe_member, capture_probe_stranger;

CREATE FUNCTION public.capture_probe_member() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT 1';
ALTER FUNCTION public.capture_probe_member() OWNER TO capture_probe_member;
GRANT EXECUTE ON FUNCTION public.capture_probe_member() TO anon, authenticated;

CREATE FUNCTION public.capture_probe_stranger() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT 1';
ALTER FUNCTION public.capture_probe_stranger() OWNER TO capture_probe_stranger;

SELECT is(
    private.capture_function(
        'public.capture_probe_member()',
        'definer',
        $ddl$ CREATE OR REPLACE FUNCTION public.capture_probe_member() RETURNS integer
              LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT 2' $ddl$
    ),
    'skipped',
    'capture_function skips a function not owned by postgres'
);

SELECT is(public.capture_probe_member(), 1, 'the skipped function keeps its body');

SELECT ok(
    NOT has_function_privilege('anon', 'public.capture_probe_member()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.capture_probe_member()', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.capture_probe_member()', 'EXECUTE'),
    'the skip path still applies the definer grant pattern where it can'
);

SELECT lives_ok(
    $sql$ SELECT private.capture_assert_definers_locked(ARRAY['public.capture_probe_member()']) $sql$,
    'self-check passes for a locked-down definer'
);

SELECT is(
    private.capture_function('public.capture_probe_stranger()', 'definer', $ddl$ SELECT 1 $ddl$),
    'skipped',
    'capture_function skips (and does not fail on) a definer it cannot revoke'
);

SELECT ok(
    has_function_privilege('anon', 'public.capture_probe_stranger()', 'EXECUTE'),
    'the stranger-owned definer is still executable by anon (PUBLIC default)'
);

SELECT pg_temp.assert_exception(
    $sql$ SELECT private.capture_assert_definers_locked(ARRAY['public.capture_probe_stranger()']) $sql$,
    '42501',
    'capture: definers still executable by anon/authenticated: public.capture_probe_stranger() (owner=capture_probe_stranger%',
    'self-check hard-fails for an exposed definer regardless of owner'
);

SELECT ok(
    NOT has_function_privilege('anon', 'private.capture_function(text, text, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'private.capture_function(text, text, text)', 'EXECUTE')
    AND NOT has_schema_privilege('anon', 'private', 'USAGE')
    AND NOT has_schema_privilege('authenticated', 'private', 'USAGE'),
    'migration helpers in schema private are not reachable by anon/authenticated'
);

SELECT * FROM finish();

ROLLBACK;
