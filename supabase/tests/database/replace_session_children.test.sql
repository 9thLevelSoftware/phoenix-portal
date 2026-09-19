-- replace_session_children: final-body behaviours (PR 20 -> PR 24 -> PR 28).
-- PR 20: stored rep_telemetry survives a re-push without telemetry, re-linked
-- only on a unique (session, exercise identity, set_number) match.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

-- ---------------------------------------------------------------------------
-- Function shape and grants
-- ---------------------------------------------------------------------------
SELECT diag('database:replace-session-children-single-overload-service-role-only');

SELECT is(
    (SELECT count(*)::int FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'replace_session_children'),
    1,
    'exactly one replace_session_children overload exists'
);

SELECT ok(
    NOT has_function_privilege('anon',
        'public.replace_session_children(uuid, uuid[], jsonb, jsonb, jsonb, jsonb)', 'EXECUTE'),
    'anon cannot execute replace_session_children'
);

SELECT ok(
    NOT has_function_privilege('authenticated',
        'public.replace_session_children(uuid, uuid[], jsonb, jsonb, jsonb, jsonb)', 'EXECUTE'),
    'authenticated cannot execute replace_session_children'
);

SELECT ok(
    has_function_privilege('service_role',
        'public.replace_session_children(uuid, uuid[], jsonb, jsonb, jsonb, jsonb)', 'EXECUTE'),
    'service_role can execute replace_session_children'
);

-- ---------------------------------------------------------------------------
-- Fixtures and payload helpers
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
VALUES ('20200000-0000-4000-8000-000000000001'::uuid, 'rsc-telemetry@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.exercise_catalog (id, name, display_name, muscle_group)
VALUES
    ('pr20-bench-press', 'Bench Press', 'Bench Press', 'Chest'),
    ('pr20-back-squat', 'Back Squat', 'Back Squat', 'Legs'),
    ('pr20-front-squat', 'Front Squat', 'Front Squat', 'Legs'),
    ('pr20-deadlift', 'Deadlift', 'Deadlift', 'Back')
ON CONFLICT (id) DO NOTHING;

CREATE FUNCTION pg_temp.u(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
    SELECT ('20200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

CREATE FUNCTION pg_temp.uid() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
    SELECT '20200000-0000-4000-8000-000000000001'::uuid
$$;

CREATE FUNCTION pg_temp.ex(p_id INT, p_session INT, p_catalog TEXT, p_name TEXT, p_order INT)
RETURNS JSONB LANGUAGE sql AS $$
    SELECT jsonb_build_object(
        'id', pg_temp.u(p_id), 'session_id', pg_temp.u(p_session),
        'user_id', pg_temp.uid(), 'name', p_name, 'exercise_id', p_catalog,
        'muscle_group', 'General', 'order_index', p_order)
$$;

CREATE FUNCTION pg_temp.st(p_id INT, p_exercise INT, p_number INT)
RETURNS JSONB LANGUAGE sql AS $$
    SELECT jsonb_build_object(
        'id', pg_temp.u(p_id), 'exercise_id', pg_temp.u(p_exercise),
        'user_id', pg_temp.uid(), 'set_number', p_number, 'target_reps', 10,
        'actual_reps', 10, 'weight_kg', 20, 'is_pr', false,
        'workout_mode', 'OLD_SCHOOL')
$$;

CREATE FUNCTION pg_temp.tm(p_id INT, p_set INT, p_ts BIGINT)
RETURNS JSONB LANGUAGE sql AS $$
    SELECT jsonb_build_object(
        'id', pg_temp.u(p_id), 'set_id', pg_temp.u(p_set),
        'user_id', pg_temp.uid(), 'timestamp_ms', p_ts, 'force_n', 100.5,
        'velocity_mps', 0.5, 'position_mm', 250, 'cable', 'A')
$$;

CREATE FUNCTION pg_temp.push(p_session INT, p_exercises JSONB, p_sets JSONB, p_telemetry JSONB)
RETURNS JSONB LANGUAGE sql AS $$
    SELECT public.replace_session_children(
        pg_temp.uid(), ARRAY[pg_temp.u(p_session)], p_exercises, p_sets,
        '[]'::jsonb, p_telemetry)
$$;

-- Telemetry ids attached to one set, as a sorted uuid array.
CREATE FUNCTION pg_temp.tel_on(p_set INT) RETURNS UUID[] LANGUAGE sql AS $$
    SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
      FROM public.rep_telemetry WHERE set_id = pg_temp.u(p_set)
$$;

-- Telemetry row count in one session.
CREATE FUNCTION pg_temp.tel_in(p_session INT) RETURNS INT LANGUAGE sql AS $$
    SELECT count(*)::int
      FROM public.rep_telemetry rt
      JOIN public.sets s ON s.id = rt.set_id
      JOIN public.exercises e ON e.id = s.exercise_id
     WHERE e.session_id = pg_temp.u(p_session)
$$;

INSERT INTO public.workout_sessions (id, user_id, started_at)
SELECT pg_temp.u(n), pg_temp.uid(), now() - (n || ' hours')::interval
  FROM generate_series(100, 105) AS n;

-- ---------------------------------------------------------------------------
-- Scenario 1: preserve, replace, set removed (session 100)
-- ---------------------------------------------------------------------------
SELECT diag('database:re-push-without-telemetry-keeps-telemetry');

SELECT pg_temp.push(100,
    jsonb_build_array(pg_temp.ex(1000, 100, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(1001, 1000, 1), pg_temp.st(1002, 1000, 2)),
    jsonb_build_array(pg_temp.tm(1101, 1001, 1), pg_temp.tm(1102, 1001, 2),
                      pg_temp.tm(1103, 1002, 1)));

SELECT is(pg_temp.tel_in(100), 3, 'first push stores three telemetry rows');

SELECT is(
    pg_temp.push(100,
        jsonb_build_array(pg_temp.ex(2000, 100, 'pr20-bench-press', 'Bench Press', 0)),
        jsonb_build_array(pg_temp.st(2001, 2000, 1), pg_temp.st(2002, 2000, 2)),
        '[]'::jsonb) ->> 'rep_telemetry_preserved',
    '3',
    're-push without telemetry reports three preserved rows'
);
SELECT is(pg_temp.tel_in(100), 3, 're-push without telemetry keeps the telemetry count');
SELECT is(pg_temp.tel_on(2001), ARRAY[pg_temp.u(1101), pg_temp.u(1102)],
    'set 1 telemetry is linked to the new set 1 id');
SELECT is(pg_temp.tel_on(2002), ARRAY[pg_temp.u(1103)],
    'set 2 telemetry is linked to the new set 2 id');
SELECT is(
    (SELECT count(*)::int FROM public.sets WHERE id IN (pg_temp.u(1001), pg_temp.u(1002))),
    0,
    'old set rows are gone'
);

SELECT diag('database:re-push-with-new-telemetry-replaces');

SELECT pg_temp.push(100,
    jsonb_build_array(pg_temp.ex(3000, 100, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(3001, 3000, 1), pg_temp.st(3002, 3000, 2)),
    jsonb_build_array(pg_temp.tm(3101, 3001, 5)));
SELECT is(pg_temp.tel_on(3001), ARRAY[pg_temp.u(3101)],
    'payload telemetry replaces the stored telemetry of that set');
SELECT is(pg_temp.tel_on(3002), ARRAY[pg_temp.u(1103)],
    'a set without payload telemetry keeps its stored telemetry');
SELECT is(pg_temp.tel_in(100), 2, 'no stale telemetry survives a replacement');

SELECT diag('database:re-push-with-set-removed-drops-only-that-set');

SELECT pg_temp.push(100,
    jsonb_build_array(pg_temp.ex(4000, 100, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(4001, 4000, 1)),
    '[]'::jsonb);
SELECT is(pg_temp.tel_on(4001), ARRAY[pg_temp.u(3101)],
    'the remaining set keeps its telemetry');
SELECT is(pg_temp.tel_in(100), 1, 'only the removed set''s telemetry is gone');

-- ---------------------------------------------------------------------------
-- Scenario 2: same identity twice, both defaulted to order_index 0 (session 101)
-- ---------------------------------------------------------------------------
SELECT diag('database:ambiguous-identity-is-not-relinked');

SELECT pg_temp.push(101,
    jsonb_build_array(pg_temp.ex(5000, 101, 'pr20-bench-press', 'Bench Press', 0),
                      pg_temp.ex(5010, 101, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(5001, 5000, 1), pg_temp.st(5011, 5010, 1)),
    jsonb_build_array(pg_temp.tm(5101, 5001, 1), pg_temp.tm(5111, 5011, 1)));
SELECT is(pg_temp.tel_in(101), 2, 'ambiguous session stores telemetry on first push');

SELECT is(
    pg_temp.push(101,
        jsonb_build_array(pg_temp.ex(6000, 101, 'pr20-bench-press', 'Bench Press', 0),
                          pg_temp.ex(6010, 101, 'pr20-bench-press', 'Bench Press', 0)),
        jsonb_build_array(pg_temp.st(6001, 6000, 1), pg_temp.st(6011, 6010, 1)),
        '[]'::jsonb) ->> 'rep_telemetry_preserved',
    '0',
    'ambiguous identity re-links nothing'
);
SELECT is(pg_temp.tel_in(101), 0, 'ambiguous telemetry is deleted as before');

-- Ambiguity on only one side (old unique, new duplicated) must also not re-link.
SELECT pg_temp.push(102,
    jsonb_build_array(pg_temp.ex(5200, 102, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(5201, 5200, 1)),
    jsonb_build_array(pg_temp.tm(5301, 5201, 1)));
SELECT pg_temp.push(102,
    jsonb_build_array(pg_temp.ex(6200, 102, 'pr20-bench-press', 'Bench Press', 0),
                      pg_temp.ex(6210, 102, NULL, 'pr20-bench-press', 1)),
    jsonb_build_array(pg_temp.st(6201, 6200, 1), pg_temp.st(6211, 6210, 1)),
    '[]'::jsonb);
SELECT is(pg_temp.tel_in(102), 0,
    'a key duplicated only on the new side is not re-linked');

-- ---------------------------------------------------------------------------
-- Scenario 3: two exercises swap order (session 103)
-- ---------------------------------------------------------------------------
SELECT diag('database:reordered-exercise-follows-identity');

SELECT pg_temp.push(103,
    jsonb_build_array(pg_temp.ex(7000, 103, 'pr20-back-squat', 'Back Squat', 0),
                      pg_temp.ex(7010, 103, NULL, 'Cable Row', 1)),
    jsonb_build_array(pg_temp.st(7001, 7000, 1), pg_temp.st(7011, 7010, 1)),
    jsonb_build_array(pg_temp.tm(7101, 7001, 1), pg_temp.tm(7111, 7011, 1)));

SELECT pg_temp.push(103,
    jsonb_build_array(pg_temp.ex(8010, 103, NULL, '  cable row ', 0),
                      pg_temp.ex(8000, 103, 'pr20-back-squat', 'Back Squat', 1)),
    jsonb_build_array(pg_temp.st(8011, 8010, 1), pg_temp.st(8001, 8000, 1)),
    '[]'::jsonb);
SELECT is(pg_temp.tel_on(8001), ARRAY[pg_temp.u(7101)],
    'squat telemetry follows the squat, not position 0');
SELECT is(pg_temp.tel_on(8011), ARRAY[pg_temp.u(7111)],
    'name-identified exercise telemetry follows its trimmed/lowercased name');

-- Distinct identities that both default to order_index 0 are unambiguous.
SELECT pg_temp.push(104,
    jsonb_build_array(pg_temp.ex(9000, 104, 'pr20-back-squat', 'Back Squat', 0),
                      pg_temp.ex(9010, 104, 'pr20-deadlift', 'Deadlift', 0)),
    jsonb_build_array(pg_temp.st(9001, 9000, 1), pg_temp.st(9011, 9010, 1)),
    jsonb_build_array(pg_temp.tm(9101, 9001, 1), pg_temp.tm(9111, 9011, 1)));
SELECT pg_temp.push(104,
    jsonb_build_array(pg_temp.ex(9200, 104, 'pr20-deadlift', 'Deadlift', 0),
                      pg_temp.ex(9210, 104, 'pr20-back-squat', 'Back Squat', 0)),
    jsonb_build_array(pg_temp.st(9201, 9200, 1), pg_temp.st(9211, 9210, 1)),
    '[]'::jsonb);
SELECT is(pg_temp.tel_on(9211), ARRAY[pg_temp.u(9101)],
    'distinct identities at order_index 0 re-link by identity (squat)');
SELECT is(pg_temp.tel_on(9201), ARRAY[pg_temp.u(9111)],
    'distinct identities at order_index 0 re-link by identity (deadlift)');

-- ---------------------------------------------------------------------------
-- Scenario 4: changed identity is never re-linked (session 105)
-- ---------------------------------------------------------------------------
SELECT diag('database:changed-identity-is-not-relinked');

SELECT pg_temp.push(105,
    jsonb_build_array(pg_temp.ex(9500, 105, 'pr20-back-squat', 'Back Squat', 0)),
    jsonb_build_array(pg_temp.st(9501, 9500, 1)),
    jsonb_build_array(pg_temp.tm(9601, 9501, 1)));
SELECT pg_temp.push(105,
    jsonb_build_array(pg_temp.ex(9700, 105, 'pr20-front-squat', 'Front Squat', 0)),
    jsonb_build_array(pg_temp.st(9701, 9700, 1)),
    '[]'::jsonb);
SELECT is(pg_temp.tel_in(105), 0,
    'telemetry is not attached to a different exercise at the same position');

SELECT * FROM finish();
ROLLBACK;
