-- Server-side tier matrix: FLAME writes
-- (20260920000900_flame_write_policies.sql, sections 1-5) and INFERNO reads
-- (20260920003800_inferno_read_policies.sql, section 6).
--
-- E is EMBER, F is FLAME, I is INFERNO (section 6 only), D is a past_due
-- FLAME subscriber, X is a FREE creator that E and F follow / block.
-- Server-side FLAME tier matrix (20260920000900_flame_write_policies.sql).
--
-- E is EMBER, F is FLAME, X is a FREE creator that E and F follow / block.
-- For every FLAME-gated table:
--   * the INSERT / UPDATE policies use the (select ...) initPlan form for
--     both auth.uid() and user_has_min_tier('FLAME') (checked in pg_policies);
--   * E is denied INSERT (42501) and cannot UPDATE its own rows;
--   * F may INSERT and UPDATE its own rows.
-- Downgrade safety: E can still DELETE its own comment, shared routine,
-- shared cycle, vote, follow, saved item and challenge participation, its own
-- routine / training cycle / routine_exercise / cycle_day, and can still
-- INSERT user_blocks and content_reports. The DEFINER import RPCs raise
-- FLAME_REQUIRED for E.
-- Section 3b exercises the comment-removal path the SPA really uses (a hard
-- DELETE with a row check) and proves comment_count follows it exactly once.
-- Section 5 pins that past_due entitlement is decided by
-- user_subscription_tier(), not by these policies (PR 8 owns the predicate).
-- The 5-minute comment edit window and the column-level write grants that
-- make it authoritative are asserted in section 1 and section 4.
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

-- R-10: the same guard for UPDATE. The shape assertions below are row-driven,
-- so dropping an UPDATE policy would silently produce one assertion fewer
-- rather than a failure (no_plan() cannot notice a vanished assertion). These
-- two checks make both the existence and the count load-bearing.
CREATE TEMP TABLE flame_update_tables (table_name text PRIMARY KEY)
ON COMMIT DROP;
INSERT INTO flame_update_tables VALUES
    ('shared_routines'),
    ('shared_cycles'),
    ('community_comments'),
    ('user_integrations'),
    ('routines'),
    ('training_cycles'),
    ('routine_exercises'),
    ('cycle_days');

SELECT is(
    (
        SELECT count(*)::integer
        FROM flame_update_tables ft
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_policies p
            WHERE p.schemaname = 'public'
              AND p.tablename = ft.table_name
              AND p.cmd = 'UPDATE'
        )
    ),
    0,
    'every FLAME table that owns an UPDATE policy still has one'
);

SELECT is(
    (
        SELECT count(*)::integer
        FROM pg_policies p
        JOIN flame_tables ft ON ft.table_name = p.tablename
        WHERE p.schemaname = 'public'
          AND p.cmd = 'UPDATE'
    ),
    (SELECT count(*)::integer FROM flame_update_tables),
    'the FLAME tables carry exactly one UPDATE policy each'
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

-- R-12: the 5-minute comment edit window must be judged on the stored row
-- (USING), not only on the row being written (WITH CHECK). With the window in
-- WITH CHECK alone, `UPDATE ... SET body = ?, created_at = now()` passes for a
-- comment of any age.
SELECT ok(
    p.qual LIKE '%created_at%' AND p.with_check LIKE '%created_at%',
    'community_comments UPDATE policy checks the edit window in USING and WITH CHECK'
)
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND p.tablename = 'community_comments'
  AND p.cmd = 'UPDATE';

-- R-12 / R-13: column-level write grants. RLS decides which rows a client may
-- touch; these grants decide which columns, and they are what stops a FLAME
-- owner backdating created_at (or writing deleted_at from a browser at all),
-- and a joining user setting completed_at.
SELECT ok(
    has_column_privilege('authenticated', 'public.community_comments', 'body', 'UPDATE')
    AND has_column_privilege('authenticated', 'public.community_comments', 'updated_at', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.community_comments', 'created_at', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.community_comments', 'deleted_at', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.community_comments', 'user_id', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.community_comments', 'item_id', 'UPDATE'),
    'authenticated may UPDATE only body / updated_at on community_comments'
);

SELECT ok(
    has_column_privilege('authenticated', 'public.community_comments', 'body', 'INSERT')
    AND has_column_privilege('authenticated', 'public.community_comments', 'user_id', 'INSERT')
    AND has_column_privilege('authenticated', 'public.community_comments', 'item_id', 'INSERT')
    AND has_column_privilege('authenticated', 'public.community_comments', 'item_type', 'INSERT')
    AND NOT has_column_privilege('authenticated', 'public.community_comments', 'created_at', 'INSERT')
    AND NOT has_column_privilege('authenticated', 'public.community_comments', 'deleted_at', 'INSERT'),
    'authenticated cannot choose created_at / deleted_at when posting a comment'
);

SELECT ok(
    has_column_privilege('authenticated', 'public.challenge_participants', 'challenge_id', 'INSERT')
    AND has_column_privilege('authenticated', 'public.challenge_participants', 'user_id', 'INSERT')
    AND NOT has_column_privilege('authenticated', 'public.challenge_participants', 'completed_at', 'INSERT'),
    'joining a challenge cannot also mark it completed'
);

-- R-1 / R-3: the denormalised comment_count must follow a hard DELETE, which
-- is what the portal now issues. The trigger has to fire on DELETE at all.
SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = 'public.community_comments'::regclass
          AND t.tgname = 'update_comment_count_on_change'
          AND NOT t.tgisinternal
          AND (t.tgtype & 8) = 8   -- DELETE
          AND (t.tgtype & 4) = 4   -- INSERT
          AND (t.tgtype & 16) = 16 -- UPDATE
    ),
    'update_comment_count_on_change fires on INSERT, UPDATE and DELETE'
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
    ('d1d1d1d1-0000-4000-8000-00000000000d'::uuid, 'tier-pastdue@example.test'),
    ('c1c1c1c1-0000-4000-8000-00000000000c'::uuid, 'tier-creator@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.profiles (id)
VALUES
    ('e1e1e1e1-0000-4000-8000-00000000000e'),
    ('f1f1f1f1-0000-4000-8000-00000000000f'),
    ('d1d1d1d1-0000-4000-8000-00000000000d'),
    ('c1c1c1c1-0000-4000-8000-00000000000c')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES
    ('e1e1e1e1-0000-4000-8000-00000000000e'::uuid, 'EMBER', 'active', now() + INTERVAL '30 days'),
    ('f1f1f1f1-0000-4000-8000-00000000000f'::uuid, 'FLAME', 'active', now() + INTERVAL '30 days'),
    -- D is the past_due FLAME subscriber of R-4 (section 5).
    ('d1d1d1d1-0000-4000-8000-00000000000d'::uuid, 'FLAME', 'past_due', now() + INTERVAL '30 days')
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
     'f1f1f1f1-0005-4000-8000-00000000000f', 'routine', 'F comment'),
    -- R-1 / R-3: E's comment removed through the path the SPA really uses,
    -- and a row that will be left over from the old soft-delete era.
    ('e1e1e1e1-0013-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e',
     'f1f1f1f1-0005-4000-8000-00000000000f', 'routine', 'E comment to hard delete'),
    ('e1e1e1e1-0014-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e',
     'f1f1f1f1-0005-4000-8000-00000000000f', 'routine', 'E legacy tombstone');

-- Tombstone the legacy row through the UPDATE branch, exactly as rows written
-- before 20260920000901 were: comment_count is decremented here, so a later
-- hard DELETE must not decrement it a second time.
UPDATE public.community_comments
SET deleted_at = now()
WHERE id = 'e1e1e1e1-0014-4000-8000-00000000000e';

-- R-8 / R-12: a FLAME comment that is well outside the 5-minute edit window.
-- created_at is also outside the rate-limit window, so it does not consume F's
-- 5-comments-per-hour quota.
INSERT INTO public.community_comments (id, user_id, item_id, item_type, body, created_at) VALUES
    ('f1f1f1f1-0009-4000-8000-00000000000f', 'f1f1f1f1-0000-4000-8000-00000000000f',
     'f1f1f1f1-0005-4000-8000-00000000000f', 'routine', 'F old comment',
     now() - INTERVAL '1 day');

-- Baseline for the comment_count assertions in section 3b. Captured as
-- postgres: `authenticated` cannot read a temp table owned by this session.
CREATE TEMP TABLE comment_count_probe (label text PRIMARY KEY, value integer)
ON COMMIT DROP;
INSERT INTO comment_count_probe
SELECT 'baseline', comment_count
FROM public.shared_routines
WHERE id = 'f1f1f1f1-0005-4000-8000-00000000000f';

SELECT is(
    (SELECT value FROM comment_count_probe WHERE label = 'baseline'),
    (
        SELECT count(*)::integer FROM public.community_comments
        WHERE item_id = 'f1f1f1f1-0005-4000-8000-00000000000f'
          AND item_type = 'routine'
          AND deleted_at IS NULL
    ),
    'comment_count counts the live comments and excludes the tombstone'
);

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
    -- R-9: routine / cycle DELETE deliberately stays at EMBER so a downgraded
    -- author is not trapped. rls_isolation's A user is FLAME since this PR, so
    -- these four are the only remaining EMBER positive controls for them.
    ('DELETE own routine', $q$DELETE FROM public.routines WHERE id = 'e1e1e1e1-0001-4000-8000-00000000000e'$q$),
    ('DELETE own training cycle', $q$DELETE FROM public.training_cycles WHERE id = 'e1e1e1e1-0003-4000-8000-00000000000e'$q$),
    ('DELETE own routine_exercise', $q$DELETE FROM public.routine_exercises WHERE id = 'e1e1e1e1-0002-4000-8000-00000000000e'$q$),
    ('DELETE own cycle_day', $q$DELETE FROM public.cycle_days WHERE id = 'e1e1e1e1-0004-4000-8000-00000000000e'$q$),
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
-- 3b. The comment-removal path the portal actually uses (R-1 / R-3, NF-14).
--
--     src/mutations/comments.ts issues
--     `.delete().eq('id', …).eq('user_id', …).select('id')`. The old
--     soft-delete UPDATE could never work (the SELECT policy is
--     `deleted_at IS NULL`, so the new row is invisible) and 20260920000900
--     put it behind FLAME as well; the owner DELETE policy has no tier check,
--     which is what keeps a downgraded author able to withdraw a comment.
--
--     These statements are deliberately NOT wrapped in pg_temp.attempt():
--     attempt() rolls back, and the point is that comment_count really
--     follows the delete. (The whole file still rolls back at the end.)
-- ---------------------------------------------------------------------------
WITH deleted AS (
    DELETE FROM public.community_comments
    WHERE id = 'e1e1e1e1-0013-4000-8000-00000000000e'
      AND user_id = 'e1e1e1e1-0000-4000-8000-00000000000e'
    RETURNING id
)
SELECT is(
    (SELECT count(*)::integer FROM deleted),
    1,
    'EMBER can hard-DELETE its own comment and the client gets the row back'
);

-- A row left over from the soft-delete era cannot be reached by its author at
-- all: PostgreSQL applies SELECT policies to the rows an UPDATE or DELETE
-- reads, and the SELECT policy here is `deleted_at IS NULL`. That is why
-- 20260920000901 purges these rows server-side instead of leaving them for
-- the client to clean up.
SELECT is(
    pg_temp.attempt($q$DELETE FROM public.community_comments WHERE id = 'e1e1e1e1-0014-4000-8000-00000000000e' AND user_id = 'e1e1e1e1-0000-4000-8000-00000000000e'$q$),
    'rows:0',
    'a legacy tombstone is invisible even to its author, so only the server can remove it'
);

RESET ROLE;

SELECT is(
    (
        SELECT count(*)::integer FROM public.community_comments
        WHERE id = 'e1e1e1e1-0013-4000-8000-00000000000e'
    ),
    0,
    'the hard-deleted comment is really gone'
);

SELECT is(
    (
        SELECT comment_count FROM public.shared_routines
        WHERE id = 'f1f1f1f1-0005-4000-8000-00000000000f'
    ),
    (SELECT value FROM comment_count_probe WHERE label = 'baseline') - 1,
    'the hard delete decrements comment_count exactly once'
);

-- The server-side purge (migration 20260920000901) over a row that was
-- already soft-deleted must NOT take comment_count down again: the UPDATE
-- branch decremented it when deleted_at was set.
DELETE FROM public.community_comments
WHERE id = 'e1e1e1e1-0014-4000-8000-00000000000e';

SELECT is(
    (
        SELECT comment_count FROM public.shared_routines
        WHERE id = 'f1f1f1f1-0005-4000-8000-00000000000f'
    ),
    (SELECT value FROM comment_count_probe WHERE label = 'baseline') - 1,
    'purging an already soft-deleted comment does not decrement comment_count again'
);

SELECT is(
    (
        SELECT comment_count FROM public.shared_routines
        WHERE id = 'f1f1f1f1-0005-4000-8000-00000000000f'
    ),
    (
        SELECT count(*)::integer FROM public.community_comments
        WHERE item_id = 'f1f1f1f1-0005-4000-8000-00000000000f'
          AND item_type = 'routine'
          AND deleted_at IS NULL
    ),
    'comment_count still matches the live comments after both deletes'
);

SET LOCAL ROLE authenticated;

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

-- R-8 / R-12: the 5-minute edit window, and the two ways round it.
SELECT is(
    pg_temp.attempt($q$UPDATE public.community_comments SET body = 'late edit' WHERE id = 'f1f1f1f1-0009-4000-8000-00000000000f'$q$),
    'rows:0',
    'FLAME cannot edit its own comment once the 5-minute window has closed'
);

SELECT matches(
    pg_temp.attempt($q$UPDATE public.community_comments SET body = 'late edit', created_at = now() WHERE id = 'f1f1f1f1-0009-4000-8000-00000000000f'$q$),
    '^42501',
    'FLAME cannot reopen the edit window by rewriting created_at'
);

-- The old soft-delete path, pinned as permanently dead: the SELECT policy
-- (`deleted_at IS NULL`) is applied to the new row of an UPDATE, and
-- authenticated no longer even holds an UPDATE grant on deleted_at.
SELECT matches(
    pg_temp.attempt($q$UPDATE public.community_comments SET deleted_at = now() WHERE id = 'f1f1f1f1-0008-4000-8000-00000000000f'$q$),
    '^42501',
    'a browser soft-delete of a comment is refused (this is why removal is a hard DELETE)'
);

SELECT matches(
    pg_temp.attempt($q$INSERT INTO public.challenge_participants (challenge_id, user_id, completed_at) VALUES ('c4c4c4c4-0002-4000-8000-000000000002', 'f1f1f1f1-0000-4000-8000-00000000000f', now())$q$),
    '^42501',
    'FLAME cannot mark a challenge complete while joining it'
);

-- ---------------------------------------------------------------------------
-- 5. past_due FLAME subscriber D (R-4).
--
--     The user decision is that past_due keeps access. That verdict belongs to
--     public.user_subscription_tier() — PR 8 changes it — and must NOT be
--     re-decided inside these policies. So the assertion is a consistency one:
--     every FLAME gate returns exactly what the shared predicate returns for a
--     past_due subscriber. Green on this base (the predicate says FREE and the
--     policies deny) and green after PR 8 (the predicate says FLAME and the
--     policies allow); red the moment a policy grows a status rule of its own,
--     or a tier check drifts away from the helper.
--
--     PR 8 merge step (exec/integration-notes.md): once 20260920000800 is on
--     the branch, replace `public.user_has_min_tier('FLAME')` below with a
--     literal true so past_due access is asserted unconditionally.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('d1d1d1d1-0000-4000-8000-00000000000d');

SELECT is(
    pg_temp.attempt(c.stmt) = 'rows:1',
    public.user_has_min_tier('FLAME'),
    'past_due FLAME: ' || c.label || ' follows user_has_min_tier(FLAME)'
)
FROM (VALUES
    ('INSERT community_comments', $q$INSERT INTO public.community_comments (user_id, item_id, item_type, body) VALUES ('d1d1d1d1-0000-4000-8000-00000000000d', 'f1f1f1f1-0005-4000-8000-00000000000f', 'routine', 'x')$q$),
    ('INSERT community_votes', $q$INSERT INTO public.community_votes (user_id, item_id, item_type) VALUES ('d1d1d1d1-0000-4000-8000-00000000000d', 'f1f1f1f1-0005-4000-8000-00000000000f', 'routine')$q$),
    ('INSERT creator_follows', $q$INSERT INTO public.creator_follows (follower_id, followed_id) VALUES ('d1d1d1d1-0000-4000-8000-00000000000d', 'c1c1c1c1-0000-4000-8000-00000000000c')$q$),
    ('INSERT saved_community_items', $q$INSERT INTO public.saved_community_items (user_id, shared_item_id, item_type) VALUES ('d1d1d1d1-0000-4000-8000-00000000000d', 'f1f1f1f1-0005-4000-8000-00000000000f', 'routine')$q$),
    ('INSERT challenge_participants', $q$INSERT INTO public.challenge_participants (challenge_id, user_id) VALUES ('c4c4c4c4-0002-4000-8000-000000000002', 'd1d1d1d1-0000-4000-8000-00000000000d')$q$),
    ('INSERT user_integrations', $q$INSERT INTO public.user_integrations (user_id, provider) VALUES ('d1d1d1d1-0000-4000-8000-00000000000d', 'strava')$q$),
    ('INSERT sync_queue', $q$INSERT INTO public.sync_queue (user_id, provider) VALUES ('d1d1d1d1-0000-4000-8000-00000000000d', 'strava')$q$),
    ('INSERT routines', $q$INSERT INTO public.routines (user_id, name) VALUES ('d1d1d1d1-0000-4000-8000-00000000000d', 'x')$q$)
) AS c(label, stmt);

SELECT is(
    pg_temp.attempt($q$SELECT public.import_shared_routine('f1f1f1f1-0005-4000-8000-00000000000f'::uuid)$q$) LIKE 'rows:%',
    public.user_has_min_tier('FLAME'),
    'past_due FLAME: import_shared_routine follows user_has_min_tier(FLAME)'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- 6. INFERNO reads (PR 38, 20260920003800_inferno_read_policies.sql).
--
--     User decision: force curves are INFERNO and paid capability is enforced
--     server-side, so the rows must not leave the database for a FLAME user.
--     This section proves the boundary itself, not a component notice:
--       * the policy shape (exactly one permissive SELECT path per table,
--         carrying the INFERNO initPlan conjunct);
--       * EMBER and FLAME read ZERO rows from rep_telemetry, the
--         telemetry_points view the replay page actually queries,
--         vbt_assessments, session_phase_statistics and exercise_signatures —
--         even though the rows are theirs;
--       * INFERNO reads them all;
--       * FLAME still reads its session / exercise / set / rep_summaries, so
--         session replay degrades to rep-by-rep instead of disappearing;
--       * the service role still reads a FLAME user's telemetry, which is what
--         keeps the GDPR export (export-user-data) whole after the gate.
-- ---------------------------------------------------------------------------

CREATE FUNCTION pg_temp.visible_rows(p_relation text) RETURNS integer
LANGUAGE plpgsql
AS $vis$
DECLARE
    n integer;
BEGIN
    EXECUTE format('SELECT count(*)::integer FROM public.%I', p_relation) INTO n;
    RETURN n;
END
$vis$;

CREATE TEMP TABLE inferno_tables (table_name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO inferno_tables VALUES
    ('rep_telemetry'),
    ('vbt_assessments'),
    ('session_phase_statistics'),
    ('exercise_signatures');

-- Permissive SELECT policies OR together, so an ungated leftover would make
-- the gate a no-op. Each table must expose exactly one permissive read path
-- to authenticated.
SELECT is(
    (
        SELECT count(*)::integer
        FROM inferno_tables t
        WHERE (
            SELECT count(*)
            FROM pg_policies p
            WHERE p.schemaname = 'public'
              AND p.tablename = t.table_name
              AND p.cmd IN ('SELECT', 'ALL')
              AND p.permissive = 'PERMISSIVE'
              AND p.roles && ARRAY['authenticated', 'public']::name[]
        ) <> 1
    ),
    0,
    'each INFERNO table exposes exactly one permissive SELECT path to authenticated'
);

-- Row-driven shape assertions cannot notice a policy that vanished, so pin
-- the count too (same guard as R-10 in section 1).
SELECT is(
    (
        SELECT count(*)::integer
        FROM pg_policies p
        JOIN inferno_tables t ON t.table_name = p.tablename
        WHERE p.schemaname = 'public'
          AND p.cmd IN ('SELECT', 'ALL')
          AND p.roles && ARRAY['authenticated', 'public']::name[]
    ),
    (SELECT count(*)::integer FROM inferno_tables),
    'every INFERNO table still carries its authenticated SELECT policy'
);

SELECT ok(
    p.qual LIKE '%( SELECT user_has_min_tier(''INFERNO''::text) AS user_has_min_tier)%'
        AND p.qual LIKE '%( SELECT auth.uid() AS uid)%',
    format('%s SELECT policy "%s" checks INFERNO and auth.uid() as initPlans', p.tablename, p.policyname)
)
FROM pg_policies p
JOIN inferno_tables t ON t.table_name = p.tablename
WHERE p.schemaname = 'public'
  AND p.cmd IN ('SELECT', 'ALL')
  AND p.roles && ARRAY['authenticated', 'public']::name[]
ORDER BY p.tablename, p.policyname;

-- rep_summaries is the rep-by-rep replay source and must stay untouched by
-- the INFERNO gate, or FLAME replay dies with the force curves.
SELECT is(
    (
        SELECT count(*)::integer
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = 'rep_summaries'
          AND coalesce(p.qual, '') LIKE '%INFERNO%'
    ),
    0,
    'rep_summaries reads are not gated at INFERNO'
);

-- The replay page reads telemetry_points, not rep_telemetry. The view only
-- inherits the gate while it is security_invoker.
SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_class c
        WHERE c.oid = 'public.telemetry_points'::regclass
          AND array_to_string(c.reloptions, ',') ~* 'security_invoker=(true|on)'
    ),
    'telemetry_points is security_invoker, so it inherits the rep_telemetry gate'
);

-- Fixtures: one owned row in every gated table for an EMBER, a FLAME and an
-- INFERNO user, plus the session / exercise / set / rep_summary chain.
INSERT INTO auth.users (id, email)
VALUES ('a1a1a1a1-0000-4000-8000-00000000000a'::uuid, 'tier-inferno@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.profiles (id)
VALUES ('a1a1a1a1-0000-4000-8000-00000000000a')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES ('a1a1a1a1-0000-4000-8000-00000000000a'::uuid, 'INFERNO', 'active', now() + INTERVAL '30 days')
ON CONFLICT (user_id) DO UPDATE
SET tier = EXCLUDED.tier,
    status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end;

INSERT INTO public.workout_sessions (id, user_id, name) VALUES
    ('e1e1e1e1-0020-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e', 'E session'),
    ('f1f1f1f1-0020-4000-8000-00000000000f', 'f1f1f1f1-0000-4000-8000-00000000000f', 'F session'),
    ('a1a1a1a1-0020-4000-8000-00000000000a', 'a1a1a1a1-0000-4000-8000-00000000000a', 'I session');

INSERT INTO public.exercises (id, session_id, user_id, name) VALUES
    ('e1e1e1e1-0021-4000-8000-00000000000e', 'e1e1e1e1-0020-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e', 'Squat'),
    ('f1f1f1f1-0021-4000-8000-00000000000f', 'f1f1f1f1-0020-4000-8000-00000000000f', 'f1f1f1f1-0000-4000-8000-00000000000f', 'Squat'),
    ('a1a1a1a1-0021-4000-8000-00000000000a', 'a1a1a1a1-0020-4000-8000-00000000000a', 'a1a1a1a1-0000-4000-8000-00000000000a', 'Squat');

INSERT INTO public.sets (id, exercise_id, user_id, set_number) VALUES
    ('e1e1e1e1-0022-4000-8000-00000000000e', 'e1e1e1e1-0021-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e', 1),
    ('f1f1f1f1-0022-4000-8000-00000000000f', 'f1f1f1f1-0021-4000-8000-00000000000f', 'f1f1f1f1-0000-4000-8000-00000000000f', 1),
    ('a1a1a1a1-0022-4000-8000-00000000000a', 'a1a1a1a1-0021-4000-8000-00000000000a', 'a1a1a1a1-0000-4000-8000-00000000000a', 1);

INSERT INTO public.rep_summaries (id, set_id, user_id, rep_number, tut_ms) VALUES
    ('e1e1e1e1-0023-4000-8000-00000000000e', 'e1e1e1e1-0022-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e', 1, 2000),
    ('f1f1f1f1-0023-4000-8000-00000000000f', 'f1f1f1f1-0022-4000-8000-00000000000f', 'f1f1f1f1-0000-4000-8000-00000000000f', 1, 2000),
    ('a1a1a1a1-0023-4000-8000-00000000000a', 'a1a1a1a1-0022-4000-8000-00000000000a', 'a1a1a1a1-0000-4000-8000-00000000000a', 1, 2000);

INSERT INTO public.rep_telemetry (id, set_id, user_id, timestamp_ms, force_n) VALUES
    ('e1e1e1e1-0024-4000-8000-00000000000e', 'e1e1e1e1-0022-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e', 10, 400),
    ('f1f1f1f1-0024-4000-8000-00000000000f', 'f1f1f1f1-0022-4000-8000-00000000000f', 'f1f1f1f1-0000-4000-8000-00000000000f', 10, 400),
    ('a1a1a1a1-0024-4000-8000-00000000000a', 'a1a1a1a1-0022-4000-8000-00000000000a', 'a1a1a1a1-0000-4000-8000-00000000000a', 10, 400);

INSERT INTO public.session_phase_statistics (id, session_id, user_id, concentric_kg_avg) VALUES
    ('e1e1e1e1-0025-4000-8000-00000000000e', 'e1e1e1e1-0020-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e', 50),
    ('f1f1f1f1-0025-4000-8000-00000000000f', 'f1f1f1f1-0020-4000-8000-00000000000f', 'f1f1f1f1-0000-4000-8000-00000000000f', 50),
    ('a1a1a1a1-0025-4000-8000-00000000000a', 'a1a1a1a1-0020-4000-8000-00000000000a', 'a1a1a1a1-0000-4000-8000-00000000000a', 50);

INSERT INTO public.vbt_assessments (id, user_id, exercise_id, estimated_1rm_kg) VALUES
    ('e1e1e1e1-0026-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e', 'squat', 100),
    ('f1f1f1f1-0026-4000-8000-00000000000f', 'f1f1f1f1-0000-4000-8000-00000000000f', 'squat', 100),
    ('a1a1a1a1-0026-4000-8000-00000000000a', 'a1a1a1a1-0000-4000-8000-00000000000a', 'squat', 100);

INSERT INTO public.exercise_signatures (id, user_id, exercise_id, rom_mm) VALUES
    ('e1e1e1e1-0027-4000-8000-00000000000e', 'e1e1e1e1-0000-4000-8000-00000000000e', 'squat', 500),
    ('f1f1f1f1-0027-4000-8000-00000000000f', 'f1f1f1f1-0000-4000-8000-00000000000f', 'squat', 500),
    ('a1a1a1a1-0027-4000-8000-00000000000a', 'a1a1a1a1-0000-4000-8000-00000000000a', 'squat', 500);

SET LOCAL ROLE authenticated;

-- EMBER E: below both gates.
SELECT pg_temp.act_as('e1e1e1e1-0000-4000-8000-00000000000e');

SELECT is(
    pg_temp.visible_rows(c.rel),
    0,
    'EMBER reads no rows from ' || c.rel
)
FROM (VALUES
    ('rep_telemetry'),
    ('telemetry_points'),
    ('vbt_assessments'),
    ('session_phase_statistics'),
    ('exercise_signatures')
) AS c(rel);

-- FLAME F: pays for session replay, not for force curves. The rows are F's
-- own and F is authenticated as their owner — the tier is the only thing
-- standing between F and the data.
SELECT pg_temp.act_as('f1f1f1f1-0000-4000-8000-00000000000f');

SELECT is(public.user_has_min_tier('FLAME'), true, 'F is FLAME');
SELECT is(public.user_has_min_tier('INFERNO'), false, 'F is below INFERNO');

SELECT is(
    pg_temp.visible_rows(c.rel),
    0,
    'FLAME reads no rows from ' || c.rel
)
FROM (VALUES
    ('rep_telemetry'),
    ('telemetry_points'),
    ('vbt_assessments'),
    ('session_phase_statistics'),
    ('exercise_signatures')
) AS c(rel);

SELECT is(
    (SELECT count(*)::integer FROM public.rep_telemetry WHERE user_id = 'f1f1f1f1-0000-4000-8000-00000000000f'),
    0,
    'FLAME cannot read even its own telemetry by explicit user_id'
);

-- …and still reads everything rep-by-rep replay is built from.
SELECT is(
    (SELECT count(*)::integer FROM public.workout_sessions WHERE id = 'f1f1f1f1-0020-4000-8000-00000000000f'),
    1,
    'FLAME still reads its own session (replay navigation)'
);
SELECT is(
    (SELECT count(*)::integer FROM public.exercises WHERE id = 'f1f1f1f1-0021-4000-8000-00000000000f'),
    1,
    'FLAME still reads its own exercises (replay navigation)'
);
SELECT is(
    (SELECT count(*)::integer FROM public.sets WHERE id = 'f1f1f1f1-0022-4000-8000-00000000000f'),
    1,
    'FLAME still reads its own sets (replay navigation)'
);
SELECT is(
    (SELECT count(*)::integer FROM public.rep_summaries WHERE set_id = 'f1f1f1f1-0022-4000-8000-00000000000f'),
    1,
    'FLAME still reads its own rep summaries, so replay degrades to rep-by-rep'
);

-- INFERNO I: paid for the force curves, gets them.
SELECT pg_temp.act_as('a1a1a1a1-0000-4000-8000-00000000000a');

SELECT is(public.user_has_min_tier('INFERNO'), true, 'I is INFERNO');

SELECT is(
    pg_temp.visible_rows(c.rel),
    1,
    'INFERNO reads its row from ' || c.rel
)
FROM (VALUES
    ('rep_telemetry'),
    ('telemetry_points'),
    ('vbt_assessments'),
    ('session_phase_statistics'),
    ('exercise_signatures')
) AS c(rel);

RESET ROLE;

-- The GDPR export reads with the service role (export-user-data), which
-- bypasses RLS. Gating reads must never gate Article 15.
SET LOCAL ROLE service_role;

SELECT is(
    (SELECT count(*)::integer FROM public.rep_telemetry WHERE user_id = 'f1f1f1f1-0000-4000-8000-00000000000f'),
    1,
    'the service role still reads a FLAME user telemetry, so the export stays whole'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT * FROM finish();

ROLLBACK;
