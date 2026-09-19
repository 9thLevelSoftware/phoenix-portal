-- Leaderboard snapshots (20260920005600_leaderboard_snapshots.sql).
--
-- A tombstoned personal record is excluded from every PR rank: the snapshot
-- written by refresh_leaderboard_snapshots() and the get_pr_count_rankings /
-- get_user_pr_rank RPCs. Also covers weekly per-cable volume, mastery,
-- non-participants, grants and the snapshot's RLS.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:leaderboard-catalog');

SELECT has_table('public', 'leaderboard_snapshots', 'leaderboard_snapshots exists');
SELECT ok(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.leaderboard_snapshots'::regclass),
    'leaderboard_snapshots has RLS enabled'
);
SELECT ok(
    (SELECT prosecdef FROM pg_proc WHERE oid = 'public.refresh_leaderboard_snapshots()'::regprocedure),
    'refresh_leaderboard_snapshots is SECURITY DEFINER'
);
SELECT is(has_function_privilege('anon', 'public.refresh_leaderboard_snapshots()', 'EXECUTE'), false,
    'anon cannot run refresh_leaderboard_snapshots');
SELECT is(has_function_privilege('authenticated', 'public.refresh_leaderboard_snapshots()', 'EXECUTE'), false,
    'authenticated cannot run refresh_leaderboard_snapshots');
SELECT is(has_function_privilege('service_role', 'public.refresh_leaderboard_snapshots()', 'EXECUTE'), true,
    'service_role can run refresh_leaderboard_snapshots');
SELECT is(has_function_privilege('authenticated', 'public.remove_leaderboard_snapshots_on_opt_out()', 'EXECUTE'), false,
    'authenticated cannot call the opt-out trigger function');
SELECT is(has_table_privilege('anon', 'public.leaderboard_snapshots', 'SELECT'), false,
    'anon cannot read leaderboard_snapshots');
SELECT is(has_table_privilege('authenticated', 'public.leaderboard_snapshots', 'INSERT'), false,
    'authenticated cannot write leaderboard_snapshots');

CREATE OR REPLACE FUNCTION pg_temp.cron_job_present() RETURNS boolean
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_count integer;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN true;
    END IF;
    EXECUTE $q$
        SELECT count(*) FROM cron.job
        WHERE jobname = 'refresh-leaderboard-snapshots'
          AND schedule = '*/15 * * * *'
          AND command = 'SELECT public.refresh_leaderboard_snapshots()'
    $q$ INTO v_count;
    RETURN v_count = 1;
END
$fn$;

SELECT ok(pg_temp.cron_job_present(), 'refresh-leaderboard-snapshots is scheduled every 15 minutes (when pg_cron is installed)');

SELECT diag('database:leaderboard-behaviour');

-- Fixtures. A: 1 active PR + 2 tombstoned. B: 2 active PRs. C: not taking part.
INSERT INTO auth.users (id, email)
VALUES
    ('a1111111-1111-4111-8111-111111111111'::uuid, 'lb-a@example.test'),
    ('b2222222-2222-4222-8222-222222222222'::uuid, 'lb-b@example.test'),
    ('c3333333-3333-4333-8333-333333333333'::uuid, 'lb-c@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.profiles (id)
VALUES
    ('a1111111-1111-4111-8111-111111111111'::uuid),
    ('b2222222-2222-4222-8222-222222222222'::uuid),
    ('c3333333-3333-4333-8333-333333333333'::uuid)
ON CONFLICT (id) DO NOTHING;

-- Only the fixture users take part, so ranks are deterministic.
UPDATE public.profiles SET leaderboard_participation = false;
UPDATE public.profiles SET leaderboard_participation = true
WHERE id IN ('a1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222');

INSERT INTO public.personal_records (user_id, exercise_name, value, achieved_at, deleted_at)
VALUES
    ('a1111111-1111-4111-8111-111111111111', 'Squat', 100, now(), NULL),
    ('a1111111-1111-4111-8111-111111111111', 'Bench', 80, now(), now()),
    ('a1111111-1111-4111-8111-111111111111', 'Row', 60, now(), now()),
    ('b2222222-2222-4222-8222-222222222222', 'Squat', 90, now(), NULL),
    ('b2222222-2222-4222-8222-222222222222', 'Bench', 70, now(), NULL),
    ('c3333333-3333-4333-8333-333333333333', 'Squat', 50, now(), NULL),
    ('c3333333-3333-4333-8333-333333333333', 'Bench', 50, now(), NULL),
    ('c3333333-3333-4333-8333-333333333333', 'Row', 50, now(), NULL);

-- Weekly volume: A 100 this week; B 50 this week plus 1000 a month ago.
-- Stored per-cable values are summed as-is (never doubled).
INSERT INTO public.workout_sessions (id, user_id, started_at, total_volume)
VALUES
    ('a0000000-0000-4000-8000-000000000001', 'a1111111-1111-4111-8111-111111111111', now(), 100),
    ('b0000000-0000-4000-8000-000000000001', 'b2222222-2222-4222-8222-222222222222', now(), 50),
    ('b0000000-0000-4000-8000-000000000002', 'b2222222-2222-4222-8222-222222222222', now() - INTERVAL '30 days', 1000);

-- Mastery: B does "Deadlift" in 10 distinct sessions (older than this week).
INSERT INTO public.workout_sessions (id, user_id, started_at, total_volume)
SELECT ('b1000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       'b2222222-2222-4222-8222-222222222222'::uuid,
       now() - INTERVAL '60 days' + g * INTERVAL '1 hour',
       0
FROM generate_series(1, 10) AS g;

INSERT INTO public.exercises (session_id, user_id, name)
SELECT ('b1000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       'b2222222-2222-4222-8222-222222222222'::uuid,
       'Deadlift'
FROM generate_series(1, 10) AS g;

SELECT lives_ok(
    'SELECT public.refresh_leaderboard_snapshots()',
    'refresh_leaderboard_snapshots runs'
);
-- A second run replaces rather than duplicates (primary key would reject).
SELECT lives_ok(
    'SELECT public.refresh_leaderboard_snapshots()',
    'refresh_leaderboard_snapshots is re-runnable'
);

CREATE OR REPLACE FUNCTION pg_temp.snap(p_metric text, p_period text, p_user uuid)
RETURNS TABLE (value numeric, rank bigint)
LANGUAGE sql
AS $fn$
    SELECT s.value, s.rank
    FROM public.leaderboard_snapshots s
    WHERE s.metric = p_metric AND s.period = p_period AND s.user_id = p_user
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.this_week() RETURNS text
LANGUAGE sql
AS $fn$ SELECT (date_trunc('week', now() AT TIME ZONE 'UTC'))::date::text $fn$;

SELECT results_eq(
    $$ SELECT value, rank FROM pg_temp.snap('pr_count', 'all_time', 'b2222222-2222-4222-8222-222222222222') $$,
    $$ VALUES (2::numeric, 1::bigint) $$,
    'snapshot: B (2 active PRs) ranks first for pr_count'
);
SELECT results_eq(
    $$ SELECT value, rank FROM pg_temp.snap('pr_count', 'all_time', 'a1111111-1111-4111-8111-111111111111') $$,
    $$ VALUES (1::numeric, 2::bigint) $$,
    'snapshot: A''s two tombstoned PRs are excluded from pr_count and rank'
);
SELECT results_eq(
    $$ SELECT value, rank FROM pg_temp.snap('pr_count', pg_temp.this_week(), 'a1111111-1111-4111-8111-111111111111') $$,
    $$ VALUES (1::numeric, 2::bigint) $$,
    'snapshot: tombstoned PRs are excluded from the weekly pr_count'
);
SELECT is(
    (SELECT count(*) FROM public.leaderboard_snapshots
     WHERE user_id = 'c3333333-3333-4333-8333-333333333333'),
    0::bigint,
    'snapshot: a non-participant has no rows'
);
SELECT is(
    (SELECT count(*) FROM public.leaderboard_snapshots
     WHERE metric = 'total_workouts' AND period = 'all_time'),
    2::bigint,
    'snapshot: one row per participant per metric (zeros included)'
);
SELECT results_eq(
    $$ SELECT value, rank FROM pg_temp.snap('total_volume_kg', pg_temp.this_week(), 'a1111111-1111-4111-8111-111111111111') $$,
    $$ VALUES (100::numeric, 1::bigint) $$,
    'snapshot: weekly volume sums this week''s stored per-cable volume'
);
SELECT results_eq(
    $$ SELECT value, rank FROM pg_temp.snap('total_volume_kg', pg_temp.this_week(), 'b2222222-2222-4222-8222-222222222222') $$,
    $$ VALUES (50::numeric, 2::bigint) $$,
    'snapshot: sessions outside the week are not counted'
);
SELECT results_eq(
    $$ SELECT value, rank FROM pg_temp.snap('exercise_mastery', 'all_time', 'b2222222-2222-4222-8222-222222222222') $$,
    $$ VALUES (1::numeric, 1::bigint) $$,
    'snapshot: an exercise done in 10 sessions is mastered'
);
SELECT results_eq(
    $$ SELECT value, rank FROM pg_temp.snap('exercise_mastery', 'all_time', 'a1111111-1111-4111-8111-111111111111') $$,
    $$ VALUES (0::numeric, 2::bigint) $$,
    'snapshot: zero-valued participants tie below everyone with a value'
);

SELECT results_eq(
    $$ SELECT user_id, pr_count, rank FROM public.get_pr_count_rankings(100) $$,
    $$ VALUES ('b2222222-2222-4222-8222-222222222222'::uuid, 2::bigint, 1::bigint),
              ('a1111111-1111-4111-8111-111111111111'::uuid, 1::bigint, 2::bigint) $$,
    'get_pr_count_rankings excludes tombstoned PRs'
);
SELECT results_eq(
    $$ SELECT pr_count, rank FROM public.get_user_pr_rank('a1111111-1111-4111-8111-111111111111') $$,
    $$ VALUES (1::bigint, 2::bigint) $$,
    'get_user_pr_rank excludes tombstoned PRs'
);

-- Opting out hides the user's rows from readers at once.
INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES ('a1111111-1111-4111-8111-111111111111'::uuid, 'FLAME', 'active', now() + INTERVAL '30 days')
ON CONFLICT (user_id) DO UPDATE
SET tier = EXCLUDED.tier, status = EXCLUDED.status, current_period_end = EXCLUDED.current_period_end;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
SELECT is(
    (SELECT count(DISTINCT user_id) FROM public.leaderboard_snapshots),
    2::bigint,
    'RLS: a FLAME user reads every participant''s rows'
);

SELECT set_config('request.jwt.claims',
    '{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
SELECT is(
    (SELECT count(*) FROM public.leaderboard_snapshots),
    0::bigint,
    'RLS: a user below FLAME reads nothing'
);
-- B opts out through their own (RLS-bound) profile update.
UPDATE public.profiles SET leaderboard_participation = false
WHERE id = 'b2222222-2222-4222-8222-222222222222';
RESET ROLE;

SELECT is(
    (SELECT count(*) FROM public.leaderboard_snapshots
     WHERE user_id = 'b2222222-2222-4222-8222-222222222222'),
    0::bigint,
    'opt-out deletes the user''s snapshot rows before the next refresh'
);
SELECT is(
    (SELECT count(*) FROM public.leaderboard_snapshots
     WHERE user_id = 'a1111111-1111-4111-8111-111111111111'),
    9::bigint,
    'opt-out leaves other participants'' rows (6 all-time + 3 weekly)'
);

SELECT * FROM finish();
ROLLBACK;
