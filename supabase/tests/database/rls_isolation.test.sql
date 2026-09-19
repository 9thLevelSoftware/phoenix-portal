-- Cross-user RLS isolation.
--
-- Users A and B are both EMBER. A owns one fixture row in each user-owned
-- table below. For every table:
--   * RLS is enabled;
--   * positive control: A sees its own row (and can UPDATE / DELETE it where
--     an owner policy for that command exists), so dropping an owner policy
--     turns this file red instead of passing vacuously;
--   * B cannot SELECT, UPDATE or DELETE A's row;
--   * anon sees none of A's rows.
-- Plus: A cannot INSERT or UPDATE subscriptions and cannot raise its own tier.
--
-- UPDATE / DELETE probes run inside a subtransaction that is always rolled
-- back, so fixtures stay intact across probes. A probe returns the number of
-- affected rows, or -1 when the statement was refused with 42501
-- (privilege or WITH CHECK). For B and anon, both 0 and -1 mean "isolated".
--
-- Fixtures are inserted as postgres (bypassing the EMBER-gated INSERT
-- policies, which trust_plane.test.sql covers).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

-- ---------------------------------------------------------------------------
-- Helpers (pg_temp, SECURITY INVOKER: they run with the caller's role).
-- ---------------------------------------------------------------------------

CREATE FUNCTION pg_temp.rls_probe(
    p_table text,
    p_op text,
    p_id uuid,
    p_set text DEFAULT 'id = id'
) RETURNS integer
LANGUAGE plpgsql
AS $probe$
DECLARE
    affected integer;
BEGIN
    IF p_op = 'select' THEN
        BEGIN
            EXECUTE format(
                'SELECT count(*)::integer FROM public.%I WHERE id = $1',
                p_table
            ) INTO affected USING p_id;
            RETURN affected;
        EXCEPTION WHEN insufficient_privilege THEN
            RETURN -1;
        END;
    END IF;

    BEGIN
        IF p_op = 'update' THEN
            EXECUTE format(
                'WITH w AS (UPDATE public.%I SET %s WHERE id = $1 RETURNING 1) '
                'SELECT count(*)::integer FROM w',
                p_table,
                p_set
            ) INTO affected USING p_id;
        ELSIF p_op = 'delete' THEN
            EXECUTE format(
                'WITH w AS (DELETE FROM public.%I WHERE id = $1 RETURNING 1) '
                'SELECT count(*)::integer FROM w',
                p_table
            ) INTO affected USING p_id;
        ELSE
            RAISE EXCEPTION 'rls_probe: unknown op %', p_op;
        END IF;
        -- Always undo the write; carry the count out in the message.
        RAISE EXCEPTION USING ERRCODE = 'P0R01', MESSAGE = affected::text;
    EXCEPTION
        WHEN SQLSTATE 'P0R01' THEN
            RETURN SQLERRM::integer;
        WHEN insufficient_privilege THEN
            RETURN -1;
    END;
END
$probe$;

CREATE FUNCTION pg_temp.act_as(p_role text, p_user uuid) RETURNS void
LANGUAGE plpgsql
AS $act$
BEGIN
    IF p_role = 'anon' THEN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    ELSE
        PERFORM set_config(
            'request.jwt.claims',
            json_build_object('sub', p_user, 'role', p_role)::text,
            true
        );
    END IF;
END
$act$;

-- ---------------------------------------------------------------------------
-- Fixtures.
--   A = a1..., B = b2..., C = c3... (C has no subscription row: FREE).
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, email)
VALUES
    ('a1a1a1a1-0000-4000-8000-00000000000a'::uuid, 'rls-a@example.test'),
    ('b2b2b2b2-0000-4000-8000-00000000000b'::uuid, 'rls-b@example.test'),
    ('c3c3c3c3-0000-4000-8000-00000000000c'::uuid, 'rls-c@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.subscriptions (id, user_id, tier, status, current_period_end)
VALUES
    (
        'a1a1a1a1-5555-4000-8000-00000000000a'::uuid,
        'a1a1a1a1-0000-4000-8000-00000000000a'::uuid,
        'EMBER', 'active', now() + INTERVAL '30 days'
    ),
    (
        'b2b2b2b2-5555-4000-8000-00000000000b'::uuid,
        'b2b2b2b2-0000-4000-8000-00000000000b'::uuid,
        'EMBER', 'active', now() + INTERVAL '30 days'
    );

INSERT INTO public.workout_sessions (id, user_id)
VALUES ('a1a1a1a1-0001-4000-8000-00000000000a', 'a1a1a1a1-0000-4000-8000-00000000000a');

INSERT INTO public.exercises (id, session_id, name, user_id)
VALUES (
    'a1a1a1a1-0002-4000-8000-00000000000a',
    'a1a1a1a1-0001-4000-8000-00000000000a',
    'Row',
    'a1a1a1a1-0000-4000-8000-00000000000a'
);

INSERT INTO public.sets (id, exercise_id, set_number, user_id)
VALUES (
    'a1a1a1a1-0003-4000-8000-00000000000a',
    'a1a1a1a1-0002-4000-8000-00000000000a',
    1,
    'a1a1a1a1-0000-4000-8000-00000000000a'
);

INSERT INTO public.rep_summaries (id, set_id, rep_number, user_id)
VALUES (
    'a1a1a1a1-0004-4000-8000-00000000000a',
    'a1a1a1a1-0003-4000-8000-00000000000a',
    1,
    'a1a1a1a1-0000-4000-8000-00000000000a'
);

INSERT INTO public.rep_telemetry (id, set_id, timestamp_ms, user_id)
VALUES (
    'a1a1a1a1-0005-4000-8000-00000000000a',
    'a1a1a1a1-0003-4000-8000-00000000000a',
    1000,
    'a1a1a1a1-0000-4000-8000-00000000000a'
);

INSERT INTO public.routines (id, user_id, name)
VALUES (
    'a1a1a1a1-0006-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'A routine'
);

INSERT INTO public.routine_exercises (id, routine_id, name)
VALUES (
    'a1a1a1a1-0007-4000-8000-00000000000a',
    'a1a1a1a1-0006-4000-8000-00000000000a',
    'Row'
);

INSERT INTO public.training_cycles (id, user_id, name)
VALUES (
    'a1a1a1a1-0008-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'A cycle'
);

INSERT INTO public.cycle_days (id, cycle_id, day_number)
VALUES (
    'a1a1a1a1-0009-4000-8000-00000000000a',
    'a1a1a1a1-0008-4000-8000-00000000000a',
    1
);

INSERT INTO public.personal_records (id, user_id, exercise_name, value)
VALUES (
    'a1a1a1a1-0010-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'Row',
    100
);

INSERT INTO public.exercise_progress (id, user_id, exercise_name, session_id)
VALUES (
    'a1a1a1a1-0011-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'Row',
    'a1a1a1a1-0001-4000-8000-00000000000a'
);

-- enforce_goal_limit reads the tier of auth.uid(), so insert as A's JWT.
SELECT pg_temp.act_as('authenticated', 'a1a1a1a1-0000-4000-8000-00000000000a');
INSERT INTO public.user_goals (id, user_id, goal_type, target_value, target_unit)
VALUES (
    'a1a1a1a1-0012-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'frequency',
    3,
    'workouts'
);
SELECT set_config('request.jwt.claims', '', true);

INSERT INTO public.oauth_tokens (id, user_id, provider)
VALUES (
    'a1a1a1a1-0013-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'strava'
);

INSERT INTO public.user_integrations (id, user_id, provider)
VALUES (
    'a1a1a1a1-0014-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'strava'
);

INSERT INTO public.deletion_requests (id, user_id)
VALUES (
    'a1a1a1a1-0015-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a'
);

-- (table, fixture id, owner_select, owner_update, owner_delete, update_set)
--   owner_select: rows A must see (oauth_tokens is service-role only).
--   owner_update / owner_delete: expected affected rows for A, or NULL when
--   the table intentionally has no owner policy for that command (not probed).
CREATE TEMP TABLE rls_cases (
    table_name text PRIMARY KEY,
    row_id uuid NOT NULL,
    owner_select integer NOT NULL,
    owner_update integer,
    owner_delete integer,
    update_set text NOT NULL DEFAULT 'id = id'
) ON COMMIT DROP;

INSERT INTO rls_cases VALUES
    ('workout_sessions',  'a1a1a1a1-0001-4000-8000-00000000000a', 1, 1,    NULL, 'id = id'),
    ('exercises',         'a1a1a1a1-0002-4000-8000-00000000000a', 1, NULL, NULL, 'id = id'),
    ('sets',              'a1a1a1a1-0003-4000-8000-00000000000a', 1, NULL, NULL, 'id = id'),
    ('rep_summaries',     'a1a1a1a1-0004-4000-8000-00000000000a', 1, NULL, NULL, 'id = id'),
    ('rep_telemetry',     'a1a1a1a1-0005-4000-8000-00000000000a', 1, NULL, NULL, 'id = id'),
    ('routines',          'a1a1a1a1-0006-4000-8000-00000000000a', 1, 1,    1,    'id = id'),
    ('routine_exercises', 'a1a1a1a1-0007-4000-8000-00000000000a', 1, 1,    1,    'id = id'),
    ('training_cycles',   'a1a1a1a1-0008-4000-8000-00000000000a', 1, 1,    1,    'id = id'),
    ('cycle_days',        'a1a1a1a1-0009-4000-8000-00000000000a', 1, 1,    1,    'id = id'),
    ('personal_records',  'a1a1a1a1-0010-4000-8000-00000000000a', 1, NULL, NULL, 'id = id'),
    ('exercise_progress', 'a1a1a1a1-0011-4000-8000-00000000000a', 1, NULL, NULL, 'id = id'),
    ('user_goals',        'a1a1a1a1-0012-4000-8000-00000000000a', 1, 1,    1,    'id = id'),
    ('subscriptions',     'a1a1a1a1-5555-4000-8000-00000000000a', 1, NULL, NULL, 'id = id'),
    ('oauth_tokens',      'a1a1a1a1-0013-4000-8000-00000000000a', 0, NULL, NULL, 'id = id'),
    ('user_integrations', 'a1a1a1a1-0014-4000-8000-00000000000a', 1, 1,    1,    'status = status'),
    ('deletion_requests', 'a1a1a1a1-0015-4000-8000-00000000000a', 1, NULL, NULL, 'status = status');

GRANT SELECT ON rls_cases TO anon, authenticated;

-- ---------------------------------------------------------------------------
SELECT diag('database:rls-isolation-catalog');
-- ---------------------------------------------------------------------------

SELECT is(
    (SELECT count(*)::integer FROM rls_cases),
    16,
    'all 16 user-owned tables are covered'
);

SELECT ok(
    c.relrowsecurity,
    format('RLS is enabled on public.%s', rc.table_name)
)
FROM rls_cases rc
JOIN pg_class c
  ON c.oid = format('public.%I', rc.table_name)::regclass
ORDER BY rc.table_name;

-- Fixture sanity: every fixture row exists (as postgres, RLS bypassed).
SELECT is(
    pg_temp.rls_probe(rc.table_name, 'select', rc.row_id),
    1,
    format('fixture row exists in public.%s', rc.table_name)
)
FROM rls_cases rc
ORDER BY rc.table_name;

-- Capture the subscription state before any client attempt.
CREATE TEMP TABLE subscription_before ON COMMIT DROP AS
SELECT user_id, tier, status, current_period_end
FROM public.subscriptions
WHERE user_id IN (
    'a1a1a1a1-0000-4000-8000-00000000000a'::uuid,
    'b2b2b2b2-0000-4000-8000-00000000000b'::uuid
);

-- ---------------------------------------------------------------------------
SELECT diag('database:rls-isolation-owner-positive-control');
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('authenticated', 'a1a1a1a1-0000-4000-8000-00000000000a');

SELECT is(
    pg_temp.rls_probe(rc.table_name, 'select', rc.row_id),
    rc.owner_select,
    format('owner A sees %s own row(s) in public.%s', rc.owner_select, rc.table_name)
)
FROM rls_cases rc
ORDER BY rc.table_name;

SELECT is(
    pg_temp.rls_probe(rc.table_name, 'update', rc.row_id, rc.update_set),
    rc.owner_update,
    format('owner A can UPDATE own row in public.%s', rc.table_name)
)
FROM rls_cases rc
WHERE rc.owner_update IS NOT NULL
ORDER BY rc.table_name;

SELECT is(
    pg_temp.rls_probe(rc.table_name, 'delete', rc.row_id),
    rc.owner_delete,
    format('owner A can DELETE own row in public.%s', rc.table_name)
)
FROM rls_cases rc
WHERE rc.owner_delete IS NOT NULL
ORDER BY rc.table_name;

RESET ROLE;

-- ---------------------------------------------------------------------------
SELECT diag('database:rls-isolation-cross-user');
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('authenticated', 'b2b2b2b2-0000-4000-8000-00000000000b');

SELECT cmp_ok(
    pg_temp.rls_probe(rc.table_name, 'select', rc.row_id),
    '<=',
    0,
    format('user B cannot SELECT A''s row in public.%s', rc.table_name)
)
FROM rls_cases rc
ORDER BY rc.table_name;

SELECT cmp_ok(
    pg_temp.rls_probe(rc.table_name, 'update', rc.row_id, rc.update_set),
    '<=',
    0,
    format('user B cannot UPDATE A''s row in public.%s', rc.table_name)
)
FROM rls_cases rc
ORDER BY rc.table_name;

SELECT cmp_ok(
    pg_temp.rls_probe(rc.table_name, 'delete', rc.row_id),
    '<=',
    0,
    format('user B cannot DELETE A''s row in public.%s', rc.table_name)
)
FROM rls_cases rc
ORDER BY rc.table_name;

RESET ROLE;

-- ---------------------------------------------------------------------------
SELECT diag('database:rls-isolation-anon');
-- ---------------------------------------------------------------------------

SET LOCAL ROLE anon;
SELECT pg_temp.act_as('anon', NULL);

SELECT cmp_ok(
    pg_temp.rls_probe(rc.table_name, 'select', rc.row_id),
    '<=',
    0,
    format('anon cannot read A''s row in public.%s', rc.table_name)
)
FROM rls_cases rc
ORDER BY rc.table_name;

SELECT cmp_ok(
    pg_temp.rls_probe(rc.table_name, 'update', rc.row_id, rc.update_set),
    '<=',
    0,
    format('anon cannot UPDATE A''s row in public.%s', rc.table_name)
)
FROM rls_cases rc
ORDER BY rc.table_name;

SELECT cmp_ok(
    pg_temp.rls_probe(rc.table_name, 'delete', rc.row_id),
    '<=',
    0,
    format('anon cannot DELETE A''s row in public.%s', rc.table_name)
)
FROM rls_cases rc
ORDER BY rc.table_name;

RESET ROLE;

-- ---------------------------------------------------------------------------
SELECT diag('database:rls-isolation-subscription-tier');
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('authenticated', 'a1a1a1a1-0000-4000-8000-00000000000a');

SELECT is(
    pg_temp.rls_probe(
        'subscriptions',
        'update',
        'a1a1a1a1-5555-4000-8000-00000000000a',
        $set$tier = 'INFERNO', current_period_end = now() + INTERVAL '10 years'$set$
    ),
    0,
    'A cannot UPDATE its own subscription (no client UPDATE policy)'
);

-- Not wrapped in rls_probe: a successful raise must stick so the invariant
-- checks below would see it.
UPDATE public.subscriptions
SET tier = 'INFERNO'
WHERE user_id = 'a1a1a1a1-0000-4000-8000-00000000000a';

SELECT throws_ok(
    $sql$
        INSERT INTO public.subscriptions (user_id, tier, status)
        VALUES ('a1a1a1a1-0000-4000-8000-00000000000a', 'INFERNO', 'active')
        ON CONFLICT (user_id) DO UPDATE SET tier = EXCLUDED.tier
    $sql$,
    '42501',
    NULL,
    'A cannot upsert its own subscription to a higher tier'
);

SELECT is(
    public.user_has_min_tier('FLAME'),
    false,
    'A still does not hold FLAME after the attempts'
);

RESET ROLE;

-- C has no subscription row (FREE) and tries to grant itself one.
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('authenticated', 'c3c3c3c3-0000-4000-8000-00000000000c');

SELECT throws_ok(
    $sql$
        INSERT INTO public.subscriptions (user_id, tier, status)
        VALUES ('c3c3c3c3-0000-4000-8000-00000000000c', 'INFERNO', 'active')
    $sql$,
    '42501',
    NULL,
    'a FREE user cannot INSERT a subscription for itself'
);

SELECT is(
    public.user_has_min_tier('EMBER'),
    false,
    'FREE user C is still below EMBER after the attempt'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT results_eq(
    $sql$
        SELECT user_id, tier, status, current_period_end
        FROM public.subscriptions
        WHERE user_id IN (
            'a1a1a1a1-0000-4000-8000-00000000000a'::uuid,
            'b2b2b2b2-0000-4000-8000-00000000000b'::uuid
        )
        ORDER BY user_id
    $sql$,
    $sql$
        SELECT user_id, tier, status, current_period_end
        FROM subscription_before
        ORDER BY user_id
    $sql$,
    'subscriptions are unchanged after every client write attempt'
);

SELECT is(
    (
        SELECT count(*)::integer
        FROM public.subscriptions
        WHERE user_id = 'c3c3c3c3-0000-4000-8000-00000000000c'
    ),
    0,
    'no subscription row was created for C'
);

-- Fixtures survived every probe (probes always roll back; B/anon wrote nothing).
SELECT is(
    pg_temp.rls_probe(rc.table_name, 'select', rc.row_id),
    1,
    format('A''s row in public.%s is still present after all probes', rc.table_name)
)
FROM rls_cases rc
ORDER BY rc.table_name;

SELECT * FROM finish();

ROLLBACK;
