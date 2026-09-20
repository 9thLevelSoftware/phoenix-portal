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
--          reclaims 'executing' rows whose claim is older than 15 minutes, or
--          that carry no claimed_at at all (a support fix or a partial write
--          would otherwise be invisible to both the reclaim and the due
--          query). Every purge step is idempotent, so re-running one is safe.
--          The release and the close are fenced on the claimed_at they took,
--          so a run that lost its claim cannot flip the winner's row.
--        - needs_support_reason text: set when a purge stops for a reason
--          only support can resolve. The row stays 'pending' so the user
--          still sees it and can cancel, but `process_due` skips it instead
--          of retrying every hour, and the hourly alert names it
--          `needs_support_overdue` rather than the generic `overdue`.
--          Support clears the column to let the next run retry:
--            UPDATE public.deletion_requests SET needs_support_reason = NULL
--            WHERE user_id = '<uuid>';
--          Reasons:
--            billing_subscription_not_found — Paddle has no record of a live
--              local subscription; deleting would risk billing the user on.
--            request_survived_purge — the purge reported success but this row
--              still exists. deletion_requests.user_id is ON DELETE CASCADE
--              (20260301_deletion_support.sql), so a surviving row means the
--              auth user was NOT deleted (admin deleteUser answered "not
--              found" for a live user). The account is therefore still there:
--              the row is parked 'pending' (never 'executed') so the erasure
--              stays visible, cancellable and on the operator's list.
--        - last_attempt_at timestamptz: stamped whenever a claim is released
--          after a failed purge. The due query orders by it NULLS FIRST, so a
--          row that keeps failing drops behind every never-attempted row and
--          cannot occupy a batch slot for ever (head-of-line blocking).
--        - legacy 'executed' rows are put back to 'pending'. PR 34's claim
--          wrote 'executed' and a crash mid-purge left it there; the row
--          normally cascades away with the user, so a surviving 'executed'
--          row is almost always a live account that could neither retry nor
--          cancel. Nothing writes 'executed' any more; the value stays in the
--          CHECK for historical rows and for PR 32's `already_executing`
--          branch.
--   2. adds public.sweep_deleted_account_residue() (definer, service_role
--      only; `process_due` calls it every run): deletes rows of the FK-less
--      tables subscription_events, sync_tombstones, rate_limit_tracking and
--      paddle_webhook_events whose non-null user_id has no auth.users row,
--      and returns the avatars/<uuid>/ folders of missing users for the
--      handler to remove through the Storage API. This is the durable retry
--      for a failed post-delete sweep (PR 34 residualTables) and catches the
--      late subscription.canceled webhook row the immediate cancel triggers.
--      It never matches by paddle_customer_id (customers are email-keyed and
--      shared between accounts), never by paddle_subscription_id, and never
--      by the checkout custom data in the payload: custom_data is supplied by
--      the client, so an event whose custom_data names a user that never
--      existed is a support/fraud artefact, not residue (purgeUser still
--      matches the payload, but only for one named user it is erasing).
--      Each table is swept in its own sub-block: a schema variance on one
--      table (missing column/table — the drift purgeUser's fallbackColumn
--      hedges against) is reported in `skipped` instead of rolling the whole
--      function back.
--   3. schedules `delete-due-accounts` hourly through
--      private.invoke_edge_function('delete-account', {"mode":"process_due"})
--      (PR 31's owner-only invoker and schedule-or-alter pattern). The job is
--      created INACTIVE (see Operator Action 7 below); a re-apply only
--      repairs a drifted schedule/command and never touches the active flag,
--      so it cannot pause a job the operator has started. Skipped with a
--      NOTICE where pg_cron is not installed (local/CI apply).
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
-- Operator (Action 7). The Vault secret `edge_cron_secret` / the Edge
-- CRON_SECRET is SHARED with PR 31's sync-queue job and is normally already
-- set by the time this migration lands, so "review before the secret is set"
-- would be no gate at all. The gate is the job's active flag instead: this
-- migration creates `delete-due-accounts` INACTIVE. Nothing is deleted on a
-- schedule until you activate it.
--   1. Apply this migration, then deploy the delete-account Edge Function.
--   2. Review every row this read-only preview returns — the first hourly run
--      executes all of them (oldest first, 10 per run), irreversibly:
--        SELECT id, user_id, status, requested_at, scheduled_for, claimed_at,
--               needs_support_reason, last_attempt_at
--        FROM public.deletion_requests
--        WHERE status IN ('pending', 'executing', 'executed')
--          AND scheduled_for <= now()
--        ORDER BY scheduled_for;
--   3. Activate the job:
--        SELECT cron.alter_job(
--          (SELECT jobid FROM cron.job WHERE jobname = 'delete-due-accounts'),
--          active := true
--        );
--      (To pause it again, the same statement with active := false.)
--   4. After the next :17, check the run:
--        SELECT status, return_message, start_time FROM cron.job_run_details
--        WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'delete-due-accounts')
--        ORDER BY start_time DESC LIMIT 5;
--        SELECT id, status_code, timed_out, error_msg, created
--        FROM net._http_response ORDER BY created DESC LIMIT 20;
--      200 = pass ran (body: counts only — purged/failed/failed_by_stage/
--      reclaimed/needs_support/overdue/needs_support_overdue/residue; the user
--      ids stay in the Edge logs so pg_net does not re-persist the identifiers
--      of accounts that were just erased). 401 = Vault edge_cron_secret and
--      Edge CRON_SECRET differ (or verify_jwt is still on).
-- Alerts ([DELETION_ALERT] in Edge logs; PR 68 runbook):
--   SELECT user_id, status, scheduled_for, claimed_at, needs_support_reason,
--          last_attempt_at
--   FROM public.deletion_requests
--   WHERE status IN ('pending', 'executing')
--     AND (scheduled_for < now() - interval '2 days'
--          OR needs_support_reason IS NOT NULL);
--
-- Idempotent: safe to re-run.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. deletion_requests: 'executing' claim, claimed_at, needs_support_reason,
--    last_attempt_at.
-- ---------------------------------------------------------------------------
ALTER TABLE public.deletion_requests
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.deletion_requests
  ADD COLUMN IF NOT EXISTS needs_support_reason text;
ALTER TABLE public.deletion_requests
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

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
  v_skipped jsonb := '[]'::jsonb;
  v_folders jsonb := '[]'::jsonb;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'subscription_events', 'sync_tombstones', 'rate_limit_tracking', 'paddle_webhook_events'
  ]
  LOOP
    -- Prod-only tables may be absent on a local stack, and prod may lack a
    -- column a local migration has. Neither may abort the other tables'
    -- deletes, so each table gets its own sub-transaction and a skip is
    -- reported rather than looking like a clean sweep.
    BEGIN
      IF pg_catalog.to_regclass(pg_catalog.format('public.%I', v_table)) IS NULL THEN
        v_skipped := v_skipped || pg_catalog.to_jsonb(v_table || ':missing_table');
        CONTINUE;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = v_table
          AND column_name = 'user_id' AND data_type = 'uuid'
      ) THEN
        v_skipped := v_skipped || pg_catalog.to_jsonb(v_table || ':no_uuid_user_id');
        CONTINUE;
      END IF;

      EXECUTE pg_catalog.format(
        'DELETE FROM public.%I t WHERE t.user_id IS NOT NULL '
        'AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.user_id)',
        v_table
      );
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_deleted := v_deleted || pg_catalog.jsonb_build_object(v_table, v_count);
    EXCEPTION
      WHEN undefined_column OR undefined_table OR insufficient_privilege THEN
        v_skipped := v_skipped || pg_catalog.to_jsonb(v_table || ':' || SQLSTATE);
    END;
  END LOOP;

  -- Webhook rows whose only link to a missing user is the checkout custom
  -- data are deliberately NOT swept: custom_data is client-supplied, so those
  -- rows are the ones support and fraud review need (see the header).

  IF pg_catalog.to_regclass('storage.objects') IS NOT NULL THEN
    SELECT coalesce(pg_catalog.jsonb_agg(f.folder ORDER BY f.folder), '[]'::jsonb)
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

  RETURN pg_catalog.jsonb_build_object(
    'deleted', v_deleted,
    'skipped', v_skipped,
    'orphan_avatar_folders', v_folders
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.sweep_deleted_account_residue(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_deleted_account_residue(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. pg_cron job (owner-only, idempotent: schedule if absent — INACTIVE, so
--    the operator reviews the overdue preview and then activates it — or
--    alter in place if the schedule or command differ, keeping jobid and the
--    active flag so a re-apply never pauses a running job).
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
    -- First creation only: the job exists but does nothing until the operator
    -- has reviewed the overdue preview (Operator Action 7) and activated it.
    v_jobid := cron.schedule(v_jobname, v_schedule_want, v_command_want);
    PERFORM cron.alter_job(v_jobid, active := false);
    RAISE NOTICE
      'delete-due-accounts scheduled INACTIVE; activate with cron.alter_job(%, active := true)',
      v_jobid;
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
