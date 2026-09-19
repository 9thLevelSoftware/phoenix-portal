-- Server-side FLAME tier matrix (20260920000900_flame_write_policies.sql).
--
-- E is EMBER, F is FLAME, X is a FREE creator that E and F follow / block.
-- For every FLAME-gated table:
--   * the INSERT / UPDATE policies use the (select ...) initPlan form for
--     both auth.uid() and user_has_min_tier('FLAME') (checked in pg_policies);
--   * E is denied INSERT (42501) and cannot UPDATE its own rows;
--   * F may INSERT and UPDATE its own rows.
-- Downgrade safety: E can still DELETE its own comment, shared routine,
-- shared cycle, vote, follow, saved item and challenge participation, and
-- can still INSERT user_blocks and content_reports. The DEFINER import RPCs raise FLAME_REQUIRED for E.
--
-- Mobile push is not exercised here: it writes through the service_role
-- client (bypasses RLS) and is covered by the Edge handler tests.
--
-- Every attempt runs in a subtransaction that is always rolled back.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

-- Runs p_sql and always rolls it back. Returns 'rows:<n>' on success, else
-- '<SQLSTATE> <message>'.
CREATE FUNCTION pg_temp.attempt(p_sql text) RETURNS text
LANGUAGE plpgsql
AS $attempt$
DECLARE
    affected integer;
BEGIN
    BEGIN
        EXECUTE p_sql;
        GET DIAGNOSTICS affected = ROW_COUNT;
        RAISE EXCEPTION USING ERRCODE = 'P0T01', MESSAGE = 'rows:' || affected;
    EXCEPTION
        WHEN SQLSTATE 'P0T01' THEN
            RETURN SQLERRM;
        WHEN OTHERS THEN
            RETURN SQLSTATE || ' ' || SQLERRM;
    END;
END
$attempt$;

CREATE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void
LANGUAGE plpgsql
AS $act$
BEGIN
    PERFORM set_config(
        'request.jwt.claims',
        json_build_object('sub', p_user, 'role', 'authenticated')::text,
        true
    );
END
$act$;

-- ---------------------------------------------------------------------------
-- 1. Policy shape: every INSERT / UPDATE policy on a FLAME table carries the
--    initPlan FLAME check; DELETE and the safety tables carry no tier check.
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE flame_tables (table_name text PRIMARY KEY, owner_col text)
ON COMMIT DROP;
INSERT INTO flame_tables VALUES
    ('shared_routines', 'user_id'),
    ('shared_cycles', 'user_id'),
    ('community_votes', 'user_id'),
    ('community_comments', 'user_id'),
    ('saved_community_items', 'user_id'),
    ('challenge_participants', 'user_id'),
    ('creator_follows', 'follower_id'),
    ('user_integrations', 'user_id'),
    ('sync_queue', 'user_id'),
    ('routines', 'user_id'),
    ('training_cycles', 'user_id'),
    ('routine_exercises', NULL),
    ('cycle_days', NULL);

SELECT is(
    (
        SELECT count(*)::integer
        FROM flame_tables ft
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_policies p
            WHERE p.schemaname = 'public'
              AND p.tablename = ft.table_name
              AND p.cmd = 'INSERT'
        )
    ),
    0,
    'every FLAME table has an INSERT policy'
);

SELECT ok(
    p.with_check LIKE '%( SELECT user_has_min_tier(''FLAME''::text) AS user_has_min_tier)%'
        AND p.with_check LIKE '%( SELECT auth.uid() AS uid)%',
    format('%s INSERT policy "%s" checks FLAME and auth.uid() as initPlans', p.tablename, p.policyname)
)
FROM pg_policies p
JOIN flame_tables ft ON ft.table_name = p.tablename
WHERE p.schemaname = 'public'
  AND p.cmd IN ('INSERT', 'ALL')
ORDER BY p.tablename, p.policyname;

SELECT ok(
    p.qual LIKE '%( SELECT user_has_min_tier(''FLAME''::text) AS user_has_min_tier)%'
        AND p.qual LIKE '%( SELECT auth.uid() AS uid)%'
        AND p.with_check LIKE '%( SELECT user_has_min_tier(''FLAME''::text) AS user_has_min_tier)%'
        AND p.with_check LIKE '%( SELECT auth.uid() AS uid)%',
    format('%s UPDATE policy "%s" checks FLAME and auth.uid() as initPlans', p.tablename, p.policyname)
)
FROM pg_policies p
JOIN flame_tables ft ON ft.table_name = p.tablename
WHERE p.schemaname = 'public'
  AND p.cmd = 'UPDATE'
ORDER BY p.tablename, p.policyname;

SELECT is(
    (
        SELECT count(*)::integer
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename IN (
              'shared_routines', 'shared_cycles', 'community_votes',
              'community_comments', 'saved_community_items',
              'challenge_participants', 'creator_follows', 'user_integrations'
          )
          AND p.cmd = 'DELETE'
          AND (
              coalesce(p.qual, '') LIKE '%tier%'
              OR coalesce(p.with_check, '') LIKE '%tier%'
          )
    ),
    0,
    'community / sharing / integration DELETE policies carry no tier check'
);

SELECT is(
    (
        SELECT count(*)::integer
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename IN ('user_blocks', 'content_reports')
          AND (
              coalesce(p.qual, '') LIKE '%tier%'
              OR coalesce(p.with_check, '') LIKE '%tier%'
          )
    ),
    0,
    'user_blocks and content_reports (safety features) carry no tier check'
);

SELECT ok(
    pg_get_functiondef('public.import_shared_routine(uuid, text)'::regprocedure)
        LIKE '%user_has_min_tier(''FLAME'')%FLAME_REQUIRED%',
    'import_shared_routine checks FLAME'
);

SELECT ok(
    pg_get_functiondef('public.import_shared_cycle(uuid, text)'::regprocedure)
        LIKE '%user_has_min_tier(''FLAME'')%FLAME_REQUIRED%',
    'import_shared_cycle checks FLAME'
);

-- ---------------------------------------------------------------------------
-- 2. Fixtures (as postgres, bypassing RLS).
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, email)
VALUES
    ('e1e1e1e1-0000-4000-8000-00000000000e'::uuid, 'tier-ember@example.test'),
    ('f1f1f1f1-0000-4000-8000-00000000000f'::uuid, 'tier-flame@example.test'),
    ('c1c1c1c1-0000-4000-8000-00000000000c'::uuid, 'tier-creator@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.profiles (id)
VALUES
    ('e1e1e1e1-0000-4000-8000-00000000000e'),
    ('f1f1f1f1-0000-4000-8000-00000000000f'),
    ('c1c1c1c1-0000-4000-8000-00000000000c')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES
    ('e1e1e1e1-0000-4000-8000-00000000000e'::uuid, 'EMBER', 'active', now() + INTERVAL '30 days'),
    ('f1f1f1f1-0000-4000-8000-00000000000f'::uuid, 'FLAME', 'active', now() + INTERVAL '30 days')
ON CONFLICT (user_id) DO UPDATE
SET tier = EXCLUDED.tier,
    status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end;

INSERT INTO public.challenges (id, name, challenge_type, target_value)
VALUES
    ('c4c4c4c4-0001-4000-8000-000000000001'::uuid, 'Tier joined', 'volume', 1),
    ('c4c4c4c4-0002-4000-8000-000000000002'::uuid, 'Tier new', 'volume', 1);

-- E's and F's own rows (ids: e1e1e1e1-00NN / f1f1f1f1-00NN).
INSERT INTO public.routines (id, user_id, name) VALUES
    ('e1e1e1e1-0001-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e', 'E routine'),
    ('f1f1f1f1-0001-4000-8000-00000000000f', 'f1f1f1f1-0000-4000-8000-00000000000f', 'F routine');

INSERT INTO public.routine_exercises (id, routine_id, name) VALUES
    ('e1e1e1e1-0002-4000-8000-00000000000e', 'e1e1e1e1-0001-4000-8000-00000000000e', 'Row'),
    ('f1f1f1f1-0002-4000-8000-00000000000f', 'f1f1f1f1-0001-4000-8000-00000000000f', 'Row');

INSERT INTO public.training_cycles (id, user_id, name) VALUES
    ('e1e1e1e1-0003-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e', 'E cycle'),
    ('f1f1f1f1-0003-4000-8000-00000000000f', 'f1f1f1f1-0000-4000-8000-00000000000f', 'F cycle');

INSERT INTO public.cycle_days (id, cycle_id, day_number) VALUES
    ('e1e1e1e1-0004-4000-8000-00000000000e', 'e1e1e1e1-0003-4000-8000-00000000000e', 1),
    ('f1f1f1f1-0004-4000-8000-00000000000f', 'f1f1f1f1-0003-4000-8000-00000000000f', 1);

INSERT INTO public.shared_routines (id, user_id, routine_id, name, exercises_snapshot) VALUES
    ('e1e1e1e1-0005-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e',
     'e1e1e1e1-0001-4000-8000-00000000000e', 'E shared routine', '[]'::jsonb),
    ('f1f1f1f1-0005-4000-8000-00000000000f', 'f1f1f1f1-0000-4000-8000-00000000000f',
     'f1f1f1f1-0001-4000-8000-00000000000f', 'F shared routine',
     '[{"name": "Row", "order_index": 0}]'::jsonb);

INSERT INTO public.shared_cycles (id, user_id, cycle_id, name, cycle_snapshot) VALUES
    ('e1e1e1e1-0006-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e',
     'e1e1e1e1-0003-4000-8000-00000000000e', 'E shared cycle', '{"days": []}'::jsonb),
    ('f1f1f1f1-0006-4000-8000-00000000000f', 'f1f1f1f1-0000-4000-8000-00000000000f',
     'f1f1f1f1-0003-4000-8000-00000000000f', 'F shared cycle',
     '{"days": [{"day_number": 1, "day_type": "workout", "routine": {"name": "Day routine", "exercises": [{"name": "Press", "order_index": 0}]}}]}'::jsonb);

INSERT INTO public.community_votes (id, user_id, item_id, item_type) VALUES
    ('e1e1e1e1-0007-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e',
     'f1f1f1f1-0005-4000-8000-00000000000f', 'routine');

INSERT INTO public.community_comments (id, user_id, item_id, item_type, body) VALUES
    ('e1e1e1e1-0008-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e',
     'f1f1f1f1-0005-4000-8000-00000000000f', 'routine', 'E comment'),
    ('f1f1f1f1-0008-4000-8000-00000000000f', 'f1f1f1f1-0000-4000-8000-00000000000f',
     'f1f1f1f1-0005-4000-8000-00000000000f', 'routine', 'F comment');

INSERT INTO public.saved_community_items (id, user_id, shared_item_id, item_type) VALUES
    ('e1e1e1e1-0009-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e',
     'f1f1f1f1-0005-4000-8000-00000000000f', 'routine');

INSERT INTO public.creator_follows (id, follower_id, followed_id) VALUES
    ('e1e1e1e1-0010-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e',
     'c1c1c1c1-0000-4000-8000-00000000000c');

INSERT INTO public.challenge_participants (id, challenge_id, user_id) VALUES
    ('e1e1e1e1-0011-4000-8000-00000000000e', 'c4c4c4c4-0001-4000-8000-000000000001',
     'e1e1e1e1-0000-4000-8000-00000000000e');

INSERT INTO public.user_integrations (id, user_id, provider) VALUES
    ('e1e1e1e1-0012-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e', 'strava'),
    ('f1f1f1f1-0012-4000-8000-00000000000f', 'f1f1f1f1-0000-4000-8000-00000000000f', 'strava');

-- ---------------------------------------------------------------------------
-- 3. EMBER user E.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('e1e1e1e1-0000-4000-8000-00000000000e');

SELECT is(public.user_has_min_tier('EMBER'), true, 'E is EMBER');
SELECT is(public.user_has_min_tier('FLAME'), false, 'E is below FLAME');

-- INSERT is denied on every FLAME table.
SELECT matches(
    pg_temp.attempt(c.stmt),
    '^42501',
    'EMBER cannot INSERT ' || c.label
)
FROM (VALUES
    ('shared_routines', $q$INSERT INTO public.shared_routines (user_id, routine_id, name) VALUES ('e1e1e1e1-0000-4000-8000-00000000000e', 'e1e1e1e1-0001-4000-8000-00000000000e', 'x')$q$),
    ('shared_cycles', $q$INSERT INTO public.shared_cycles (user_id, cycle_id, name) VALUES ('e1e1e1e1-0000-4000-8000-00000000000e', 'e1e1e1e1-0003-4000-8000-00000000000e', 'x')$q$),
    ('community_votes', $q$INSERT INTO public.community_votes (user_id, item_id, item_type) VALUES ('e1e1e1e1-0000-4000-8000-00000000000e', 'f1f1f1f1-0006-4000-8000-00000000000f', 'cycle')$q$),
    ('community_comments', $q$INSERT INTO public.community_comments (user_id, item_id, item_type, body) VALUES ('e1e1e1e1-0000-4000-8000-00000000000e', 'f1f1f1f1-0006-4000-8000-00000000000f', 'cycle', 'x')$q$),
    ('saved_community_items', $q$INSERT INTO public.saved_community_items (user_id, shared_item_id, item_type) VALUES ('e1e1e1e1-0000-4000-8000-00000000000e', 'f1f1f1f1-0006-4000-8000-00000000000f', 'cycle')$q$),
    ('creator_follows', $q$INSERT INTO public.creator_follows (follower_id, followed_id) VALUES ('e1e1e1e1-0000-4000-8000-00000000000e', 'f1f1f1f1-0000-4000-8000-00000000000f')$q$),
    ('challenge_participants', $q$INSERT INTO public.challenge_participants (challenge_id, user_id) VALUES ('c4c4c4c4-0002-4000-8000-000000000002', 'e1e1e1e1-0000-4000-8000-00000000000e')$q$),
    ('user_integrations', $q$INSERT INTO public.user_integrations (user_id, provider) VALUES ('e1e1e1e1-0000-4000-8000-00000000000e', 'hevy')$q$),
    ('sync_queue', $q$INSERT INTO public.sync_queue (user_id, provider) VALUES ('e1e1e1e1-0000-4000-8000-00000000000e', 'strava')$q$),
    ('routines', $q$INSERT INTO public.routines (user_id, name) VALUES ('e1e1e1e1-0000-4000-8000-00000000000e', 'x')$q$),
    ('training_cycles', $q$INSERT INTO public.training_cycles (user_id, name) VALUES ('e1e1e1e1-0000-4000-8000-00000000000e', 'x')$q$),
    ('routine_exercises', $q$INSERT INTO public.routine_exercises (routine_id, name) VALUES ('e1e1e1e1-0001-4000-8000-00000000000e', 'x')$q$),
    ('cycle_days', $q$INSERT INTO public.cycle_days (cycle_id, day_number) VALUES ('e1e1e1e1-0003-4000-8000-00000000000e', 2)$q$)
) AS c(label, stmt);

-- UPDATE of E's own rows changes nothing (filtered or refused).
SELECT matches(
    pg_temp.attempt(c.stmt),
    '^(42501|rows:0$)',
    'EMBER cannot UPDATE own ' || c.label
)
FROM (VALUES
    ('shared_routines', $q$UPDATE public.shared_routines SET name = 'x' WHERE id = 'e1e1e1e1-0005-4000-8000-00000000000e'$q$),
    ('shared_cycles', $q$UPDATE public.shared_cycles SET name = 'x' WHERE id = 'e1e1e1e1-0006-4000-8000-00000000000e'$q$),
    ('community_comments (edit body)', $q$UPDATE public.community_comments SET body = 'x' WHERE id = 'e1e1e1e1-0008-4000-8000-00000000000e'$q$),
    ('user_integrations', $q$UPDATE public.user_integrations SET status = 'error' WHERE id = 'e1e1e1e1-0012-4000-8000-00000000000e'$q$),
    ('routines', $q$UPDATE public.routines SET name = 'x' WHERE id = 'e1e1e1e1-0001-4000-8000-00000000000e'$q$),
    ('training_cycles', $q$UPDATE public.training_cycles SET name = 'x' WHERE id = 'e1e1e1e1-0003-4000-8000-00000000000e'$q$),
    ('routine_exercises', $q$UPDATE public.routine_exercises SET name = 'x' WHERE id = 'e1e1e1e1-0002-4000-8000-00000000000e'$q$),
    ('cycle_days', $q$UPDATE public.cycle_days SET day_number = 9 WHERE id = 'e1e1e1e1-0004-4000-8000-00000000000e'$q$)
) AS c(label, stmt);

-- Downgrade safety: E can still withdraw what it published or joined.
SELECT is(
    pg_temp.attempt(c.stmt),
    'rows:1',
    'EMBER can still ' || c.label
)
FROM (VALUES
    ('DELETE own comment', $q$DELETE FROM public.community_comments WHERE id = 'e1e1e1e1-0008-4000-8000-00000000000e'$q$),
    ('DELETE own shared routine', $q$DELETE FROM public.shared_routines WHERE id = 'e1e1e1e1-0005-4000-8000-00000000000e'$q$),
    ('DELETE own shared cycle', $q$DELETE FROM public.shared_cycles WHERE id = 'e1e1e1e1-0006-4000-8000-00000000000e'$q$),
    ('DELETE own vote', $q$DELETE FROM public.community_votes WHERE id = 'e1e1e1e1-0007-4000-8000-00000000000e'$q$),
    ('DELETE own follow', $q$DELETE FROM public.creator_follows WHERE id = 'e1e1e1e1-0010-4000-8000-00000000000e'$q$),
    ('DELETE own saved item', $q$DELETE FROM public.saved_community_items WHERE id = 'e1e1e1e1-0009-4000-8000-00000000000e'$q$),
    ('DELETE own challenge participation', $q$DELETE FROM public.challenge_participants WHERE id = 'e1e1e1e1-0011-4000-8000-00000000000e'$q$),
    ('INSERT user_blocks', $q$INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('e1e1e1e1-0000-4000-8000-00000000000e', 'c1c1c1c1-0000-4000-8000-00000000000c')$q$),
    ('INSERT content_reports', $q$INSERT INTO public.content_reports (reporter_id, content_id, content_type, category) VALUES ('e1e1e1e1-0000-4000-8000-00000000000e', 'f1f1f1f1-0005-4000-8000-00000000000f', 'routine', 'spam')$q$)
) AS c(label, stmt);

SELECT matches(
    pg_temp.attempt($q$SELECT public.import_shared_routine('f1f1f1f1-0005-4000-8000-00000000000f'::uuid)$q$),
    '^P0001 FLAME_REQUIRED',
    'EMBER cannot import_shared_routine (FLAME_REQUIRED)'
);

SELECT matches(
    pg_temp.attempt($q$SELECT public.import_shared_cycle('f1f1f1f1-0006-4000-8000-00000000000f'::uuid)$q$),
    '^P0001 FLAME_REQUIRED',
    'EMBER cannot import_shared_cycle (FLAME_REQUIRED)'
);

-- ---------------------------------------------------------------------------
-- 4. FLAME user F.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('f1f1f1f1-0000-4000-8000-00000000000f');

SELECT is(public.user_has_min_tier('FLAME'), true, 'F is FLAME');

SELECT is(
    pg_temp.attempt(c.stmt),
    'rows:1',
    'FLAME can ' || c.label
)
FROM (VALUES
    ('INSERT shared_routines', $q$INSERT INTO public.shared_routines (user_id, routine_id, name) VALUES ('f1f1f1f1-0000-4000-8000-00000000000f', 'f1f1f1f1-0001-4000-8000-00000000000f', 'x')$q$),
    ('INSERT shared_cycles', $q$INSERT INTO public.shared_cycles (user_id, cycle_id, name) VALUES ('f1f1f1f1-0000-4000-8000-00000000000f', 'f1f1f1f1-0003-4000-8000-00000000000f', 'x')$q$),
    ('INSERT community_votes', $q$INSERT INTO public.community_votes (user_id, item_id, item_type) VALUES ('f1f1f1f1-0000-4000-8000-00000000000f', 'f1f1f1f1-0006-4000-8000-00000000000f', 'cycle')$q$),
    ('INSERT community_comments', $q$INSERT INTO public.community_comments (user_id, item_id, item_type, body) VALUES ('f1f1f1f1-0000-4000-8000-00000000000f', 'f1f1f1f1-0006-4000-8000-00000000000f', 'cycle', 'x')$q$),
    ('INSERT saved_community_items', $q$INSERT INTO public.saved_community_items (user_id, shared_item_id, item_type) VALUES ('f1f1f1f1-0000-4000-8000-00000000000f', 'f1f1f1f1-0006-4000-8000-00000000000f', 'cycle')$q$),
    ('INSERT creator_follows', $q$INSERT INTO public.creator_follows (follower_id, followed_id) VALUES ('f1f1f1f1-0000-4000-8000-00000000000f', 'c1c1c1c1-0000-4000-8000-00000000000c')$q$),
    ('INSERT challenge_participants', $q$INSERT INTO public.challenge_participants (challenge_id, user_id) VALUES ('c4c4c4c4-0002-4000-8000-000000000002', 'f1f1f1f1-0000-4000-8000-00000000000f')$q$),
    ('INSERT user_integrations', $q$INSERT INTO public.user_integrations (user_id, provider) VALUES ('f1f1f1f1-0000-4000-8000-00000000000f', 'hevy')$q$),
    ('INSERT sync_queue', $q$INSERT INTO public.sync_queue (user_id, provider) VALUES ('f1f1f1f1-0000-4000-8000-00000000000f', 'strava')$q$),
    ('INSERT routines', $q$INSERT INTO public.routines (user_id, name) VALUES ('f1f1f1f1-0000-4000-8000-00000000000f', 'x')$q$),
    ('INSERT training_cycles', $q$INSERT INTO public.training_cycles (user_id, name) VALUES ('f1f1f1f1-0000-4000-8000-00000000000f', 'x')$q$),
    ('INSERT routine_exercises', $q$INSERT INTO public.routine_exercises (routine_id, name) VALUES ('f1f1f1f1-0001-4000-8000-00000000000f', 'x')$q$),
    ('INSERT cycle_days', $q$INSERT INTO public.cycle_days (cycle_id, day_number) VALUES ('f1f1f1f1-0003-4000-8000-00000000000f', 2)$q$),
    ('UPDATE own shared_routines', $q$UPDATE public.shared_routines SET name = 'x' WHERE id = 'f1f1f1f1-0005-4000-8000-00000000000f'$q$),
    ('UPDATE own shared_cycles', $q$UPDATE public.shared_cycles SET name = 'x' WHERE id = 'f1f1f1f1-0006-4000-8000-00000000000f'$q$),
    ('edit own recent comment', $q$UPDATE public.community_comments SET body = 'x' WHERE id = 'f1f1f1f1-0008-4000-8000-00000000000f'$q$),
    ('UPDATE own user_integrations', $q$UPDATE public.user_integrations SET status = 'error' WHERE id = 'f1f1f1f1-0012-4000-8000-00000000000f'$q$),
    ('UPDATE own routines', $q$UPDATE public.routines SET name = 'x' WHERE id = 'f1f1f1f1-0001-4000-8000-00000000000f'$q$),
    ('UPDATE own training_cycles', $q$UPDATE public.training_cycles SET name = 'x' WHERE id = 'f1f1f1f1-0003-4000-8000-00000000000f'$q$),
    ('UPDATE own routine_exercises', $q$UPDATE public.routine_exercises SET name = 'x' WHERE id = 'f1f1f1f1-0002-4000-8000-00000000000f'$q$),
    ('UPDATE own cycle_days', $q$UPDATE public.cycle_days SET day_number = 9 WHERE id = 'f1f1f1f1-0004-4000-8000-00000000000f'$q$)
) AS c(label, stmt);

-- FLAME still cannot write under another user's identity or parent.
SELECT matches(
    pg_temp.attempt(c.stmt),
    '^42501',
    'FLAME cannot ' || c.label
)
FROM (VALUES
    ('INSERT a shared routine owned by E', $q$INSERT INTO public.shared_routines (user_id, routine_id, name) VALUES ('e1e1e1e1-0000-4000-8000-00000000000e', 'e1e1e1e1-0001-4000-8000-00000000000e', 'x')$q$),
    ('INSERT a follow as E', $q$INSERT INTO public.creator_follows (follower_id, followed_id) VALUES ('e1e1e1e1-0000-4000-8000-00000000000e', 'f1f1f1f1-0000-4000-8000-00000000000f')$q$),
    ('INSERT an exercise under E''s routine', $q$INSERT INTO public.routine_exercises (routine_id, name) VALUES ('e1e1e1e1-0001-4000-8000-00000000000e', 'x')$q$),
    ('INSERT a day under E''s cycle', $q$INSERT INTO public.cycle_days (cycle_id, day_number) VALUES ('e1e1e1e1-0003-4000-8000-00000000000e', 3)$q$)
) AS c(label, stmt);

SELECT matches(
    pg_temp.attempt($q$SELECT public.import_shared_routine('f1f1f1f1-0005-4000-8000-00000000000f'::uuid)$q$),
    '^rows:',
    'FLAME can import_shared_routine'
);

SELECT matches(
    pg_temp.attempt($q$SELECT public.import_shared_cycle('f1f1f1f1-0006-4000-8000-00000000000f'::uuid)$q$),
    '^rows:',
    'FLAME can import_shared_cycle'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT * FROM finish();

ROLLBACK;
