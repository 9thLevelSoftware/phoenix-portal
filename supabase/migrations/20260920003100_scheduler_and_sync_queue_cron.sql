-- KD-10: scheduler plumbing (pg_cron + pg_net + a Vault-held secret), and
-- draining the integration sync queue.
--
-- Nothing has ever scheduled process-sync-queue (prod-evidence: the only
-- pg_cron jobs are refresh-community-benchmarks and refresh-hot-scores), so
-- every sync_queue row since launch is still `pending`. This migration:
--
--   1. enables pg_net (best effort; NOTICE if it cannot be created);
--   2. adds private.invoke_edge_function(fn, body): SECURITY DEFINER,
--      search_path pinned, EXECUTE for postgres/service_role only. It reads
--      the Vault secrets `edge_cron_secret` and `project_url` and POSTs to
--      <project_url>/functions/v1/<fn> with header `x-cron-secret`. If Vault,
--      pg_net or either secret is missing it RAISEs NOTICE and returns NULL,
--      so a clean apply (CI, local) and a prod apply before Operator
--      Action 7 both succeed and the job is a harmless no-op;
--   3. triages the stale backlog BEFORE scheduling (R-8), through
--      private.triage_sync_queue_backlog() (persistent, so pgTAP can seed
--      rows and exercise it):
--        a. pending rows whose (user_id, provider) integration is not
--           `connected` -> `failed`, error_message 'integration_not_connected'.
--           A missing user_integrations row counts as not connected.
--        b. per (user_id, provider), keep only the newest pending row
--           (created_at DESC, id DESC); the others -> `superseded`.
--           Plain reading of the spec: an old pending `initial` with a newer
--           pending `incremental` for the same pair is superseded here.
--        c. pending rows older than 14 days -> `superseded`, except the
--           newest pending `initial` row of a still-connected integration,
--           so its history import still runs.
--      Terminal rows get completed_at = now() (the Edge convention).
--      sync_queue.status has no CHECK constraint in any migration, so
--      `superseded` needs no constraint change (the portal's SyncStatus only
--      counts pending/processing, so the new value is invisible there);
--   4. schedules, idempotently (lookup by jobname -> cron.schedule if absent,
--      cron.alter_job in place if schedule/command differ; PR 2's pattern):
--        - process-sync-queue          */5 * * * *
--        - sync-tombstones-retention   daily, deletes tombstones > 180 days
--      Skipped with a NOTICE where pg_cron is not installed (local/CI; prod
--      has it). Jobs run as postgres, the owner of invoke_edge_function.
--
-- The Edge receiver keeps its constant-time x-cron-secret compare and now
-- also reads CRON_SECRET (the name Operator Action 7 sets). verify_jwt is
-- already false for process-sync-queue in supabase/config.toml.
--
-- Operator (Action 7), read-only counts to record in the PR BEFORE applying:
--   -- a. pending rows for a not-connected (or missing) integration
--   SELECT count(*) FROM public.sync_queue q
--   WHERE q.status = 'pending' AND NOT EXISTS (
--     SELECT 1 FROM public.user_integrations i
--     WHERE i.user_id = q.user_id AND i.provider = q.provider
--       AND i.status = 'connected');
--   -- b. pending duplicates (rows beyond the newest per user/provider)
--   SELECT coalesce(sum(n - 1), 0) FROM (
--     SELECT count(*) AS n FROM public.sync_queue
--     WHERE status = 'pending' GROUP BY user_id, provider) d;
--   -- c. pending rows older than 14 days
--   SELECT count(*) FROM public.sync_queue
--   WHERE status = 'pending' AND created_at < now() - interval '14 days';
--   -- d. connected users' pending `initial` rows that step b supersedes
--   --    because a newer pending row (e.g. a manual sync) exists
--   SELECT count(*) FROM public.sync_queue q
--   WHERE q.status = 'pending' AND q.sync_type = 'initial'
--     AND EXISTS (SELECT 1 FROM public.user_integrations i
--                 WHERE i.user_id = q.user_id AND i.provider = q.provider
--                   AND i.status = 'connected')
--     AND EXISTS (SELECT 1 FROM public.sync_queue n
--                 WHERE n.user_id = q.user_id AND n.provider = q.provider
--                   AND n.status = 'pending'
--                   AND (n.created_at, n.id) > (q.created_at, q.id));
--   -- total pending
--   SELECT count(*) FROM public.sync_queue WHERE status = 'pending';
--
-- Idempotent: safe to re-run (triage only touches `pending` rows and is a
-- no-op once the backlog is clean; jobs are looked up by name).

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. pg_net. Not every local image preloads it; never fail the apply on it.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_net;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_net could not be created (%: %); invoke_edge_function will no-op',
        SQLSTATE, SQLERRM;
    END;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Schema `private` (PR 2 created it; keep its revokes) and the invoker.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
-- service_role may call the functions granted to it below. PR 2's helpers
-- stay non-executable for it (EXECUTE revoked from PUBLIC, never granted).
GRANT USAGE ON SCHEMA private TO service_role;

CREATE OR REPLACE FUNCTION private.invoke_edge_function(fn text, body jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_secret text;
  v_url text;
  v_request_id bigint;
BEGIN
  IF fn IS NULL OR fn !~ '^[a-z0-9][a-z0-9_-]*$' THEN
    RAISE EXCEPTION 'invoke_edge_function: invalid function name %', fn
      USING ERRCODE = '22023';
  END IF;

  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'invoke_edge_function(%): Vault is not available; skipped', fn;
    RETURN NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'invoke_edge_function(%): pg_net is not installed; skipped', fn;
    RETURN NULL;
  END IF;

  BEGIN
    SELECT s.decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets s
    WHERE s.name = 'edge_cron_secret'
    ORDER BY s.created_at DESC
    LIMIT 1;

    SELECT s.decrypted_secret INTO v_url
    FROM vault.decrypted_secrets s
    WHERE s.name = 'project_url'
    ORDER BY s.created_at DESC
    LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'invoke_edge_function(%): cannot read Vault (%); skipped', fn, SQLERRM;
    RETURN NULL;
  END;

  IF coalesce(v_secret, '') = '' OR coalesce(v_url, '') = '' THEN
    RAISE NOTICE 'invoke_edge_function(%): Vault secret edge_cron_secret or project_url is missing; skipped', fn;
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := pg_catalog.rtrim(v_url, '/') || '/functions/v1/' || fn,
    body := coalesce(body, '{}'::jsonb),
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  RETURN v_request_id;
END
$fn$;

REVOKE ALL ON FUNCTION private.invoke_edge_function(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.invoke_edge_function(text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Backlog triage (R-8). Returns the per-step counts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.triage_sync_queue_backlog()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_not_connected integer;
  v_duplicates integer;
  v_stale integer;
BEGIN
  -- a. Integration not connected (or gone).
  UPDATE public.sync_queue q
  SET status = 'failed',
      error_message = 'integration_not_connected',
      completed_at = now()
  WHERE q.status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM public.user_integrations i
      WHERE i.user_id = q.user_id
        AND i.provider = q.provider
        AND i.status = 'connected'
    );
  GET DIAGNOSTICS v_not_connected = ROW_COUNT;

  -- b. Keep only the newest pending row per (user_id, provider).
  UPDATE public.sync_queue q
  SET status = 'superseded',
      completed_at = now()
  FROM (
    SELECT id,
           row_number() OVER (
             PARTITION BY user_id, provider
             ORDER BY created_at DESC NULLS LAST, id DESC
           ) AS rn
    FROM public.sync_queue
    WHERE status = 'pending'
  ) ranked
  WHERE q.id = ranked.id
    AND ranked.rn > 1
    AND q.status = 'pending';
  GET DIAGNOSTICS v_duplicates = ROW_COUNT;

  -- c. Older than 14 days, except the newest pending `initial` of a
  --    still-connected integration.
  UPDATE public.sync_queue q
  SET status = 'superseded',
      completed_at = now()
  WHERE q.status = 'pending'
    AND (q.created_at IS NULL OR q.created_at < now() - interval '14 days')
    AND NOT (
      q.sync_type IS NOT DISTINCT FROM 'initial'
      AND EXISTS (
        SELECT 1 FROM public.user_integrations i
        WHERE i.user_id = q.user_id
          AND i.provider = q.provider
          AND i.status = 'connected'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.sync_queue newer
        WHERE newer.user_id = q.user_id
          AND newer.provider = q.provider
          AND newer.status = 'pending'
          AND newer.sync_type = 'initial'
          AND newer.id <> q.id
          AND (newer.created_at, newer.id) > (q.created_at, q.id)
      )
    );
  GET DIAGNOSTICS v_stale = ROW_COUNT;

  RAISE NOTICE 'sync_queue triage: % not connected -> failed, % duplicates -> superseded, % stale -> superseded',
    v_not_connected, v_duplicates, v_stale;

  RETURN pg_catalog.jsonb_build_object(
    'not_connected', v_not_connected,
    'duplicates', v_duplicates,
    'stale', v_stale
  );
END
$fn$;

REVOKE ALL ON FUNCTION private.triage_sync_queue_backlog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.triage_sync_queue_backlog() TO service_role;

SELECT private.triage_sync_queue_backlog();

-- ---------------------------------------------------------------------------
-- 4. pg_cron jobs (after triage). PR 2's idempotent pattern.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  j record;
  v_jobid bigint;
  v_schedule text;
  v_command text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skip scheduling process-sync-queue and sync-tombstones-retention';
    RETURN;
  END IF;

  FOR j IN
    SELECT *
    FROM (VALUES
      ('process-sync-queue', '*/5 * * * *',
       'SELECT private.invoke_edge_function(''process-sync-queue'', ''{}''::jsonb)'),
      ('sync-tombstones-retention', '23 3 * * *',
       'DELETE FROM public.sync_tombstones WHERE deleted_at < now() - interval ''180 days''')
    ) AS v(jobname, schedule, command)
  LOOP
    v_jobid := NULL;
    EXECUTE 'SELECT jobid, schedule, command FROM cron.job WHERE jobname = $1 ORDER BY jobid LIMIT 1'
      INTO v_jobid, v_schedule, v_command
      USING j.jobname;

    IF v_jobid IS NULL THEN
      PERFORM cron.schedule(j.jobname, j.schedule, j.command);
    ELSIF v_schedule IS DISTINCT FROM j.schedule OR v_command IS DISTINCT FROM j.command THEN
      PERFORM cron.alter_job(v_jobid, schedule := j.schedule, command := j.command);
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Self-check.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF has_function_privilege('anon', 'private.invoke_edge_function(text, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.invoke_edge_function(text, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'private.triage_sync_queue_backlog()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.triage_sync_queue_backlog()', 'EXECUTE') THEN
    RAISE EXCEPTION 'scheduler: private functions are executable by anon/authenticated'
      USING ERRCODE = '42501';
  END IF;
END
$$;

COMMIT;
