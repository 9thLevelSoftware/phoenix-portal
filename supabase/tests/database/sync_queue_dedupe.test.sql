-- sync_queue dedupe pgTAP (FP-8 / F-057, PR 52, migration 20260920005200):
--   * `sync_queue_one_active` exists, is UNIQUE and PARTIAL;
--   * one active row per (user_id, provider, initial-or-not): a duplicate
--     pending/processing row is 23505, an `initial` beside a non-initial is
--     allowed, another provider is independent, and a finished row
--     (completed/failed/superseded) never blocks a new one;
--   * a NULL sync_type is classified as non-initial (it must NOT slip past the
--     index the way a bare `sync_type = 'initial'` expression would);
--   * pending <-> processing transitions keep the same key and never trip it.
--
-- The seeded-backlog dedupe itself (the migration's `superseded` pass, applied
-- twice) is asserted in CI by scripts/ci/sync-queue-dedupe.
--
-- Run locally with `supabase test db`.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:sync-queue-one-active');

SELECT has_index('public', 'sync_queue', 'sync_queue_one_active',
    'sync_queue has the one-active index');
SELECT ok(
    (SELECT i.indisunique AND i.indpred IS NOT NULL
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'sync_queue_one_active'),
    'sync_queue_one_active is a partial UNIQUE index'
);
SELECT is(
    substring(
      pg_get_indexdef('public.sync_queue_one_active'::regclass) FROM ' WHERE .*$'
    ),
    ' WHERE (status = ANY (ARRAY[''pending''::text, ''processing''::text]))',
    'the index covers exactly the active statuses'
);
SELECT ok(
    pg_get_indexdef('public.sync_queue_one_active'::regclass)
      LIKE '%(user_id, provider, ((COALESCE(sync_type, ''incremental''::text) = ''initial''::text)))%',
    'the index key is (user_id, provider, initial-or-not), with NULL sync_type as non-initial'
);
SELECT has_index('public', 'sync_queue', 'sync_queue_one_processing',
    'sync_queue has the one-processing index');
SELECT ok(
    (SELECT i.indisunique AND i.indpred IS NOT NULL
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'sync_queue_one_processing'),
    'sync_queue_one_processing is a partial UNIQUE index'
);

INSERT INTO auth.users (id, email)
SELECT ('52525252-0000-4000-8000-00000000000' || u)::uuid, 'dedupe-' || u || '@example.test'
FROM unnest(ARRAY['1', '2']) AS u
ON CONFLICT (id) DO NOTHING;

-- One live incremental for user 1 / strava.
INSERT INTO public.sync_queue (id, user_id, provider, sync_type, status, created_at)
VALUES ('52520000-0000-4000-8000-0000000000a1',
        '52525252-0000-4000-8000-000000000001', 'strava', 'incremental', 'processing',
        now() - interval '1 minute');

SELECT throws_ok(
    $$ INSERT INTO public.sync_queue (user_id, provider, sync_type, status)
       VALUES ('52525252-0000-4000-8000-000000000001', 'strava', 'manual', 'pending') $$,
    '23505',
    NULL,
    'a second non-initial row for the same pair is rejected'
);
-- An explicit NULL, not the column default: `sync_type = 'initial'` evaluates
-- to NULL for such a row, and NULL index keys never collide, so a bare
-- equality expression would let every untyped legacy row straight through.
SELECT throws_ok(
    $$ INSERT INTO public.sync_queue (user_id, provider, sync_type, status)
       VALUES ('52525252-0000-4000-8000-000000000001', 'strava', NULL, 'pending') $$,
    '23505',
    NULL,
    'a NULL sync_type counts as non-initial and is rejected too'
);
SELECT lives_ok(
    $$ INSERT INTO public.sync_queue (id, user_id, provider, sync_type, status)
       VALUES ('52520000-0000-4000-8000-0000000000a2',
               '52525252-0000-4000-8000-000000000001', 'strava', 'initial', 'pending') $$,
    'an initial beside an active incremental is allowed'
);
SELECT throws_ok(
    $$ INSERT INTO public.sync_queue (user_id, provider, sync_type, status)
       VALUES ('52525252-0000-4000-8000-000000000001', 'strava', 'initial', 'processing') $$,
    '23505',
    NULL,
    'a second initial for the same pair is rejected'
);
SELECT throws_ok(
    $$ UPDATE public.sync_queue SET status = 'processing'
       WHERE id = '52520000-0000-4000-8000-0000000000a2' $$,
    '23505',
    NULL,
    'initial and non-initial rows cannot execute concurrently'
);
SELECT lives_ok(
    $$ INSERT INTO public.sync_queue (user_id, provider, sync_type, status)
       VALUES ('52525252-0000-4000-8000-000000000001', 'hevy', 'manual', 'processing') $$,
    'another provider is independent'
);
SELECT lives_ok(
    $$ INSERT INTO public.sync_queue (user_id, provider, sync_type, status)
       VALUES ('52525252-0000-4000-8000-000000000002', 'strava', 'manual', 'processing') $$,
    'another user is independent'
);

-- Reclaiming keeps the class index key while leaving the processing-only one.
SELECT lives_ok(
    $$ UPDATE public.sync_queue SET status = 'pending'
       WHERE id = '52520000-0000-4000-8000-0000000000a1' $$,
    'reclaiming a row (processing -> pending) leaves both indexes clean'
);

-- Terminal rows leave the index.
SELECT lives_ok(
    $$ UPDATE public.sync_queue SET status = 'completed', completed_at = now()
       WHERE id = '52520000-0000-4000-8000-0000000000a1' $$,
    'completing the live row is allowed'
);
SELECT lives_ok(
    $$ INSERT INTO public.sync_queue (user_id, provider, sync_type, status)
       VALUES ('52525252-0000-4000-8000-000000000001', 'strava', 'manual', 'processing') $$,
    'a completed row no longer blocks a new sync'
);
SELECT lives_ok(
    $$ UPDATE public.sync_queue SET status = 'superseded', completed_at = now()
       WHERE user_id = '52525252-0000-4000-8000-000000000001'
         AND provider = 'strava' AND status = 'processing' $$,
    'superseding the active rows is allowed'
);
SELECT is(
    (SELECT count(*)::int FROM public.sync_queue
     WHERE user_id = '52525252-0000-4000-8000-000000000001'
       AND provider = 'strava' AND status IN ('pending', 'processing')),
    1,
    'only the kept pending initial is still active for that pair'
);

SELECT * FROM finish();
ROLLBACK;
