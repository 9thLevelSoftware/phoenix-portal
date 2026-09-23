-- Pause an already-installed process-sync-queue job while the owned-row
-- provider handlers from this release are being deployed.
--
-- PR 31 initially scheduled the job active. On databases where that migration
-- has already been recorded, changing its CREATE path cannot protect the
-- deployment window. This one-time release gate pauses the existing job. The
-- marker makes this migration safe to re-run after an operator has activated
-- the compatible handlers: a re-apply preserves that activation.

BEGIN;

CREATE TABLE IF NOT EXISTS private.scheduler_release_gates (
  jobname text PRIMARY KEY,
  gated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE private.scheduler_release_gates
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  v_first_apply boolean := false;
  v_jobid bigint;
BEGIN
  INSERT INTO private.scheduler_release_gates (jobname)
  VALUES ('process-sync-queue-owned-row-v1')
  ON CONFLICT (jobname) DO NOTHING
  RETURNING true INTO v_first_apply;

  IF NOT coalesce(v_first_apply, false) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron'
  ) OR to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron not installed; process-sync-queue will be created inactive by private.schedule_sync_queue_jobs()';
    RETURN;
  END IF;

  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'process-sync-queue';

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(v_jobid, active := false);
    RAISE NOTICE 'process-sync-queue paused for owned-row provider handler deployment; activate jobid % after handlers deploy', v_jobid;
  END IF;
END
$$;

COMMIT;
