-- Trust-plane pgTAP: EMBER write deny, child SELECT without EMBER, deletion
-- grace floor, profile opt-in defaults.
--
-- Follows supabase/tests/database/profile_preferences.test.sql.
-- CI gap: no workflow currently runs `supabase test db`; this file is the
-- assertion source for local `supabase test db` / `supabase db test`.

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
          AND tablename = 'workout_sessions'
          AND policyname = 'Users can insert own sessions'
    ) LIKE '%user_has_min_tier%',
    'workout_sessions INSERT WITH CHECK requires EMBER'
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

INSERT INTO auth.users (id, email)
VALUES
    ('33333333-3333-4333-8333-333333333333'::uuid, 'trust-free@example.test'),
    ('44444444-4444-4444-8444-444444444444'::uuid, 'trust-ember@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.local_profiles (user_id, id, name, device_id)
VALUES
    ('33333333-3333-4333-8333-333333333333'::uuid, 'default', 'Default', 'pgtap'),
    ('44444444-4444-4444-8444-444444444444'::uuid, 'default', 'Default', 'pgtap')
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
VALUES (
    '44444444-4444-4444-8444-444444444444'::uuid,
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

SELECT pg_temp.assert_sqlstate(
    $sql$
        INSERT INTO public.workout_sessions (user_id, name)
        VALUES (
            '33333333-3333-4333-8333-333333333333'::uuid,
            'unpaid cloud write'
        )
    $sql$,
    '42501',
    'FREE JWT cannot INSERT workout_sessions'
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
        INSERT INTO public.workout_sessions (user_id, name)
        VALUES (
            '44444444-4444-4444-8444-444444444444'::uuid,
            'ember cloud write'
        )
    $sql$,
    'EMBER JWT can INSERT workout_sessions'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT * FROM finish();
