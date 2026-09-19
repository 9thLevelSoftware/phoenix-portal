-- Leaderboard snapshots (20260920005600_leaderboard_snapshots.sql).
--
-- A tombstoned personal record is excluded from every PR rank: the snapshot
-- written by refresh_leaderboard_snapshots() and the get_pr_count_rankings /
-- get_user_pr_rank RPCs. Also covers weekly per-cable volume, mastery,
-- non-participants, previous-week rebuild, 12-period retention, grants
-- (service_role only), the opt-out trigger and the pg_cron job.

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
SELECT is_empty(
    $$ SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'leaderboard_snapshots' $$,
    'leaderboard_snapshots has no policies (service_role only)'
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
SELECT is(has_function_privilege('service_role', 'private.ensure_leaderboard_refresh_job()', 'EXECUTE'), false,
    'service_role cannot call the cron scheduling helper');
SELECT is(has_table_privilege('anon', 'public.leaderboard_snapshots', 'SELECT'), false,
    'anon cannot read leaderboard_snapshots');
SELECT is(has_table_privilege('authenticated', 'public.leaderboard_snapshots', 'SELECT'), false,
    'authenticated cannot read leaderboard_snapshots');
SELECT is(has_table_privilege('authenticated', 'public.leaderboard_snapshots', 'INSERT'), false,
    'authenticated cannot write leaderboard_snapshots');
SELECT is(has_table_privilege('service_role', 'public.leaderboard_snapshots', 'SELECT'), true,
    'service_role can read leaderboard_snapshots');
SELECT ok(
    pg_get_functiondef('public.remove_leaderboard_snapshots_on_opt_out()'::regprocedure)
      ~ 'pg_advisory_xact_lock\(hashtext\(''public\.refresh_leaderboard_snapshots''\)\)[\s\S]*DELETE FROM public\.leaderboard_snapshots',
    'opt-out trigger takes the refresh advisory lock before deleting (serializes with a running refresh)'
);

-- pg_cron job. The stock local/CI stack ships pg_cron but does not install
-- it, so install it here (rolled back with this transaction) and run the
-- migration's scheduling helper; the assertion is never vacuous where
-- pg_cron is available. Where the extension is installed before migrations
-- (as in prod), the migration itself must already have created the job.
CREATE OR REPLACE FUNCTION pg_temp.cron_mode() RETURNS text
LANGUAGE plpgsql
AS $fn$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN 'installed';
    ELSIF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
        CREATE EXTENSION pg_cron;
        PERFORM private.ensure_leaderboard_refresh_job();
        RETURN 'installed-by-test';
    END IF;
    RETURN 'unavailable';
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.leaderboard_job_count() RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_count integer;
BEGIN
    EXECUTE $q$
        SELECT count(*) FROM cron.job
        WHERE jobname = 'refresh-leaderboard-snapshots'
          AND schedule = '*/15 * * * *'
          AND command = 'SELECT public.refresh_leaderboard_snapshots()'
    $q$ INTO v_count;
    RETURN v_count;
END
$fn$;

CREATE TEMP TABLE cron_state ON COMMIT DROP AS SELECT pg_temp.cron_mode() AS mode;
SELECT diag('pg_cron: ' || mode) FROM cron_state;

SELECT CASE WHEN (SELECT mode FROM cron_state) = 'unavailable'
    THEN skip('pg_cron is not available in this Postgres build', 2)
    ELSE collect_tap(
        is(pg_temp.leaderboard_job_count(), 1,
           'refresh-leaderboard-snapshots is scheduled every 15 minutes'),
        is((SELECT private.ensure_leaderboard_refresh_job()::text || '/' || pg_temp.leaderboard_job_count()::text),
           'true/1',
           'scheduling is idempotent (re-run keeps one job)')
    )
END;

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

CREATE OR REPLACE FUNCTION pg_temp.this_week() RETURNS date
LANGUAGE sql
AS $fn$ SELECT (date_trunc('week', now() AT TIME ZONE 'UTC'))::date $fn$;

-- Middle of the current / previous UTC ISO week.
CREATE OR REPLACE FUNCTION pg_temp.in_week(p_offset_weeks int) RETURNS timestamptz
LANGUAGE sql
AS $fn$
    SELECT ((pg_temp.this_week() + 7 * p_offset_weeks)::timestamp AT TIME ZONE 'UTC')
           + INTERVAL '3 days 12 hours'
$fn$;

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

-- Mastery: B does "Deadlift" in 10 distinct sessions (older than two weeks).
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

-- History rows the refresh must keep untouched (12 periods: current + 11
-- previous) or prune (older).
INSERT INTO public.leaderboard_snapshots (metric, period, user_id, value, rank)
VALUES
    ('total_volume_kg', (pg_temp.this_week() - 14)::text, 'a1111111-1111-4111-8111-111111111111', 999, 1),
    ('total_volume_kg', (pg_temp.this_week() - 77)::text, 'a1111111-1111-4111-8111-111111111111', 777, 1),
    ('total_volume_kg', (pg_temp.this_week() - 84)::text, 'a1111111-1111-4111-8111-111111111111', 888, 1);

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
    $$ SELECT value, rank FROM pg_temp.snap('pr_count', pg_temp.this_week()::text, 'a1111111-1111-4111-8111-111111111111') $$,
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
    $$ SELECT value, rank FROM pg_temp.snap('total_volume_kg', pg_temp.this_week()::text, 'a1111111-1111-4111-8111-111111111111') $$,
    $$ VALUES (100::numeric, 1::bigint) $$,
    'snapshot: weekly volume sums this week''s stored per-cable volume'
);
SELECT results_eq(
    $$ SELECT value, rank FROM pg_temp.snap('total_volume_kg', pg_temp.this_week()::text, 'b2222222-2222-4222-8222-222222222222') $$,
    $$ VALUES (50::numeric, 2::bigint) $$,
    'snapshot: sessions outside the week are not counted'
);
SELECT is(
    (SELECT count(*) FROM public.leaderboard_snapshots
     WHERE period = (pg_temp.this_week() - 7)::text AND metric = 'total_volume_kg'),
    2::bigint,
    'snapshot: the previous week is rebuilt too (a row per participant)'
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

-- Retention: exactly 12 weekly periods are kept; older weeks are preserved
-- as written (not rebuilt), and anything older is pruned.
SELECT results_eq(
    $$ SELECT value FROM pg_temp.snap('total_volume_kg', (pg_temp.this_week() - 14)::text, 'a1111111-1111-4111-8111-111111111111') $$,
    $$ VALUES (999::numeric) $$,
    'retention: a week two back is preserved untouched'
);
SELECT results_eq(
    $$ SELECT value FROM pg_temp.snap('total_volume_kg', (pg_temp.this_week() - 77)::text, 'a1111111-1111-4111-8111-111111111111') $$,
    $$ VALUES (777::numeric) $$,
    'retention: the 12th period (current + 11 previous) is kept'
);
SELECT is_empty(
    $$ SELECT 1 FROM public.leaderboard_snapshots WHERE period = (pg_temp.this_week() - 84)::text $$,
    'retention: a 13th-oldest week is pruned'
);
SELECT ok(
    (SELECT count(DISTINCT period) FROM public.leaderboard_snapshots WHERE period <> 'all_time') <= 12,
    'retention: at most 12 weekly periods remain'
);

-- Late sync and later tombstone for the week just closed: the previous week
-- is recomputed by the next refresh.
INSERT INTO public.workout_sessions (id, user_id, started_at, total_volume)
VALUES ('a0000000-0000-4000-8000-000000000002', 'a1111111-1111-4111-8111-111111111111', pg_temp.in_week(-1), 40);
INSERT INTO public.personal_records (id, user_id, exercise_name, value, achieved_at)
VALUES ('ad000000-0000-4000-8000-000000000001', 'a1111111-1111-4111-8111-111111111111', 'Press', 40, pg_temp.in_week(-1));
SELECT public.refresh_leaderboard_snapshots();
SELECT results_eq(
    $$ SELECT value FROM pg_temp.snap('total_volume_kg', (pg_temp.this_week() - 7)::text, 'a1111111-1111-4111-8111-111111111111') $$,
    $$ VALUES (40::numeric) $$,
    'previous week: a late-synced session lands in the week just closed'
);
SELECT results_eq(
    $$ SELECT value FROM pg_temp.snap('pr_count', (pg_temp.this_week() - 7)::text, 'a1111111-1111-4111-8111-111111111111') $$,
    $$ VALUES (1::numeric) $$,
    'previous week: a late-synced PR counts'
);
UPDATE public.personal_records SET deleted_at = now()
WHERE id = 'ad000000-0000-4000-8000-000000000001';
SELECT public.refresh_leaderboard_snapshots();
SELECT results_eq(
    $$ SELECT value FROM pg_temp.snap('pr_count', (pg_temp.this_week() - 7)::text, 'a1111111-1111-4111-8111-111111111111') $$,
    $$ VALUES (0::numeric) $$,
    'previous week: a PR tombstoned after the week closed stops counting'
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

-- Browser roles cannot read the snapshot directly.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
SELECT throws_ok(
    'SELECT count(*) FROM public.leaderboard_snapshots',
    '42501',
    NULL,
    'authenticated cannot SELECT leaderboard_snapshots'
);

-- B opts out through their own (RLS-bound) profile update; the trigger
-- removes B's rows at once.
SELECT set_config('request.jwt.claims',
    '{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
UPDATE public.profiles SET leaderboard_participation = false
WHERE id = 'b2222222-2222-4222-8222-222222222222';
RESET ROLE;

SELECT is(
    (SELECT count(*) FROM public.leaderboard_snapshots
     WHERE user_id = 'b2222222-2222-4222-8222-222222222222'),
    0::bigint,
    'opt-out deletes the user''s snapshot rows before the next refresh'
);
SELECT ok(
    (SELECT count(*) FROM public.leaderboard_snapshots
     WHERE user_id = 'a1111111-1111-4111-8111-111111111111') > 0,
    'opt-out leaves other participants'' rows'
);

-- The refresh's final participation re-check removes rows of a user whose
-- opt-out bypassed the trigger (e.g. participation cleared in bulk with
-- triggers disabled): simulate with a stale row in a retained week the
-- refresh does not rebuild.
INSERT INTO public.leaderboard_snapshots (metric, period, user_id, value, rank)
VALUES ('total_workouts', (pg_temp.this_week() - 14)::text, 'c3333333-3333-4333-8333-333333333333', 1, 1);
SELECT public.refresh_leaderboard_snapshots();
SELECT is(
    (SELECT count(*) FROM public.leaderboard_snapshots
     WHERE user_id IN ('b2222222-2222-4222-8222-222222222222', 'c3333333-3333-4333-8333-333333333333')),
    0::bigint,
    'refresh leaves no rows for non-participants in any period'
);

SELECT * FROM finish();
ROLLBACK;
