-- Portal routine / cycle RPCs (20260920001400_routine_cycle_stable_ids_and_create_rpcs.sql).
--
-- What matters here:
--   * an update that carries child `id`s KEEPS them (the phone keys its own
--     per-exercise state by routine_exercises.id / cycle_days.id, so churning
--     them on a name-only edit silently orphans that state);
--   * a child omitted from the payload is still removed;
--   * an update that carries NO ids behaves exactly as it did before, because
--     that is what the shipped SPA sends;
--   * an id belonging to somebody else's routine — or to another routine of
--     the caller's own — is never adopted and never touched;
--   * create is one transaction: a child that violates a CHECK takes the
--     parent down with it instead of leaving a parent whose exercise_count
--     does not match its children;
--   * an EMBER user is refused by RLS, not by a hand-written tier check.
--
-- Section 0 pins the precondition behind the implementation's
-- delete-and-reinsert-with-the-same-id strategy: nothing may reference
-- routine_exercises.id or cycle_days.id by foreign key. If someone adds one
-- (an ON DELETE CASCADE especially), this goes red before a portal save
-- silently deletes the dependants.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

-- Runs p_sql and always rolls it back. Returns 'rows:<n>' on success, else
-- '<SQLSTATE> <message>'. (Same helper shape as tier_matrix.test.sql.)
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

-- One routine-exercise payload element with every NOT NULL column set.
CREATE FUNCTION pg_temp.ex(
    p_name text,
    p_order int,
    p_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $ex$
    SELECT jsonb_build_object(
        'name', p_name,
        'muscle_group', 'back',
        'sets', 3,
        'reps', 10,
        'weight', 40,
        'rest_seconds', 60,
        'order_index', p_order,
        'mode', 'OLD_SCHOOL',
        'is_bodyweight', false
    ) || CASE WHEN p_id IS NULL THEN '{}'::jsonb
              ELSE jsonb_build_object('id', p_id) END;
$ex$;

CREATE FUNCTION pg_temp.day(
    p_number int,
    p_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $day$
    SELECT jsonb_build_object(
        'day_number', p_number,
        'day_type', 'workout',
        'weight_adjustment', 0,
        'rep_modifier', 0
    ) || CASE WHEN p_id IS NULL THEN '{}'::jsonb
              ELSE jsonb_build_object('id', p_id) END;
$day$;

-- ---------------------------------------------------------------------------
-- 0. Precondition: no inbound foreign key on either child table.
-- ---------------------------------------------------------------------------
SELECT is(
    (
        SELECT count(*)::integer
        FROM pg_constraint
        WHERE contype = 'f'
          AND confrelid IN (
              'public.routine_exercises'::regclass,
              'public.cycle_days'::regclass
          )
    ),
    0,
    'nothing references routine_exercises.id / cycle_days.id by FK (the update RPCs re-insert kept children with their original id)'
);

-- ---------------------------------------------------------------------------
-- 1. Grants: authenticated may call all four; anon and PUBLIC may not.
-- ---------------------------------------------------------------------------
SELECT ok(
    has_function_privilege('authenticated', sig::regprocedure, 'EXECUTE'),
    'authenticated may EXECUTE ' || sig
) FROM (VALUES
    ('public.update_routine_with_exercises(uuid, text, text, int, int, jsonb)'),
    ('public.update_cycle_with_days(uuid, text, text, int, int, int, timestamptz, jsonb, jsonb, jsonb)'),
    ('public.create_routine_with_exercises(text, text, int, int, jsonb, text)'),
    ('public.create_cycle_with_days(text, text, int, int, int, timestamptz, jsonb, jsonb, jsonb, text)')
) AS t(sig);

SELECT ok(
    NOT has_function_privilege('anon', sig::regprocedure, 'EXECUTE'),
    'anon may NOT EXECUTE ' || sig
) FROM (VALUES
    ('public.update_routine_with_exercises(uuid, text, text, int, int, jsonb)'),
    ('public.update_cycle_with_days(uuid, text, text, int, int, int, timestamptz, jsonb, jsonb, jsonb)'),
    ('public.create_routine_with_exercises(text, text, int, int, jsonb, text)'),
    ('public.create_cycle_with_days(text, text, int, int, int, timestamptz, jsonb, jsonb, jsonb, text)')
) AS t(sig);

-- All four run as the caller, so the FLAME policies decide. None of them may
-- be SECURITY DEFINER (that would bypass RLS and belong in the PR 1 lockdown
-- allow-list instead).
SELECT is(
    (
        SELECT count(*)::integer
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef
          AND p.proname IN (
              'update_routine_with_exercises', 'update_cycle_with_days',
              'create_routine_with_exercises', 'create_cycle_with_days'
          )
    ),
    0,
    'the four portal routine/cycle RPCs are SECURITY INVOKER'
);

-- ---------------------------------------------------------------------------
-- 2. Fixtures (as the migration role, bypassing RLS).
--    F = FLAME author. E = EMBER. O = a second FLAME user whose routine
--    supplies the "foreign id" case.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
    ('aaaa0000-0000-4000-8000-0000000000f1', 'rpc-flame@example.test'),
    ('aaaa0000-0000-4000-8000-0000000000e1', 'rpc-ember@example.test'),
    ('aaaa0000-0000-4000-8000-0000000000f2', 'rpc-other@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.profiles (id) VALUES
    ('aaaa0000-0000-4000-8000-0000000000f1'),
    ('aaaa0000-0000-4000-8000-0000000000e1'),
    ('aaaa0000-0000-4000-8000-0000000000f2')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subscriptions (user_id, tier, status, current_period_end) VALUES
    ('aaaa0000-0000-4000-8000-0000000000f1', 'FLAME', 'active', now() + INTERVAL '30 days'),
    ('aaaa0000-0000-4000-8000-0000000000e1', 'EMBER', 'active', now() + INTERVAL '30 days'),
    ('aaaa0000-0000-4000-8000-0000000000f2', 'FLAME', 'active', now() + INTERVAL '30 days')
ON CONFLICT (user_id) DO UPDATE
SET tier = EXCLUDED.tier, status = EXCLUDED.status;

-- routines.local_profile_id / training_cycles.local_profile_id carry a
-- composite FK to local_profiles(user_id, id), so the create RPCs need a real
-- profile to attribute the new row to.
INSERT INTO public.local_profiles (user_id, id, name) VALUES
    ('aaaa0000-0000-4000-8000-0000000000f1', 'profile-7', 'Bench profile')
ON CONFLICT (user_id, id) DO NOTHING;

-- F's routine with three exercises. created_at is backdated so that keeping it
-- is observable.
INSERT INTO public.routines (id, user_id, name, exercise_count) VALUES
    ('bbbb0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-0000000000f1', 'Pull day', 3),
    -- F's second routine: the source of a same-user-but-wrong-parent id.
    ('bbbb0000-0000-4000-8000-000000000002', 'aaaa0000-0000-4000-8000-0000000000f1', 'Push day', 1),
    ('bbbb0000-0000-4000-8000-000000000003', 'aaaa0000-0000-4000-8000-0000000000e1', 'E routine', 1),
    -- O's routine: the source of another user's id.
    ('bbbb0000-0000-4000-8000-000000000004', 'aaaa0000-0000-4000-8000-0000000000f2', 'O routine', 1);

INSERT INTO public.routine_exercises (id, routine_id, name, order_index, created_at) VALUES
    ('cccc0000-0000-4000-8000-000000000001', 'bbbb0000-0000-4000-8000-000000000001', 'Row', 0, '2020-01-01T00:00:00Z'),
    ('cccc0000-0000-4000-8000-000000000002', 'bbbb0000-0000-4000-8000-000000000001', 'Pulldown', 1, '2020-01-02T00:00:00Z'),
    ('cccc0000-0000-4000-8000-000000000003', 'bbbb0000-0000-4000-8000-000000000001', 'Curl', 2, '2020-01-03T00:00:00Z'),
    ('cccc0000-0000-4000-8000-000000000009', 'bbbb0000-0000-4000-8000-000000000002', 'Bench', 0, '2020-01-04T00:00:00Z'),
    ('cccc0000-0000-4000-8000-00000000000e', 'bbbb0000-0000-4000-8000-000000000003', 'E row', 0, '2020-01-05T00:00:00Z'),
    ('cccc0000-0000-4000-8000-00000000000f', 'bbbb0000-0000-4000-8000-000000000004', 'O row', 0, '2020-01-06T00:00:00Z');

INSERT INTO public.training_cycles (id, user_id, name) VALUES
    ('dddd0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-0000000000f1', 'Block A'),
    ('dddd0000-0000-4000-8000-000000000002', 'aaaa0000-0000-4000-8000-0000000000f2', 'O block');

INSERT INTO public.cycle_days (id, cycle_id, day_number) VALUES
    ('eeee0000-0000-4000-8000-000000000001', 'dddd0000-0000-4000-8000-000000000001', 1),
    ('eeee0000-0000-4000-8000-000000000002', 'dddd0000-0000-4000-8000-000000000001', 2),
    ('eeee0000-0000-4000-8000-00000000000f', 'dddd0000-0000-4000-8000-000000000002', 1);

-- ---------------------------------------------------------------------------
-- 3. FLAME user F: the stable-id contract.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('aaaa0000-0000-4000-8000-0000000000f1');

SELECT is(public.user_has_min_tier('FLAME'), true, 'F is FLAME');

-- 3a. Keep exercises 1 and 2 by id, drop 3, add a fourth with no id.
SELECT is(
    public.update_routine_with_exercises(
        'bbbb0000-0000-4000-8000-000000000001',
        'Pull day v2', 'desc', 3, 1800,
        jsonb_build_array(
            pg_temp.ex('Row', 0, 'cccc0000-0000-4000-8000-000000000001'),
            pg_temp.ex('Pulldown', 1, 'cccc0000-0000-4000-8000-000000000002'),
            pg_temp.ex('Face pull', 2)
        )
    ),
    'bbbb0000-0000-4000-8000-000000000001'::uuid,
    'update_routine_with_exercises returns the routine id'
);

SELECT is(
    (SELECT count(*)::integer FROM public.routine_exercises
      WHERE routine_id = 'bbbb0000-0000-4000-8000-000000000001'),
    3,
    'the routine has three exercises after the update'
);

-- THE regression assertion: an id the caller sent is the id still stored.
SELECT set_eq(
    $$SELECT id FROM public.routine_exercises
       WHERE routine_id = 'bbbb0000-0000-4000-8000-000000000001'
         AND id IN ('cccc0000-0000-4000-8000-000000000001',
                    'cccc0000-0000-4000-8000-000000000002')$$,
    $$VALUES ('cccc0000-0000-4000-8000-000000000001'::uuid),
             ('cccc0000-0000-4000-8000-000000000002'::uuid)$$,
    'exercise ids sent in the payload survive the update (the phone keys its per-exercise state by them)'
);

SELECT is(
    (SELECT name FROM public.routine_exercises
      WHERE id = 'cccc0000-0000-4000-8000-000000000002'),
    'Pulldown',
    'a kept exercise still carries the payload values'
);

SELECT is(
    (SELECT created_at FROM public.routine_exercises
      WHERE id = 'cccc0000-0000-4000-8000-000000000001'),
    '2020-01-01T00:00:00Z'::timestamptz,
    'a kept exercise keeps its original created_at'
);

SELECT is(
    (SELECT count(*)::integer FROM public.routine_exercises
      WHERE id = 'cccc0000-0000-4000-8000-000000000003'),
    0,
    'an exercise omitted from the payload is removed'
);

SELECT is(
    (SELECT count(*)::integer FROM public.routine_exercises
      WHERE routine_id = 'bbbb0000-0000-4000-8000-000000000001'
        AND name = 'Face pull'
        AND id NOT IN ('cccc0000-0000-4000-8000-000000000001',
                       'cccc0000-0000-4000-8000-000000000002',
                       'cccc0000-0000-4000-8000-000000000003')),
    1,
    'an exercise sent without an id gets a fresh one'
);

SELECT is(
    (SELECT name FROM public.routines WHERE id = 'bbbb0000-0000-4000-8000-000000000001'),
    'Pull day v2',
    'the parent row is updated'
);

-- 3b. The shipped SPA sends no ids at all: unchanged behaviour, every child
--     re-created.
CREATE TEMP TABLE before_no_ids ON COMMIT DROP AS
SELECT id FROM public.routine_exercises
 WHERE routine_id = 'bbbb0000-0000-4000-8000-000000000001';

SELECT public.update_routine_with_exercises(
    'bbbb0000-0000-4000-8000-000000000001',
    'Pull day v3', 'desc', 2, 1200,
    jsonb_build_array(pg_temp.ex('Row', 0), pg_temp.ex('Pulldown', 1))
);

SELECT is(
    (SELECT count(*)::integer FROM public.routine_exercises
      WHERE routine_id = 'bbbb0000-0000-4000-8000-000000000001'),
    2,
    'an id-less payload replaces the children wholesale'
);

SELECT is(
    (SELECT count(*)::integer FROM public.routine_exercises re
      JOIN before_no_ids b ON b.id = re.id),
    0,
    'an id-less payload mints new ids, exactly as before this migration'
);

-- 3c. Foreign ids are never adopted and never touched.
SELECT public.update_routine_with_exercises(
    'bbbb0000-0000-4000-8000-000000000001',
    'Pull day v4', 'desc', 2, 1200,
    jsonb_build_array(
        -- id of F's OTHER routine's exercise
        pg_temp.ex('Steal same user', 0, 'cccc0000-0000-4000-8000-000000000009'),
        -- id of another user's exercise
        pg_temp.ex('Steal other user', 1, 'cccc0000-0000-4000-8000-00000000000f')
    )
);

SELECT is(
    (SELECT count(*)::integer FROM public.routine_exercises
      WHERE routine_id = 'bbbb0000-0000-4000-8000-000000000001'
        AND id IN ('cccc0000-0000-4000-8000-000000000009',
                   'cccc0000-0000-4000-8000-00000000000f')),
    0,
    'an id owned by another routine is not adopted'
);

SELECT is(
    (SELECT name FROM public.routine_exercises
      WHERE id = 'cccc0000-0000-4000-8000-000000000009'),
    'Bench',
    'the caller''s other routine keeps its exercise untouched'
);

SELECT is(
    (SELECT routine_id FROM public.routine_exercises
      WHERE id = 'cccc0000-0000-4000-8000-000000000009'),
    'bbbb0000-0000-4000-8000-000000000002'::uuid,
    'the foreign row was not re-parented'
);

-- Another user's row is invisible under RLS, so read it back as the owner.
RESET ROLE;
SELECT is(
    (SELECT name FROM public.routine_exercises
      WHERE id = 'cccc0000-0000-4000-8000-00000000000f'),
    'O row',
    'another user''s exercise is untouched'
);
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('aaaa0000-0000-4000-8000-0000000000f1');

-- 3d. Malformed / duplicate ids abort the whole call.
SELECT matches(
    pg_temp.attempt($q$SELECT public.update_routine_with_exercises(
        'bbbb0000-0000-4000-8000-000000000001', 'x', 'x', 1, 1,
        jsonb_build_array(jsonb_build_object('id', 'not-a-uuid', 'name', 'x'))
    )$q$),
    '^P0001 invalid_exercise_id',
    'a non-uuid id is rejected instead of silently minting a new row'
);

SELECT matches(
    pg_temp.attempt(format($q$SELECT public.update_routine_with_exercises(
        'bbbb0000-0000-4000-8000-000000000001', 'x', 'x', 2, 1,
        jsonb_build_array(%L::jsonb, %L::jsonb)
    )$q$,
        pg_temp.ex('a', 0, (SELECT id FROM public.routine_exercises
                             WHERE routine_id = 'bbbb0000-0000-4000-8000-000000000001'
                             ORDER BY order_index LIMIT 1)),
        pg_temp.ex('b', 1, (SELECT id FROM public.routine_exercises
                             WHERE routine_id = 'bbbb0000-0000-4000-8000-000000000001'
                             ORDER BY order_index LIMIT 1))
    )),
    '^P0001 duplicate_exercise_id',
    'the same id twice in one payload is rejected'
);

-- 3e. The pre-existing "validate before mutating" guard still holds.
SELECT matches(
    pg_temp.attempt($q$SELECT public.update_routine_with_exercises(
        'bbbb0000-0000-4000-8000-000000000001', 'x', 'x', 0, 0, '{"not":"an array"}'::jsonb
    )$q$),
    '^P0001 invalid_exercises_payload',
    'a non-array exercises payload still aborts before the children are deleted'
);

SELECT matches(
    pg_temp.attempt($q$SELECT public.update_routine_with_exercises(
        'bbbb0000-0000-4000-8000-000000000001', 'x', 'x', 0, 0, '["nope"]'::jsonb
    )$q$),
    '^P0001 invalid_exercises_payload',
    'a non-object element aborts before the children are deleted'
);

SELECT is(
    (SELECT count(*)::integer FROM public.routine_exercises
      WHERE routine_id = 'bbbb0000-0000-4000-8000-000000000001'),
    2,
    'the rejected payloads left the existing exercises in place'
);

-- 3e-bis. An explicit empty array is still the valid "clear all children"
--        path (20260628180000).
SELECT public.update_routine_with_exercises(
    'bbbb0000-0000-4000-8000-000000000001', 'Emptied', '', 0, 0, '[]'::jsonb
);

SELECT is(
    (SELECT count(*)::integer FROM public.routine_exercises
      WHERE routine_id = 'bbbb0000-0000-4000-8000-000000000001'),
    0,
    'an explicit [] clears every exercise'
);

-- 3f. Cycles: the same id contract.
SELECT is(
    public.update_cycle_with_days(
        'dddd0000-0000-4000-8000-000000000001',
        'Block A v2', 'desc', 6, 4, 2, NULL, NULL, NULL,
        jsonb_build_array(
            pg_temp.day(1, 'eeee0000-0000-4000-8000-000000000001'),
            pg_temp.day(3),
            -- another user's day id: must not be adopted
            pg_temp.day(4, 'eeee0000-0000-4000-8000-00000000000f')
        )
    ),
    'dddd0000-0000-4000-8000-000000000001'::uuid,
    'update_cycle_with_days returns the cycle id'
);

SELECT is(
    (SELECT count(*)::integer FROM public.cycle_days
      WHERE cycle_id = 'dddd0000-0000-4000-8000-000000000001'
        AND id = 'eeee0000-0000-4000-8000-000000000001'),
    1,
    'a cycle day id sent in the payload survives the update'
);

SELECT is(
    (SELECT count(*)::integer FROM public.cycle_days
      WHERE id = 'eeee0000-0000-4000-8000-000000000002'),
    0,
    'a cycle day omitted from the payload is removed'
);

SELECT is(
    (SELECT count(*)::integer FROM public.cycle_days
      WHERE cycle_id = 'dddd0000-0000-4000-8000-000000000001'
        AND id = 'eeee0000-0000-4000-8000-00000000000f'),
    0,
    'another user''s cycle day id is not adopted'
);

SELECT is(
    (SELECT duration_weeks FROM public.training_cycles
      WHERE id = 'dddd0000-0000-4000-8000-000000000001'),
    6,
    'the cycle parent row is updated'
);

RESET ROLE;
SELECT is(
    (SELECT cycle_id FROM public.cycle_days
      WHERE id = 'eeee0000-0000-4000-8000-00000000000f'),
    'dddd0000-0000-4000-8000-000000000002'::uuid,
    'another user''s cycle day is untouched'
);
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('aaaa0000-0000-4000-8000-0000000000f1');

-- ---------------------------------------------------------------------------
-- 4. Atomic create.
-- ---------------------------------------------------------------------------
SELECT lives_ok(
    $q$SELECT public.create_routine_with_exercises(
        'Created routine', 'from the portal', 2, 900,
        jsonb_build_array(pg_temp.ex('Row', 0), pg_temp.ex('Curl', 1)),
        'profile-7'
    )$q$,
    'create_routine_with_exercises succeeds for a FLAME user'
);

SELECT is(
    (SELECT count(*)::integer FROM public.routine_exercises re
      JOIN public.routines r ON r.id = re.routine_id
     WHERE r.name = 'Created routine'),
    2,
    'create_routine_with_exercises wrote both children'
);

SELECT is(
    (SELECT local_profile_id FROM public.routines WHERE name = 'Created routine'),
    'profile-7',
    'create_routine_with_exercises stores the active local profile'
);

SELECT is(
    (SELECT user_id FROM public.routines WHERE name = 'Created routine'),
    'aaaa0000-0000-4000-8000-0000000000f1'::uuid,
    'create_routine_with_exercises owns the row to auth.uid()'
);

-- A child that violates a CHECK must take the parent with it: the failure is
-- the whole call, not a routine row with no exercises.
SELECT matches(
    pg_temp.attempt($q$SELECT public.create_routine_with_exercises(
        'Half-created routine', '', 1, 60,
        jsonb_build_array(pg_temp.ex('Row', 0) || '{"drop_set_enabled": true}'::jsonb)
    )$q$),
    '^23514',
    'create_routine_with_exercises raises the child CHECK violation instead of swallowing it'
);

SELECT is(
    (SELECT count(*)::integer FROM public.routines WHERE name = 'Half-created routine'),
    0,
    'the failed create left no parent routine behind'
);

SELECT lives_ok(
    $q$SELECT public.create_cycle_with_days(
        'Created cycle', 'from the portal', 8, 5, 2, NULL, NULL, NULL,
        jsonb_build_array(pg_temp.day(1), pg_temp.day(2)),
        'profile-7'
    )$q$,
    'create_cycle_with_days succeeds for a FLAME user'
);

SELECT is(
    (SELECT count(*)::integer FROM public.cycle_days cd
      JOIN public.training_cycles tc ON tc.id = cd.cycle_id
     WHERE tc.name = 'Created cycle'),
    2,
    'create_cycle_with_days wrote both days'
);

SELECT row_eq(
    $q$SELECT status, current_week, duration_weeks, local_profile_id
        FROM public.training_cycles WHERE name = 'Created cycle'$q$,
    ROW('draft'::text, 1::integer, 8::integer, 'profile-7'::text),
    'create_cycle_with_days matches what the SPA inserts today'
);

SELECT matches(
    pg_temp.attempt($q$SELECT public.create_cycle_with_days(
        'Half-created cycle', '', 4, 1, 0, NULL, NULL, NULL,
        '["nope"]'::jsonb
    )$q$),
    '^P0001 invalid_days_payload',
    'create_cycle_with_days validates the payload before inserting the parent'
);

SELECT is(
    (SELECT count(*)::integer FROM public.training_cycles WHERE name = 'Half-created cycle'),
    0,
    'the failed create left no parent cycle behind'
);

-- ---------------------------------------------------------------------------
-- 5. EMBER user E is refused by RLS, not by a tier check inside the function.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('aaaa0000-0000-4000-8000-0000000000e1');

SELECT is(public.user_has_min_tier('FLAME'), false, 'E is below FLAME');

SELECT matches(
    pg_temp.attempt($q$SELECT public.create_routine_with_exercises(
        'E routine v2', '', 1, 60, jsonb_build_array(pg_temp.ex('Row', 0))
    )$q$),
    '^42501',
    'an EMBER user cannot create a routine'
);

SELECT matches(
    pg_temp.attempt($q$SELECT public.create_cycle_with_days(
        'E cycle v2', '', 4, 1, 0, NULL, NULL, NULL, jsonb_build_array(pg_temp.day(1))
    )$q$),
    '^42501',
    'an EMBER user cannot create a training cycle'
);

-- The FLAME UPDATE policy makes E's own routine unmatchable, so the RPC's own
-- ownership guard is what the caller sees.
SELECT matches(
    pg_temp.attempt($q$SELECT public.update_routine_with_exercises(
        'bbbb0000-0000-4000-8000-000000000003', 'x', '', 1, 60,
        jsonb_build_array(pg_temp.ex('Row', 0, 'cccc0000-0000-4000-8000-00000000000e'))
    )$q$),
    '^P0001 routine_not_found_or_forbidden',
    'an EMBER user cannot update their own routine'
);

SELECT is(
    (SELECT name FROM public.routine_exercises
      WHERE id = 'cccc0000-0000-4000-8000-00000000000e'),
    'E row',
    'the denied update changed nothing'
);

-- F's routine is not E's to edit either.
SELECT matches(
    pg_temp.attempt($q$SELECT public.update_routine_with_exercises(
        'bbbb0000-0000-4000-8000-000000000001', 'x', '', 0, 0, '[]'::jsonb
    )$q$),
    '^P0001 routine_not_found_or_forbidden',
    'one user cannot update another user''s routine'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
