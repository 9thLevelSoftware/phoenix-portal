-- Security hardening and dead paths (20260923100000):
--   NF-31  no client UPDATE on challenge_participants (table or column);
--   OP-14  no client UPDATE on workout_sessions (the notes grant is gone);
--   NF-30  the comment rate limit counts write events, so deleting comments
--          does not hand slots back.

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
    NOT has_table_privilege('authenticated', 'private.comment_rate_events', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'private.comment_rate_events', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'private.comment_rate_events', 'DELETE'),
    'comment rate events are server-only'
);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres): two users, F (FLAME) and I (INFERNO).
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
