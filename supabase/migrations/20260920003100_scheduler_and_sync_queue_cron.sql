-- KD-10: scheduler plumbing (pg_cron + pg_net + a Vault-held secret), and
-- draining the integration sync queue.
--
-- Nothing has ever scheduled process-sync-queue (prod-evidence: the only
-- pg_cron jobs are refresh-community-benchmarks and refresh-hot-scores), so
-- every sync_queue row since launch is still `pending`. This migration:
--
--   1. enables pg_net (best effort; NOTICE if it cannot be created) and
--      revokes EXECUTE on pg_net's SECURITY DEFINER entry points
--      (net.http_get / net.http_post / ...) from PUBLIC, anon and
--      authenticated, wherever the migration role holds those grants.
--      LIMITATION: on Supabase the extension is created by supabase_admin,
--      which also issues the anon/authenticated grants; postgres has no
--      grant option on them, so the REVOKE is a no-op there (verified on the
--      local image) and the self-check below NOTICEs. What keeps them
--      unreachable is that `net` is not an exposed API schema;
--      scheduler.test.sql asserts that, and that no grant postgres could
--      revoke is left. Caveat: `ALTER EXTENSION pg_net UPDATE` re-runs
--      Supabase's grant trigger.
--      The migration NOTICEs if any trigger calls
--      supabase_functions.http_request (Database Webhooks run as the
--      inserting user and would need those grants).
--   2. adds private.invoke_edge_function(fn, body): SECURITY DEFINER,
--      search_path pinned, owner-only (postgres; pg_cron runs the jobs as
--      postgres, so no other role needs EXECUTE). It reads the Vault secrets
--      `edge_cron_secret` and `project_url` and POSTs to
--      <project_url>/functions/v1/<fn> with header `x-cron-secret`.
--      project_url must be https:// (http:// only for local hosts:
--      localhost, 127.0.0.1, [::1], kong, supabase_kong_*), so the secret is
--      never sent in clear text. If Vault, pg_net, either secret or a valid
--      URL is missing it RAISEs NOTICE and returns NULL, so a clean apply
--      (CI, local) and a prod apply before Operator Action 7 both succeed and
--      the job is a harmless no-op. pg_net's timeout is 400 s, the paid Edge
--      wall-clock limit, so a long backlog pass is not recorded as a timeout.
--   3. adds a stopgap BEFORE INSERT trigger on sync_queue for client inserts
--      (roles anon/authenticated; service role and postgres are untouched):
--      forces created_at = now(), status = 'pending', started_at /
--      completed_at / error_message = NULL, retry_count = 0, sync_type in
--      (initial, incremental, manual), and rejects (SQLSTATE 23505,
--      'sync_already_queued', i.e. HTTP 409) a new row when the same
--      (user_id, provider, sync_type class) already has a pending or
--      processing row. Class = initial vs everything else, the shape of
--      PR 52's planned unique index, which will replace this check.
--   4. triages the stale backlog BEFORE scheduling (R-8) through a one-time
--      function that the migration calls and then DROPS (it must never run
--      against a live queue). Each pending row gets exactly one outcome,
--      computed by the classifier also shipped read-only for the operator in
--      scripts/ci/sync-queue-triage/dry_run.sql:
--        a. not dispatchable -> `failed`, with the reason. Mirrors what
--           process-sync-queue + the provider function would do:
--             provider_not_queueable     provider not strava/fitbit/hevy/
--                                        liftosaur (garmin is webhook-only)
--             integration_not_connected  strava/fitbit: user_integrations
--                                        .status <> 'connected' or no
--                                        oauth_tokens row; hevy/liftosaur:
--                                        no stored api_key (their sync
--                                        ignores integration status, so an
--                                        `error` integration still runs)
--             subscription_required      no active/trialing FLAME+ plan with
--                                        current_period_end in the future
--        b. per (user_id, provider, class initial|other) keep only the newest
--           row (created_at DESC NULLS LAST, id DESC); older ones in the same
--           class -> `superseded`. So a pair keeps at most one `initial` and
--           one incremental/manual row (the orchestrator's "newest row plus
--           newest initial", keeping the newest non-initial too so its
--           since-watermark window is never dropped).
--        c. the kept non-initial row older than 14 days (or with a NULL
--           created_at; the column is nullable) -> `superseded`; the kept
--           `initial` always stays, so its history import still runs.
--      Terminal rows get completed_at = now() (the Edge convention).
--      sync_queue.status has no CHECK constraint, so `superseded` needs no
--      constraint change (SyncStatus.tsx counts only pending/processing).
--      process-sync-queue runs a pair's rows oldest-first, one at a time
--      (never while another row of the pair is processing or after a
--      retryable failure in the same pass). An `initial` never moves an
--      existing last_sync_at (_shared/syncWatermark.ts), so a kept stale
--      initial cannot open a gap in imported activities.
--   5. schedules, through private.schedule_sync_queue_jobs() (owner-only,
--      idempotent: lookup by jobname -> cron.schedule if absent,
--      cron.alter_job in place if schedule/command differ, keeping jobid and
--      the active flag; PR 2's pattern):
--        - process-sync-queue              */5 * * * *
--        - sync-tombstones-retention       daily, tombstones > 180 days
--        - cron-job-run-details-retention  daily, run history > 7 days
--          (prod has no purge; the 5-minute job adds 288 rows/day)
--      Skipped with a NOTICE where pg_cron is not installed (local/CI apply;
--      prod has it). scheduler.test.sql installs pg_cron in its own
--      transaction and asserts the jobs, so CI exercises this path.
--
-- The Edge receiver keeps its constant-time x-cron-secret compare
-- (_shared/cronSecret.ts). It reads CRON_SECRET first; the legacy names
-- PROCESS_SYNC_QUEUE_SECRET / CRON_SYNC_QUEUE_SECRET are consulted only when
-- CRON_SECRET is unset (once it is set, a caller holding a different legacy
-- value gets 401). verify_jwt is false for process-sync-queue in config.toml.
--
-- Operator (Action 7):
--   BEFORE applying: run scripts/ci/sync-queue-triage/dry_run.sql (read-only)
--   and record its per-outcome counts in the PR. The buckets are disjoint and
--   are exactly what this migration will do (CI checks this on a seeded
--   backlog). Confirm the API's exposed schemas exclude `net` and `private`
--   and that no Database Webhooks exist (they need net.http_post for the
--   inserting user).
--   AFTER setting the Vault secrets and CRON_SECRET, check each call:
--     SELECT id, status_code, timed_out, error_msg, created
--     FROM net._http_response ORDER BY created DESC LIMIT 20;
--   200 = pass ran (body has processed/failed/skipped); 401 = Vault
--   edge_cron_secret and Edge CRON_SECRET differ; timed_out = the pass ran
--   past 400 s (confirm on the first live pass that the handler is not
--   aborted when pg_net disconnects: claimed rows would then wait out the
--   30-minute lease); no new rows while cron.job_run_details says
--   `succeeded` = Vault secret, project_url or pg_net missing (the NOTICE is
--   in the Postgres log). Then
--     SELECT status, count(*) FROM public.sync_queue GROUP BY 1;
--
-- Idempotent: safe to re-run (triage only touches `pending` rows; jobs are
-- looked up by name; the trigger and grants are re-issued).

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. pg_net, and close its browser-role grants.
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

DO $$
DECLARE
  f regprocedure;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN;
  END IF;

  FOR f IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net' AND p.prosecdef
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'could not revoke EXECUTE on % (%)', f, SQLERRM;
    END;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'supabase_functions' AND p.proname = 'http_request'
  ) THEN
    RAISE NOTICE 'Database Webhooks (supabase_functions.http_request triggers) exist; they run as the inserting user and now lack EXECUTE on net.http_post';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Schema `private` (PR 2 created it; keep its revokes) and the invoker.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

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

  -- Never send the secret in clear text: https only, except local stacks.
  IF NOT (
    v_url ~* '^https://[^/?#@\s]+(/|$)'
    OR v_url ~* '^http://(localhost|127\.0\.0\.1|\[::1\]|kong|supabase_kong_[a-z0-9_.-]+)(:[0-9]+)?(/|$)'
  ) THEN
    RAISE NOTICE 'invoke_edge_function(%): project_url must be https:// (http:// only for local hosts); skipped', fn;
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := pg_catalog.rtrim(v_url, '/') || '/functions/v1/' || fn,
    body := coalesce(body, '{}'::jsonb),
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    -- The Edge wall-clock limit (paid plans). A backlog pass can legitimately
    -- run minutes; a shorter timeout would record successful passes as
    -- failures in net._http_response.
    timeout_milliseconds := 400000
  ) INTO v_request_id;

  RETURN v_request_id;
END
$fn$;

REVOKE ALL ON FUNCTION private.invoke_edge_function(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Stopgap guard on client inserts into sync_queue (R-16). PR 52's unique
--    index replaces the duplicate check.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.sync_queue_guard_client_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
BEGIN
  -- Only browser roles are clamped; the service role (Edge Functions) and
  -- postgres (migrations, cron) insert as they need to.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  NEW.created_at := now();
  NEW.status := 'pending';
  NEW.started_at := NULL;
  NEW.completed_at := NULL;
  NEW.error_message := NULL;
  NEW.retry_count := 0;
  NEW.sync_type := coalesce(NEW.sync_type, 'incremental');

  IF NEW.sync_type NOT IN ('initial', 'incremental', 'manual') THEN
    RAISE EXCEPTION 'invalid sync_type %', NEW.sync_type USING ERRCODE = '22023';
  END IF;

  -- Serialize concurrent inserts for the same pair so the check below holds.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.user_id::text || ':' || NEW.provider, 31)
  );

  IF EXISTS (
    SELECT 1 FROM public.sync_queue q
    WHERE q.user_id = NEW.user_id
      AND q.provider = NEW.provider
      AND q.status IN ('pending', 'processing')
      AND (q.sync_type IS NOT DISTINCT FROM 'initial') = (NEW.sync_type = 'initial')
  ) THEN
    RAISE EXCEPTION 'sync_already_queued'
      USING ERRCODE = '23505',
            DETAIL = 'A sync of this kind is already queued or running for this provider.';
  END IF;

  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION private.sync_queue_guard_client_insert()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.sync_queue'::regclass
      AND tgname = 'sync_queue_guard_client_insert'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER sync_queue_guard_client_insert
      BEFORE INSERT ON public.sync_queue
      FOR EACH ROW EXECUTE FUNCTION private.sync_queue_guard_client_insert();
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. One-time backlog triage (R-8), then dropped. The classifier below is
--    kept identical to scripts/ci/sync-queue-triage/dry_run.sql (CI compares
--    the dry run's counts with this function's outcome on a seeded backlog).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.triage_sync_queue_backlog()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_counts jsonb;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.sync_queue_triage_plan (
    id uuid PRIMARY KEY,
    outcome text NOT NULL,
    reason text
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.sync_queue_triage_plan;

  INSERT INTO pg_temp.sync_queue_triage_plan (id, outcome, reason)
  WITH pending AS (
    SELECT
      q.id, q.user_id, q.provider, q.sync_type, q.created_at,
      CASE
        WHEN q.provider NOT IN ('strava', 'fitbit', 'hevy', 'liftosaur')
          THEN 'provider_not_queueable'
        WHEN q.provider IN ('strava', 'fitbit') AND NOT (
          EXISTS (SELECT 1 FROM public.user_integrations i
                  WHERE i.user_id = q.user_id AND i.provider = q.provider
                    AND i.status = 'connected')
          AND EXISTS (SELECT 1 FROM public.oauth_tokens t
                      WHERE t.user_id = q.user_id AND t.provider = q.provider)
        ) THEN 'integration_not_connected'
        WHEN q.provider IN ('hevy', 'liftosaur') AND NOT EXISTS (
          SELECT 1 FROM public.oauth_tokens t
          WHERE t.user_id = q.user_id AND t.provider = q.provider
            AND coalesce(t.api_key, '') <> ''
        ) THEN 'integration_not_connected'
        WHEN NOT EXISTS (
          SELECT 1 FROM public.subscriptions s
          WHERE s.user_id = q.user_id
            AND s.tier IN ('FLAME', 'INFERNO')
            AND s.status IN ('active', 'trialing')
            AND s.current_period_end > now()
        ) THEN 'subscription_required'
      END AS fail_reason
    FROM public.sync_queue q
    WHERE q.status = 'pending'
  ),
  ranked AS (
    SELECT
      p.*,
      (p.sync_type IS NOT DISTINCT FROM 'initial') AS is_initial,
      row_number() OVER (
        PARTITION BY p.user_id, p.provider, (p.sync_type IS NOT DISTINCT FROM 'initial')
        ORDER BY p.created_at DESC NULLS LAST, p.id DESC
      ) AS rn_class
    FROM pending p
    WHERE p.fail_reason IS NULL
  )
  SELECT id, 'failed', fail_reason FROM pending WHERE fail_reason IS NOT NULL
  UNION ALL
  SELECT id,
         CASE
           WHEN rn_class > 1 THEN 'superseded_duplicate'
           WHEN NOT is_initial
                AND (created_at IS NULL OR created_at < now() - interval '14 days')
             THEN 'superseded_stale'
           ELSE 'kept'
         END,
         NULL
  FROM ranked;

  UPDATE public.sync_queue q
  SET status = CASE WHEN p.outcome = 'failed' THEN 'failed' ELSE 'superseded' END,
      error_message = CASE WHEN p.outcome = 'failed' THEN p.reason ELSE q.error_message END,
      completed_at = now()
  FROM pg_temp.sync_queue_triage_plan p
  WHERE q.id = p.id
    AND p.outcome <> 'kept'
    AND q.status = 'pending';

  SELECT coalesce(jsonb_object_agg(outcome, n), '{}'::jsonb) INTO v_counts
  FROM (
    SELECT outcome, count(*) AS n
    FROM pg_temp.sync_queue_triage_plan
    GROUP BY outcome
  ) c;

  RAISE NOTICE 'sync_queue triage: %', v_counts;
  RETURN v_counts;
END
$fn$;

REVOKE ALL ON FUNCTION private.triage_sync_queue_backlog()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT private.triage_sync_queue_backlog();

-- One-time: never leave a function that would supersede live rows lying
-- around. Re-applying the migration re-creates, runs and drops it.
DROP FUNCTION private.triage_sync_queue_backlog();

-- ---------------------------------------------------------------------------
-- 5. pg_cron jobs (after triage). Owner-only, idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.schedule_sync_queue_jobs()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  j record;
  v_jobid bigint;
  v_schedule text;
  v_command text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skip scheduling process-sync-queue and retention jobs';
    RETURN;
  END IF;

  FOR j IN
    SELECT *
    FROM (VALUES
      ('process-sync-queue', '*/5 * * * *',
       'SELECT private.invoke_edge_function(''process-sync-queue'', ''{}''::jsonb)'),
      ('sync-tombstones-retention', '23 3 * * *',
       'DELETE FROM public.sync_tombstones WHERE deleted_at < now() - interval ''180 days'''),
      ('cron-job-run-details-retention', '41 3 * * *',
       'DELETE FROM cron.job_run_details WHERE end_time < now() - interval ''7 days''')
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
$fn$;

REVOKE ALL ON FUNCTION private.schedule_sync_queue_jobs()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT private.schedule_sync_queue_jobs();

-- ---------------------------------------------------------------------------
-- 6. Self-check.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_offenders text;
BEGIN
  SELECT string_agg(format('%s/%s', p.oid::regprocedure, r.rolname), ', ')
  INTO v_offenders
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
  WHERE n.nspname = 'private'
    AND p.proname IN ('invoke_edge_function', 'sync_queue_guard_client_insert',
                      'schedule_sync_queue_jobs')
    AND has_function_privilege(r.rolname, p.oid, 'EXECUTE');

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'scheduler: private functions are executable by %', v_offenders
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    SELECT string_agg(format('%s/%s', p.oid::regprocedure, r.rolname), ', ')
    INTO v_offenders
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
    WHERE n.nspname = 'net' AND p.prosecdef
      AND has_function_privilege(r.rolname, p.oid, 'EXECUTE');
    IF v_offenders IS NOT NULL THEN
      RAISE NOTICE 'scheduler: pg_net definers still executable by % (platform grants by the extension owner; not revocable by this role; `net` must stay unexposed)', v_offenders;
    END IF;
  END IF;
END
$$;

COMMIT;
