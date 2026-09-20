-- PR 40: caller-scoped analytics aggregate RPCs
-- (supabase/migrations/20260920004000_analytics_aggregate_rpcs.sql).
--
-- The session time zone is deliberately NOT UTC (Pacific/Auckland): results
-- must depend only on p_tz, never on the connection's TimeZone setting.
--
-- Fixtures (inserted as postgres, bypassing the EMBER-gated INSERT policies):
--   user A: 10 sessions built to separate UTC days/weeks from
--           Australia/Sydney days/weeks (UTC+11 in January), including a
--           same-UTC-day double in the MIDDLE of a run (proves DISTINCT);
--           1,212 "Bench Press"/"Squat" progress rows + 3 p2 "Deadlift" rows;
--           1,100 personal_records, tied in pairs on achieved_at, with
--           microsecond timestamps; 50 tombstoned.
--   user B: one session, exercise, progress row and PR of its own.
--   user C: sessions just inside / outside each period cutoff.
-- Every RPC call runs as `authenticated` with a JWT subject, so RLS and the
-- explicit auth.uid() filter are both in play (as postgres RLS is bypassed
-- and cross-user checks would pass vacuously).

BEGIN;

SET LOCAL timezone = 'Pacific/Auckland';

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
    ('b4040404-0000-4000-8000-00000000000b'::uuid, 'pr40-b@example.test'),
    ('c4040404-0000-4000-8000-00000000000c'::uuid, 'pr40-c@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.subscriptions (id, user_id, tier, status, current_period_end)
VALUES
    ('a4040404-5555-4000-8000-00000000000a', 'a4040404-0000-4000-8000-00000000000a',
     'EMBER', 'active', now() + INTERVAL '30 days'),
    ('b4040404-5555-4000-8000-00000000000b', 'b4040404-0000-4000-8000-00000000000b',
     'EMBER', 'active', now() + INTERVAL '30 days');

INSERT INTO public.local_profiles (user_id, id, name)
VALUES ('a4040404-0000-4000-8000-00000000000a', 'p2', 'Second profile');

-- A's sessions (stored total_volume is per cable, KD-8; sum = 2642).
--                               UTC day / ISO week      Sydney day / ISO week
--   s1  Mon Jan 05 10:00        Jan 05 / Jan 05         Jan 05 / Jan 05
--   s2  Tue Jan 06 10:00        Jan 06 / Jan 05         Jan 06 / Jan 05
--   s3  Wed Jan 07 10:00        Jan 07 / Jan 05         Jan 07 / Jan 05
--   s4  Wed Jan 07 23:30        Jan 07 / Jan 05         Jan 08 / Jan 05
--   s5  Thu Jan 08 10:00        Jan 08 / Jan 05         Jan 08 / Jan 05
--   s6  Fri Jan 09 10:00        Jan 09 / Jan 05         Jan 09 / Jan 05
--   s10 Sat Jan 10 13:30        Jan 10 / Jan 05         Jan 11 / Jan 05
--   s7  Mon Jan 12 10:00 (p2)   Jan 12 / Jan 12         Jan 12 / Jan 12
--   s9  Sun Jan 18 21:00        Jan 18 / Jan 12         Jan 19 / Jan 19
--   s8  yesterday               (isolated)
-- UTC best streak: Jan 05..10 = 6. Sydney: Jan 05..09 = 5 (Jan 10 empty).
-- Without DISTINCT the UTC Jan 07 double would split the run.
INSERT INTO public.workout_sessions
    (id, user_id, started_at, total_volume, duration_seconds, set_count, local_profile_id)
VALUES
    ('a4040404-0001-4000-8000-000000000001', 'a4040404-0000-4000-8000-00000000000a', '2026-01-05 10:00+00', 100, 600, 5, NULL),
    ('a4040404-0001-4000-8000-000000000002', 'a4040404-0000-4000-8000-00000000000a', '2026-01-06 10:00+00', 200, 600, 5, NULL),
    ('a4040404-0001-4000-8000-000000000003', 'a4040404-0000-4000-8000-00000000000a', '2026-01-07 10:00+00', 300, 600, 5, NULL),
    ('a4040404-0001-4000-8000-000000000004', 'a4040404-0000-4000-8000-00000000000a', '2026-01-07 23:30+00', 50, 300, 2, NULL),
    ('a4040404-0001-4000-8000-000000000005', 'a4040404-0000-4000-8000-00000000000a', '2026-01-08 10:00+00', 400, 600, 5, NULL),
    ('a4040404-0001-4000-8000-000000000006', 'a4040404-0000-4000-8000-00000000000a', '2026-01-09 10:00+00', 500, 600, 5, NULL),
    ('a4040404-0001-4000-8000-000000000010', 'a4040404-0000-4000-8000-00000000000a', '2026-01-10 13:30+00', 60, 300, 3, NULL),
    ('a4040404-0001-4000-8000-000000000007', 'a4040404-0000-4000-8000-00000000000a', '2026-01-12 10:00+00', 1000, 900, 9, 'p2'),
    ('a4040404-0001-4000-8000-000000000009', 'a4040404-0000-4000-8000-00000000000a', '2026-01-18 21:00+00', 25, 120, 1, NULL),
    ('a4040404-0001-4000-8000-000000000008', 'a4040404-0000-4000-8000-00000000000a', now() - INTERVAL '1 day', 7, 60, 1, NULL);

INSERT INTO public.workout_sessions (id, user_id, started_at, total_volume)
VALUES ('b4040404-0001-4000-8000-000000000001', 'b4040404-0000-4000-8000-00000000000b', '2026-01-05 10:00+00', 99999);

-- C: period-cutoff probes 12 hours inside / outside each cutoff (N days):
-- 1d, 6.5d | 7.5d, 27.5d | 28.5d, 83.5d | 84.5d, 364.5d | 365.5d ago.
-- A cutoff off by one day (e.g. 52w = 364) moves a probe across it.
INSERT INTO public.workout_sessions (id, user_id, started_at, total_volume)
SELECT
    ('c4040404-0001-4000-8000-' || lpad(h::text, 12, '0'))::uuid,
    'c4040404-0000-4000-8000-00000000000c',
    now() - make_interval(hours => h),
    h
FROM unnest(ARRAY[24, 156, 180, 660, 684, 2004, 2028, 8748, 8772]) AS h;

-- Exercises. Bench Press: s1 ('General', legacy), s2 twice under two raw
-- groups ('Chest' and 'General': one session), s7 ('General', newest, p2).
-- Latest non-General group = 'Chest'. Row: s1 only. Plank: only 'General'.
INSERT INTO public.exercises (id, session_id, name, muscle_group, user_id)
VALUES
    ('a4040404-0002-4000-8000-000000000001', 'a4040404-0001-4000-8000-000000000001', 'Bench Press', 'General', 'a4040404-0000-4000-8000-00000000000a'),
    ('a4040404-0002-4000-8000-000000000002', 'a4040404-0001-4000-8000-000000000001', 'Row', 'Back', 'a4040404-0000-4000-8000-00000000000a'),
    ('a4040404-0002-4000-8000-000000000003', 'a4040404-0001-4000-8000-000000000002', 'Bench Press', 'Chest', 'a4040404-0000-4000-8000-00000000000a'),
    ('a4040404-0002-4000-8000-000000000004', 'a4040404-0001-4000-8000-000000000002', 'Bench Press', 'General', 'a4040404-0000-4000-8000-00000000000a'),
    ('a4040404-0002-4000-8000-000000000005', 'a4040404-0001-4000-8000-000000000007', 'Bench Press', 'General', 'a4040404-0000-4000-8000-00000000000a'),
    ('a4040404-0002-4000-8000-000000000006', 'a4040404-0001-4000-8000-000000000003', 'Plank', 'General', 'a4040404-0000-4000-8000-00000000000a'),
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

-- 10 Squat rows, plus two tied newest rows (same recorded_at) whose order
-- must come from id DESC.
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
    (id, user_id, exercise_name, session_id, recorded_at, estimated_1rm_kg)
VALUES
    ('a4040404-0004-4000-8000-00000000000e', 'a4040404-0000-4000-8000-00000000000a', 'Squat',
     'a4040404-0001-4000-8000-000000000002', '2026-01-01 00:11+00', 111),
    ('a4040404-0004-4000-8000-00000000000f', 'a4040404-0000-4000-8000-00000000000a', 'Squat',
     'a4040404-0001-4000-8000-000000000002', '2026-01-01 00:11+00', 222);

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

-- 1,100 PRs for A. Rows 2k-1 and 2k share achieved_at, which carries a
-- microsecond component (k us) so a millisecond-truncated cursor differs.
-- Every 22nd row is tombstoned: 50 tombstones, 1,050 live. Row 1100 is a
-- tombstone, so row 1099 is alone at the newest live achieved_at. The
-- tie-break is exercised by the page walk (a page boundary splits a tied
-- pair), not by the first-row check.
INSERT INTO public.personal_records
    (id, user_id, exercise_name, value, achieved_at, deleted_at, local_profile_id)
SELECT
    ('a4040404-0003-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
    'a4040404-0000-4000-8000-00000000000a',
    'Bench Press',
    i,
    TIMESTAMPTZ '2026-02-01 00:00+00'
        + make_interval(mins => (i + 1) / 2)
        + ((i + 1) / 2) * INTERVAL '1 microsecond',
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

-- Walks personal_record_history, passing the last row's achieved_at (as
-- text, full precision) and id back unchanged.
CREATE FUNCTION pg_temp.walk_pr_history(p_page_size integer) RETURNS integer
LANGUAGE plpgsql
AS $walk$
DECLARE
    v_before text := NULL;
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
            v_before := r.achieved_at::text;
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
              'exercise_progress_series_many', 'personal_record_history',
              'profile_workout_stats', 'session_volume_buckets'
          )
    ),
    7,
    'exactly one overload of each of the seven analytics RPCs'
);

SELECT is(
    (
        SELECT count(*)::integer
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'exercise_frequency', 'exercise_names', 'exercise_progress_series',
              'exercise_progress_series_many', 'personal_record_history',
              'profile_workout_stats', 'session_volume_buckets'
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
    7,
    'all seven are SECURITY INVOKER, search_path pinned, authenticated-only (no anon, no PUBLIC)'
);

SELECT has_index(
    'public', 'personal_records', 'idx_personal_records_user_achieved_live',
    ARRAY['user_id', 'achieved_at', 'id'],
    'personal_records has the (user_id, achieved_at, id) keyset index'
);
SELECT has_index(
    'public', 'exercise_progress', 'idx_exercise_progress_user_exercise_recorded',
    ARRAY['user_id', 'exercise_name', 'recorded_at', 'id'],
    'exercise_progress has the (user_id, exercise_name, recorded_at, id) series index'
);

-- ---------------------------------------------------------------------------
SELECT diag('database:analytics-rpcs-owner');
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('a4040404-0000-4000-8000-00000000000a');

-- exercise_frequency: one row per name, distinct sessions, latest
-- non-General raw group.
SELECT results_eq(
    $$SELECT exercise_name, muscle_group, sessions FROM public.exercise_frequency()$$,
    $$VALUES ('Bench Press'::text, 'Chest'::text, 3),
             ('Plank'::text, 'General'::text, 1),
             ('Row'::text, 'Back'::text, 1)$$,
    'exercise_frequency: one row per name, distinct sessions (s2 double counted once), latest non-General group'
);

SELECT results_eq(
    $$SELECT exercise_name, muscle_group, sessions FROM public.exercise_frequency('p2')$$,
    $$VALUES ('Bench Press'::text, 'General'::text, 1)$$,
    'exercise_frequency filters by profile through the parent session (General fallback)'
);

-- exercise_names.
SELECT results_eq(
    $$SELECT exercise_name FROM public.exercise_names()$$,
    $$VALUES ('Bench Press'::text), ('Deadlift'::text), ('Squat'::text)$$,
    'exercise_names returns distinct names A-Z across 1,215 progress rows'
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
    (SELECT count(*)::integer FROM public.exercise_progress_series('Bench Press', NULL, NULL)),
    500,
    'exercise_progress_series treats p_limit NULL as 500'
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
    (SELECT count(*)::integer FROM public.exercise_progress_series('Bench Press', NULL, 0)),
    1,
    'exercise_progress_series clamps p_limit 0 to 1'
);

SELECT is(
    (SELECT count(*)::integer FROM public.exercise_progress_series('Bench Press', NULL, -5)),
    1,
    'exercise_progress_series clamps a negative p_limit to 1'
);

SELECT is(
    (SELECT array_agg(estimated_1rm_kg::integer) FROM public.exercise_progress_series('Squat', NULL, 3)),
    ARRAY[222, 111, 10],
    'exercise_progress_series breaks a recorded_at tie by id DESC'
);

SELECT is(
    (SELECT count(*)::integer FROM public.exercise_progress_series('Deadlift', 'p2')),
    3,
    'exercise_progress_series filters by profile'
);

-- exercise_progress_series_many: one row per exercise, jsonb rows.
SELECT results_eq(
    $$SELECT exercise_name, jsonb_array_length(rows)
      FROM public.exercise_progress_series_many(NULL, NULL, 5)$$,
    $$VALUES ('Deadlift'::text, 3), ('Bench Press'::text, 5), ('Squat'::text, 5)$$,
    'series_many(all): one row per exercise, newest exercise first, per-exercise limit'
);

SELECT is(
    (
        SELECT array_agg((e ->> 'estimated_1rm_kg')::numeric::integer ORDER BY o)
        FROM public.exercise_progress_series_many(ARRAY['Bench Press'], NULL, 3) m,
             jsonb_array_elements(m.rows) WITH ORDINALITY AS x(e, o)
    ),
    ARRAY[1200, 1199, 1198],
    'series_many rows are the newest rows, newest first'
);

SELECT is(
    (
        SELECT array_agg((e ->> 'estimated_1rm_kg')::numeric::integer ORDER BY o)
        FROM public.exercise_progress_series_many(ARRAY['Squat'], NULL, 2) m,
             jsonb_array_elements(m.rows) WITH ORDINALITY AS x(e, o)
    ),
    ARRAY[222, 111],
    'series_many breaks a recorded_at tie by id DESC'
);

SELECT is(
    (
        SELECT jsonb_array_length(rows)
        FROM public.exercise_progress_series_many(ARRAY['Bench Press'])
    ),
    100,
    'series_many default per-exercise limit is 100'
);

SELECT is(
    (
        SELECT jsonb_array_length(rows)
        FROM public.exercise_progress_series_many(ARRAY['Bench Press'], NULL, 5000)
    ),
    1000,
    'series_many clamps the per-exercise limit to 1000'
);

SELECT is(
    (
        SELECT jsonb_array_length(rows)
        FROM public.exercise_progress_series_many(ARRAY['Bench Press'], NULL, 0)
    ),
    1,
    'series_many clamps a per-exercise limit of 0 to 1'
);

SELECT is(
    (
        SELECT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(rows -> 0) AS k)
        FROM public.exercise_progress_series_many(ARRAY['Squat'], NULL, 1)
    ),
    (
        SELECT array_agg(column_name::text ORDER BY column_name::text)
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'exercise_progress'
    ),
    'series_many row objects carry exactly the exercise_progress columns (no rn)'
);

SELECT results_eq(
    $$SELECT exercise_name FROM public.exercise_progress_series_many(NULL, 'p2', 10)$$,
    $$VALUES ('Deadlift'::text)$$,
    'series_many filters by profile'
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

-- Cursor on row 1098 (tied with 1097): 1097 comes next, not skipped.
SELECT is(
    (
        SELECT id FROM public.personal_record_history(
            NULL, 1,
            (SELECT achieved_at::text FROM public.personal_records
             WHERE id = 'a4040404-0003-4000-8000-000000001098'),
            'a4040404-0003-4000-8000-000000001098'
        )
    ),
    'a4040404-0003-4000-8000-000000001097'::uuid,
    'a cursor on one row of a tied pair returns its partner next'
);

-- A cursor row tombstoned since the previous page is still a valid cursor.
SELECT is(
    (
        SELECT id FROM public.personal_record_history(
            NULL, 1,
            (SELECT achieved_at::text FROM public.personal_records
             WHERE id = 'a4040404-0003-4000-8000-000000001100'),
            'a4040404-0003-4000-8000-000000001100'
        )
    ),
    'a4040404-0003-4000-8000-000000001099'::uuid,
    'a tombstoned cursor row still pages correctly'
);

SELECT throws_ok(
    $$SELECT * FROM public.personal_record_history(NULL, 10, '2026-02-01 09:00:00+00')$$,
    '22023',
    NULL,
    'p_before without p_before_id is rejected'
);
SELECT throws_ok(
    $$SELECT * FROM public.personal_record_history(NULL, 10, NULL, 'a4040404-0003-4000-8000-000000001098')$$,
    '22023',
    NULL,
    'p_before_id without p_before is rejected'
);
SELECT throws_ok(
    $$SELECT * FROM public.personal_record_history(
        NULL, 10,
        (SELECT to_char(date_trunc('milliseconds', achieved_at) AT TIME ZONE 'UTC',
                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         FROM public.personal_records WHERE id = 'a4040404-0003-4000-8000-000000001098'),
        'a4040404-0003-4000-8000-000000001098')$$,
    '22023',
    NULL,
    'a millisecond-truncated (JS Date) cursor is rejected instead of skipping rows'
);
SELECT throws_ok(
    $$SELECT * FROM public.personal_record_history(NULL, 10, 'not a time', 'a4040404-0003-4000-8000-000000001098')$$,
    '22023',
    NULL,
    'an unparseable p_before is rejected'
);
SELECT lives_ok(
    $$SELECT * FROM public.personal_record_history(
        NULL, 10,
        (SELECT to_char(achieved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')
         FROM public.personal_records WHERE id = 'a4040404-0003-4000-8000-000000001098'),
        'a4040404-0003-4000-8000-000000001098')$$,
    'the PostgREST-rendered achieved_at (ISO, microseconds) is accepted unchanged'
);

SELECT is(
    (SELECT count(*)::integer FROM public.personal_record_history(NULL, 5000)),
    1000,
    'personal_record_history clamps p_limit to 1000'
);
SELECT is(
    (SELECT count(*)::integer FROM public.personal_record_history(NULL, NULL)),
    200,
    'personal_record_history treats p_limit NULL as 200'
);
SELECT is(
    (SELECT count(*)::integer FROM public.personal_record_history(NULL, 0)),
    1,
    'personal_record_history clamps p_limit 0 to 1'
);
SELECT is(
    (SELECT count(*)::integer FROM public.personal_record_history(NULL, -5)),
    1,
    'personal_record_history clamps a negative p_limit to 1'
);

SELECT is(
    (SELECT count(*)::integer FROM public.personal_record_history('p2', 100)),
    4,
    'personal_record_history filters by profile'
);

-- profile_workout_stats: stored per-cable volume, never doubled (KD-8).
SELECT results_eq(
    $$SELECT total_workouts, total_volume, best_streak, pr_count FROM public.profile_workout_stats()$$,
    $$VALUES (10, 2642::numeric, 6, 1050)$$,
    'profile_workout_stats (UTC): 10 sessions, raw volume 2642 (no x2), best UTC streak 6, 1,050 live PRs'
);

SELECT results_eq(
    $$SELECT best_streak FROM public.profile_workout_stats(NULL, 'Australia/Sydney')$$,
    $$VALUES (5)$$,
    'profile_workout_stats best streak in Australia/Sydney days is 5 (Jan 10 UTC is Jan 11 there)'
);

SELECT results_eq(
    $$SELECT total_workouts, total_volume, best_streak, pr_count FROM public.profile_workout_stats('p2')$$,
    $$VALUES (1, 1000::numeric, 6, 4)$$,
    'profile_workout_stats filters counts by profile; best_streak stays account-wide'
);

SELECT throws_ok(
    $$SELECT * FROM public.profile_workout_stats(NULL, 'Mars/Olympus')$$,
    '22023',
    NULL,
    'profile_workout_stats rejects an unknown time zone'
);
SELECT throws_ok(
    $$SELECT * FROM public.profile_workout_stats(NULL, 'UTC+5')$$,
    '22023',
    NULL,
    'profile_workout_stats rejects a POSIX offset string (IANA names only)'
);

-- session_volume_buckets.
SELECT results_eq(
    $$SELECT week_start, sessions, total_volume
      FROM public.session_volume_buckets('all')
      WHERE week_start < DATE '2026-06-01'$$,
    $$VALUES (DATE '2026-01-05', 7, 1610::numeric), (DATE '2026-01-12', 2, 1025::numeric)$$,
    'session_volume_buckets(all, UTC): Sunday 21:00 UTC stays in the UTC week of Jan 12'
);

SELECT results_eq(
    $$SELECT week_start, sessions, total_volume
      FROM public.session_volume_buckets('all', NULL, 'Australia/Sydney')
      WHERE week_start < DATE '2026-06-01'$$,
    $$VALUES (DATE '2026-01-05', 7, 1610::numeric),
             (DATE '2026-01-12', 1, 1000::numeric),
             (DATE '2026-01-19', 1, 25::numeric)$$,
    'session_volume_buckets(all, Sydney): the same session is Monday Jan 19 local and moves week'
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

SELECT results_eq(
    $$SELECT sessions FROM public.session_volume_buckets('all', 'p2')$$,
    $$VALUES (1)$$,
    'session_volume_buckets filters by profile'
);

SELECT throws_ok(
    $$SELECT * FROM public.session_volume_buckets('3d')$$,
    '22023',
    NULL,
    'session_volume_buckets rejects an unknown period'
);
SELECT throws_ok(
    $$SELECT * FROM public.session_volume_buckets('all', NULL, 'Not/AZone')$$,
    '22023',
    NULL,
    'session_volume_buckets rejects an unknown time zone'
);

RESET ROLE;

-- Period mapping (user C: probes 12 hours either side of each cutoff).
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('c4040404-0000-4000-8000-00000000000c');

SELECT results_eq(
    $$SELECT p, (SELECT COALESCE(sum(b.sessions), 0)::integer
                 FROM public.session_volume_buckets(p) b)
      FROM unnest(ARRAY['1w', '4w', '12w', '52w', 'all']) AS p$$,
    $$VALUES ('1w'::text, 2), ('4w'::text, 4), ('12w'::text, 6), ('52w'::text, 8), ('all'::text, 9)$$,
    'period mapping matches periodToDays: 1w=7, 4w=28, 12w=84, 52w=365 days, all=unbounded'
);

SELECT results_eq(
    $$SELECT p, (SELECT COALESCE(sum(b.sessions), 0)::integer
                 FROM public.session_volume_buckets(p, NULL, 'America/Los_Angeles') b)
      FROM unnest(ARRAY['1w', '4w', '12w', '52w', 'all']) AS p$$,
    $$VALUES ('1w'::text, 2), ('4w'::text, 4), ('12w'::text, 6), ('52w'::text, 8), ('all'::text, 9)$$,
    'period mapping is the same in a non-UTC zone'
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
    $$SELECT exercise_name, jsonb_array_length(rows) FROM public.exercise_progress_series_many()$$,
    $$VALUES ('Bench Press'::text, 1)$$,
    'B''s batched series covers only B''s rows'
);
SELECT results_eq(
    $$SELECT id FROM public.personal_record_history()$$,
    $$VALUES ('b4040404-0003-4000-8000-000000000001'::uuid)$$,
    'B sees only its own PR, none of A''s 1,100'
);
SELECT throws_ok(
    $$SELECT * FROM public.personal_record_history(
        NULL, 10,
        '2026-02-01 09:10:00.000020+00',
        'a4040404-0003-4000-8000-000000000020')$$,
    '22023',
    NULL,
    'B cannot page with a cursor naming A''s record'
);
SELECT results_eq(
    $$SELECT total_workouts, total_volume, best_streak, pr_count FROM public.profile_workout_stats()$$,
    $$VALUES (1, 99999::numeric, 1, 1)$$,
    'B''s stats cover only B''s rows'
);
SELECT results_eq(
    $$SELECT total_workouts, total_volume, pr_count FROM public.profile_workout_stats('p2')$$,
    $$VALUES (0, 0::numeric, 0)$$,
    'B gets zero counts for A''s profile id'
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
        + (SELECT count(*) FROM public.exercise_progress_series_many())
        + (SELECT count(*) FROM public.personal_record_history())
        + (SELECT count(*) FROM public.session_volume_buckets('all'))
    )::integer,
    0,
    'a caller without auth.uid() gets no rows'
);
SELECT results_eq(
    $$SELECT total_workouts, total_volume, best_streak, pr_count FROM public.profile_workout_stats()$$,
    $$VALUES (0, 0::numeric, 0, 0)$$,
    'a caller without auth.uid() gets all-zero stats'
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
SELECT throws_ok(
    $$SELECT * FROM public.exercise_progress_series_many()$$,
    '42501',
    NULL,
    'anon cannot execute exercise_progress_series_many'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
