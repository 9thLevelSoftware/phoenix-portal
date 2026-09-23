-- NF-37 (20260924120000): rank-time outlier handling. Implausible session
-- rows are left in place but cannot inflate a ranking.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

INSERT INTO auth.users (id, email)
VALUES ('26262626-0000-4000-8000-000000000001'::uuid, 'leaderboard-outlier@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id)
VALUES ('26262626-0000-4000-8000-000000000001'::uuid)
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET leaderboard_participation = true
 WHERE id = '26262626-0000-4000-8000-000000000001';

INSERT INTO public.workout_sessions (user_id, name, started_at, total_volume) VALUES
    ('26262626-0000-4000-8000-000000000001', 'honest', now() - interval '1 hour', 500),
    ('26262626-0000-4000-8000-000000000001', 'fabricated volume', now() - interval '2 hours', 1e12);
-- 40 sessions on consecutive future dates.
INSERT INTO public.workout_sessions (user_id, name, started_at, total_volume)
SELECT '26262626-0000-4000-8000-000000000001', 'future', now() + (g || ' days')::interval, 10
  FROM generate_series(2, 41) AS g;
INSERT INTO public.personal_records (user_id, exercise_name, value, achieved_at)
VALUES ('26262626-0000-4000-8000-000000000001', 'Bench Press', 100, now() + interval '30 days');

SELECT lives_ok($$ SELECT public.refresh_leaderboard_snapshots() $$, 'refresh runs');

SELECT is(
    (SELECT value FROM public.leaderboard_snapshots
      WHERE user_id = '26262626-0000-4000-8000-000000000001'
        AND metric = 'total_volume_kg' AND period = 'all_time'),
    100500::numeric,
    'a fabricated session contributes at most the per-session volume cap; future sessions none'
);
SELECT is(
    (SELECT value FROM public.leaderboard_snapshots
      WHERE user_id = '26262626-0000-4000-8000-000000000001'
        AND metric = 'longest_streak' AND period = 'all_time'),
    1::numeric,
    'consecutive future-dated sessions build no streak'
);
SELECT is(
    (SELECT value FROM public.leaderboard_snapshots
      WHERE user_id = '26262626-0000-4000-8000-000000000001'
        AND metric = 'pr_count' AND period = 'all_time'),
    0::numeric,
    'a future-dated personal record does not count'
);
SELECT ok(
    (SELECT value FROM public.leaderboard_snapshots
      WHERE user_id = '26262626-0000-4000-8000-000000000001'
        AND metric = 'total_workouts' AND period = 'all_time') <= 2,
    'future-dated sessions do not add workouts'
);
SELECT is(
    (SELECT count(*)::int FROM public.workout_sessions
      WHERE user_id = '26262626-0000-4000-8000-000000000001'),
    42,
    'the user''s own rows are left intact'
);

SELECT * FROM finish();
ROLLBACK;
