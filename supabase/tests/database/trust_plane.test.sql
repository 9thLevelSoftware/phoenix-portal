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

-- PR 33 (20260920003300): requests go through request_account_deletion()
-- only; the browser has no INSERT path of its own.
SELECT ok(
    NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'deletion_requests'
          AND cmd = 'INSERT'
    ),
    'deletion_requests has no INSERT policy'
);

SELECT ok(
    NOT has_table_privilege('authenticated', 'public.deletion_requests', 'INSERT')
    AND NOT has_any_column_privilege('authenticated', 'public.deletion_requests', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.deletion_requests', 'INSERT')
    AND NOT has_any_column_privilege('anon', 'public.deletion_requests', 'INSERT'),
    'authenticated and anon have no INSERT privilege on deletion_requests (table or column)'
);

SELECT ok(
    has_column_privilege('authenticated', 'public.deletion_requests', 'status', 'UPDATE')
    AND has_column_privilege('authenticated', 'public.deletion_requests', 'cancelled_at', 'UPDATE'),
    'authenticated keeps the UPDATE (status, cancelled_at) grant for cancel'
);

-- The "RPC is the only write path" guarantee must not rest on the absence of
-- a DELETE policy alone (review R-13): the grant is gone too.
SELECT ok(
    NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'deletion_requests'
          AND cmd = 'DELETE'
    ),
    'deletion_requests has no DELETE policy'
);

SELECT ok(
    NOT has_table_privilege('authenticated', 'public.deletion_requests', 'DELETE')
    AND NOT has_table_privilege('anon', 'public.deletion_requests', 'DELETE'),
    'authenticated and anon have no DELETE privilege on deletion_requests'
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
        now() - INTERVAL '3 days'
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

SELECT pg_temp.assert_exception(
    $sql$
        SELECT public.import_shared_routine(
            '00000000-0000-4000-8000-000000000099'::uuid
        )
    $sql$,
    'P0001',
    'FLAME_REQUIRED',
    'FREE JWT cannot import_shared_routine'
);

SELECT pg_temp.assert_exception(
    $sql$
        SELECT public.import_shared_cycle(
            '00000000-0000-4000-8000-000000000098'::uuid
        )
    $sql$,
    'P0001',
    'FLAME_REQUIRED',
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

-- Pre-existing guard: this one was already 42501 before PR 33, via the
-- INSERT (user_id) column grant from 20260823120000 — it pins that narrow
-- grant, not the revoke. The probe below is the PR 33 guard: it uses only the
-- column the old grant allowed, so it can only pass once INSERT is revoked.
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
    'authenticated cannot INSERT deletion_requests with scheduled_for'
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        INSERT INTO public.deletion_requests (user_id)
        VALUES ('33333333-3333-4333-8333-333333333333'::uuid)
    $sql$,
    '42501',
    'authenticated cannot INSERT its own deletion_requests row directly (RPC only)'
);

-- DELETE is revoked, so the attempt fails at permission-check time rather
-- than quietly matching zero rows under RLS.
SELECT pg_temp.assert_sqlstate(
    $sql$
        DELETE FROM public.deletion_requests
         WHERE user_id = '33333333-3333-4333-8333-333333333333'::uuid
    $sql$,
    '42501',
    'authenticated cannot DELETE its own deletion_requests row'
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

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}',
    true
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        INSERT INTO public.workout_sessions (user_id, name)
        VALUES (
            '77777777-7777-4777-8777-777777777777'::uuid,
            'expired period write'
        )
    $sql$,
    '42501',
    'expired current_period_end cannot INSERT workout_sessions'
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

-- ---------------------------------------------------------------------------
-- request_account_deletion(): request -> cancel -> request gets a fresh
-- 30-day floor; a double request raises; another user's row is untouched.
-- ---------------------------------------------------------------------------
SELECT diag('database:request-account-deletion');

SELECT ok(
    has_function_privilege('authenticated', 'public.request_account_deletion()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.request_account_deletion()', 'EXECUTE'),
    'request_account_deletion is executable by authenticated only'
);

INSERT INTO auth.users (id, email)
VALUES
    ('c3200000-0000-4000-8000-000000000001'::uuid, 'deletion-requester@example.test'),
    ('c3200000-0000-4000-8000-000000000002'::uuid, 'deletion-bystander@example.test'),
    ('c3200000-0000-4000-8000-000000000003'::uuid, 'deletion-executed@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

-- Seed rows whose times lie in the past (the INSERT trigger would reject
-- them), so the tests can tell a fresh floor from the old one. The CHECK
-- (scheduled_for >= requested_at + 30 days) still applies.
SET LOCAL session_replication_role = replica;
INSERT INTO public.deletion_requests (
    id, user_id, requested_at, scheduled_for, cancelled_at, executed_at, status
)
VALUES
    (
        'c3200000-0000-4000-8000-0000000000b2'::uuid,
        'c3200000-0000-4000-8000-000000000002'::uuid,
        now() - INTERVAL '40 days',
        now() - INTERVAL '10 days',
        now() - INTERVAL '35 days',
        NULL,
        'cancelled'
    ),
    (
        'c3200000-0000-4000-8000-0000000000c3'::uuid,
        'c3200000-0000-4000-8000-000000000003'::uuid,
        now() - INTERVAL '40 days',
        now() - INTERVAL '10 days',
        NULL,
        now() - INTERVAL '1 day',
        'executed'
    );
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"c3200000-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);

SELECT results_eq(
    $sql$
        SELECT status, requested_at, scheduled_for,
               previous_requested_at, previous_cancelled_at, rerequest_count
        FROM public.request_account_deletion()
    $sql$,
    $values$
        VALUES (
            'pending'::text,
            now(),
            now() + INTERVAL '30 days',
            NULL::timestamptz,
            NULL::timestamptz,
            0
        )
    $values$,
    'first request creates a pending row with a 30-day grace'
);

SELECT pg_temp.assert_exception(
    $sql$ SELECT public.request_account_deletion() $sql$,
    'P0001',
    'already_pending',
    'a second request while pending raises already_pending'
);

-- The app's cancel path (RLS: pending -> cancelled on own row).
WITH cancelled AS (
    UPDATE public.deletion_requests
       SET status = 'cancelled', cancelled_at = now()
     WHERE user_id = 'c3200000-0000-4000-8000-000000000001'::uuid
    RETURNING 1
)
SELECT is(
    (SELECT count(*)::int FROM cancelled),
    1,
    'user can cancel own pending request'
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        UPDATE public.deletion_requests
           SET rerequest_count = 0,
               previous_requested_at = NULL,
               previous_cancelled_at = NULL
         WHERE user_id = 'c3200000-0000-4000-8000-000000000001'::uuid
    $sql$,
    '42501',
    'authenticated cannot write the re-request audit columns'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- Age the cancelled request so the re-request must produce a new floor
-- rather than reuse the old one.
CREATE TEMP TABLE pr32_old_request ON COMMIT DROP AS
SELECT id FROM public.deletion_requests
WHERE user_id = 'c3200000-0000-4000-8000-000000000001'::uuid;

SET LOCAL session_replication_role = replica;
UPDATE public.deletion_requests
   SET requested_at = now() - INTERVAL '40 days',
       scheduled_for = now() - INTERVAL '10 days',
       cancelled_at = now() - INTERVAL '35 days'
 WHERE user_id = 'c3200000-0000-4000-8000-000000000001'::uuid;
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"c3200000-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);

SELECT results_eq(
    $sql$
        SELECT status, requested_at, scheduled_for, cancelled_at, executed_at,
               previous_requested_at, previous_cancelled_at, rerequest_count
        FROM public.request_account_deletion()
    $sql$,
    $values$
        VALUES (
            'pending'::text,
            now(),
            now() + INTERVAL '30 days',
            NULL::timestamptz,
            NULL::timestamptz,
            now() - INTERVAL '40 days',
            now() - INTERVAL '35 days',
            1
        )
    $values$,
    're-request after cancel gets a new 30-day floor and carries the cancelled request forward (audit)'
);

SELECT pg_temp.assert_exception(
    $sql$ SELECT public.request_account_deletion() $sql$,
    'P0001',
    'already_pending',
    'a request right after the re-request raises already_pending'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT results_eq(
    $sql$
        SELECT count(*)::int,
               bool_and(id <> (SELECT id FROM pr32_old_request)),
               bool_and(status = 'pending'),
               bool_and(scheduled_for = now() + INTERVAL '30 days')
        FROM public.deletion_requests
        WHERE user_id = 'c3200000-0000-4000-8000-000000000001'::uuid
    $sql$,
    $values$ VALUES (1, true, true, true) $values$,
    're-request replaces the cancelled row with exactly one fresh pending row'
);

SELECT results_eq(
    $sql$
        SELECT id, status, requested_at, scheduled_for, cancelled_at
        FROM public.deletion_requests
        WHERE user_id = 'c3200000-0000-4000-8000-000000000002'::uuid
    $sql$,
    $values$
        VALUES (
            'c3200000-0000-4000-8000-0000000000b2'::uuid,
            'cancelled'::text,
            now() - INTERVAL '40 days',
            now() - INTERVAL '10 days',
            now() - INTERVAL '35 days'
        )
    $values$,
    'another user''s cancelled request is untouched'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"c3200000-0000-4000-8000-000000000003","role":"authenticated"}',
    true
);

SELECT pg_temp.assert_exception(
    $sql$ SELECT public.request_account_deletion() $sql$,
    'P0001',
    'already_executing',
    'a request over an executed/claimed row raises already_executing'
);

SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);

SELECT pg_temp.assert_exception(
    $sql$ SELECT public.request_account_deletion() $sql$,
    '28000',
    'not_authenticated',
    'a request without auth.uid() raises not_authenticated'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT results_eq(
    $sql$
        SELECT id, status, executed_at
        FROM public.deletion_requests
        WHERE user_id = 'c3200000-0000-4000-8000-000000000003'::uuid
    $sql$,
    $values$
        VALUES (
            'c3200000-0000-4000-8000-0000000000c3'::uuid,
            'executed'::text,
            now() - INTERVAL '1 day'
        )
    $values$,
    'an executed/claimed request is never reset by a re-request'
);

-- ---------------------------------------------------------------------------
-- request_account_deletion() concurrency (review R-2/R-6). Two real sessions
-- over dblink, outside this test's transaction:
--   pr32_a  holds a lock in an open transaction;
--   pr32_b  calls the RPC as the user (async) and must block on that lock.
-- The test waits until pg_stat_activity shows pr32_b waiting on a Lock, then
-- commits pr32_a and reads pr32_b's outcome, so the ordering is deterministic.
-- dblink sessions commit for real, so the two users are created and removed
-- through pr32_a (cleanup runs first too, in case an earlier run aborted).
-- dblink needs a password connection (postgres is not superuser here): it
-- uses the local stack's default postgres password over the server's own
-- non-loopback address, as `supabase test db` / CI connect over TCP.
-- ---------------------------------------------------------------------------
SELECT diag('database:request-account-deletion-concurrency');

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION pg_temp.pr32_conninfo() RETURNS text
LANGUAGE sql
AS $fn$
    SELECT format(
        'host=%s port=%s dbname=%s user=postgres password=postgres',
        host(inet_server_addr()),
        inet_server_port(),
        current_database()
    )
$fn$;

-- True once `target_pid` is waiting on a heavyweight lock (max ~10s).
CREATE OR REPLACE FUNCTION pg_temp.pr32_wait_for_lock(target_pid int)
RETURNS boolean
LANGUAGE plpgsql
AS $fn$
BEGIN
    FOR i IN 1..200 LOOP
        PERFORM pg_stat_clear_snapshot();
        IF EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE pid = target_pid AND wait_event_type = 'Lock'
        ) THEN
            RETURN true;
        END IF;
        PERFORM pg_sleep(0.05);
    END LOOP;
    RETURN false;
END
$fn$;

-- Outcome of pr32_b's pending RPC call: 'status=<status>' on success,
-- 'error=<message>' on failure. Drains the connection for the next query.
CREATE OR REPLACE FUNCTION pg_temp.pr32_collect_b() RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_status text;
    v_rows int;
    v_error text;
BEGIN
    SELECT t.status INTO v_status
    FROM extensions.dblink_get_result('pr32_b', false) AS t(status text);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_error := extensions.dblink_error_message('pr32_b');
    PERFORM * FROM extensions.dblink_get_result('pr32_b', false) AS t(status text);
    IF v_rows = 0 OR v_error <> 'OK' THEN
        -- dblink returns 'ERROR:  <message>' plus CONTEXT lines; keep the message.
        RETURN 'error=' || coalesce(
            substring(v_error FROM '^ERROR:\s+([^\n]*)'),
            v_error,
            '<none>'
        );
    END IF;
    RETURN 'status=' || coalesce(v_status, '<null>');
END
$fn$;

SELECT is(
    extensions.dblink_connect('pr32_a', pg_temp.pr32_conninfo()),
    'OK',
    'dblink session A connects'
);
SELECT is(
    extensions.dblink_connect('pr32_b', pg_temp.pr32_conninfo()),
    'OK',
    'dblink session B connects'
);

SELECT extensions.dblink_exec('pr32_a', $sql$
    DELETE FROM auth.users
    WHERE id IN (
        'c3200000-0000-4000-8000-000000000004'::uuid,
        'c3200000-0000-4000-8000-000000000005'::uuid
    )
$sql$);
SELECT extensions.dblink_exec('pr32_a', $sql$
    INSERT INTO auth.users (id, email)
    VALUES
        ('c3200000-0000-4000-8000-000000000004'::uuid, 'deletion-race-insert@example.test'),
        ('c3200000-0000-4000-8000-000000000005'::uuid, 'deletion-race-cancel@example.test')
$sql$);
SELECT extensions.dblink_exec('pr32_a', $sql$
    INSERT INTO public.deletion_requests (user_id)
    VALUES ('c3200000-0000-4000-8000-000000000005'::uuid)
$sql$);

SELECT extensions.dblink_exec('pr32_b', $sql$ SET statement_timeout = '20s' $sql$);
SELECT extensions.dblink_exec('pr32_b', $sql$ SET ROLE authenticated $sql$);

CREATE TEMP TABLE pr32_b_pid ON COMMIT DROP AS
SELECT pid FROM extensions.dblink('pr32_b', 'SELECT pg_backend_pid()') AS t(pid int);

-- 1. unique_violation branch: A inserts the user's first request but has not
--    committed. B's FOR UPDATE finds nothing, its INSERT blocks on
--    UNIQUE (user_id), and after A commits it must get already_pending (not a
--    raw 23505, and not a silent NULL row).
SELECT extensions.dblink_exec('pr32_a', 'BEGIN');
SELECT extensions.dblink_exec('pr32_a', $sql$
    INSERT INTO public.deletion_requests (user_id)
    VALUES ('c3200000-0000-4000-8000-000000000004'::uuid)
$sql$);

SELECT extensions.dblink_exec('pr32_b', $sql$
    SET request.jwt.claims = '{"sub":"c3200000-0000-4000-8000-000000000004","role":"authenticated"}'
$sql$);
SELECT is(
    extensions.dblink_send_query(
        'pr32_b',
        'SELECT status FROM public.request_account_deletion()'
    ),
    1,
    'session B sends the concurrent first request'
);

SELECT ok(
    pg_temp.pr32_wait_for_lock((SELECT pid FROM pr32_b_pid)),
    'concurrent first request blocks on the uncommitted request''s unique key'
);

SELECT extensions.dblink_exec('pr32_a', 'COMMIT');

SELECT is(
    pg_temp.pr32_collect_b(),
    'error=already_pending',
    'losing concurrent first request raises already_pending (unique_violation branch)'
);

-- 2. FOR UPDATE ordering: the user has a pending request and A cancels it
--    without committing. B must wait for A's row lock and then see the
--    committed 'cancelled' row and replace it. Without FOR UPDATE, B would
--    read the old 'pending' version without waiting and raise already_pending.
SELECT extensions.dblink_exec('pr32_a', 'BEGIN');
SELECT extensions.dblink_exec('pr32_a', $sql$
    UPDATE public.deletion_requests
       SET status = 'cancelled', cancelled_at = now()
     WHERE user_id = 'c3200000-0000-4000-8000-000000000005'::uuid
$sql$);

SELECT extensions.dblink_exec('pr32_b', $sql$
    SET request.jwt.claims = '{"sub":"c3200000-0000-4000-8000-000000000005","role":"authenticated"}'
$sql$);
SELECT is(
    extensions.dblink_send_query(
        'pr32_b',
        'SELECT status FROM public.request_account_deletion()'
    ),
    1,
    'session B sends the request racing a cancel'
);

SELECT ok(
    pg_temp.pr32_wait_for_lock((SELECT pid FROM pr32_b_pid)),
    'request racing an uncommitted cancel waits on the row lock (FOR UPDATE)'
);

SELECT extensions.dblink_exec('pr32_a', 'COMMIT');

SELECT is(
    pg_temp.pr32_collect_b(),
    'status=pending',
    'after the cancel commits, the waiting request replaces the cancelled row'
);

SELECT results_eq(
    $sql$
        SELECT count, status, rerequest_count, has_previous_cancel
        FROM extensions.dblink('pr32_a', $q$
            SELECT count(*)::int,
                   min(status),
                   min(rerequest_count),
                   bool_and(previous_cancelled_at IS NOT NULL)
            FROM public.deletion_requests
            WHERE user_id = 'c3200000-0000-4000-8000-000000000005'::uuid
        $q$) AS t(count int, status text, rerequest_count int, has_previous_cancel boolean)
    $sql$,
    $values$ VALUES (1, 'pending'::text, 1, true) $values$,
    'the raced re-request leaves exactly one pending row carrying the cancel forward'
);

SELECT extensions.dblink_exec('pr32_a', $sql$
    DELETE FROM auth.users
    WHERE id IN (
        'c3200000-0000-4000-8000-000000000004'::uuid,
        'c3200000-0000-4000-8000-000000000005'::uuid
    )
$sql$);
SELECT extensions.dblink_disconnect('pr32_b');
SELECT extensions.dblink_disconnect('pr32_a');

SELECT * FROM finish();
