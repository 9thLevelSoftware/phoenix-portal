-- SECURITY DEFINER lockdown guard (20260920000100_lockdown_definer_function_grants.sql).
--
-- Fails when any SECURITY DEFINER function in `public` is executable by anon
-- or authenticated outside the browser allow-list below. A new definer
-- function created without `REVOKE ALL ... FROM PUBLIC` is caught here: the
-- built-in PUBLIC EXECUTE default cannot be removed per schema, so the
-- migration's ALTER DEFAULT PRIVILEGES does not close new functions by itself.
--
-- Allow-list (keep in sync with the migration and with the prod grant check
-- in .github/workflows/prod-migration-drift.yml):
--   authenticated: import_shared_routine, import_shared_cycle,
--                  workout_current_streak, user_has_min_tier,
--                  user_subscription_tier
--   anon:          none. Every policy that calls a tier helper is
--                  INSERT/UPDATE/DELETE with an auth.uid() ownership
--                  conjunct; asserted below. (The migration and the prod
--                  check allow anon on a tier helper only while a
--                  PUBLIC/anon SELECT/ALL policy calls it; this file
--                  asserts no such policy exists.)
-- Entries are exact signatures: proname(oidvectortypes(proargtypes)).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:definer-grants-catalog');

SELECT set_eq(
    $sql$
        SELECT format('%s(%s)', p.proname, oidvectortypes(p.proargtypes))::text,
               r.rolname::text
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
        WHERE n.nspname = 'public'
          AND p.prosecdef
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.classid = 'pg_proc'::regclass
                AND d.objid = p.oid
                AND d.deptype = 'e'
          )
          AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    $sql$,
    $sql$
        VALUES
            ('import_shared_cycle(uuid, text)'::text, 'authenticated'::text),
            ('import_shared_routine(uuid, text)', 'authenticated'),
            ('user_has_min_tier(text)', 'authenticated'),
            ('user_subscription_tier()', 'authenticated'),
            ('workout_current_streak(uuid)', 'authenticated')
    $sql$,
    'only allow-listed SECURITY DEFINER functions are executable by anon/authenticated'
);

-- The 8 SECURITY DEFINER functions captured from the prod dashboard by
-- 20260920000200 must exist on a clean apply, so the catalog check above
-- really covers them (a missing one would pass it vacuously).
SELECT is_empty(
    $sql$
        SELECT sig
        FROM unnest(ARRAY[
            'public.get_percentile_rank(uuid, text, text)',
            'public.get_profile_stats(uuid)',
            'public.log_subscription_event()',
            'public.refresh_community_benchmarks()',
            'public.refresh_hot_scores()',
            'public.rls_auto_enable()',
            'public.update_pr_count_on_record()',
            'public.update_profile_stats_on_workout()'
        ]) AS sig
        LEFT JOIN pg_proc p ON p.oid = to_regprocedure(sig)
        WHERE p.oid IS NULL
           OR NOT p.prosecdef
           OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    $sql$,
    'dashboard-captured SECURITY DEFINER functions exist and keep service_role EXECUTE'
);

SELECT is_empty(
    $sql$
        SELECT p.oid::regprocedure
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = ANY (ARRAY[
              'get_routines_excluding_ids',
              'get_sessions_excluding_ids',
              'get_cycles_excluding_ids',
              'get_personal_records_excluding_ids',
              'get_badges_excluding_ids',
              'get_personal_record_tombstones',
              'insert_routine_exercises_from_snapshot',
              'replace_session_children',
              'replace_user_insights',
              'apply_subscription_event',
              'disconnect_integration'
          ])
          AND (
              has_function_privilege('anon', p.oid, 'EXECUTE')
              OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
          )
    $sql$,
    'Edge-only RPCs (definer and invoker) are service_role-only'
);

SELECT is_empty(
    $sql$
        SELECT p.oid::regprocedure
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND (
              p.prosecdef
              OR p.proname IN (
                  'get_acwr',
                  'get_muscle_distribution',
                  'get_workout_streak',
                  'get_volume_rolling_avg',
                  'detect_plateaus',
                  'get_exercise_trend',
                  'get_volume_comparison',
                  'get_wearable_trends',
                  'get_goal_progress_cached',
                  '_external_activities_bump_updated_at',
                  'update_personal_record_updated_at'
              )
          )
          AND NOT EXISTS (
              SELECT 1
              FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS cfg(setting)
              WHERE cfg.setting LIKE 'search_path=%'
          )
    $sql$,
    'every SECURITY DEFINER and advisor-flagged function in public pins search_path'
);

SELECT is_empty(
    $sql$
        SELECT a.grantee::regrole
        FROM pg_default_acl d
        CROSS JOIN LATERAL aclexplode(d.defaclacl) AS a
        WHERE d.defaclrole = 'postgres'::regrole
          AND d.defaclnamespace = 'public'::regnamespace
          AND d.defaclobjtype = 'f'
          AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)
          AND a.privilege_type = 'EXECUTE'
    $sql$,
    'postgres default privileges in public grant no EXECUTE to anon/authenticated'
);

SELECT is_empty(
    $sql$
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE roles && ARRAY['public', 'anon']::name[]
          AND cmd IN ('SELECT', 'ALL')
          AND (
              coalesce(qual, '') ~ '(user_has_min_tier|user_subscription_tier)\('
              OR coalesce(with_check, '') ~ '(user_has_min_tier|user_subscription_tier)\('
          )
    $sql$,
    'no PUBLIC/anon SELECT policy calls a tier helper (anon stays off the allow-list)'
);

SELECT is(
    has_table_privilege('anon', 'public.public_profiles', 'SELECT'),
    false,
    'anon has no SELECT on public_profiles'
);

SELECT ok(
    CASE
        WHEN to_regclass('realtime.messages') IS NULL THEN true
        ELSE EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'realtime'
              AND tablename = 'messages'
              AND policyname = 'phoenix_sync_broadcast_select'
        )
    END,
    'realtime.messages has the phoenix_sync_broadcast_select policy'
);

SELECT diag('database:definer-grants-behaviour');

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
        RETURN extensions.is(SQLSTATE, expected_sqlstate, assertion_description);
    END IF;
    -- expected_message is a LIKE pattern.
    RETURN extensions.ok(
        SQLERRM LIKE expected_message,
        assertion_description || ' (got: ' || SQLERRM || ')'
    );
END
$assertion$;

-- Fixtures: A is an EMBER user; B owns a routine and shares it.
INSERT INTO auth.users (id, email)
VALUES
    ('a1a1a1a1-0000-4000-8000-000000000001'::uuid, 'definer-a@example.test'),
    ('b2b2b2b2-0000-4000-8000-000000000002'::uuid, 'definer-b@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES (
    'a1a1a1a1-0000-4000-8000-000000000001'::uuid,
    'EMBER',
    'active',
    now() + INTERVAL '30 days'
)
ON CONFLICT (user_id) DO UPDATE
SET tier = EXCLUDED.tier,
    status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end;

INSERT INTO public.routines (id, user_id, name)
VALUES
    (
        'a1a1a1a1-1111-4000-8000-000000000001'::uuid,
        'a1a1a1a1-0000-4000-8000-000000000001'::uuid,
        'A routine'
    ),
    (
        'b2b2b2b2-1111-4000-8000-000000000002'::uuid,
        'b2b2b2b2-0000-4000-8000-000000000002'::uuid,
        'B routine'
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.shared_routines (id, user_id, routine_id, name, exercises_snapshot)
VALUES (
    'b2b2b2b2-2222-4000-8000-000000000002'::uuid,
    'b2b2b2b2-0000-4000-8000-000000000002'::uuid,
    'b2b2b2b2-1111-4000-8000-000000000002'::uuid,
    'B shared routine',
    '[{"name": "Row", "sets": 3, "reps": 8, "order_index": 0}]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.training_cycles (id, user_id, name)
VALUES (
    'b2b2b2b2-3333-4000-8000-000000000002'::uuid,
    'b2b2b2b2-0000-4000-8000-000000000002'::uuid,
    'B cycle'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.shared_cycles (id, user_id, cycle_id, name, cycle_snapshot)
VALUES (
    'b2b2b2b2-4444-4000-8000-000000000002'::uuid,
    'b2b2b2b2-0000-4000-8000-000000000002'::uuid,
    'b2b2b2b2-3333-4000-8000-000000000002'::uuid,
    'B shared cycle',
    '{"days": [{"day_number": 1, "day_type": "workout", "routine": {"name": "Cycle day routine", "exercises": [{"name": "Press", "order_index": 0}]}}]}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Guards, exercised as the owner role (postgres keeps EXECUTE) so the
-- function body, not the privilege revoke, is what rejects the call.
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"a1a1a1a1-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);

SELECT pg_temp.assert_exception(
    $sql$
        SELECT * FROM public.get_routines_excluding_ids(
            'b2b2b2b2-0000-4000-8000-000000000002'::uuid
        )
    $sql$,
    '42501',
    'forbidden',
    'get_routines_excluding_ids rejects another user''s id'
);

SELECT lives_ok(
    $sql$
        SELECT * FROM public.get_routines_excluding_ids(
            'a1a1a1a1-0000-4000-8000-000000000001'::uuid
        )
    $sql$,
    'get_routines_excluding_ids allows the caller''s own id'
);

SELECT pg_temp.assert_exception(
    $sql$
        SELECT public.insert_routine_exercises_from_snapshot(
            'b2b2b2b2-1111-4000-8000-000000000002'::uuid,
            '[{"name": "Injected"}]'::jsonb
        )
    $sql$,
    '42501',
    'forbidden',
    'insert_routine_exercises_from_snapshot rejects another user''s routine'
);

SELECT lives_ok(
    $sql$
        SELECT public.insert_routine_exercises_from_snapshot(
            'a1a1a1a1-1111-4000-8000-000000000001'::uuid,
            '[{"name": "Own"}]'::jsonb
        )
    $sql$,
    'insert_routine_exercises_from_snapshot allows the caller''s own routine'
);

SELECT pg_temp.assert_exception(
    format(
        'SELECT * FROM public.%I(%L::uuid)',
        fn,
        'b2b2b2b2-0000-4000-8000-000000000002'
    ),
    '42501',
    'forbidden',
    fn || ' rejects another user''s id'
)
FROM unnest(ARRAY[
    'get_sessions_excluding_ids',
    'get_cycles_excluding_ids',
    'get_badges_excluding_ids'
]) AS fn;

SELECT lives_ok(
    format(
        'SELECT * FROM public.%I(%L::uuid)',
        fn,
        'a1a1a1a1-0000-4000-8000-000000000001'
    ),
    fn || ' allows the caller''s own id'
)
FROM unnest(ARRAY[
    'get_sessions_excluding_ids',
    'get_cycles_excluding_ids',
    'get_badges_excluding_ids'
]) AS fn;

SELECT set_config(
    'request.jwt.claims',
    '{"role":"service_role"}',
    true
);

SELECT results_eq(
    $sql$
        SELECT name FROM public.get_routines_excluding_ids(
            'b2b2b2b2-0000-4000-8000-000000000002'::uuid
        )
    $sql$,
    $values$ VALUES ('B routine'::text) $values$,
    'service_role may read any user''s routines through get_routines_excluding_ids'
);

SELECT lives_ok(
    format(
        'SELECT * FROM public.%I(%L::uuid)',
        fn,
        'b2b2b2b2-0000-4000-8000-000000000002'
    ),
    'service_role may call ' || fn || ' for any user'
)
FROM unnest(ARRAY[
    'get_sessions_excluding_ids',
    'get_cycles_excluding_ids',
    'get_badges_excluding_ids'
]) AS fn;

-- Privilege revokes, as the browser roles.
SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"a1a1a1a1-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);

SELECT pg_temp.assert_exception(
    $sql$
        SELECT * FROM public.get_routines_excluding_ids(
            'a1a1a1a1-0000-4000-8000-000000000001'::uuid
        )
    $sql$,
    '42501',
    'permission denied for function%',
    'authenticated cannot execute get_routines_excluding_ids'
);

SELECT pg_temp.assert_exception(
    $sql$
        SELECT public.insert_routine_exercises_from_snapshot(
            'a1a1a1a1-1111-4000-8000-000000000001'::uuid,
            '[]'::jsonb
        )
    $sql$,
    '42501',
    'permission denied for function%',
    'authenticated cannot execute insert_routine_exercises_from_snapshot'
);

-- The nested definer path (import -> insert_routine_exercises_from_snapshot)
-- still works for an EMBER caller.
-- still works for an entitled caller. Importing is FLAME since
-- 20260920000900 (tier_matrix.test.sql covers the EMBER denial), so A is
-- FLAME for these two calls and back to EMBER afterwards.
RESET ROLE;
UPDATE public.subscriptions
SET tier = 'FLAME'
WHERE user_id = 'a1a1a1a1-0000-4000-8000-000000000001'::uuid;
SET LOCAL ROLE authenticated;

SELECT lives_ok(
    $sql$
        SELECT public.import_shared_routine(
            'b2b2b2b2-2222-4000-8000-000000000002'::uuid
        )
    $sql$,
    'EMBER user can still import_shared_routine'
    'FLAME user can still import_shared_routine'
);

SELECT lives_ok(
    $sql$
        SELECT public.import_shared_cycle(
            'b2b2b2b2-4444-4000-8000-000000000002'::uuid
        )
    $sql$,
    'EMBER user can still import_shared_cycle'
);

    'FLAME user can still import_shared_cycle'
);

RESET ROLE;
UPDATE public.subscriptions
SET tier = 'EMBER'
WHERE user_id = 'a1a1a1a1-0000-4000-8000-000000000001'::uuid;
SET LOCAL ROLE authenticated;

-- A tier helper evaluated inside an RLS policy as authenticated.
SELECT lives_ok(
    $sql$
        INSERT INTO public.workout_sessions (user_id, name)
        VALUES (
            'a1a1a1a1-0000-4000-8000-000000000001'::uuid,
            'ember write through user_has_min_tier policy'
        )
    $sql$,
    'EMBER JWT can INSERT workout_sessions (policy calls user_has_min_tier)'
);

RESET ROLE;

SELECT results_eq(
    $sql$
        SELECT re.name
        FROM public.routine_exercises re
        JOIN public.routines r ON r.id = re.routine_id
        WHERE r.user_id = 'a1a1a1a1-0000-4000-8000-000000000001'::uuid
          AND r.name = 'B shared routine'
    $sql$,
    $values$ VALUES ('Row'::text) $values$,
    'import_shared_routine copied the snapshot exercises into the caller''s routine'
);

SELECT results_eq(
    $sql$
        SELECT re.name
        FROM public.routine_exercises re
        JOIN public.routines r ON r.id = re.routine_id
        WHERE r.user_id = 'a1a1a1a1-0000-4000-8000-000000000001'::uuid
          AND r.name = 'Cycle day routine'
    $sql$,
    $values$ VALUES ('Press'::text) $values$,
    'import_shared_cycle copied the day routine exercises into the caller''s routine'
);

-- Trigger functions whose EXECUTE was revoked still fire for the caller:
-- EMBER may hold 3 active goals, and the 4th is rejected by check_goal_limit.
SELECT has_trigger(
    'public',
    'user_goals',
    'enforce_goal_limit',
    'user_goals has the enforce_goal_limit trigger'
);

SELECT is(
    has_function_privilege('authenticated', 'public.check_goal_limit()', 'EXECUTE'),
    false,
    'authenticated has no EXECUTE on check_goal_limit'
);

SET LOCAL ROLE authenticated;

SELECT lives_ok(
    $sql$
        INSERT INTO public.user_goals (user_id, goal_type, target_value, target_unit)
        SELECT 'a1a1a1a1-0000-4000-8000-000000000001'::uuid, 'frequency', 3, 'workouts'
        FROM generate_series(1, 3)
    $sql$,
    'EMBER JWT can INSERT goals up to the tier limit'
);

SELECT throws_ok(
    $sql$
        INSERT INTO public.user_goals (user_id, goal_type, target_value, target_unit)
        VALUES (
            'a1a1a1a1-0000-4000-8000-000000000001'::uuid,
            'frequency',
            3,
            'workouts'
        )
    $sql$,
    'P0001',
    'Goal limit reached for your subscription tier',
    'revoked SECURITY DEFINER trigger (check_goal_limit) still fires and enforces the limit'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT pg_temp.assert_exception(
    $sql$ SELECT 1 FROM public.public_profiles LIMIT 1 $sql$,
    '42501',
    'permission denied for view public_profiles',
    'anon cannot select public_profiles'
);

SELECT pg_temp.assert_exception(
    $sql$
        SELECT * FROM public.get_routines_excluding_ids(
            'b2b2b2b2-0000-4000-8000-000000000002'::uuid
        )
    $sql$,
    '42501',
    'permission denied for function%',
    'anon cannot execute get_routines_excluding_ids'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT * FROM finish();

ROLLBACK;
