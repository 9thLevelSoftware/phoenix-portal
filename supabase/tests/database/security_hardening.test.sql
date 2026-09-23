-- Security hardening and dead paths (20260923100000):
--   NF-31  no client UPDATE on challenge_participants (table or column);
--   OP-14  no client UPDATE on workout_sessions (the notes grant is gone);
--   NF-30  the comment rate limit counts write events, so deleting comments
--          does not hand slots back;
--   NF-36  velocity_estimated_1rm_kg is not client-readable, and the two
--          progress RPCs return it only to INFERNO.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:security-hardening-grants');

SELECT ok(
    NOT has_any_column_privilege('authenticated', 'public.challenge_participants', 'UPDATE')
    AND NOT has_any_column_privilege('anon', 'public.challenge_participants', 'UPDATE'),
    'no client role may UPDATE challenge_participants, table-wide or per column (NF-31)'
);
SELECT ok(
    has_column_privilege('authenticated', 'public.challenge_participants', 'challenge_id', 'INSERT')
    AND has_table_privilege('authenticated', 'public.challenge_participants', 'DELETE'),
    'joining (INSERT) and leaving (DELETE) a challenge are still granted'
);
SELECT ok(
    NOT has_any_column_privilege('authenticated', 'public.workout_sessions', 'UPDATE'),
    'authenticated holds no UPDATE on workout_sessions, notes included (OP-14)'
);
SELECT ok(
    NOT has_column_privilege('authenticated', 'public.exercise_progress', 'velocity_estimated_1rm_kg', 'SELECT')
    AND NOT has_column_privilege('anon', 'public.exercise_progress', 'velocity_estimated_1rm_kg', 'SELECT'),
    'velocity_estimated_1rm_kg is not client-readable (NF-36)'
);
SELECT is_empty(
    $sql$
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'exercise_progress'
          AND column_name <> 'velocity_estimated_1rm_kg'
          AND NOT has_column_privilege('authenticated', 'public.exercise_progress', column_name, 'SELECT')
    $sql$,
    'every other exercise_progress column stays readable by authenticated'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'private.comment_rate_events', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'private.comment_rate_events', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'private.comment_rate_events', 'DELETE'),
    'comment rate events are server-only'
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
SELECT set_config('request.jwt.claims', '', true);

SELECT diag('database:security-hardening-comment-rate-limit');

-- The trigger fires for every writer, so postgres inserts exercise it.
INSERT INTO public.community_comments (item_id, item_type, user_id, body)
SELECT gen_random_uuid(), 'routine', '23100000-0000-4000-8000-0000000000f1', 'comment ' || n
FROM generate_series(1, 5) AS n;

DELETE FROM public.community_comments
WHERE user_id = '23100000-0000-4000-8000-0000000000f1';

SELECT throws_ok(
    $sql$ INSERT INTO public.community_comments (item_id, item_type, user_id, body)
          VALUES (gen_random_uuid(), 'routine', '23100000-0000-4000-8000-0000000000f1', 'sixth') $sql$,
    'P0001',
    'Rate limit exceeded: maximum 5 comments per hour',
    'deleting comments does not hand rate-limit slots back (NF-30)'
);
SELECT lives_ok(
    $sql$ INSERT INTO public.community_comments (item_id, item_type, user_id, body)
          VALUES (gen_random_uuid(), 'routine', '23100000-0000-4000-8000-0000000000a1', 'other user') $sql$,
    'the limit is per user'
);

SELECT * FROM finish();
ROLLBACK;
