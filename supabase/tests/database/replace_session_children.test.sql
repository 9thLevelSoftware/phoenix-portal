-- replace_session_children: final-body behaviours (PR 20 -> PR 24 -> PR 28).
-- PR 20: stored rep_telemetry survives a re-push without telemetry. Key rule:
--   tier 1: same exercise row id + set_number (current mobile: stable ids);
--   tier 2 (only for exercise ids absent on the other side):
--           (identity, order_index, set_number);
--   both unique on old AND new side, new set without payload telemetry;
--   per-session bound of 50000 stash + payload rows.
-- PR 24: optional p_progress (7th argument, DEFAULT NULL) replaces the
--   sessions' exercise_progress; session_id lookups are indexed.
-- PR 28: exercises.cable_count (1, 2 or NULL = unknown) is stored from the
--   exercise JSON's cable_count key; the signature is unchanged, so exactly
--   one overload remains. The session-117 sequence below pins all final-body
--   behaviours in the same calls: telemetry kept on a re-push without it,
--   progress rows replaced, cable_count inserted.
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
        'public.replace_session_children(uuid, uuid[], jsonb, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE'),
    'anon cannot execute replace_session_children'
);

SELECT ok(
    NOT has_function_privilege('authenticated',
        'public.replace_session_children(uuid, uuid[], jsonb, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE'),
    'authenticated cannot execute replace_session_children'
);

SELECT ok(
    has_function_privilege('service_role',
        'public.replace_session_children(uuid, uuid[], jsonb, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE'),
    'service_role can execute replace_session_children'
);

SELECT diag('database:exercises-cable-count-column');

SELECT has_column('public', 'exercises', 'cable_count', 'exercises.cable_count exists');
SELECT col_type_is('public', 'exercises', 'cable_count', 'smallint',
    'exercises.cable_count is smallint');
SELECT col_is_null('public', 'exercises', 'cable_count',
    'exercises.cable_count is nullable (NULL = unknown)');
SELECT col_hasnt_default('public', 'exercises', 'cable_count',
    'exercises.cable_count has no default (never assumed to be 2)');

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

-- p_cable NULL omits the cable_count key entirely (today's mobile shape).
CREATE FUNCTION pg_temp.ex(p_id INT, p_session INT, p_catalog TEXT, p_name TEXT, p_order INT,
                           p_cable INT DEFAULT NULL)
RETURNS JSONB LANGUAGE sql AS $$
    SELECT jsonb_build_object(
        'id', pg_temp.u(p_id), 'session_id', pg_temp.u(p_session),
        'user_id', pg_temp.uid(), 'name', p_name, 'exercise_id', p_catalog,
        'muscle_group', 'General', 'order_index', p_order)
        || CASE WHEN p_cable IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('cable_count', p_cable) END
$$;

-- Stored cable_count of one exercise row.
CREATE FUNCTION pg_temp.cable_of(p_id INT) RETURNS SMALLINT LANGUAGE sql AS $$
    SELECT cable_count FROM public.exercises WHERE id = pg_temp.u(p_id)
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

SELECT diag('database:tier2-kept-exercise-without-old-sets-is-not-a-legacy-replacement');

INSERT INTO public.workout_sessions (id, user_id, started_at)
VALUES (pg_temp.u(119), pg_temp.uid(), now());

-- The retained row has no old sets, but its stable id must still exclude it
-- from legacy matching against the removed row with the same identity/order.
SELECT pg_temp.push(119,
    jsonb_build_array(pg_temp.ex(191, 119, 'pr20-bench-press', 'Bench Press', 0),
                      pg_temp.ex(192, 119, 'pr20-bench-press', 'Bench Press', 0)),
    jsonb_build_array(pg_temp.st(5192, 192, 1)),
    jsonb_build_array(pg_temp.tm(5292, 5192, 1)));
SELECT is(pg_temp.tel_on(5192), ARRAY[pg_temp.u(5292)],
    'the removed exercise initially owns the stored telemetry');
SELECT is(
    pg_temp.push(119,
        jsonb_build_array(pg_temp.ex(191, 119, 'pr20-bench-press', 'Bench Press', 0)),
        jsonb_build_array(pg_temp.st(6191, 191, 1)),
        '[]'::jsonb) ->> 'rep_telemetry_preserved',
    '0',
    'adding the first set to a retained exercise does not preserve another row''s curve');
SELECT is(pg_temp.tel_on(6191), ARRAY[]::uuid[],
    'the retained exercise receives no telemetry from the removed exercise');

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

-- ===========================================================================
-- PR 24 (F-069 / F-036): p_progress refreshes exercise_progress; session_id
-- lookups are indexed. The 6-argument calls above (pg_temp.push) already
-- prove today's call shape still resolves to the single 7-argument function.
-- ===========================================================================
SELECT diag('database:session-id-indexes-exist-and-are-used');

SELECT has_index('public', 'exercise_progress', 'idx_exercise_progress_session_id',
    'session_id', 'exercise_progress(session_id) is indexed');
SELECT has_index('public', 'personal_records', 'idx_personal_records_session_id',
    'session_id', 'personal_records(session_id) is indexed');

CREATE FUNCTION pg_temp.plan_of(p_query TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    r RECORD;
    v_plan TEXT := '';
BEGIN
    FOR r IN EXECUTE 'EXPLAIN ' || p_query LOOP
        v_plan := v_plan || r."QUERY PLAN" || E'\n';
    END LOOP;
    RETURN v_plan;
END;
$$;

-- Plan checks are index-name independent: each query must be served by an
-- index whose condition is on session_id (any such index, including a
-- future composite), never by a seq scan. The refresh delete runs on a
-- realistic, ANALYZEd shape (one user, 300 sessions x 10 progress rows), so a
-- per-user index is a real alternative the planner must reject. Seq scans
-- are disabled so tiny fixture tables cannot flip the plan on cost alone; with
-- no usable session_id index the plan stays a (disabled) Seq Scan or filters
-- session_id after a user_id index scan, and the assertions fail.
INSERT INTO public.workout_sessions (id, user_id, started_at)
SELECT pg_temp.u(30000 + n), pg_temp.uid(), now() - (n || ' days')::interval
  FROM generate_series(1, 300) AS n;
INSERT INTO public.exercise_progress (user_id, exercise_name, session_id, max_weight_kg)
SELECT pg_temp.uid(), 'History Lift ' || (g % 10), pg_temp.u(30000 + 1 + (g / 10)), 50
  FROM generate_series(0, 2999) AS g;
ANALYZE public.exercise_progress;
ANALYZE public.personal_records;
SET LOCAL enable_seqscan = off;

CREATE TEMP TABLE pr24_plans ON COMMIT DROP AS
SELECT 'refresh delete' AS probe, pg_temp.plan_of(format(
           'DELETE FROM public.exercise_progress WHERE session_id = ANY(ARRAY[%L, %L]::uuid[]) AND user_id = %L',
           pg_temp.u(30001), pg_temp.u(30002), pg_temp.uid())) AS plan
UNION ALL
SELECT 'progress probe', pg_temp.plan_of(format(
           'SELECT session_id, exercise_id, exercise_name FROM public.exercise_progress WHERE session_id = ANY(ARRAY[%L, %L]::uuid[])',
           pg_temp.u(117), pg_temp.u(118)))
UNION ALL
SELECT 'personal_records lookup', pg_temp.plan_of(format(
           'SELECT id FROM public.personal_records WHERE session_id = %L',
           pg_temp.u(117)));
RESET enable_seqscan;

SELECT matches((SELECT plan FROM pr24_plans WHERE probe = 'refresh delete'),
    'Index Cond: [^\n]*session_id',
    'the progress refresh delete is served by an index on session_id');
SELECT doesnt_match((SELECT plan FROM pr24_plans WHERE probe = 'refresh delete'),
    'Seq Scan',
    'the progress refresh delete does not seq-scan exercise_progress');
SELECT matches((SELECT plan FROM pr24_plans WHERE probe = 'progress probe'),
    'Index Cond: [^\n]*session_id',
    'a session_id probe on exercise_progress is served by an index on session_id');
SELECT doesnt_match((SELECT plan FROM pr24_plans WHERE probe = 'progress probe'),
    'Seq Scan',
    'a session_id probe does not seq-scan exercise_progress');
SELECT matches((SELECT plan FROM pr24_plans WHERE probe = 'personal_records lookup'),
    'Index Cond: [^\n]*session_id',
    'a personal_records session lookup is served by an index on session_id');
SELECT doesnt_match((SELECT plan FROM pr24_plans WHERE probe = 'personal_records lookup'),
    'Seq Scan',
    'a personal_records session lookup does not seq-scan');


SELECT diag('database:p-progress-refreshes-exercise-progress');

INSERT INTO auth.users (id, email)
VALUES ('20200000-0000-4000-8000-000000000002'::uuid, 'rsc-progress-other@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.workout_sessions (id, user_id, started_at)
SELECT pg_temp.u(n), pg_temp.uid(), now() - (n || ' hours')::interval
  FROM generate_series(117, 118) AS n;

CREATE FUNCTION pg_temp.pg(p_session INT, p_name TEXT, p_weight NUMERIC, p_1rm NUMERIC,
                           p_user UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE sql AS $$
    SELECT jsonb_build_object(
        'user_id', COALESCE(p_user, pg_temp.uid()), 'local_profile_id', NULL,
        'exercise_name', p_name, 'exercise_id', NULL,
        'session_id', pg_temp.u(p_session), 'recorded_at', '2026-09-18T10:00:00Z',
        'max_weight_kg', p_weight, 'total_volume_kg', p_weight * 10,
        'estimated_1rm_kg', p_1rm, 'velocity_estimated_1rm_kg', NULL,
        'max_reps', 10, 'set_count', 1)
$$;

CREATE FUNCTION pg_temp.push_p(p_session INT, p_exercises JSONB, p_sets JSONB,
                               p_telemetry JSONB, p_prog JSONB)
RETURNS JSONB LANGUAGE sql AS $$
    SELECT public.replace_session_children(
        p_user_id => pg_temp.uid(), p_session_ids => ARRAY[pg_temp.u(p_session)],
        p_exercises => p_exercises, p_sets => p_sets, p_rep_summaries => '[]'::jsonb,
        p_rep_telemetry => p_telemetry, p_progress => p_prog)
$$;

-- Progress of session 117 as sorted "name:max_weight:1rm" strings.
CREATE FUNCTION pg_temp.prog_of(p_session INT) RETURNS TEXT[] LANGUAGE sql AS $$
    SELECT COALESCE(array_agg(exercise_name || ':' || max_weight_kg::text || ':'
                              || estimated_1rm_kg::text ORDER BY exercise_name),
                    ARRAY[]::text[])
      FROM public.exercise_progress
     WHERE session_id = pg_temp.u(p_session) AND user_id = pg_temp.uid()
$$;

-- Session 118 has progress of its own; another user's row sits on 117.
INSERT INTO public.exercise_progress (user_id, exercise_name, session_id, max_weight_kg, estimated_1rm_kg)
VALUES (pg_temp.uid(), 'Other Session Lift', pg_temp.u(118), 70, 80),
       ('20200000-0000-4000-8000-000000000002'::uuid, 'Foreign Lift', pg_temp.u(117), 90, 99);

-- First push of 117: two exercises, telemetry on the first set.
SELECT is(
    pg_temp.push_p(117,
        jsonb_build_array(pg_temp.ex(241, 117, NULL, 'Cable Row A', 0, 1),
                          pg_temp.ex(242, 117, NULL, 'Cable Row B', 1)),
        jsonb_build_array(pg_temp.st(24101, 241, 1), pg_temp.st(24201, 242, 1)),
        jsonb_build_array(pg_temp.tm(24111, 24101, 1), pg_temp.tm(24112, 24101, 2)),
        jsonb_build_array(pg_temp.pg(117, 'Cable Row A', 20, 26.67),
                          pg_temp.pg(117, 'Cable Row B', 40, 50))
    ) ->> 'exercise_progress',
    '2',
    'first push inserts two progress rows and reports them'
);
SELECT is(pg_temp.prog_of(117),
    ARRAY['Cable Row A:20:26.67', 'Cable Row B:40:50'],
    'first push stores the supplied progress');
SELECT is(pg_temp.cable_of(241), 1::smallint, 'cable_count 1 is stored');
SELECT is(pg_temp.cable_of(242), NULL::smallint,
    'an exercise without a cable_count key stores NULL (unknown), not 2');

-- Edit: new weights and estimates, no telemetry (PR 20 must still keep it).
SELECT is(
    pg_temp.push_p(117,
        jsonb_build_array(pg_temp.ex(241, 117, NULL, 'Cable Row A', 0, 1),
                          pg_temp.ex(242, 117, NULL, 'Cable Row B', 1, 2)),
        jsonb_build_array(pg_temp.st(24102, 241, 1), pg_temp.st(24202, 242, 1)),
        '[]'::jsonb,
        jsonb_build_array(pg_temp.pg(117, 'Cable Row A', 30, 40),
                          pg_temp.pg(117, 'Cable Row B', 44, 55))
    ) ->> 'rep_telemetry_preserved',
    '2',
    'the 7-argument call keeps PR 20 telemetry preservation'
);
SELECT is(pg_temp.tel_on(24102), ARRAY[pg_temp.u(24111), pg_temp.u(24112)],
    'stored telemetry follows the re-pushed set');
SELECT is(pg_temp.prog_of(117),
    ARRAY['Cable Row A:30:40', 'Cable Row B:44:55'],
    'an edited session replaces max_weight_kg and estimated_1rm_kg (no stale rows)');
SELECT is(ARRAY[pg_temp.cable_of(241), pg_temp.cable_of(242)], ARRAY[1, 2]::smallint[],
    'the same re-push stores cable_count (kept 1; NULL -> 2)');

-- Remove exercise B.
SELECT pg_temp.push_p(117,
    jsonb_build_array(pg_temp.ex(241, 117, NULL, 'Cable Row A', 0)),
    jsonb_build_array(pg_temp.st(24103, 241, 1)),
    '[]'::jsonb,
    jsonb_build_array(pg_temp.pg(117, 'Cable Row A', 30, 40)));
SELECT is(pg_temp.prog_of(117), ARRAY['Cable Row A:30:40'],
    'a removed exercise loses its progress row');

-- Isolation: other sessions and other users are untouched.
SELECT is(
    (SELECT count(*)::int FROM public.exercise_progress
      WHERE session_id = pg_temp.u(118) AND exercise_name = 'Other Session Lift'),
    1,
    'progress of a session outside p_session_ids is untouched');
SELECT is(
    (SELECT count(*)::int FROM public.exercise_progress
      WHERE session_id = pg_temp.u(117) AND exercise_name = 'Foreign Lift'),
    1,
    'another user''s progress row is untouched');

-- The old 6-argument call leaves progress alone.
SELECT pg_temp.push(117,
    jsonb_build_array(pg_temp.ex(241, 117, NULL, 'Cable Row A', 0)),
    jsonb_build_array(pg_temp.st(24104, 241, 1)),
    '[]'::jsonb);
SELECT is(pg_temp.prog_of(117), ARRAY['Cable Row A:30:40'],
    'a call without p_progress does not touch exercise_progress');
SELECT is(pg_temp.cable_of(241), NULL::smallint,
    'a re-push without cable_count stores NULL (last push wins, like every exercise column)');

SELECT diag('database:cable-count-outside-1-2-is-rejected');

SELECT throws_ok(
    format('SELECT public.replace_session_children(%L::uuid, ARRAY[%L::uuid], %L::jsonb, %L::jsonb, %L::jsonb, %L::jsonb)',
           pg_temp.uid(), pg_temp.u(117),
           jsonb_build_array(pg_temp.ex(241, 117, NULL, 'Cable Row A', 0, 3)),
           '[]', '[]', '[]'),
    '23514', NULL,
    'cable_count 3 violates the CHECK and rolls back the call');
SELECT is(
    (SELECT count(*)::int FROM public.exercises WHERE id = pg_temp.u(241)),
    1,
    'the rejected call left the stored exercise in place');

-- Supplied rows outside p_session_ids or for another user are ignored.
SELECT is(
    pg_temp.push_p(117,
        jsonb_build_array(pg_temp.ex(241, 117, NULL, 'Cable Row A', 0)),
        jsonb_build_array(pg_temp.st(24105, 241, 1)),
        '[]'::jsonb,
        jsonb_build_array(
            pg_temp.pg(117, 'Cable Row A', 32, 42),
            pg_temp.pg(118, 'Smuggled Lift', 1, 1),
            pg_temp.pg(117, 'Smuggled Foreign', 1, 1,
                       '20200000-0000-4000-8000-000000000002'::uuid))
    ) ->> 'exercise_progress',
    '1',
    'only rows for p_session_ids and p_user_id are inserted');
SELECT is(pg_temp.prog_of(118), ARRAY['Other Session Lift:70:80'],
    'a row for a session outside p_session_ids is not inserted');
SELECT is(
    (SELECT count(*)::int FROM public.exercise_progress
      WHERE exercise_name = 'Smuggled Foreign'),
    0,
    'a row for another user is not inserted');

-- An empty array clears the session.
SELECT pg_temp.push_p(117, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
SELECT is(pg_temp.prog_of(117), ARRAY[]::text[],
    'p_progress = [] clears the session''s progress');

SELECT * FROM finish();
ROLLBACK;
