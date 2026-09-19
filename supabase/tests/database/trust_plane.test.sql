-- Trust-plane pgTAP: EMBER write deny, child SELECT without EMBER, deletion
-- grace floor, profile opt-in defaults.
--
-- Follows supabase/tests/database/profile_preferences.test.sql.
-- Runs in CI with the rest of the suite (`supabase test db` in
-- .github/workflows/migrations.yml); locally: `npm run test:db`.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:trust-plane-catalog');

SELECT ok(
    (
        SELECT pg_get_expr(column_row.adbin, column_row.adrelid)
        FROM pg_attrdef column_row
        JOIN pg_attribute attribute
          ON attribute.attrelid = column_row.adrelid
         AND attribute.attnum = column_row.adnum
        WHERE column_row.adrelid = 'public.profiles'::regclass
          AND attribute.attname = 'profile_visible'
    ) ILIKE '%false%',
    'profiles.profile_visible defaults to false'
);

SELECT ok(
    (
        SELECT pg_get_expr(column_row.adbin, column_row.adrelid)
        FROM pg_attrdef column_row
        JOIN pg_attribute attribute
          ON attribute.attrelid = column_row.adrelid
         AND attribute.attnum = column_row.adnum
        WHERE column_row.adrelid = 'public.profiles'::regclass
          AND attribute.attname = 'leaderboard_participation'
    ) ILIKE '%false%',
    'profiles.leaderboard_participation defaults to false'
);

SELECT ok(
    pg_get_functiondef('public.handle_new_user()'::regprocedure)
      LIKE '%Athlete%'
     AND pg_get_functiondef('public.handle_new_user()'::regprocedure)
      LIKE '%profile_visible%',
    'handle_new_user binds Athlete and profile_visible'
);

SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.deletion_requests'::regclass
          AND conname = 'deletion_requests_scheduled_for_min_grace'
    ),
    'deletion_requests has the 30-day scheduled_for CHECK'
);

SELECT ok(
    (
        SELECT with_check
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'routines'
          AND policyname = 'Users can insert own routines'
    ) LIKE '%user_has_min_tier%',
    'routines INSERT WITH CHECK requires EMBER'
);

SELECT is_empty(
    $sql$
        SELECT tablename::text || ' ' || policyname::text
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('workout_sessions', 'personal_records')
          AND cmd IN ('INSERT', 'ALL')
    $sql$,
    'workout_sessions and personal_records have no client INSERT policy'
);

SELECT ok(
    (
        SELECT COALESCE(qual, '')
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'routine_exercises'
          AND policyname = 'Users can view exercises in own routines'
          AND cmd = 'SELECT'
    ) NOT LIKE '%user_has_min_tier%',
    'routine_exercises SELECT has no EMBER predicate'
);

SELECT ok(
    (
        SELECT COALESCE(qual, '')
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'cycle_days'
          AND policyname = 'Users can view days in own cycles'
          AND cmd = 'SELECT'
    ) NOT LIKE '%user_has_min_tier%',
    'cycle_days SELECT has no EMBER predicate'
);

SELECT ok(
    (
        SELECT with_check
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'deletion_requests'
          AND policyname = 'Users can insert own deletion request'
    ) LIKE '%pending%',
    'deletion_requests INSERT WITH CHECK requires status pending'
);

SELECT ok(
    NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'Public can read avatars'
    ),
    'avatars listing policy is absent (fail closed)'
);

SELECT ok(
    (
        SELECT with_check
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'Users can upload own avatars'
    ) LIKE '%avatars%'
    AND position(
        '/%' IN (
            SELECT with_check
            FROM pg_policies
            WHERE schemaname = 'storage'
              AND tablename = 'objects'
              AND policyname = 'Users can upload own avatars'
        )
    ) > 0,
    'avatars INSERT WITH CHECK is path-scoped to auth.uid()/'
);

SELECT is(
    has_function_privilege('anon', 'public.user_has_min_tier(text)', 'EXECUTE'),
    false,
    'anon cannot execute user_has_min_tier'
);

SELECT diag('database:trust-plane-rls-and-deletion-floor');

CREATE OR REPLACE FUNCTION pg_temp.assert_sqlstate(
    statement_sql text,
    expected_sqlstate text,
    assertion_description text
) RETURNS text
LANGUAGE plpgsql
AS $assertion$
BEGIN
    EXECUTE statement_sql;
    RETURN extensions.ok(false, assertion_description);
EXCEPTION WHEN OTHERS THEN
    RETURN extensions.is(SQLSTATE, expected_sqlstate, assertion_description);
END
$assertion$;

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
    RETURN extensions.is(SQLERRM, expected_message, assertion_description);
END
$assertion$;

SELECT is(
    public.jsonb_redact_token_keys(
        '{"userAccessToken":"secret","a":1,"nested":{"refresh_token":"x","n":2},"arr":[{"access_token":"z","v":3}]}'::jsonb
    ),
    '{"a":1,"nested":{"n":2},"arr":[{"v":3}]}'::jsonb,
    'jsonb_redact_token_keys strips nested objects and arrays'
);

INSERT INTO auth.users (id, email)
VALUES
    ('33333333-3333-4333-8333-333333333333'::uuid, 'trust-free@example.test'),
    ('44444444-4444-4444-8444-444444444444'::uuid, 'trust-ember@example.test'),
    ('77777777-7777-4777-8777-777777777777'::uuid, 'trust-expired@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.local_profiles (user_id, id, name, device_id)
VALUES
    ('33333333-3333-4333-8333-333333333333'::uuid, 'default', 'Default', 'pgtap'),
    ('44444444-4444-4444-8444-444444444444'::uuid, 'default', 'Default', 'pgtap'),
    ('77777777-7777-4777-8777-777777777777'::uuid, 'default', 'Default', 'pgtap')
ON CONFLICT (user_id, id) DO NOTHING;

INSERT INTO public.routines (id, user_id, name)
VALUES (
    '55555555-5555-4555-8555-555555555555'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid,
    'Free user routine'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.routine_exercises (id, routine_id, name)
VALUES (
    '66666666-6666-4666-8666-666666666666'::uuid,
    '55555555-5555-4555-8555-555555555555'::uuid,
    'Squat'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES
    (
        '44444444-4444-4444-8444-444444444444'::uuid,
        'EMBER',
        'active',
        now() + INTERVAL '30 days'
    ),
    (
        '77777777-7777-4777-8777-777777777777'::uuid,
        'EMBER',
        'active',
        now() - INTERVAL '1 day'
    )
ON CONFLICT (user_id) DO UPDATE
SET tier = EXCLUDED.tier,
    status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',
    true
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        INSERT INTO public.routines (user_id, name)
        VALUES (
            '33333333-3333-4333-8333-333333333333'::uuid,
            'unpaid cloud write'
        )
    $sql$,
    '42501',
    'FREE JWT cannot INSERT routines'
);

SELECT pg_temp.assert_exception(
    $sql$
        SELECT public.import_shared_routine(
            '00000000-0000-4000-8000-000000000099'::uuid
        )
    $sql$,
    'P0001',
    'EMBER_REQUIRED',
    'FREE JWT cannot import_shared_routine'
);

SELECT pg_temp.assert_exception(
    $sql$
        SELECT public.import_shared_cycle(
            '00000000-0000-4000-8000-000000000098'::uuid
        )
    $sql$,
    'P0001',
    'EMBER_REQUIRED',
    'FREE JWT cannot import_shared_cycle'
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        INSERT INTO storage.objects (bucket_id, name)
        VALUES (
            'avatars',
            '00000000-0000-4000-8000-000000000099/evil.png'
        )
    $sql$,
    '42501',
    'authenticated cannot INSERT avatars outside own folder'
);

SELECT results_eq(
    $sql$
        SELECT name COLLATE "C"
        FROM public.routine_exercises
        WHERE routine_id = '55555555-5555-4555-8555-555555555555'::uuid
    $sql$,
    $values$
        VALUES ('Squat'::text COLLATE "C")
    $values$,
    'FREE JWT can SELECT own routine_exercises without EMBER'
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        INSERT INTO public.deletion_requests (
            user_id,
            requested_at,
            scheduled_for,
            status
        )
        VALUES (
            '33333333-3333-4333-8333-333333333333'::uuid,
            now(),
            now() + INTERVAL '1 day',
            'pending'
        )
    $sql$,
    '42501',
    'authenticated cannot set scheduled_for on INSERT (column grant)'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT pg_temp.assert_sqlstate(
    $sql$
        INSERT INTO public.deletion_requests (
            user_id,
            requested_at,
            scheduled_for,
            status
        )
        VALUES (
            '33333333-3333-4333-8333-333333333333'::uuid,
            now(),
            now() + INTERVAL '1 day',
            'pending'
        )
    $sql$,
    '23514',
    'deletion_requests rejects a scheduled_for shorter than 30 days'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',
    true
);

SELECT lives_ok(
    $sql$
        INSERT INTO public.routines (user_id, name)
        VALUES (
            '44444444-4444-4444-8444-444444444444'::uuid,
            'ember cloud write'
        )
    $sql$,
    'EMBER JWT can INSERT routines'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}',
    true
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        INSERT INTO public.routines (user_id, name)
        VALUES (
            '77777777-7777-4777-8777-777777777777'::uuid,
            'expired period write'
        )
    $sql$,
    '42501',
    'expired current_period_end cannot INSERT routines'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

INSERT INTO public.deletion_requests (
    user_id,
    requested_at,
    scheduled_for,
    status
)
VALUES (
    '33333333-3333-4333-8333-333333333333'::uuid,
    now(),
    now() + INTERVAL '30 days',
    'pending'
)
ON CONFLICT (user_id) DO NOTHING;

SELECT pg_temp.assert_sqlstate(
    $sql$
        UPDATE public.deletion_requests
           SET scheduled_for = scheduled_for + INTERVAL '1 day'
         WHERE user_id = '33333333-3333-4333-8333-333333333333'::uuid
    $sql$,
    '23514',
    'deletion_requests freeze rejects scheduled_for change'
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        UPDATE public.deletion_requests
           SET requested_at = requested_at - INTERVAL '1 day'
         WHERE user_id = '33333333-3333-4333-8333-333333333333'::uuid
    $sql$,
    '23514',
    'deletion_requests freeze rejects requested_at change'
);

SELECT diag('database:trust-plane-leaderboard-inputs-catalog');

SELECT is_empty(
    $sql$
        SELECT tablename::text || ' ' || cmd
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('gamification_stats', 'rpg_attributes')
          AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    $sql$,
    'gamification_stats and rpg_attributes have no client write policy'
);

SELECT is(
    (
        SELECT count(*)::integer
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('gamification_stats', 'rpg_attributes')
          AND cmd = 'SELECT'
    ),
    2,
    'gamification_stats and rpg_attributes keep their owner SELECT policy'
);

-- Grant-level backstop, independent of policy names.
SELECT is_empty(
    $sql$
        SELECT grantee.role || ' ' || t.relname || ' ' || priv.name
        FROM (VALUES ('anon'), ('authenticated')) AS grantee(role)
        CROSS JOIN (VALUES
            ('gamification_stats'), ('rpg_attributes'),
            ('workout_sessions'), ('personal_records')
        ) AS t(relname)
        CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) AS priv(name)
        WHERE has_table_privilege(
            grantee.role, format('public.%I', t.relname), priv.name
        )
    $sql$,
    'anon/authenticated hold no table-level INSERT/UPDATE on leaderboard inputs'
);

SELECT is_empty(
    $sql$
        SELECT grantee.role || ' ' || t.relname
        FROM (VALUES ('anon'), ('authenticated')) AS grantee(role)
        CROSS JOIN (VALUES ('gamification_stats'), ('rpg_attributes')) AS t(relname)
        WHERE has_table_privilege(
            grantee.role, format('public.%I', t.relname), 'DELETE'
        )
    $sql$,
    'anon/authenticated hold no DELETE on the stats tables'
);

SELECT ok(
    has_column_privilege('authenticated', 'public.workout_sessions', 'notes', 'UPDATE'),
    'authenticated can UPDATE workout_sessions.notes'
);

SELECT is_empty(
    $sql$
        SELECT a.attname::text
        FROM pg_attribute a
        WHERE a.attrelid = 'public.workout_sessions'::regclass
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND a.attname <> 'notes'
          AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
    $sql$,
    'authenticated can UPDATE no workout_sessions column other than notes'
);

SELECT is(
    has_any_column_privilege('anon', 'public.workout_sessions', 'UPDATE'),
    false,
    'anon cannot UPDATE any workout_sessions column'
);

SELECT is_empty(
    $sql$
        SELECT format('%s %s', r.role, p.oid::regprocedure)
        FROM pg_proc p
        CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname LIKE 'upsert\_%\_lww'
          AND has_function_privilege(r.role, p.oid, 'EXECUTE')
    $sql$,
    'anon/authenticated cannot EXECUTE any upsert_*_lww RPC'
);

SELECT is(
    (
        SELECT bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
           AND count(*) >= 6
        FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname LIKE 'upsert\_%\_lww'
    ),
    true,
    'service_role keeps EXECUTE on every upsert_*_lww RPC'
);

SELECT ok(
    pg_get_triggerdef(
        (
            SELECT oid FROM pg_trigger
            WHERE tgrelid = 'public.user_goals'::regclass
              AND tgname = 'enforce_goal_limit'
        )
    ) LIKE '%BEFORE INSERT OR UPDATE OF status ON public.user_goals%',
    'enforce_goal_limit fires BEFORE INSERT OR UPDATE OF status'
);

SELECT diag('database:trust-plane-leaderboard-inputs-client');

-- EMBER-owned fixtures, written as postgres (the server path).
INSERT INTO public.workout_sessions (id, user_id, name, total_volume)
VALUES (
    '44444444-5555-4444-8444-444444444444'::uuid,
    '44444444-4444-4444-8444-444444444444'::uuid,
    'synced session',
    100
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rpg_attributes (user_id)
VALUES ('44444444-4444-4444-8444-444444444444'::uuid)
ON CONFLICT (user_id) DO NOTHING;

CREATE TEMP TABLE stats_before ON COMMIT DROP AS
SELECT total_workouts, total_volume_kg, pr_count
FROM public.gamification_stats
WHERE user_id = '44444444-4444-4444-8444-444444444444'::uuid;
GRANT SELECT ON stats_before TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',
    true
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        INSERT INTO public.workout_sessions (user_id, name, total_volume, duration_seconds, started_at)
        VALUES (
            '44444444-4444-4444-8444-444444444444'::uuid,
            'fabricated session',
            1000000000,
            1000000000,
            now()
        )
    $sql$,
    '42501',
    'EMBER JWT cannot INSERT workout_sessions'
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        INSERT INTO public.personal_records (user_id, exercise_name, value)
        VALUES ('44444444-4444-4444-8444-444444444444'::uuid, 'Squat', 1000000)
    $sql$,
    '42501',
    'EMBER JWT cannot INSERT personal_records'
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        SELECT public.upsert_workout_session_lww(
            jsonb_build_array(jsonb_build_object(
                'id', '44444444-6666-4444-8444-444444444444',
                'user_id', '44444444-4444-4444-8444-444444444444',
                'total_volume', 1000000000,
                'updated_at', now()
            ))
        )
    $sql$,
    '42501',
    'EMBER JWT cannot call upsert_workout_session_lww'
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        SELECT public.upsert_gamification_stats_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', '44444444-4444-4444-8444-444444444444',
                'total_volume_kg', 1000000000,
                'updated_at', now()
            ))
        )
    $sql$,
    '42501',
    'EMBER JWT cannot call upsert_gamification_stats_lww'
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        UPDATE public.workout_sessions
           SET total_volume = 999999
         WHERE user_id = '44444444-4444-4444-8444-444444444444'::uuid
    $sql$,
    '42501',
    'EMBER JWT cannot UPDATE workout_sessions.total_volume'
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        UPDATE public.workout_sessions
           SET duration_seconds = 999999
         WHERE user_id = '44444444-4444-4444-8444-444444444444'::uuid
    $sql$,
    '42501',
    'EMBER JWT cannot UPDATE workout_sessions.duration_seconds'
);

-- Same shape PostgREST sends for useSaveSessionNotes:
-- .update({ notes }).eq('id', ...).eq('user_id', ...).select('id').
SELECT results_eq(
    $sql$
        WITH updated AS (
            UPDATE public.workout_sessions
               SET notes = 'pgtap note'
             WHERE id = '44444444-5555-4444-8444-444444444444'::uuid
               AND user_id = '44444444-4444-4444-8444-444444444444'::uuid
            RETURNING id, notes
        )
        SELECT count(*)::integer, min(notes) FROM updated
    $sql$,
    $values$ VALUES (1, 'pgtap note'::text) $values$,
    'EMBER JWT can UPDATE workout_sessions.notes on its own session'
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        INSERT INTO public.gamification_stats (user_id, total_volume_kg)
        VALUES ('44444444-4444-4444-8444-444444444444'::uuid, 999999)
        ON CONFLICT (user_id) DO NOTHING
    $sql$,
    '42501',
    'authenticated cannot INSERT gamification_stats'
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        INSERT INTO public.rpg_attributes (user_id)
        VALUES ('44444444-4444-4444-8444-444444444444'::uuid)
        ON CONFLICT (user_id) DO NOTHING
    $sql$,
    '42501',
    'authenticated cannot INSERT rpg_attributes'
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        UPDATE public.gamification_stats
           SET total_volume_kg = 999999
         WHERE user_id = '44444444-4444-4444-8444-444444444444'::uuid
    $sql$,
    '42501',
    'authenticated cannot UPDATE gamification_stats'
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        UPDATE public.rpg_attributes
           SET level = 99
         WHERE user_id = '44444444-4444-4444-8444-444444444444'::uuid
    $sql$,
    '42501',
    'authenticated cannot UPDATE rpg_attributes'
);

SELECT results_eq(
    $sql$
        SELECT total_workouts, total_volume_kg, pr_count
        FROM public.gamification_stats
        WHERE user_id = '44444444-4444-4444-8444-444444444444'::uuid
    $sql$,
    $sql$ SELECT total_workouts, total_volume_kg, pr_count FROM stats_before $sql$,
    'owner can SELECT own gamification_stats and the client attempts left it unchanged'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT diag('database:trust-plane-leaderboard-inputs-service-role');

SET LOCAL ROLE service_role;

SELECT lives_ok(
    $sql$
        INSERT INTO public.workout_sessions (id, user_id, name, total_volume)
        VALUES (
            '44444444-7777-4444-8444-444444444444'::uuid,
            '44444444-4444-4444-8444-444444444444'::uuid,
            'push session',
            10
        )
    $sql$,
    'service_role can INSERT workout_sessions'
);

SELECT lives_ok(
    $sql$
        UPDATE public.workout_sessions
           SET total_volume = 20, duration_seconds = 60
         WHERE id = '44444444-7777-4444-8444-444444444444'::uuid
    $sql$,
    'service_role can UPDATE workout_sessions volume and duration'
);

SELECT lives_ok(
    $sql$
        INSERT INTO public.personal_records (user_id, exercise_name, value)
        VALUES ('44444444-4444-4444-8444-444444444444'::uuid, 'Push PR', 10)
    $sql$,
    'service_role can INSERT personal_records'
);

SELECT lives_ok(
    $sql$
        INSERT INTO public.gamification_stats (user_id, total_workouts)
        VALUES ('44444444-4444-4444-8444-444444444444'::uuid, 5)
        ON CONFLICT (user_id) DO UPDATE SET total_workouts = EXCLUDED.total_workouts
    $sql$,
    'service_role can upsert gamification_stats'
);

SELECT lives_ok(
    $sql$
        INSERT INTO public.rpg_attributes (user_id, level)
        VALUES ('44444444-4444-4444-8444-444444444444'::uuid, 2)
        ON CONFLICT (user_id) DO UPDATE SET level = EXCLUDED.level
    $sql$,
    'service_role can upsert rpg_attributes'
);

SELECT lives_ok(
    $sql$
        SELECT public.upsert_workout_session_lww(
            jsonb_build_array(jsonb_build_object(
                'id', '44444444-7777-4444-8444-444444444444',
                'user_id', '44444444-4444-4444-8444-444444444444',
                'name', 'push session',
                'total_volume', 30,
                'updated_at', now() + INTERVAL '1 minute'
            ))
        )
    $sql$,
    'service_role can call upsert_workout_session_lww'
);

SELECT lives_ok(
    $sql$
        SELECT public.upsert_gamification_stats_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', '44444444-4444-4444-8444-444444444444',
                'total_workouts', 7,
                'updated_at', now() + INTERVAL '1 minute'
            ))
        )
    $sql$,
    'service_role can call upsert_gamification_stats_lww'
);

SELECT lives_ok(
    $sql$
        SELECT public.upsert_rpg_attributes_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', '44444444-4444-4444-8444-444444444444',
                'level', 3,
                'updated_at', now() + INTERVAL '1 minute'
            ))
        )
    $sql$,
    'service_role can call upsert_rpg_attributes_lww'
);

RESET ROLE;

SELECT results_eq(
    $sql$
        SELECT
            (SELECT total_volume FROM public.workout_sessions
              WHERE id = '44444444-7777-4444-8444-444444444444'::uuid)::numeric,
            (SELECT total_workouts FROM public.gamification_stats
              WHERE user_id = '44444444-4444-4444-8444-444444444444'::uuid)::integer,
            (SELECT level FROM public.rpg_attributes
              WHERE user_id = '44444444-4444-4444-8444-444444444444'::uuid)::integer
    $sql$,
    $values$ VALUES (30::numeric, 7, 3) $values$,
    'service_role LWW writes landed'
);

SELECT diag('database:trust-plane-goal-cap');

-- EMBER cap is 3 active goals. Every INSERT is checked; an UPDATE is checked
-- only when the goal becomes active.
SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',
    true
);

SELECT lives_ok(
    $sql$
        INSERT INTO public.user_goals (id, user_id, goal_type, target_value, target_unit, status)
        VALUES ('44444444-0004-4444-8444-444444444444'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, 'frequency', 3, 'workouts', 'archived')
    $sql$,
    'EMBER JWT can insert an archived goal below the cap'
);

SELECT lives_ok(
    $sql$
        INSERT INTO public.user_goals (id, user_id, goal_type, target_value, target_unit, status)
        VALUES ('44444444-0005-4444-8444-444444444444'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, 'frequency', 3, 'workouts', 'completed')
    $sql$,
    'EMBER JWT can insert a completed goal below the cap'
);

SELECT lives_ok(
    format(
        $sql$
            INSERT INTO public.user_goals (id, user_id, goal_type, target_value, target_unit, status)
            VALUES (%L::uuid, '44444444-4444-4444-8444-444444444444'::uuid, 'frequency', 3, 'workouts', 'active')
        $sql$,
        goals.goal_id
    ),
    'EMBER JWT can insert active goal ' || goals.n
)
FROM (VALUES
    (1, '44444444-0001-4444-8444-444444444444'),
    (2, '44444444-0002-4444-8444-444444444444'),
    (3, '44444444-0003-4444-8444-444444444444')
) AS goals(n, goal_id)
ORDER BY goals.n;

-- The trigger took the per-user advisory lock for this transaction.
SELECT ok(
    EXISTS (
        SELECT 1
        FROM pg_locks l
        CROSS JOIN LATERAL (
            SELECT hashtextextended(
                'user_goals:44444444-4444-4444-8444-444444444444', 0
            ) AS k
        ) lock_key
        WHERE l.locktype = 'advisory'
          AND l.pid = pg_backend_pid()
          AND l.granted
          AND l.objsubid = 1
          AND l.classid = ((lock_key.k >> 32) & 4294967295)::bigint::oid
          AND l.objid = (lock_key.k & 4294967295)::bigint::oid
    ),
    'check_goal_limit holds the per-user advisory transaction lock'
);

SELECT pg_temp.assert_exception(
    $sql$
        INSERT INTO public.user_goals (user_id, goal_type, target_value, target_unit, status)
        VALUES ('44444444-4444-4444-8444-444444444444'::uuid, 'frequency', 3, 'workouts', 'archived')
    $sql$,
    'P0001',
    'Goal limit reached for your subscription tier',
    'EMBER JWT at the cap cannot INSERT another goal, even archived'
);

SELECT lives_ok(
    $sql$
        UPDATE public.user_goals
           SET target_value = 4
         WHERE id = '44444444-0001-4444-8444-444444444444'::uuid
    $sql$,
    'editing an already-active goal at the cap is allowed'
);

SELECT lives_ok(
    $sql$
        UPDATE public.user_goals
           SET status = 'active'
         WHERE id = '44444444-0002-4444-8444-444444444444'::uuid
    $sql$,
    'rewriting status on an already-active goal at the cap is allowed'
);

SELECT pg_temp.assert_exception(
    $sql$
        UPDATE public.user_goals
           SET status = 'active'
         WHERE id = '44444444-0004-4444-8444-444444444444'::uuid
    $sql$,
    'P0001',
    'Goal limit reached for your subscription tier',
    'EMBER JWT cannot un-archive a fourth active goal'
);

SELECT pg_temp.assert_exception(
    $sql$
        UPDATE public.user_goals
           SET status = 'active'
         WHERE id = '44444444-0005-4444-8444-444444444444'::uuid
    $sql$,
    'P0001',
    'Goal limit reached for your subscription tier',
    'EMBER JWT cannot move a completed goal back to active at the cap'
);

SELECT lives_ok(
    $sql$
        UPDATE public.user_goals
           SET status = 'archived'
         WHERE id = '44444444-0003-4444-8444-444444444444'::uuid
    $sql$,
    'archiving an active goal is allowed'
);

SELECT lives_ok(
    $sql$
        UPDATE public.user_goals
           SET status = 'active'
         WHERE id = '44444444-0004-4444-8444-444444444444'::uuid
    $sql$,
    'un-archiving is allowed again once below the cap'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- A lapsed subscriber: a goal created while paid, then the period ended.
INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES (
    '33333333-3333-4333-8333-333333333333'::uuid,
    'EMBER',
    'active',
    now() + INTERVAL '30 days'
)
ON CONFLICT (user_id) DO UPDATE
SET tier = EXCLUDED.tier,
    status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',
    true
);

SELECT lives_ok(
    $sql$
        INSERT INTO public.user_goals (id, user_id, goal_type, target_value, target_unit, status)
        VALUES (
            '33333333-0001-4333-8333-333333333333'::uuid,
            '33333333-3333-4333-8333-333333333333'::uuid,
            'frequency',
            3,
            'workouts',
            'archived'
        )
    $sql$,
    'paid JWT can insert an archived goal'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

UPDATE public.subscriptions
   SET current_period_end = now() - INTERVAL '1 day'
 WHERE user_id = '33333333-3333-4333-8333-333333333333'::uuid;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',
    true
);

SELECT pg_temp.assert_exception(
    $sql$
        UPDATE public.user_goals
           SET status = 'active'
         WHERE id = '33333333-0001-4333-8333-333333333333'::uuid
    $sql$,
    'P0001',
    'Goal limit reached for your subscription tier',
    'FREE (lapsed) JWT cannot re-activate an archived goal'
);

SELECT pg_temp.assert_exception(
    $sql$
        INSERT INTO public.user_goals (user_id, goal_type, target_value, target_unit, status)
        VALUES ('33333333-3333-4333-8333-333333333333'::uuid, 'frequency', 3, 'workouts', 'archived')
    $sql$,
    'P0001',
    'Goal limit reached for your subscription tier',
    'FREE JWT cannot INSERT a goal of any status (archived)'
);

SELECT pg_temp.assert_exception(
    $sql$
        INSERT INTO public.user_goals (user_id, goal_type, target_value, target_unit, status)
        VALUES ('33333333-3333-4333-8333-333333333333'::uuid, 'frequency', 3, 'workouts', 'completed')
    $sql$,
    'P0001',
    'Goal limit reached for your subscription tier',
    'FREE JWT cannot INSERT a goal of any status (completed)'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT * FROM finish();
