-- KD-11 (PR 35): run due account deletions on a schedule.
--
-- Until now nothing executed a deletion request when its 30-day grace period
-- ended; only the user's own "Delete now" click did. This migration:
--
--   1. extends deletion_requests for an atomic claim (R-29):
--        - status CHECK gains 'executing'. Both executors (the hourly
--          `process_due` pass and the user's "Delete now") move a row
--          pending -> executing with a conditional UPDATE before any side
--          effect, so a user cancel (RLS: USING status = 'pending') cannot
--          race an execution and two runs never process one row. A failed
--          purge puts the row back to 'pending'.
--        - claimed_at timestamptz: when the claim was taken. `process_due`
--          reclaims 'executing' rows whose claim is older than 15 minutes
--          (a crashed run); every purge step is idempotent.
--        - needs_support_reason text: set when a purge stops for a reason
--          only support can resolve (Paddle has no record of a live local
--          subscription: `billing_subscription_not_found`). The row stays
--          'pending' so the user still sees it and can cancel, but
--          `process_due` skips it instead of retrying every hour. Support
--          clears the column to let the next run retry.
--        - legacy 'executed' rows are put back to 'pending'. PR 34's claim
--          wrote 'executed' and a crash mid-purge left it there; the row
--          normally cascades away with the user, so a surviving 'executed'
--          row is almost always a live account that could neither retry nor
--          cancel. (From now on the handler writes 'executed' only when a
--          purge succeeded but the row survived, alerting
--          request_survived_purge; if a re-apply flips such a row back, the
--          next run purges an already-gone user, which is a no-op, and
--          closes it again.)
--   2. adds public.sweep_deleted_account_residue() (definer, service_role
--      only; `process_due` calls it every run): deletes rows of the FK-less
--      tables subscription_events, sync_tombstones, rate_limit_tracking and
--      paddle_webhook_events whose non-null user_id has no auth.users row
--      (plus webhook rows with a NULL user_id whose checkout custom data
--      names a missing user: the payload match purgeUser also uses),
--      and returns the avatars/<uuid>/ folders of missing users for the
--      handler to remove through the Storage API. This is the durable retry
--      for a failed post-delete sweep (PR 34 residualTables) and catches the
--      late subscription.canceled webhook row the immediate cancel triggers.
--      It never matches by paddle_customer_id (customers are email-keyed and
--      shared between accounts) or by paddle_subscription_id.
--   3. schedules `delete-due-accounts` hourly through
--      private.invoke_edge_function('delete-account', {"mode":"process_due"})
--      (PR 31's owner-only invoker and schedule-or-alter pattern). Skipped
--      with a NOTICE where pg_cron is not installed (local/CI apply).
--
-- The Edge receiver authenticates `process_due` with x-cron-secret against
-- CRON_SECRET (_shared/cronSecret.ts, constant-time). config.toml sets
-- verify_jwt = false for delete-account; "Delete now" verifies the user JWT
-- in the handler (auth.getUser()).
--
-- DEPLOY ORDER: apply this migration BEFORE deploying the delete-account
-- Edge Function: the new handler writes status 'executing' and claimed_at,
-- which the old CHECK rejects.
--
-- Operator (Action 7), BEFORE setting the Vault secrets / CRON_SECRET, run
-- this read-only preview and review every row: the first hourly run
-- executes all of them (oldest first, 10 per run).
--   SELECT id, user_id, status, requested_at, scheduled_for, claimed_at,
--          needs_support_reason
--   FROM public.deletion_requests
--   WHERE status IN ('pending', 'executing', 'executed')
--     AND scheduled_for <= now()
--   ORDER BY scheduled_for;
-- AFTER setting the secrets:
--   SELECT status, return_message, start_time FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'delete-due-accounts')
--   ORDER BY start_time DESC LIMIT 5;
--   SELECT id, status_code, timed_out, error_msg, created
--   FROM net._http_response ORDER BY created DESC LIMIT 20;
-- 200 = pass ran (body: purged/failed/reclaimed/swept); 401 = Vault
-- edge_cron_secret and Edge CRON_SECRET differ (or verify_jwt is still on).
-- Alerts ([DELETION_ALERT] in Edge logs; PR 68 runbook):
--   SELECT user_id, status, scheduled_for, claimed_at, needs_support_reason
--   FROM public.deletion_requests
--   WHERE status IN ('pending', 'executing')
--     AND scheduled_for < now() - interval '2 days';
--
-- Idempotent: safe to re-run.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. deletion_requests: 'executing' claim, claimed_at, needs_support_reason.
-- ---------------------------------------------------------------------------
ALTER TABLE public.deletion_requests
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.deletion_requests
  ADD COLUMN IF NOT EXISTS needs_support_reason text;

-- The original CHECK is an unnamed column constraint (auto-named, so its
-- name is looked up rather than assumed).
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.deletion_requests'::regclass
      AND contype = 'c'
      AND conname <> 'deletion_requests_status_valid'
      AND pg_get_constraintdef(oid) ~ '\mstatus\M'
      AND pg_get_constraintdef(oid) !~ 'scheduled_for'
  LOOP
    EXECUTE format('ALTER TABLE public.deletion_requests DROP CONSTRAINT %I', c.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.deletion_requests'::regclass
      AND conname = 'deletion_requests_status_valid'
  ) THEN
    ALTER TABLE public.deletion_requests
      ADD CONSTRAINT deletion_requests_status_valid
      CHECK (status IN ('pending', 'executing', 'cancelled', 'executed'));
  END IF;
END
$$;

-- Legacy 'executed' claims (PR 34) of accounts that still exist.
UPDATE public.deletion_requests
SET status = 'pending', executed_at = NULL, claimed_at = NULL
WHERE status = 'executed';

CREATE INDEX IF NOT EXISTS deletion_requests_due_idx
  ON public.deletion_requests (scheduled_for)
  WHERE status IN ('pending', 'executing');

-- ---------------------------------------------------------------------------
-- 2. Residue sweep for deleted accounts (service_role only).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sweep_deleted_account_residue(p_avatar_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_table text;
  v_count bigint;
  v_deleted jsonb := '{}'::jsonb;
  v_folders jsonb := '[]'::jsonb;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'subscription_events', 'sync_tombstones', 'rate_limit_tracking', 'paddle_webhook_events'
  ]
  LOOP
    -- Prod-only tables may be absent on a local stack.
    IF to_regclass(format('public.%I', v_table)) IS NULL OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_table
        AND column_name = 'user_id' AND data_type = 'uuid'
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'DELETE FROM public.%I t WHERE t.user_id IS NOT NULL '
      'AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.user_id)',
      v_table
    );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object(v_table, v_count);
  END LOOP;

  -- Webhook rows that name the user only in the checkout custom data (the
  -- same user-id match purgeUser uses; never customer or subscription ids).
  IF to_regclass('public.paddle_webhook_events') IS NOT NULL AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'paddle_webhook_events'
      AND column_name = 'payload' AND data_type = 'jsonb'
  ) THEN
    EXECUTE
      'DELETE FROM public.paddle_webhook_events t '
      'WHERE t.user_id IS NULL '
      'AND (t.payload->''data''->''custom_data''->>''user_id'') '
      '  ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'' '
      'AND NOT EXISTS (SELECT 1 FROM auth.users u '
      '  WHERE u.id = (t.payload->''data''->''custom_data''->>''user_id'')::uuid)';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('paddle_webhook_events:payload_user_id', v_count);
  END IF;

  IF to_regclass('storage.objects') IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(f.folder ORDER BY f.folder), '[]'::jsonb)
    INTO v_folders
    FROM (
      SELECT DISTINCT pg_catalog.split_part(o.name, '/', 1) AS folder
      FROM storage.objects o
      WHERE o.bucket_id = 'avatars'
        AND pg_catalog.split_part(o.name, '/', 1)
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND NOT EXISTS (
          SELECT 1 FROM auth.users u
          WHERE u.id = pg_catalog.split_part(o.name, '/', 1)::uuid
        )
      ORDER BY 1
      LIMIT greatest(coalesce(p_avatar_limit, 100), 0)
    ) f;
  END IF;

  RETURN jsonb_build_object('deleted', v_deleted, 'orphan_avatar_folders', v_folders);
END
$fn$;

REVOKE ALL ON FUNCTION public.sweep_deleted_account_residue(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_deleted_account_residue(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. pg_cron job (owner-only, idempotent: schedule if absent, alter in place
--    if the schedule or command differ, keeping jobid and the active flag).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.schedule_due_deletion_job()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_jobname constant text := 'delete-due-accounts';
  v_schedule_want constant text := '17 * * * *';
  v_command_want constant text :=
    'SELECT private.invoke_edge_function(''delete-account'', ''{"mode":"process_due"}''::jsonb)';
  v_jobid bigint;
  v_schedule text;
  v_command text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skip scheduling delete-due-accounts';
    RETURN;
  END IF;

  EXECUTE 'SELECT jobid, schedule, command FROM cron.job WHERE jobname = $1 ORDER BY jobid LIMIT 1'
    INTO v_jobid, v_schedule, v_command
    USING v_jobname;

  IF v_jobid IS NULL THEN
    PERFORM cron.schedule(v_jobname, v_schedule_want, v_command_want);
  ELSIF v_schedule IS DISTINCT FROM v_schedule_want OR v_command IS DISTINCT FROM v_command_want THEN
    PERFORM cron.alter_job(v_jobid, schedule := v_schedule_want, command := v_command_want);
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION private.schedule_due_deletion_job()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT private.schedule_due_deletion_job();

-- ---------------------------------------------------------------------------
-- 4. Self-check.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_offenders text;
BEGIN
  SELECT string_agg(r.rolname, ', ')
  INTO v_offenders
  FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
  WHERE has_function_privilege(
    r.rolname, 'public.sweep_deleted_account_residue(integer)'::regprocedure, 'EXECUTE'
  );
  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'sweep_deleted_account_residue is executable by %', v_offenders
      USING ERRCODE = '42501';
  END IF;

  SELECT string_agg(r.rolname, ', ')
  INTO v_offenders
  FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
  WHERE has_function_privilege(
    r.rolname, 'private.schedule_due_deletion_job()'::regprocedure, 'EXECUTE'
  );
  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'private.schedule_due_deletion_job is executable by %', v_offenders
      USING ERRCODE = '42501';
  END IF;
END
$$;

COMMIT;
