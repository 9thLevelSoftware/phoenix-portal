-- NF-36 (20260925900000): velocity_estimated_1rm_kg is not client-readable, and
-- the two progress RPCs return it only to INFERNO. Moved out of
-- security_hardening.test.sql together with the migration.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:nf36-velocity-gate-grants');

SELECT ok(
    NOT has_column_privilege('authenticated', 'public.exercise_progress', 'velocity_estimated_1rm_kg', 'SELECT')
    AND NOT has_column_privilege('anon', 'public.exercise_progress', 'velocity_estimated_1rm_kg', 'SELECT'),
    'velocity_estimated_1rm_kg is not client-readable (NF-36)'
);
SELECT is_empty(
    $sql$
        SELECT c
        FROM unnest(ARRAY[
          'id', 'user_id', 'exercise_name', 'session_id', 'recorded_at', 'max_weight_kg',
          'total_volume_kg', 'estimated_1rm_kg', 'max_reps', 'set_count',
          'local_profile_id', 'exercise_id'
        ]) AS c
        WHERE NOT has_column_privilege('authenticated', 'public.exercise_progress', c, 'SELECT')
    $sql$,
    'every allow-listed exercise_progress column stays readable by authenticated (a later column is not, by design)'
);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres): F is FLAME, I is INFERNO; each has one session and one
-- exercise_progress row carrying a VBT 1RM of 99.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
    ('23100000-0000-4000-8000-0000000000f1'::uuid, 'hardening-flame@example.test'),
    ('23100000-0000-4000-8000-0000000000a1'::uuid, 'hardening-inferno@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id) VALUES
    ('23100000-0000-4000-8000-0000000000f1'),
    ('23100000-0000-4000-8000-0000000000a1')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.subscriptions (user_id, tier, status, current_period_end) VALUES
    ('23100000-0000-4000-8000-0000000000f1', 'FLAME', 'active', now() + INTERVAL '30 days'),
    ('23100000-0000-4000-8000-0000000000a1', 'INFERNO', 'active', now() + INTERVAL '30 days')
ON CONFLICT (user_id) DO UPDATE
SET tier = EXCLUDED.tier, status = EXCLUDED.status, current_period_end = EXCLUDED.current_period_end;
INSERT INTO public.workout_sessions (id, user_id) VALUES
    ('23100000-0001-4000-8000-0000000000f1', '23100000-0000-4000-8000-0000000000f1'),
    ('23100000-0001-4000-8000-0000000000a1', '23100000-0000-4000-8000-0000000000a1');
INSERT INTO public.exercise_progress
    (user_id, exercise_name, session_id, recorded_at, max_weight_kg, total_volume_kg,
     estimated_1rm_kg, max_reps, set_count, velocity_estimated_1rm_kg)
VALUES
    ('23100000-0000-4000-8000-0000000000f1', 'Hardening Press', '23100000-0001-4000-8000-0000000000f1',
     now(), 40, 400, 50, 10, 3, 99),
    ('23100000-0000-4000-8000-0000000000a1', 'Hardening Press', '23100000-0001-4000-8000-0000000000a1',
     now(), 40, 400, 50, 10, 3, 99);

SELECT diag('database:security-hardening-vbt-gate');

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"23100000-0000-4000-8000-0000000000f1","role":"authenticated"}',
    true
);
SELECT throws_ok(
    $sql$ SELECT velocity_estimated_1rm_kg FROM public.exercise_progress $sql$,
    '42501',
    NULL,
    'a direct read of the VBT 1RM column is refused'
);
SELECT results_eq(
    $sql$ SELECT estimated_1rm_kg::integer, velocity_estimated_1rm_kg
          FROM public.exercise_progress_series('Hardening Press') $sql$,
    $v$ VALUES (50, NULL::numeric) $v$,
    'FLAME: exercise_progress_series returns the row with the VBT 1RM nulled'
);
SELECT is(
    public.exercise_progress_series_many(ARRAY['Hardening Press']) -> 0 -> 'rows' -> 0 -> 'velocity_estimated_1rm_kg',
    'null'::jsonb,
    'FLAME: exercise_progress_series_many carries the key, nulled'
);

SELECT set_config(
    'request.jwt.claims',
    '{"sub":"23100000-0000-4000-8000-0000000000a1","role":"authenticated"}',
    true
);
SELECT results_eq(
    $sql$ SELECT velocity_estimated_1rm_kg::integer
          FROM public.exercise_progress_series('Hardening Press') $sql$,
    $v$ VALUES (99) $v$,
    'INFERNO: exercise_progress_series returns the VBT 1RM'
);
SELECT is(
    (public.exercise_progress_series_many(ARRAY['Hardening Press']) -> 0 -> 'rows' -> 0 ->> 'velocity_estimated_1rm_kg')::numeric::integer,
    99,
    'INFERNO: exercise_progress_series_many returns the VBT 1RM'
);
SELECT is(
    (SELECT count(*)::integer FROM public.exercise_progress_series('Hardening Press')),
    1,
    'the DEFINER series is still caller-scoped: INFERNO sees only its own row'
);
RESET ROLE;

-- Fail closed: a column added to exercise_progress later is not returned by
-- these DEFINER RPCs until it is listed deliberately.
ALTER TABLE public.exercise_progress ADD COLUMN zz_server_only text;
UPDATE public.exercise_progress SET zz_server_only = 'secret';
SET LOCAL ROLE authenticated;
SELECT is(
    (SELECT zz_server_only FROM public.exercise_progress_series('Hardening Press')),
    NULL,
    'a new column comes back NULL from exercise_progress_series'
);
SELECT ok(
    NOT ((public.exercise_progress_series_many(ARRAY['Hardening Press']) -> 0 -> 'rows' -> 0) ? 'zz_server_only'),
    'a new column is absent from exercise_progress_series_many'
);
SELECT ok(
    NOT has_column_privilege('authenticated', 'public.exercise_progress', 'zz_server_only', 'SELECT'),
    'a new column is not browser-readable either'
);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT * FROM finish();
ROLLBACK;
