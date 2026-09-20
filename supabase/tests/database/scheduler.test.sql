-- Scheduler pgTAP (KD-10, PR 31):
--   * private.invoke_edge_function: definer, search_path pinned, owner-only,
--     no-op (no error) without Vault secrets, https-only project_url, and a
--     real pg_net request carrying x-cron-secret with them;
--   * pg_net's SECURITY DEFINER entry points closed to anon/authenticated;
--   * the cron jobs, through private.schedule_sync_queue_jobs() with pg_cron
--     installed inside this test's transaction (fails loudly if the image
--     cannot create pg_cron);
--   * the one-time triage: dropped after use, and run by the migration
--     before scheduling (the seeded-backlog outcome itself is asserted in CI
--     by scripts/ci/sync-queue-triage, through the migration's own call);
--   * the stopgap client-insert guard on sync_queue.
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
SELECT has_function('private', 'schedule_sync_queue_jobs', ARRAY[]::text[],
    'private.schedule_sync_queue_jobs() exists');
SELECT ok(
    to_regprocedure('private.triage_sync_queue_backlog()') IS NULL,
    'the one-time triage function was dropped after the migration ran it'
);
SELECT has_trigger('public', 'sync_queue', 'sync_queue_guard_client_insert',
    'sync_queue has the client-insert guard trigger');

-- R-14: the migration's own statements run the triage, drop it, and only
-- then schedule the jobs.
SELECT ok(
    (
      WITH s AS (
        SELECT stmt, ord
        FROM supabase_migrations.schema_migrations m,
             unnest(m.statements) WITH ORDINALITY AS u(stmt, ord)
        WHERE m.version = '20260920003100'
      )
      -- Statements may carry leading comment lines; match at a line start.
      SELECT (SELECT min(ord) FROM s WHERE stmt ~* '(^|\n)\s*SELECT\s+private\.triage_sync_queue_backlog\(\)')
           < (SELECT min(ord) FROM s WHERE stmt ~* '(^|\n)\s*DROP\s+FUNCTION\s+private\.triage_sync_queue_backlog\(\)')
         AND (SELECT min(ord) FROM s WHERE stmt ~* '(^|\n)\s*DROP\s+FUNCTION\s+private\.triage_sync_queue_backlog\(\)')
           < (SELECT min(ord) FROM s WHERE stmt ~* '(^|\n)\s*SELECT\s+private\.schedule_sync_queue_jobs\(\)')
    ),
    'migration 20260920003100 runs the triage, drops it, then schedules the jobs'
);

SELECT diag('database:scheduler-privileges');

SELECT ok(
    NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
        WHERE n.nspname = 'private'
          AND p.proname IN ('invoke_edge_function', 'schedule_sync_queue_jobs',
                            'sync_queue_guard_client_insert')
          AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    ),
    'scheduler functions are owner-only (not anon, authenticated or service_role)'
);
SELECT ok(
    NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace,
             aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE n.nspname = 'private'
          AND p.proname IN ('invoke_edge_function', 'schedule_sync_queue_jobs',
                            'sync_queue_guard_client_insert')
          AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ),
    'PUBLIC cannot execute the scheduler functions'
);
SELECT ok(
    NOT has_schema_privilege('anon', 'private', 'USAGE')
    AND NOT has_schema_privilege('authenticated', 'private', 'USAGE')
    AND NOT has_schema_privilege('service_role', 'private', 'USAGE'),
    'schema private stays closed to anon, authenticated and service_role'
);

SET LOCAL ROLE authenticated;
SELECT throws_ok(
    $$ SELECT private.invoke_edge_function('process-sync-queue', '{}'::jsonb) $$,
    '42501',
    NULL,
    'authenticated cannot call invoke_edge_function'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT throws_ok(
    $$ SELECT private.invoke_edge_function('process-sync-queue', '{}'::jsonb) $$,
    '42501',
    NULL,
    'service_role cannot call invoke_edge_function (cron runs as postgres)'
);
RESET ROLE;

SELECT diag('database:scheduler-pg-net-surface');

SELECT ok(
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net'),
    'pg_net is installed by the migration'
);
-- The migration revokes every anon/authenticated/PUBLIC EXECUTE grant on
-- pg_net's definers that the migration role can revoke. On Supabase the
-- extension is created by supabase_admin, whose grants postgres cannot
-- revoke (no grant option); those remain a platform grant, reachable only if
-- `net` were exposed through the API (asserted below). This assertion fails
-- if any grant that postgres COULD revoke is left behind.
SELECT ok(
    NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace,
             aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE n.nspname = 'net' AND p.prosecdef
          AND a.privilege_type = 'EXECUTE'
          AND a.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
          AND (a.grantor = 'postgres'::regrole::oid
               OR pg_has_role('postgres', a.grantor, 'MEMBER'))
    ),
    'no anon/authenticated/PUBLIC EXECUTE on a pg_net definer that postgres could revoke remains'
);
SELECT diag(coalesce(
    'pg_net platform grants postgres cannot revoke: ' || (
        SELECT string_agg(DISTINCT format('%s -> %s (grantor %s)', p.oid::regprocedure,
                          CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
                          pg_get_userbyid(a.grantor)), '; ')
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace,
             aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE n.nspname = 'net' AND p.prosecdef
          AND a.privilege_type = 'EXECUTE'
          AND a.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
    ),
    'pg_net: no anon/authenticated EXECUTE grants'
));
SELECT ok(
    has_function_privilege('service_role',
        'net.http_post(text, jsonb, jsonb, jsonb, integer)', 'EXECUTE'),
    'service_role keeps net.http_post'
);
SELECT ok(
    NOT EXISTS (
        SELECT 1
        FROM pg_roles r, unnest(coalesce(r.rolconfig, ARRAY[]::text[])) AS c(setting)
        WHERE r.rolname = 'authenticator'
          AND c.setting ~ '^pgrst\.db_schemas='
          AND c.setting ~ '(=|,)\s*(net|private)\s*(,|$)'
    ),
    'the API does not expose schema net or private (authenticator pgrst.db_schemas)'
);

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

-- With secrets (rolled back with the test): what gets queued per project_url.
CREATE OR REPLACE FUNCTION pg_temp.invoke_with(p_url text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_id bigint;
  v_row jsonb;
BEGIN
  DELETE FROM vault.secrets WHERE name IN ('edge_cron_secret', 'project_url');
  PERFORM vault.create_secret('pgtap-cron-secret', 'edge_cron_secret');
  PERFORM vault.create_secret(p_url, 'project_url');
  v_id := private.invoke_edge_function('process-sync-queue', '{"probe": true}'::jsonb);
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE 'SELECT to_jsonb(q) FROM net.http_request_queue q WHERE id = $1'
    INTO v_row USING v_id;
  RETURN v_row;
END
$$;

SELECT is(
    (SELECT r ->> 'url' FROM pg_temp.invoke_with('https://abcd.supabase.co/') r),
    'https://abcd.supabase.co/functions/v1/process-sync-queue',
    'https project_url: POST queued to /functions/v1/<fn>'
);
SELECT is(
    (SELECT r -> 'headers' ->> 'x-cron-secret' FROM pg_temp.invoke_with('https://abcd.supabase.co') r),
    'pgtap-cron-secret',
    'the request carries the x-cron-secret header'
);
SELECT is(
    (SELECT (r ->> 'timeout_milliseconds')::int FROM pg_temp.invoke_with('https://abcd.supabase.co') r),
    400000,
    'the pg_net timeout is the Edge wall-clock limit (400 s)'
);
SELECT is(
    pg_temp.invoke_with('http://evil.example/'),
    NULL::jsonb,
    'a plain-http non-local project_url is refused (secret never sent in clear)'
);
SELECT is(
    pg_temp.invoke_with('https://user@evil.example'),
    NULL::jsonb,
    'a project_url with userinfo is refused'
);
SELECT is(
    (SELECT r ->> 'url' FROM pg_temp.invoke_with('http://localhost:54321') r),
    'http://localhost:54321/functions/v1/process-sync-queue',
    'http is allowed for a local stack'
);
SELECT is(
    (SELECT r ->> 'url' FROM pg_temp.invoke_with('http://kong:8000') r),
    'http://kong:8000/functions/v1/process-sync-queue',
    'http is allowed for the local kong gateway'
);
DELETE FROM vault.secrets WHERE name IN ('edge_cron_secret', 'project_url');

SELECT diag('database:scheduler-cron-jobs');

-- pg_cron is not installed by the clean apply (prod has it). Install it for
-- this transaction; this fails loudly if the image cannot, so the job
-- assertions below always execute.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
    'sync-tombstones-retention',
    '23 3 * * *',
    'DELETE FROM public.sync_tombstones WHERE deleted_at < now() - interval ''180 days'''
);
SELECT lives_ok(
    $$ SELECT private.schedule_sync_queue_jobs() $$,
    'schedule_sync_queue_jobs runs with pg_cron installed and removes legacy tombstone retention'
);

CREATE OR REPLACE FUNCTION pg_temp.scheduler_jobs() RETURNS TABLE(jobname text, schedule text, command text, active boolean, jobid bigint)
LANGUAGE sql AS $$
  SELECT jobname, schedule, command, active, jobid FROM cron.job
  WHERE jobname IN ('process-sync-queue', 'sync-tombstones-retention', 'cron-job-run-details-retention')
$$;

SELECT set_eq(
    $$ SELECT jobname, schedule, command FROM pg_temp.scheduler_jobs() $$,
    $$ VALUES
        ('process-sync-queue', '*/5 * * * *',
         'SELECT private.invoke_edge_function(''process-sync-queue'', ''{}''::jsonb)'),
        ('cron-job-run-details-retention', '41 3 * * *',
         'DELETE FROM cron.job_run_details WHERE end_time < now() - interval ''7 days''')
    $$,
    'the scheduler jobs exist with the expected schedule and command'
);
SELECT is(
    (SELECT count(*)::int FROM pg_temp.scheduler_jobs()),
    2,
    'each scheduler job exists exactly once'
);

CREATE TEMP TABLE scheduler_jobids AS SELECT jobname, jobid FROM pg_temp.scheduler_jobs();
SELECT cron.alter_job(
    (SELECT jobid FROM cron.job WHERE jobname = 'process-sync-queue'),
    schedule := '0 * * * *', active := false
);
SELECT private.schedule_sync_queue_jobs();
SELECT set_eq(
    $$ SELECT jobname, jobid FROM pg_temp.scheduler_jobs() $$,
    $$ SELECT jobname, jobid FROM scheduler_jobids $$,
    're-running the scheduler keeps every jobid (no duplicates)'
);
SELECT is(
    (SELECT schedule FROM cron.job WHERE jobname = 'process-sync-queue'),
    '*/5 * * * *',
    're-running the scheduler repairs a drifted schedule in place'
);
SELECT is(
    (SELECT active FROM cron.job WHERE jobname = 'process-sync-queue'),
    false,
    're-running the scheduler keeps a paused job paused'
);

SELECT diag('database:sync-queue-client-insert-guard');

INSERT INTO auth.users (id, email)
VALUES ('31313131-0000-4000-8000-0000000000f0'::uuid, 'scheduler-guard@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subscriptions (id, user_id, tier, status, current_period_end)
VALUES (
    '31313131-5555-4000-8000-0000000000f0'::uuid,
    '31313131-0000-4000-8000-0000000000f0'::uuid,
    'FLAME',
    'active',
    now() + interval '30 days'
)
ON CONFLICT (user_id) DO UPDATE
SET tier = EXCLUDED.tier,
    status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"31313131-0000-4000-8000-0000000000f0","role":"authenticated"}',
    true
);

SELECT lives_ok(
    $$ INSERT INTO public.sync_queue
         (id, user_id, provider, sync_type, status, created_at, started_at, retry_count, error_message)
       VALUES ('31310000-0000-4000-8000-0000000000f0', '31313131-0000-4000-8000-0000000000f0',
               'strava', 'manual', 'processing', '2000-01-01', now(), 7, 'x') $$,
    'a client may queue a sync'
);
SELECT throws_ok(
    $$ INSERT INTO public.sync_queue (user_id, provider, sync_type)
       VALUES ('31313131-0000-4000-8000-0000000000f0', 'strava', 'incremental') $$,
    '23505',
    'sync_already_queued',
    'a second non-initial row for the same provider is rejected (409)'
);
SELECT lives_ok(
    $$ INSERT INTO public.sync_queue (id, user_id, provider, sync_type)
       VALUES ('31310000-0000-4000-8000-0000000000f1', '31313131-0000-4000-8000-0000000000f0',
               'strava', 'initial') $$,
    'an initial next to a queued incremental/manual is allowed (different class)'
);
SELECT throws_ok(
    $$ INSERT INTO public.sync_queue (user_id, provider, sync_type)
       VALUES ('31313131-0000-4000-8000-0000000000f0', 'strava', 'initial') $$,
    '23505',
    'sync_already_queued',
    'a second initial for the same provider is rejected'
);
SELECT lives_ok(
    $$ INSERT INTO public.sync_queue (user_id, provider, sync_type)
       VALUES ('31313131-0000-4000-8000-0000000000f0', 'hevy', 'manual') $$,
    'another provider is independent'
);
SELECT throws_ok(
    $$ INSERT INTO public.sync_queue (user_id, provider, sync_type)
       VALUES ('31313131-0000-4000-8000-0000000000f0', 'fitbit', 'everything') $$,
    '22023',
    NULL,
    'an unknown sync_type is rejected'
);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT is(
    (SELECT row(status, retry_count, started_at IS NULL, error_message IS NULL,
                created_at > now() - interval '1 minute')::text
     FROM public.sync_queue WHERE id = '31310000-0000-4000-8000-0000000000f0'),
    row('pending', 0, true, true, true)::text,
    'client-supplied status, created_at, started_at, retry_count and error_message are overridden'
);
SELECT lives_ok(
    $$ INSERT INTO public.sync_queue (user_id, provider, sync_type, status, created_at)
       VALUES ('31313131-0000-4000-8000-0000000000f0', 'strava', 'incremental', 'pending',
               '2020-01-01') $$,
    'service-side (postgres) inserts are not clamped or deduplicated'
);
SELECT is(
    (SELECT count(*)::int FROM public.sync_queue
     WHERE user_id = '31313131-0000-4000-8000-0000000000f0'
       AND created_at = '2020-01-01'::timestamptz),
    1,
    'a postgres insert keeps its created_at'
);

SELECT * FROM finish();
ROLLBACK;
