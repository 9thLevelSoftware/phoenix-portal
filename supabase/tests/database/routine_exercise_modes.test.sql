BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:routine-exercise-mode-wire-names');

SELECT is(public.normalize_workout_mode('Eccentric Only'), 'ECCENTRIC_ONLY', 'display name normalizes');
SELECT is(public.normalize_workout_mode(' tut beast '), 'TUT_BEAST', 'case/space-insensitive');
SELECT is(public.normalize_workout_mode('CLASSIC'), 'OLD_SCHOOL', 'CLASSIC alias normalizes');
SELECT is(public.normalize_workout_mode('Power'), 'OLD_SCHOOL', 'retired POWER normalizes');
SELECT is(public.normalize_workout_mode('ECHO'), 'ECHO', 'wire name unchanged');
SELECT is(public.normalize_workout_mode('NEW_FANCY_MODE'), 'NEW_FANCY_MODE', 'unknown passes through');

INSERT INTO auth.users (id, email)
VALUES ('a1a1a1a1-0000-4000-8000-000000000011'::uuid, 'modes@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.routines (id, user_id, name)
VALUES (
    'a1a1a1a1-0000-4000-8000-000000000012'::uuid,
    'a1a1a1a1-0000-4000-8000-000000000011'::uuid,
    'Mode routine'
);

INSERT INTO public.routine_exercises (id, routine_id, name, mode)
VALUES
    ('a1a1a1a1-0000-4000-8000-000000000013'::uuid, 'a1a1a1a1-0000-4000-8000-000000000012'::uuid, 'A', 'Eccentric Only'),
    ('a1a1a1a1-0000-4000-8000-000000000014'::uuid, 'a1a1a1a1-0000-4000-8000-000000000012'::uuid, 'B', 'NEW_FANCY_MODE');

SELECT is(
    (SELECT mode FROM public.routine_exercises WHERE id = 'a1a1a1a1-0000-4000-8000-000000000013'::uuid),
    'ECCENTRIC_ONLY',
    'insert with display name stores wire name'
);

SELECT is(
    (SELECT mode FROM public.routine_exercises WHERE id = 'a1a1a1a1-0000-4000-8000-000000000014'::uuid),
    'NEW_FANCY_MODE',
    'insert with unknown mode is not rejected'
);

UPDATE public.routine_exercises
SET mode = 'Echo'
WHERE id = 'a1a1a1a1-0000-4000-8000-000000000013'::uuid;

SELECT is(
    (SELECT mode FROM public.routine_exercises WHERE id = 'a1a1a1a1-0000-4000-8000-000000000013'::uuid),
    'ECHO',
    'update with display name stores wire name'
);

-- Load-bearing grants: the SECURITY INVOKER trigger calls the helper as the
-- writing role, so losing either grant would break every routine write.
SELECT ok(
    has_function_privilege('authenticated', 'public.normalize_workout_mode(text)', 'EXECUTE'),
    'authenticated can execute normalize_workout_mode (portal writes)'
);

SELECT ok(
    has_function_privilege('service_role', 'public.normalize_workout_mode(text)', 'EXECUTE'),
    'service_role can execute normalize_workout_mode (mobile-sync-push writes)'
);

SELECT ok(
    NOT has_function_privilege('anon', 'public.normalize_workout_mode(text)', 'EXECUTE'),
    'anon cannot execute normalize_workout_mode'
);

-- A real SPA-shaped write: authenticated FLAME user through RLS.
INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES (
    'a1a1a1a1-0000-4000-8000-000000000011'::uuid,
    'FLAME',
-- A real SPA-shaped write: authenticated EMBER user through RLS.
INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES (
    'a1a1a1a1-0000-4000-8000-000000000011'::uuid,
    'EMBER',
    'active',
    now() + INTERVAL '30 days'
)
ON CONFLICT (user_id) DO UPDATE
SET tier = EXCLUDED.tier,
    status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"a1a1a1a1-0000-4000-8000-000000000011","role":"authenticated"}',
    true
);

INSERT INTO public.routine_exercises (id, routine_id, name, mode)
VALUES (
    'a1a1a1a1-0000-4000-8000-000000000015'::uuid,
    'a1a1a1a1-0000-4000-8000-000000000012'::uuid,
    'C',
    'TUT Beast'
);

SELECT is(
    (SELECT mode FROM public.routine_exercises WHERE id = 'a1a1a1a1-0000-4000-8000-000000000015'::uuid),
    'TUT_BEAST',
    'authenticated insert through RLS runs the trigger and stores the wire name'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SET LOCAL ROLE service_role;

UPDATE public.routine_exercises
SET mode = 'Pump'
WHERE id = 'a1a1a1a1-0000-4000-8000-000000000015'::uuid;

RESET ROLE;

SELECT is(
    (SELECT mode FROM public.routine_exercises WHERE id = 'a1a1a1a1-0000-4000-8000-000000000015'::uuid),
    'PUMP',
    'service_role update runs the trigger and stores the wire name'
);

SELECT ok(
    NOT has_function_privilege('authenticated', 'public.routine_exercises_normalize_mode()', 'EXECUTE'),
    'authenticated cannot execute the trigger function directly'
);

SELECT * FROM finish();

ROLLBACK;
