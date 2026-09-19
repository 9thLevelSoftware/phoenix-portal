-- replace_session_children: final-body behaviours (PR 20 -> PR 24 -> PR 28).
-- PR 20: stored rep_telemetry survives a re-push without telemetry. Key rule:
--   tier 1: same exercise row id + set_number (current mobile: stable ids);
--   tier 2 (only for exercise ids absent on the other side):
--           (identity, order_index, set_number);
--   both unique on old AND new side, new set without payload telemetry;
--   per-session bound of 50000 stash + payload rows.
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
  FROM generate_series(100, 116) AS n;

-- ===========================================================================
-- Tier 1: real mobile shape (one set per exercise, set_number 1, stable
-- exercise ids, fresh set ids per push, same exercise repeated)
-- ===========================================================================
SELECT diag('database:mobile-shape-re-push-without-telemetry-keeps-each-sets-telemetry');

-- Routine session 100: three sets of bench = three exercises E1..E3.
SELECT pg_temp.push(100,
    jsonb_build_array(pg_temp.ex(1, 100, 'pr20-bench-press', 'Bench Press', 0),
                      pg_temp.ex(2, 100, 'pr20-bench-press', 'Bench Press', 1),
                      pg_temp.ex(3, 100, 'pr20-bench-press', 'Bench Press', 2)),
    jsonb_build_array(pg_temp.st(1001, 1, 1), pg_temp.st(1002, 2, 1),
                      pg_temp.st(1003, 3, 1)),
    jsonb_build_array(pg_temp.tm(1101, 1001, 1), pg_temp.tm(1102, 1001, 2),
                      pg_temp.tm(1201, 1002, 1), pg_temp.tm(1301, 1003, 1)));
SELECT is(pg_temp.tel_in(100), 4, 'first mobile-shaped push stores four rows');

SELECT is(
    pg_temp.push(100,
        jsonb_build_array(pg_temp.ex(1, 100, 'pr20-bench-press', 'Bench Press', 0),
                          pg_temp.ex(2, 100, 'pr20-bench-press', 'Bench Press', 1),
                          pg_temp.ex(3, 100, 'pr20-bench-press', 'Bench Press', 2)),
        jsonb_build_array(pg_temp.st(2001, 1, 1), pg_temp.st(2002, 2, 1),
                          pg_temp.st(2003, 3, 1)),
        '[]'::jsonb) ->> 'rep_telemetry_preserved',
    '4',
    're-push without telemetry reports four preserved rows'
);
SELECT is(pg_temp.tel_in(100), 4, 're-push without telemetry keeps the telemetry count');
SELECT is(pg_temp.tel_on(2001), ARRAY[pg_temp.u(1101), pg_temp.u(1102)],
    'set of E1 keeps its own telemetry on the new set id');
SELECT is(pg_temp.tel_on(2002), ARRAY[pg_temp.u(1201)],
    'set of E2 keeps its own telemetry on the new set id');
SELECT is(pg_temp.tel_on(2003), ARRAY[pg_temp.u(1301)],
    'set of E3 keeps its own telemetry on the new set id');
SELECT is(
    (SELECT count(*)::int FROM public.sets
      WHERE id IN (pg_temp.u(1001), pg_temp.u(1002), pg_temp.u(1003))),
    0,
    'old set rows are gone'
);

SELECT diag('database:mobile-shape-re-push-with-new-telemetry-replaces');

SELECT pg_temp.push(100,
    jsonb_build_array(pg_temp.ex(1, 100, 'pr20-bench-press', 'Bench Press', 0),
                      pg_temp.ex(2, 100, 'pr20-bench-press', 'Bench Press', 1),
                      pg_temp.ex(3, 100, 'pr20-bench-press', 'Bench Press', 2)),
    jsonb_build_array(pg_temp.st(3001, 1, 1), pg_temp.st(3002, 2, 1),
                      pg_temp.st(3003, 3, 1)),
    jsonb_build_array(pg_temp.tm(3201, 3002, 9)));
SELECT is(pg_temp.tel_on(3002), ARRAY[pg_temp.u(3201)],
    'payload telemetry replaces the stored telemetry of that set');
SELECT is(pg_temp.tel_on(3001), ARRAY[pg_temp.u(1101), pg_temp.u(1102)],
    'E1 without payload telemetry keeps its stored telemetry');
SELECT is(pg_temp.tel_on(3003), ARRAY[pg_temp.u(1301)],
    'E3 without payload telemetry keeps its stored telemetry');
SELECT is(pg_temp.tel_in(100), 4, 'no stale telemetry survives a replacement');

SELECT diag('database:mobile-shape-removed-middle-set-drops-only-its-telemetry');

-- E2 deleted on mobile: E3 moves to order_index 1 but keeps its stable id.
SELECT pg_temp.push(100,
    jsonb_build_array(pg_temp.ex(1, 100, 'pr20-bench-press', 'Bench Press', 0),
                      pg_temp.ex(3, 100, 'pr20-bench-press', 'Bench Press', 1)),
    jsonb_build_array(pg_temp.st(4001, 1, 1), pg_temp.st(4003, 3, 1)),
    '[]'::jsonb);
SELECT is(pg_temp.tel_on(4001), ARRAY[pg_temp.u(1101), pg_temp.u(1102)],
    'E1 keeps its telemetry after the middle set is removed');
SELECT is(pg_temp.tel_on(4003), ARRAY[pg_temp.u(1301)],
    'E3 keeps its telemetry although its order_index shifted');
SELECT is(pg_temp.tel_in(100), 3, 'only the removed set''s telemetry is gone');

SELECT diag('database:stable-id-reorder-follows-the-exercise');

SELECT pg_temp.push(101,
    jsonb_build_array(pg_temp.ex(11, 101, 'pr20-back-squat', 'Back Squat', 0),
                      pg_temp.ex(12, 101, NULL, 'Cable Row', 1)),
    jsonb_build_array(pg_temp.st(5011, 11, 1), pg_temp.st(5012, 12, 1)),
    jsonb_build_array(pg_temp.tm(5111, 5011, 1), pg_temp.tm(5112, 5012, 1)));
SELECT pg_temp.push(101,
    jsonb_build_array(pg_temp.ex(12, 101, NULL, 'Cable Row', 0),
                      pg_temp.ex(11, 101, 'pr20-back-squat', 'Back Squat', 1)),
    jsonb_build_array(pg_temp.st(6012, 12, 1), pg_temp.st(6011, 11, 1)),
    '[]'::jsonb);
SELECT is(pg_temp.tel_on(6011), ARRAY[pg_temp.u(5111)],
    'swapped squat keeps its telemetry by exercise id');
SELECT is(pg_temp.tel_on(6012), ARRAY[pg_temp.u(5112)],
    'swapped row keeps its telemetry by exercise id');

SELECT diag('database:stable-id-survives-later-catalog-tagging');

SELECT pg_temp.push(102,
    jsonb_build_array(pg_temp.ex(21, 102, NULL, 'Just Lift', 0)),
    jsonb_build_array(pg_temp.st(5021, 21, 1)),
    jsonb_build_array(pg_temp.tm(5121, 5021, 1)));
SELECT pg_temp.push(102,
    jsonb_build_array(pg_temp.ex(21, 102, 'pr20-deadlift', 'Deadlift', 0)),
    jsonb_build_array(pg_temp.st(6021, 21, 1)),
    '[]'::jsonb);
SELECT is(pg_temp.tel_on(6021), ARRAY[pg_temp.u(5121)],
    'same exercise row re-tagged with a catalog id keeps its telemetry');

SELECT diag('database:tier1-old-side-duplicate-is-not-relinked');

-- Old exercise E31 holds two sets numbered 1; the re-push has one.
SELECT pg_temp.push(103,
    jsonb_build_array(pg_temp.ex(31, 103, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(5031, 31, 1), pg_temp.st(5032, 31, 1)),
    jsonb_build_array(pg_temp.tm(5131, 5031, 1), pg_temp.tm(5132, 5032, 1)));
SELECT is(
    pg_temp.push(103,
        jsonb_build_array(pg_temp.ex(31, 103, 'pr20-bench-press', 'Bench Press', 0)),
        jsonb_build_array(pg_temp.st(6031, 31, 1)),
        '[]'::jsonb) ->> 'rep_telemetry_preserved',
    '0',
    'old-side duplicate (exercise id, set_number) re-links nothing'
);
SELECT is(pg_temp.tel_in(103), 0, 'old-side ambiguous telemetry is deleted as before');

SELECT diag('database:tier1-new-side-duplicate-is-not-relinked');

SELECT pg_temp.push(104,
    jsonb_build_array(pg_temp.ex(41, 104, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(5041, 41, 1)),
    jsonb_build_array(pg_temp.tm(5141, 5041, 1)));
SELECT pg_temp.push(104,
    jsonb_build_array(pg_temp.ex(41, 104, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(6041, 41, 1), pg_temp.st(6042, 41, 1)),
    '[]'::jsonb);
SELECT is(pg_temp.tel_in(104), 0, 'new-side duplicate (exercise id, set_number) re-links nothing');

-- ===========================================================================
-- Tier 2: legacy clients that regenerate exercise ids
-- ===========================================================================
SELECT diag('database:legacy-regenerated-ids-relink-by-identity-and-position');

SELECT pg_temp.push(105,
    jsonb_build_array(pg_temp.ex(51, 105, 'pr20-bench-press', 'Bench Press', 0),
                      pg_temp.ex(52, 105, NULL, 'Cable Row', 1)),
    jsonb_build_array(pg_temp.st(5051, 51, 1), pg_temp.st(5052, 51, 2),
                      pg_temp.st(5053, 52, 1)),
    jsonb_build_array(pg_temp.tm(5151, 5051, 1), pg_temp.tm(5152, 5052, 1),
                      pg_temp.tm(5153, 5053, 1)));
SELECT is(
    pg_temp.push(105,
        jsonb_build_array(pg_temp.ex(61, 105, 'pr20-bench-press', 'Bench Press', 0),
                          pg_temp.ex(62, 105, NULL, '  cable ROW ', 1)),
        jsonb_build_array(pg_temp.st(6051, 61, 1), pg_temp.st(6052, 61, 2),
                          pg_temp.st(6053, 62, 1)),
        '[]'::jsonb) ->> 'rep_telemetry_preserved',
    '3',
    'legacy re-push with regenerated ids preserves all three sets'
);
SELECT is(pg_temp.tel_on(6051), ARRAY[pg_temp.u(5151)], 'legacy bench set 1 re-linked');
SELECT is(pg_temp.tel_on(6052), ARRAY[pg_temp.u(5152)], 'legacy bench set 2 re-linked');
SELECT is(pg_temp.tel_on(6053), ARRAY[pg_temp.u(5153)],
    'legacy name identity matches after trim/lowercase');

SELECT diag('database:legacy-same-identity-at-order-index-0-is-not-relinked');

SELECT pg_temp.push(106,
    jsonb_build_array(pg_temp.ex(71, 106, 'pr20-bench-press', 'Bench Press', 0),
                      pg_temp.ex(72, 106, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(5071, 71, 1), pg_temp.st(5072, 72, 1)),
    jsonb_build_array(pg_temp.tm(5171, 5071, 1), pg_temp.tm(5172, 5072, 1)));
SELECT is(
    pg_temp.push(106,
        jsonb_build_array(pg_temp.ex(81, 106, 'pr20-bench-press', 'Bench Press', 0),
                          pg_temp.ex(82, 106, 'pr20-bench-press', 'Bench Press', 0)),
        jsonb_build_array(pg_temp.st(6071, 81, 1), pg_temp.st(6072, 82, 1)),
        '[]'::jsonb) ->> 'rep_telemetry_preserved',
    '0',
    'duplicated (identity, order_index 0, set_number) re-links nothing'
);
SELECT is(pg_temp.tel_in(106), 0, 'ambiguous legacy telemetry is deleted as before');

SELECT diag('database:legacy-old-side-duplicate-is-not-relinked');

SELECT pg_temp.push(107,
    jsonb_build_array(pg_temp.ex(91, 107, 'pr20-bench-press', 'Bench Press', 0),
                      pg_temp.ex(92, 107, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(5091, 91, 1), pg_temp.st(5092, 92, 1)),
    jsonb_build_array(pg_temp.tm(5191, 5091, 1), pg_temp.tm(5192, 5092, 1)));
SELECT pg_temp.push(107,
    jsonb_build_array(pg_temp.ex(93, 107, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(6093, 93, 1)),
    '[]'::jsonb);
SELECT is(pg_temp.tel_in(107), 0,
    'two old candidates for one new legacy set: neither force curve is attached');

SELECT diag('database:legacy-new-side-duplicate-is-not-relinked');

SELECT pg_temp.push(108,
    jsonb_build_array(pg_temp.ex(101, 108, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(5101, 101, 1)),
    jsonb_build_array(pg_temp.tm(5201, 5101, 1)));
SELECT pg_temp.push(108,
    jsonb_build_array(pg_temp.ex(102, 108, 'pr20-bench-press', 'Bench Press', 0),
                      pg_temp.ex(103, 108, NULL, 'Bench Press', 0),
                      pg_temp.ex(104, 108, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(6102, 102, 1), pg_temp.st(6103, 103, 1),
                      pg_temp.st(6104, 104, 1)),
    '[]'::jsonb);
SELECT is(pg_temp.tel_in(108), 0, 'a legacy key duplicated only on the new side is not re-linked');

SELECT diag('database:legacy-swap-is-not-relinked');

-- Without a stable id, a reordered exercise cannot be told apart from a
-- different one at that position, so tier 2 (identity + order_index) does not
-- re-link it.
SELECT pg_temp.push(109,
    jsonb_build_array(pg_temp.ex(111, 109, 'pr20-back-squat', 'Back Squat', 0),
                      pg_temp.ex(112, 109, 'pr20-deadlift', 'Deadlift', 1)),
    jsonb_build_array(pg_temp.st(5111, 111, 1), pg_temp.st(5112, 112, 1)),
    jsonb_build_array(pg_temp.tm(5211, 5111, 1), pg_temp.tm(5212, 5112, 1)));
SELECT pg_temp.push(109,
    jsonb_build_array(pg_temp.ex(113, 109, 'pr20-deadlift', 'Deadlift', 0),
                      pg_temp.ex(114, 109, 'pr20-back-squat', 'Back Squat', 1)),
    jsonb_build_array(pg_temp.st(6113, 113, 1), pg_temp.st(6114, 114, 1)),
    '[]'::jsonb);
SELECT is(pg_temp.tel_in(109), 0, 'legacy swapped exercises are not re-linked');

SELECT diag('database:legacy-changed-identity-is-not-relinked');

SELECT pg_temp.push(110,
    jsonb_build_array(pg_temp.ex(121, 110, 'pr20-back-squat', 'Back Squat', 0)),
    jsonb_build_array(pg_temp.st(5121, 121, 1)),
    jsonb_build_array(pg_temp.tm(5221, 5121, 1)));
SELECT pg_temp.push(110,
    jsonb_build_array(pg_temp.ex(122, 110, 'pr20-deadlift', 'Deadlift', 0)),
    jsonb_build_array(pg_temp.st(6122, 122, 1)),
    '[]'::jsonb);
SELECT is(pg_temp.tel_in(110), 0,
    'telemetry is not attached to a different exercise at the same position');

SELECT diag('database:legacy-catalog-id-and-name-namespaces-do-not-collide');

SELECT pg_temp.push(111,
    jsonb_build_array(pg_temp.ex(131, 111, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(5131, 131, 1)),
    jsonb_build_array(pg_temp.tm(5231, 5131, 1)));
SELECT pg_temp.push(111,
    jsonb_build_array(pg_temp.ex(132, 111, NULL, 'pr20-bench-press', 0)),
    jsonb_build_array(pg_temp.st(6132, 132, 1)),
    '[]'::jsonb);
SELECT is(pg_temp.tel_in(111), 0,
    'a free-text name equal to a catalog id is a different identity');

SELECT diag('database:tier2-never-applies-to-a-kept-exercise-row');

-- E141 keeps its id but moves to order_index 1; a brand-new exercise id takes
-- the old (identity, order_index 0) slot. The curve follows E141 (tier 1) and
-- the new row must not also pick it up through tier 2.
SELECT pg_temp.push(112,
    jsonb_build_array(pg_temp.ex(141, 112, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(5141, 141, 1)),
    jsonb_build_array(pg_temp.tm(5241, 5141, 1)));
SELECT pg_temp.push(112,
    jsonb_build_array(pg_temp.ex(141, 112, 'pr20-bench-press', 'Bench Press', 1),
                      pg_temp.ex(142, 112, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(6141, 141, 1), pg_temp.st(6142, 142, 1)),
    '[]'::jsonb);
SELECT is(pg_temp.tel_on(6141), ARRAY[pg_temp.u(5241)],
    'the kept exercise row keeps its curve via tier 1');
SELECT is(pg_temp.tel_on(6142), ARRAY[]::uuid[],
    'a new legacy exercise at the old position gets nothing');

-- Same, but the kept row now carries payload telemetry: its stored curve is
-- replaced and must not leak onto the new legacy exercise via tier 2.
SELECT pg_temp.push(116,
    jsonb_build_array(pg_temp.ex(181, 116, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(5181, 181, 1)),
    jsonb_build_array(pg_temp.tm(5281, 5181, 1)));
SELECT pg_temp.push(116,
    jsonb_build_array(pg_temp.ex(181, 116, 'pr20-bench-press', 'Bench Press', 1),
                      pg_temp.ex(182, 116, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(6181, 181, 1), pg_temp.st(6182, 182, 1)),
    jsonb_build_array(pg_temp.tm(6281, 6181, 1)));
SELECT is(pg_temp.tel_on(6181), ARRAY[pg_temp.u(6281)],
    'the kept row holds only its payload telemetry');
SELECT is(pg_temp.tel_on(6182), ARRAY[]::uuid[],
    'a replaced curve of a kept row never moves to a new legacy exercise');

-- ===========================================================================
-- Per-session bound (50000 = MAX_TELEMETRY_POINTS)
-- ===========================================================================
SELECT diag('database:per-session-telemetry-bound');

-- Session 113: 49998 stored + 2 payload = 50000 -> kept.
SELECT pg_temp.push(113,
    jsonb_build_array(pg_temp.ex(151, 113, 'pr20-bench-press', 'Bench Press', 0),
                      pg_temp.ex(152, 113, 'pr20-bench-press', 'Bench Press', 1)),
    jsonb_build_array(pg_temp.st(5151, 151, 1), pg_temp.st(5152, 152, 1)),
    '[]'::jsonb);
INSERT INTO public.rep_telemetry (set_id, user_id, timestamp_ms, force_n)
SELECT pg_temp.u(5151), pg_temp.uid(), g, 1 FROM generate_series(1, 49998) AS g;
SELECT is(
    pg_temp.push(113,
        jsonb_build_array(pg_temp.ex(151, 113, 'pr20-bench-press', 'Bench Press', 0),
                          pg_temp.ex(152, 113, 'pr20-bench-press', 'Bench Press', 1)),
        jsonb_build_array(pg_temp.st(6151, 151, 1), pg_temp.st(6152, 152, 1)),
        jsonb_build_array(pg_temp.tm(6251, 6152, 1), pg_temp.tm(6252, 6152, 2))
    ) ->> 'rep_telemetry_preserved',
    '49998',
    'stash + payload exactly at the bound is preserved'
);
SELECT is(pg_temp.tel_in(113), 50000, 'session holds exactly the bound');

-- Session 114: 49999 stored + 2 payload = 50001 -> stash dropped.
SELECT pg_temp.push(114,
    jsonb_build_array(pg_temp.ex(161, 114, 'pr20-bench-press', 'Bench Press', 0),
                      pg_temp.ex(162, 114, 'pr20-bench-press', 'Bench Press', 1)),
    jsonb_build_array(pg_temp.st(5161, 161, 1), pg_temp.st(5162, 162, 1)),
    '[]'::jsonb);
INSERT INTO public.rep_telemetry (set_id, user_id, timestamp_ms, force_n)
SELECT pg_temp.u(5161), pg_temp.uid(), g, 1 FROM generate_series(1, 49999) AS g;
SELECT is(
    pg_temp.push(114,
        jsonb_build_array(pg_temp.ex(161, 114, 'pr20-bench-press', 'Bench Press', 0),
                          pg_temp.ex(162, 114, 'pr20-bench-press', 'Bench Press', 1)),
        jsonb_build_array(pg_temp.st(6161, 161, 1), pg_temp.st(6162, 162, 1)),
        jsonb_build_array(pg_temp.tm(6261, 6162, 1), pg_temp.tm(6262, 6162, 2))
    ) ->> 'rep_telemetry_preserved',
    '0',
    'stash + payload over the bound falls back to delete'
);
SELECT is(pg_temp.tel_in(114), 2, 'only the payload telemetry remains over the bound');

-- ===========================================================================
-- Cross-session isolation within one call
-- ===========================================================================
SELECT diag('database:multi-session-call-keeps-each-session');

SELECT public.replace_session_children(
    pg_temp.uid(), ARRAY[pg_temp.u(115), pg_temp.u(102)],
    jsonb_build_array(pg_temp.ex(171, 115, 'pr20-bench-press', 'Bench Press', 0),
                      pg_temp.ex(21, 102, 'pr20-deadlift', 'Deadlift', 0)),
    jsonb_build_array(pg_temp.st(5171, 171, 1), pg_temp.st(7021, 21, 1)),
    '[]'::jsonb,
    jsonb_build_array(pg_temp.tm(5271, 5171, 1)));
SELECT is(pg_temp.tel_on(7021), ARRAY[pg_temp.u(5121)],
    'a second session in the same call keeps its telemetry');
SELECT is(pg_temp.tel_on(5171), ARRAY[pg_temp.u(5271)],
    'the first session gets its payload telemetry');

SELECT * FROM finish();
ROLLBACK;
