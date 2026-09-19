-- Scheduler pgTAP (KD-10, PR 31):
--   * private.invoke_edge_function: definer, search_path pinned, not
--     executable by anon/authenticated, no-op (no error) without Vault
--     secrets, and a real pg_net request carrying x-cron-secret with them;
--   * the process-sync-queue and sync-tombstones-retention cron jobs (when
--     pg_cron is installed, as in prod);
--   * the R-8 backlog triage over a seeded backlog.
--
-- Run locally with `supabase test db`.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:scheduler-catalog');

SELECT has_function(
    'private', 'invoke_edge_function', ARRAY['text', 'jsonb'],
    'private.invoke_edge_function(text, jsonb) exists'
);
SELECT ok(
    (SELECT prosecdef FROM pg_proc WHERE oid = 'private.invoke_edge_function(text, jsonb)'::regprocedure),
    'invoke_edge_function is SECURITY DEFINER'
);
SELECT ok(
    (SELECT proconfig FROM pg_proc WHERE oid = 'private.invoke_edge_function(text, jsonb)'::regprocedure)
      @> ARRAY['search_path=""'],
    'invoke_edge_function pins search_path'
);
SELECT ok(
    (SELECT prosecdef FROM pg_proc WHERE oid = 'private.triage_sync_queue_backlog()'::regprocedure)
    AND (SELECT proconfig FROM pg_proc WHERE oid = 'private.triage_sync_queue_backlog()'::regprocedure)
      @> ARRAY['search_path=""'],
    'triage_sync_queue_backlog is SECURITY DEFINER with search_path pinned'
);

SELECT diag('database:scheduler-privileges');

SELECT ok(
    NOT has_function_privilege('anon', 'private.invoke_edge_function(text, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'private.invoke_edge_function(text, jsonb)', 'EXECUTE'),
    'invoke_edge_function is not executable by anon or authenticated'
);
SELECT ok(
    NOT has_function_privilege('anon', 'private.triage_sync_queue_backlog()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'private.triage_sync_queue_backlog()', 'EXECUTE'),
    'triage_sync_queue_backlog is not executable by anon or authenticated'
);
SELECT ok(
    has_function_privilege('service_role', 'private.invoke_edge_function(text, jsonb)', 'EXECUTE'),
    'service_role can execute invoke_edge_function'
);
SELECT ok(
    (SELECT p.proacl IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM aclexplode(p.proacl) a
                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
            )
     FROM pg_proc p
     WHERE p.oid = 'private.invoke_edge_function(text, jsonb)'::regprocedure),
    'PUBLIC cannot execute invoke_edge_function'
);
SELECT ok(
    NOT has_schema_privilege('anon', 'private', 'USAGE')
    AND NOT has_schema_privilege('authenticated', 'private', 'USAGE'),
    'schema private stays closed to anon and authenticated'
);
SELECT ok(
    NOT has_function_privilege('service_role', 'private.capture_function(text, text, text)', 'EXECUTE'),
    'PR 2 migration helpers stay non-executable for service_role'
);

SET LOCAL ROLE authenticated;
SELECT throws_ok(
    $$ SELECT private.invoke_edge_function('process-sync-queue', '{}'::jsonb) $$,
    '42501',
    NULL,
    'authenticated cannot call invoke_edge_function'
);
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok(
    $$ SELECT private.triage_sync_queue_backlog() $$,
    '42501',
    NULL,
    'anon cannot call triage_sync_queue_backlog'
);
RESET ROLE;

SELECT diag('database:scheduler-invoke');

-- No Vault secrets exist in a clean apply: the call is a NOTICE + NULL.
SELECT is(
    (SELECT count(*)::int FROM vault.secrets WHERE name IN ('edge_cron_secret', 'project_url')),
    0,
    'fixture: no scheduler Vault secrets exist'
);
SELECT lives_ok(
    $$ SELECT private.invoke_edge_function('process-sync-queue', '{}'::jsonb) $$,
    'invoke_edge_function without Vault secrets does not error'
);
SELECT is(
    private.invoke_edge_function('process-sync-queue', '{}'::jsonb),
    NULL::bigint,
    'invoke_edge_function without Vault secrets returns NULL (no request)'
);
SELECT throws_ok(
    $$ SELECT private.invoke_edge_function('../auth/v1/admin', '{}'::jsonb) $$,
    '22023',
    NULL,
    'invoke_edge_function rejects a function name that is not a slug'
);

-- With the secrets (rolled back with the test), a pg_net request is queued
-- to <project_url>/functions/v1/<fn> with the x-cron-secret header.
CREATE OR REPLACE FUNCTION pg_temp.invoke_with_secrets_queues_request()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_id bigint;
  v_url text;
  v_headers jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN 'skipped: pg_net not installed';
  END IF;
  PERFORM vault.create_secret('pgtap-cron-secret', 'edge_cron_secret');
  PERFORM vault.create_secret('http://edge.invalid/', 'project_url');
  v_id := private.invoke_edge_function('process-sync-queue', '{"probe": true}'::jsonb);
  IF v_id IS NULL THEN
    RETURN 'no request id';
  END IF;
  EXECUTE 'SELECT url, headers FROM net.http_request_queue WHERE id = $1'
    INTO v_url, v_headers USING v_id;
  IF v_url IS DISTINCT FROM 'http://edge.invalid/functions/v1/process-sync-queue' THEN
    RETURN 'unexpected url ' || coalesce(v_url, '<null>');
  END IF;
  IF v_headers ->> 'x-cron-secret' IS DISTINCT FROM 'pgtap-cron-secret' THEN
    RETURN 'missing x-cron-secret header';
  END IF;
  RETURN 'ok';
END
$$;

SELECT is(
    pg_temp.invoke_with_secrets_queues_request() IN ('ok', 'skipped: pg_net not installed'),
    true,
    'with Vault secrets, invoke_edge_function queues a POST with x-cron-secret (when pg_net is installed)'
);

SELECT diag('database:scheduler-cron-jobs');

-- pg_cron is not installed in the default local/CI stack; prod has it. When
-- it is installed, both jobs exist exactly once with the expected schedule
-- and command.
CREATE OR REPLACE FUNCTION pg_temp.scheduler_jobs_match() RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN true;
  END IF;
  EXECUTE $q$
    SELECT count(*) FROM cron.job
    WHERE (jobname = 'process-sync-queue'
           AND schedule = '*/5 * * * *'
           AND command = 'SELECT private.invoke_edge_function(''process-sync-queue'', ''{}''::jsonb)')
       OR (jobname = 'sync-tombstones-retention'
           AND schedule = '23 3 * * *'
           AND command = 'DELETE FROM public.sync_tombstones WHERE deleted_at < now() - interval ''180 days''')
  $q$ INTO v_count;
  IF v_count <> 2 THEN
    RETURN false;
  END IF;
  EXECUTE $q$
    SELECT count(*) FROM cron.job
    WHERE jobname IN ('process-sync-queue', 'sync-tombstones-retention')
  $q$ INTO v_count;
  RETURN v_count = 2;
END
$$;

SELECT ok(
    pg_temp.scheduler_jobs_match(),
    'process-sync-queue and sync-tombstones-retention jobs exist once each (when pg_cron is installed)'
);
SELECT diag(
    CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
         THEN 'pg_cron installed: job assertions executed'
         ELSE 'pg_cron NOT installed: job assertions skipped' END
);

SELECT diag('database:scheduler-backlog-triage');

-- Fixture (R-8 acceptance):
--   A connected strava, 3 pending incrementals (1d/2d/3d) -> newest stays pending
--   B disconnected fitbit, 1 pending                        -> failed (integration_not_connected)
--   C connected hevy, 1 pending incremental 30d old         -> superseded
--   D connected strava, 1 pending initial 30d old           -> stays pending
--   E no integration row at all, liftosaur pending           -> failed
--   F connected strava: initial 5d + newer incremental 1d   -> both stay pending;
--     an older duplicate initial 6d                          -> superseded
--   A completed row                                          -> untouched
INSERT INTO auth.users (id, email)
VALUES
    ('31313131-0000-4000-8000-00000000000a'::uuid, 'scheduler-a@example.test'),
    ('31313131-0000-4000-8000-00000000000b'::uuid, 'scheduler-b@example.test'),
    ('31313131-0000-4000-8000-00000000000c'::uuid, 'scheduler-c@example.test'),
    ('31313131-0000-4000-8000-00000000000d'::uuid, 'scheduler-d@example.test'),
    ('31313131-0000-4000-8000-00000000000e'::uuid, 'scheduler-e@example.test'),
    ('31313131-0000-4000-8000-00000000000f'::uuid, 'scheduler-f@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_integrations (user_id, provider, status)
VALUES
    ('31313131-0000-4000-8000-00000000000a', 'strava', 'connected'),
    ('31313131-0000-4000-8000-00000000000b', 'fitbit', 'disconnected'),
    ('31313131-0000-4000-8000-00000000000c', 'hevy', 'connected'),
    ('31313131-0000-4000-8000-00000000000d', 'strava', 'connected'),
    ('31313131-0000-4000-8000-00000000000f', 'strava', 'connected');

INSERT INTO public.sync_queue (id, user_id, provider, sync_type, status, created_at)
VALUES
    ('31310000-0000-4000-8000-0000000000a1', '31313131-0000-4000-8000-00000000000a', 'strava', 'incremental', 'pending', now() - interval '1 day'),
    ('31310000-0000-4000-8000-0000000000a2', '31313131-0000-4000-8000-00000000000a', 'strava', 'incremental', 'pending', now() - interval '2 days'),
    ('31310000-0000-4000-8000-0000000000a3', '31313131-0000-4000-8000-00000000000a', 'strava', 'incremental', 'pending', now() - interval '3 days'),
    ('31310000-0000-4000-8000-0000000000a4', '31313131-0000-4000-8000-00000000000a', 'strava', 'incremental', 'completed', now() - interval '40 days'),
    ('31310000-0000-4000-8000-0000000000b1', '31313131-0000-4000-8000-00000000000b', 'fitbit', 'incremental', 'pending', now() - interval '1 day'),
    ('31310000-0000-4000-8000-0000000000c1', '31313131-0000-4000-8000-00000000000c', 'hevy', 'incremental', 'pending', now() - interval '30 days'),
    ('31310000-0000-4000-8000-0000000000d1', '31313131-0000-4000-8000-00000000000d', 'strava', 'initial', 'pending', now() - interval '30 days'),
    ('31310000-0000-4000-8000-0000000000e1', '31313131-0000-4000-8000-00000000000e', 'liftosaur', 'incremental', 'pending', now() - interval '1 day'),
    ('31310000-0000-4000-8000-0000000000f1', '31313131-0000-4000-8000-00000000000f', 'strava', 'initial', 'pending', now() - interval '5 days'),
    ('31310000-0000-4000-8000-0000000000f2', '31313131-0000-4000-8000-00000000000f', 'strava', 'incremental', 'pending', now() - interval '1 day'),
    ('31310000-0000-4000-8000-0000000000f3', '31313131-0000-4000-8000-00000000000f', 'strava', 'initial', 'pending', now() - interval '6 days');

SELECT is(
    private.triage_sync_queue_backlog(),
    '{"not_connected": 2, "duplicates": 3, "stale": 1}'::jsonb,
    'triage reports 2 not connected, 3 duplicates, 1 stale'
);

SELECT set_eq(
    $$ SELECT id::text FROM public.sync_queue
       WHERE user_id::text LIKE '31313131-%' AND status = 'pending' $$,
    ARRAY[
        '31310000-0000-4000-8000-0000000000a1',
        '31310000-0000-4000-8000-0000000000d1',
        '31310000-0000-4000-8000-0000000000f1',
        '31310000-0000-4000-8000-0000000000f2'
    ],
    'pending: newest row per pair, a connected user''s old initial, and an initial kept next to a newer incremental'
);
SELECT set_eq(
    $$ SELECT id::text FROM public.sync_queue
       WHERE user_id::text LIKE '31313131-%' AND status = 'failed'
         AND error_message = 'integration_not_connected' AND completed_at IS NOT NULL $$,
    ARRAY['31310000-0000-4000-8000-0000000000b1', '31310000-0000-4000-8000-0000000000e1'],
    'rows for a disconnected or missing integration are failed with integration_not_connected'
);
SELECT set_eq(
    $$ SELECT id::text FROM public.sync_queue
       WHERE user_id::text LIKE '31313131-%' AND status = 'superseded' AND completed_at IS NOT NULL $$,
    ARRAY[
        '31310000-0000-4000-8000-0000000000a2',
        '31310000-0000-4000-8000-0000000000a3',
        '31310000-0000-4000-8000-0000000000c1',
        '31310000-0000-4000-8000-0000000000f3'
    ],
    'older duplicates (incl. an older duplicate initial) and the 30-day-old incremental are superseded'
);
SELECT is(
    (SELECT status FROM public.sync_queue WHERE id = '31310000-0000-4000-8000-0000000000a4'),
    'completed',
    'a completed row is untouched'
);
SELECT is(
    private.triage_sync_queue_backlog(),
    '{"not_connected": 0, "duplicates": 0, "stale": 0}'::jsonb,
    're-running the triage is a no-op'
);

SELECT * FROM finish();
ROLLBACK;
