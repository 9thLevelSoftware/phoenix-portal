-- PR 40: caller-scoped analytics aggregate RPCs
-- (supabase/migrations/20260920004000_analytics_aggregate_rpcs.sql).
--
-- Fixtures (inserted as postgres, bypassing the EMBER-gated INSERT policies):
--   user A: 8 sessions (5 consecutive UTC days, a same-day double, a
--           p2-profile session a week later, one session yesterday),
--           1,210 exercise_progress rows (1,200 "Bench Press"), 3 p2 rows,
--           1,100 personal_records of which 50 are tombstoned and which
--           share achieved_at in pairs (keyset tie-break);
--   user B: one session, exercise, progress row and PR of its own.
-- Every RPC call runs as `authenticated` with a JWT subject, so RLS and the
-- explicit auth.uid() filter are both in play (as postgres RLS is bypassed
-- and cross-user checks would pass vacuously).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

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
-- Fixtures.
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, email)
VALUES
    ('a4040404-0000-4000-8000-00000000000a'::uuid, 'pr40-a@example.test'),
    ('b4040404-0000-4000-8000-00000000000b'::uuid, 'pr40-b@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.subscriptions (id, user_id, tier, status, current_period_end)
VALUES
    ('a4040404-5555-4000-8000-00000000000a', 'a4040404-0000-4000-8000-00000000000a',
     'EMBER', 'active', now() + INTERVAL '30 days'),
    ('b4040404-5555-4000-8000-00000000000b', 'b4040404-0000-4000-8000-00000000000b',
     'EMBER', 'active', now() + INTERVAL '30 days');

INSERT INTO public.local_profiles (user_id, id, name)
VALUES ('a4040404-0000-4000-8000-00000000000a', 'p2', 'Second profile');

-- A's sessions. Stored total_volume is per cable (KD-8): sum = 2557.
INSERT INTO public.workout_sessions
    (id, user_id, started_at, total_volume, duration_seconds, set_count, local_profile_id)
VALUES
    ('a4040404-0001-4000-8000-000000000001', 'a4040404-0000-4000-8000-00000000000a', '2026-01-05 10:00+00', 100, 600, 5, NULL),
    ('a4040404-0001-4000-8000-000000000002', 'a4040404-0000-4000-8000-00000000000a', '2026-01-06 10:00+00', 200, 600, 5, NULL),
    ('a4040404-0001-4000-8000-000000000003', 'a4040404-0000-4000-8000-00000000000a', '2026-01-07 10:00+00', 300, 600, 5, NULL),
    ('a4040404-0001-4000-8000-000000000004', 'a4040404-0000-4000-8000-00000000000a', '2026-01-08 10:00+00', 400, 600, 5, NULL),
    ('a4040404-0001-4000-8000-000000000005', 'a4040404-0000-4000-8000-00000000000a', '2026-01-09 01:00+00', 500, 600, 5, NULL),
    ('a4040404-0001-4000-8000-000000000006', 'a4040404-0000-4000-8000-00000000000a', '2026-01-09 23:30+00', 50, 300, 2, NULL),
    ('a4040404-0001-4000-8000-000000000007', 'a4040404-0000-4000-8000-00000000000a', '2026-01-12 10:00+00', 1000, 900, 9, 'p2'),
    ('a4040404-0001-4000-8000-000000000008', 'a4040404-0000-4000-8000-00000000000a', now() - INTERVAL '1 day', 7, 60, 1, NULL);

INSERT INTO public.workout_sessions (id, user_id, started_at, total_volume)
VALUES ('b4040404-0001-4000-8000-000000000001', 'b4040404-0000-4000-8000-00000000000b', '2026-01-05 10:00+00', 99999);

-- Exercises: Bench Press in s1, twice in s2 (one session), and in s7 (p2);
-- Row in s1 only. B has a Squat.
INSERT INTO public.exercises (id, session_id, name, muscle_group, user_id)
VALUES
    ('a4040404-0002-4000-8000-000000000001', 'a4040404-0001-4000-8000-000000000001', 'Bench Press', 'Chest', 'a4040404-0000-4000-8000-00000000000a'),
    ('a4040404-0002-4000-8000-000000000002', 'a4040404-0001-4000-8000-000000000001', 'Row', 'Back', 'a4040404-0000-4000-8000-00000000000a'),
    ('a4040404-0002-4000-8000-000000000003', 'a4040404-0001-4000-8000-000000000002', 'Bench Press', 'Chest', 'a4040404-0000-4000-8000-00000000000a'),
    ('a4040404-0002-4000-8000-000000000004', 'a4040404-0001-4000-8000-000000000002', 'Bench Press', 'Chest', 'a4040404-0000-4000-8000-00000000000a'),
    ('a4040404-0002-4000-8000-000000000005', 'a4040404-0001-4000-8000-000000000007', 'Bench Press', 'Chest', 'a4040404-0000-4000-8000-00000000000a'),
    ('b4040404-0002-4000-8000-000000000001', 'b4040404-0001-4000-8000-000000000001', 'Squat', 'Legs', 'b4040404-0000-4000-8000-00000000000b');

-- 1,200 Bench Press progress rows; row i has estimated_1rm_kg = i and is
-- recorded i minutes after the base, so i = 1200 is the newest.
INSERT INTO public.exercise_progress
    (user_id, exercise_name, session_id, recorded_at, estimated_1rm_kg)
SELECT
    'a4040404-0000-4000-8000-00000000000a',
    'Bench Press',
    'a4040404-0001-4000-8000-000000000001',
    TIMESTAMPTZ '2026-01-01 00:00+00' + make_interval(mins => i),
    i
FROM generate_series(1, 1200) AS i;

INSERT INTO public.exercise_progress
    (user_id, exercise_name, session_id, recorded_at, estimated_1rm_kg)
SELECT
    'a4040404-0000-4000-8000-00000000000a',
    'Squat',
    'a4040404-0001-4000-8000-000000000002',
    TIMESTAMPTZ '2026-01-01 00:00+00' + make_interval(mins => i),
    i
FROM generate_series(1, 10) AS i;

INSERT INTO public.exercise_progress
    (user_id, exercise_name, session_id, recorded_at, estimated_1rm_kg, local_profile_id)
SELECT
    'a4040404-0000-4000-8000-00000000000a',
    'Deadlift',
    'a4040404-0001-4000-8000-000000000007',
    TIMESTAMPTZ '2026-01-12 10:00+00' + make_interval(mins => i),
    i,
    'p2'
FROM generate_series(1, 3) AS i;

INSERT INTO public.exercise_progress
    (user_id, exercise_name, session_id, recorded_at, estimated_1rm_kg)
VALUES (
    'b4040404-0000-4000-8000-00000000000b', 'Bench Press',
    'b4040404-0001-4000-8000-000000000001', '2027-01-01 00:00+00', 5000
);

-- 1,100 PRs for A. Rows 2k-1 and 2k share achieved_at (tie-break needed).
-- Every 22nd row is tombstoned: 50 tombstones, 1,050 live. Row 1100 is a
-- tombstone, so row 1099 is alone at the newest live achieved_at (minute
-- 550). The tie-break is exercised by the page walk (a page boundary splits
-- a tied pair), not by the first-row check.
INSERT INTO public.personal_records
    (id, user_id, exercise_name, value, achieved_at, deleted_at, local_profile_id)
SELECT
    ('a4040404-0003-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
    'a4040404-0000-4000-8000-00000000000a',
    'Bench Press',
    i,
    TIMESTAMPTZ '2026-02-01 00:00+00' + make_interval(mins => (i + 1) / 2),
    CASE WHEN i % 22 = 0 THEN now() END,
    CASE WHEN i <= 4 THEN 'p2' END
FROM generate_series(1, 1100) AS i;

INSERT INTO public.personal_records (id, user_id, exercise_name, value, achieved_at)
VALUES ('b4040404-0003-4000-8000-000000000001', 'b4040404-0000-4000-8000-00000000000b',
        'Squat', 1, '2027-01-01 00:00+00');

-- Page-walk sink (written under the authenticated role).
CREATE TEMP TABLE pr_walk (
    seq integer,
    page integer,
    id uuid,
    achieved_at timestamptz,
    deleted_at timestamptz
) ON COMMIT DROP;
GRANT ALL ON pr_walk TO authenticated;

-- Walks personal_record_history with the (achieved_at, id) keyset cursor.
CREATE FUNCTION pg_temp.walk_pr_history(p_page_size integer) RETURNS integer
LANGUAGE plpgsql
AS $walk$
DECLARE
    v_before timestamptz := NULL;
    v_before_id uuid := NULL;
    v_page integer := 0;
    v_seq integer := 0;
    v_rows integer;
    r record;
BEGIN
    LOOP
        v_page := v_page + 1;
        v_rows := 0;
        FOR r IN
            SELECT h.id, h.achieved_at, h.deleted_at
            FROM public.personal_record_history(NULL, p_page_size, v_before, v_before_id) h
        LOOP
            v_seq := v_seq + 1;
            v_rows := v_rows + 1;
            INSERT INTO pr_walk VALUES (v_seq, v_page, r.id, r.achieved_at, r.deleted_at);
            v_before := r.achieved_at;
            v_before_id := r.id;
        END LOOP;
        EXIT WHEN v_rows < p_page_size OR v_page > 50;
    END LOOP;
    RETURN v_page;
END
$walk$;

-- ---------------------------------------------------------------------------
SELECT diag('database:analytics-rpcs-grants');
-- ---------------------------------------------------------------------------

SELECT is(
    (
        SELECT count(*)::integer
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'exercise_frequency', 'exercise_names', 'exercise_progress_series',
              'personal_record_history', 'profile_workout_stats', 'session_volume_buckets'
          )
    ),
    6,
    'exactly one overload of each of the six analytics RPCs'
);

SELECT is(
    (
        SELECT count(*)::integer
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'exercise_frequency', 'exercise_names', 'exercise_progress_series',
              'personal_record_history', 'profile_workout_stats', 'session_volume_buckets'
          )
          AND NOT p.prosecdef
          AND 'search_path=""' = ANY (p.proconfig)
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
          AND NOT EXISTS (
              SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
          )
    ),
    6,
    'all six are SECURITY INVOKER, search_path pinned, authenticated-only (no anon, no PUBLIC)'
);

-- ---------------------------------------------------------------------------
SELECT diag('database:analytics-rpcs-owner');
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('a4040404-0000-4000-8000-00000000000a');

-- exercise_frequency: distinct sessions, not exercise rows.
SELECT results_eq(
    $$SELECT exercise_name, muscle_group, sessions FROM public.exercise_frequency()$$,
    $$VALUES ('Bench Press'::text, 'Chest'::text, 3), ('Row'::text, 'Back'::text, 1)$$,
    'exercise_frequency counts distinct sessions per exercise, most frequent first'
);

SELECT results_eq(
    $$SELECT exercise_name, sessions FROM public.exercise_frequency('p2')$$,
    $$VALUES ('Bench Press'::text, 1)$$,
    'exercise_frequency filters by profile through the parent session'
);

-- exercise_names.
SELECT results_eq(
    $$SELECT exercise_name FROM public.exercise_names()$$,
    $$VALUES ('Bench Press'::text), ('Deadlift'::text), ('Squat'::text)$$,
    'exercise_names returns distinct names A-Z across 1,213 progress rows'
);

SELECT results_eq(
    $$SELECT exercise_name FROM public.exercise_names('p2')$$,
    $$VALUES ('Deadlift'::text)$$,
    'exercise_names filters by profile'
);

-- exercise_progress_series: newest first; the newest row is never lost.
SELECT is(
    (SELECT count(*)::integer FROM public.exercise_progress_series('Bench Press')),
    500,
    'exercise_progress_series returns the default 500 rows of 1,200'
);

SELECT is(
    (SELECT estimated_1rm_kg::integer FROM public.exercise_progress_series('Bench Press') LIMIT 1),
    1200,
    'exercise_progress_series first row is the newest (row 1,200)'
);

SELECT is(
    (
        SELECT array_agg(estimated_1rm_kg::integer)
        FROM public.exercise_progress_series('Bench Press', NULL, 1000)
    ),
    (SELECT array_agg(i) FROM generate_series(1200, 201, -1) AS i),
    'exercise_progress_series(limit 1000) returns rows 1200..201 strictly newest first'
);

SELECT is(
    (SELECT count(*)::integer FROM public.exercise_progress_series('Bench Press', NULL, 5000)),
    1000,
    'exercise_progress_series clamps p_limit to 1000'
);

SELECT is(
    (SELECT count(*)::integer FROM public.exercise_progress_series('Deadlift', 'p2')),
    3,
    'exercise_progress_series filters by profile'
);

-- personal_record_history: keyset walk over 1,100 rows (50 tombstoned).
SELECT is(
    (SELECT id FROM public.personal_record_history(NULL, 1)),
    'a4040404-0003-4000-8000-000000001099'::uuid,
    'personal_record_history first row is the newest live PR (tombstoned row 1100 skipped)'
);

SELECT is(pg_temp.walk_pr_history(100), 11, 'walking pages of 100 takes 11 pages');

SELECT is((SELECT count(*)::integer FROM pr_walk), 1050, 'the walk returns all 1,050 live PRs');
SELECT is((SELECT count(DISTINCT id)::integer FROM pr_walk), 1050, 'the walk has no duplicate rows');
SELECT is(
    (SELECT count(*)::integer FROM pr_walk WHERE deleted_at IS NOT NULL),
    0,
    'the walk never returns a tombstoned PR'
);
SELECT is(
    (
        SELECT count(*)::integer
        FROM pr_walk w
        JOIN pr_walk prev ON prev.seq = w.seq - 1
        WHERE (w.achieved_at, w.id) >= (prev.achieved_at, prev.id)
    ),
    0,
    'the walk is strictly descending by (achieved_at, id) across page boundaries'
);
SELECT is(
    (
        SELECT count(*)::integer
        FROM pr_walk w
        JOIN pr_walk prev ON prev.seq = w.seq - 1
        WHERE w.page <> prev.page AND w.achieved_at = prev.achieved_at
    ) > 0,
    true,
    'at least one page boundary splits a tied achieved_at pair (tie-break exercised)'
);

SELECT is(
    (SELECT count(*)::integer FROM public.personal_record_history(NULL, 5000)),
    1000,
    'personal_record_history clamps p_limit to 1000'
);

SELECT is(
    (SELECT count(*)::integer FROM public.personal_record_history('p2', 100)),
    4,
    'personal_record_history filters by profile'
);

-- profile_workout_stats: stored per-cable volume, never doubled (KD-8).
SELECT results_eq(
    $$SELECT total_workouts, total_volume, best_streak, pr_count FROM public.profile_workout_stats()$$,
    $$VALUES (8, 2557::numeric, 5, 1050)$$,
    'profile_workout_stats: 8 sessions, raw volume 2557 (no x2), best UTC streak 5, 1,050 live PRs'
);

SELECT results_eq(
    $$SELECT total_workouts, total_volume, best_streak, pr_count FROM public.profile_workout_stats('p2')$$,
    $$VALUES (1, 1000::numeric, 1, 4)$$,
    'profile_workout_stats filters by profile'
);

-- session_volume_buckets.
SELECT results_eq(
    $$SELECT week_start, sessions, total_volume
      FROM public.session_volume_buckets('all')
      WHERE week_start < DATE '2026-06-01'$$,
    $$VALUES (DATE '2026-01-05', 6, 1550::numeric), (DATE '2026-01-12', 1, 1000::numeric)$$,
    'session_volume_buckets(all) buckets by ISO week (UTC), raw per-cable volume'
);

SELECT is(
    (SELECT count(*)::integer FROM public.session_volume_buckets('all')),
    3,
    'session_volume_buckets(all) has three weekly buckets'
);

SELECT results_eq(
    $$SELECT sessions, total_volume, total_duration_seconds, total_sets FROM public.session_volume_buckets('1w')$$,
    $$VALUES (1, 7::numeric, 60::bigint, 1::bigint)$$,
    'session_volume_buckets(1w) keeps only the last 7 days'
);

SELECT throws_ok(
    $$SELECT * FROM public.session_volume_buckets('3d')$$,
    '22023',
    NULL,
    'session_volume_buckets rejects an unknown period'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
SELECT diag('database:analytics-rpcs-cross-user');
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('b4040404-0000-4000-8000-00000000000b');

SELECT results_eq(
    $$SELECT exercise_name, muscle_group, sessions FROM public.exercise_frequency()$$,
    $$VALUES ('Squat'::text, 'Legs'::text, 1)$$,
    'B sees only its own exercise frequency'
);
SELECT results_eq(
    $$SELECT exercise_name FROM public.exercise_names()$$,
    $$VALUES ('Bench Press'::text)$$,
    'B sees only its own exercise names'
);
SELECT results_eq(
    $$SELECT estimated_1rm_kg::integer FROM public.exercise_progress_series('Bench Press')$$,
    $$VALUES (5000)$$,
    'B sees only its own Bench Press progress row, none of A''s 1,200'
);
SELECT is(
    (SELECT count(*)::integer FROM public.exercise_progress_series('Deadlift', 'p2')),
    0,
    'B cannot read A''s profile-scoped progress by naming A''s profile id'
);
SELECT results_eq(
    $$SELECT id FROM public.personal_record_history()$$,
    $$VALUES ('b4040404-0003-4000-8000-000000000001'::uuid)$$,
    'B sees only its own PR, none of A''s 1,100'
);
SELECT results_eq(
    $$SELECT total_workouts, total_volume, best_streak, pr_count FROM public.profile_workout_stats()$$,
    $$VALUES (1, 99999::numeric, 1, 1)$$,
    'B''s stats cover only B''s rows'
);
SELECT results_eq(
    $$SELECT total_workouts, total_volume, best_streak, pr_count FROM public.profile_workout_stats('p2')$$,
    $$VALUES (0, 0::numeric, 0, 0)$$,
    'B gets zeros for A''s profile id'
);
SELECT results_eq(
    $$SELECT week_start, sessions, total_volume FROM public.session_volume_buckets('all')$$,
    $$VALUES (DATE '2026-01-05', 1, 99999::numeric)$$,
    'B''s weekly buckets cover only B''s session'
);

-- No JWT subject: nothing.
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT is(
    (
        (SELECT count(*) FROM public.exercise_frequency())
        + (SELECT count(*) FROM public.exercise_names())
        + (SELECT count(*) FROM public.exercise_progress_series('Bench Press'))
        + (SELECT count(*) FROM public.personal_record_history())
        + (SELECT count(*) FROM public.session_volume_buckets('all'))
    )::integer,
    0,
    'a caller without auth.uid() gets no rows'
);

RESET ROLE;

-- anon cannot execute any of them.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT throws_ok(
    $$SELECT * FROM public.profile_workout_stats()$$,
    '42501',
    NULL,
    'anon cannot execute profile_workout_stats'
);
SELECT throws_ok(
    $$SELECT * FROM public.personal_record_history()$$,
    '42501',
    NULL,
    'anon cannot execute personal_record_history'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
