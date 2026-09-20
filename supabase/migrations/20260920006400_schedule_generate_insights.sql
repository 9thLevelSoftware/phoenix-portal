-- KD-14 (user decision 2026-09-18: schedule it, do not delete it).
--
-- Nothing has ever called `generate-insights` (F-042), so `user_insights` is
-- empty in prod and the Analytics feed has always fallen back to the browser
-- rules. This migration gives the function a scheduler and the portal a way
-- to tell a fresh server batch from a stale one:
--
--   1. public.replace_user_insights(uuid, text, jsonb) now stamps
--      `expires_at = now() + 36 hours` on every row it writes. Signature and
--      grants are unchanged (service_role only, as PR 1's lockdown set them);
--      this is a signature-preserving CREATE OR REPLACE starting from the
--      latest body, 20260628160000_atomic_insights_and_disconnect_rpcs.sql
--      (KD-3 rule 3a). The portal filters on `expires_at > now()`, so a batch
--      older than 36 h expires into the browser fallback instead of being
--      shown as if it were current. NOTE: rows written before this migration
--      have `expires_at IS NULL` and are therefore treated as expired — those
--      users see the local fallback until the first scheduled pass.
--
--   2. private.insights_batch_state: a one-row keyset cursor for the batch.
--      The cron command reads it; the Edge Function advances it through
--      public.set_insights_batch_cursor(uuid) (service_role only), because
--      `private` is not a PostgREST-exposed schema.
--
--   3. public.insights_batch_candidates(uuid, integer): the eligibility
--      predicate, in SQL so it cannot drift from the tier rules. A user is a
--      candidate when they have a workout_sessions row in the last 30 days
--      AND public.subscription_tier_for(user_id) (PR 8) is FLAME or INFERNO.
--      `public.user_subscription_tier()` cannot be used here: it reads
--      auth.uid(), which is NULL under the service role (R-19).
--      SECURITY INVOKER on purpose — service_role already has EXECUTE on
--      subscription_tier_for and bypasses RLS, so this adds no definer.
--
--   4. pg_cron job `generate-insights`, every 15 minutes, through
--      private.invoke_edge_function (PR 31 / KD-10), carrying
--      {mode:'batch', cursor:<state>}. Scheduling follows PR 31's and PR 35's
--      shape: look the job up by name, cron.schedule when absent,
--      cron.alter_job when the schedule or command has drifted, and NEVER
--      touch the `active` flag in either direction on a re-apply. Unlike
--      PR 35's job this one is not destructive, so it is created ACTIVE.
--      It no-ops without the Vault secrets (KD-10): invoke_edge_function
--      RAISEs a NOTICE and returns NULL, so applying this migration before
--      Operator Action 7 is harmless.
--
-- Idempotent: safe to re-run. Re-applying does not change the job's active
-- flag, does not reset the cursor, and re-issues every grant.
--
-- Operator (Operator Action 7 covers the shared Vault secret; this job needs
-- nothing beyond it):
--   After apply + the generate-insights Edge deploy, confirm the pass ran:
--     SELECT id, status_code, timed_out, error_msg, created
--     FROM net._http_response ORDER BY created DESC LIMIT 20;
--   200 = pass ran (body has processed/failed/nextCursor); 401 = the Vault
--   `edge_cron_secret` and the Edge `CRON_SECRET` differ. Then:
--     SELECT count(*) FROM public.user_insights WHERE expires_at > now();
--     SELECT * FROM private.insights_batch_state;
--   To pause the job without reverting anything:
--     SELECT cron.alter_job(
--       (SELECT jobid FROM cron.job WHERE jobname = 'generate-insights'),
--       active := false);

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. replace_user_insights stamps the 36-hour freshness window.
--    Body = 20260628160000's, plus expires_at. Signature unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.replace_user_insights(
  p_user_id UUID,
  p_period TEXT,
  p_rows JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inserted INT := 0;
BEGIN
  DELETE FROM public.user_insights
  WHERE user_id = p_user_id
    AND period = p_period;

  IF p_rows IS NOT NULL AND jsonb_array_length(p_rows) > 0 THEN
    INSERT INTO public.user_insights
      (user_id, insight_type, title, description, recommendation,
       metric_name, metric_value, metric_unit, metric_delta, period,
       expires_at)
    SELECT p_user_id, insight_type, title, description, recommendation,
           metric_name, metric_value, metric_unit, metric_delta, p_period,
           now() + interval '36 hours'
    FROM jsonb_to_recordset(p_rows) AS x(
      insight_type TEXT,
      title TEXT,
      description TEXT,
      recommendation TEXT,
      metric_name TEXT,
      metric_value NUMERIC,
      metric_unit TEXT,
      metric_delta NUMERIC
    );
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_user_insights(UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_user_insights(UUID, TEXT, JSONB)
  TO service_role;

COMMENT ON FUNCTION public.replace_user_insights(UUID, TEXT, JSONB) IS
  'Atomically replaces a user''s cached insights for one period and stamps expires_at = now() + 36h (KD-14). Service role only.';

-- ---------------------------------------------------------------------------
-- 2. Batch cursor state (private schema; PR 31 created it and revoked it).
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.insights_batch_state (
  -- Single row: the CHECK plus the primary key make a second row impossible.
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  next_cursor uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO private.insights_batch_state (id, next_cursor)
VALUES (true, NULL)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE private.insights_batch_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.insights_batch_state
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Cursor writer. DEFINER because `private` is unreachable for service_role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_insights_batch_cursor(p_cursor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO private.insights_batch_state (id, next_cursor, updated_at)
  VALUES (true, p_cursor, now())
  ON CONFLICT (id) DO UPDATE
    SET next_cursor = EXCLUDED.next_cursor,
        updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.set_insights_batch_cursor(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_insights_batch_cursor(uuid) TO service_role;

COMMENT ON FUNCTION public.set_insights_batch_cursor(uuid) IS
  'Advances (or wraps to NULL) the generate-insights batch cursor. Service role only (KD-14).';

-- ---------------------------------------------------------------------------
-- 4. Eligibility. FLAME+ AND active in the last 30 days, keyset-paged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insights_batch_candidates(
  p_cursor uuid DEFAULT NULL,
  p_limit integer DEFAULT 25
)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT s.user_id
  FROM public.workout_sessions s
  WHERE s.started_at >= now() - interval '30 days'
    AND (p_cursor IS NULL OR s.user_id > p_cursor)
  GROUP BY s.user_id
  HAVING public.subscription_tier_for(s.user_id) IN ('FLAME', 'INFERNO')
  ORDER BY s.user_id
  LIMIT greatest(1, least(coalesce(p_limit, 25), 200));
$$;

REVOKE ALL ON FUNCTION public.insights_batch_candidates(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insights_batch_candidates(uuid, integer)
  TO service_role;

COMMENT ON FUNCTION public.insights_batch_candidates(uuid, integer) IS
  'Next page of users eligible for a scheduled insights refresh: active in 30d and FLAME+ per subscription_tier_for (R-19). Service role only (KD-14).';

-- ---------------------------------------------------------------------------
-- 5. The pg_cron job. Created ACTIVE; a re-apply never flips `active`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.schedule_generate_insights_job()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  c_jobname CONSTANT text := 'generate-insights';
  c_schedule CONSTANT text := '*/15 * * * *';
  c_command CONSTANT text :=
    'SELECT private.invoke_edge_function(''generate-insights'', '
    || 'jsonb_build_object(''mode'', ''batch'', ''cursor'', '
    || '(SELECT next_cursor FROM private.insights_batch_state WHERE id)))';
  v_jobid bigint;
  v_schedule text;
  v_command text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skip scheduling %', c_jobname;
    RETURN;
  END IF;

  EXECUTE 'SELECT jobid, schedule, command FROM cron.job WHERE jobname = $1 ORDER BY jobid LIMIT 1'
    INTO v_jobid, v_schedule, v_command
    USING c_jobname;

  IF v_jobid IS NULL THEN
    -- First creation only. The job is not destructive (it refreshes a cache),
    -- so unlike PR 35's deletion job it starts active.
    PERFORM cron.schedule(c_jobname, c_schedule, c_command);
  ELSIF v_schedule IS DISTINCT FROM c_schedule OR v_command IS DISTINCT FROM c_command THEN
    -- Repair drift, keeping jobid AND whatever the operator set `active` to.
    PERFORM cron.alter_job(v_jobid, schedule := c_schedule, command := c_command);
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION private.schedule_generate_insights_job()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT private.schedule_generate_insights_job();

-- ---------------------------------------------------------------------------
-- 6. Self-check: nothing added here may be reachable from the browser.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_offenders text;
BEGIN
  SELECT string_agg(format('%s/%s', p.oid::regprocedure, r.rolname), ', ')
  INTO v_offenders
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
  WHERE (
      (n.nspname = 'public'
        AND p.proname IN ('replace_user_insights', 'set_insights_batch_cursor',
                          'insights_batch_candidates'))
      OR (n.nspname = 'private' AND p.proname = 'schedule_generate_insights_job')
    )
    AND has_function_privilege(r.rolname, p.oid, 'EXECUTE');

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'generate-insights schedule: functions executable by %', v_offenders
      USING ERRCODE = '42501';
  END IF;

  SELECT string_agg(format('%s/%s', 'private.insights_batch_state', r.rolname), ', ')
  INTO v_offenders
  FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
  WHERE has_table_privilege(r.rolname, 'private.insights_batch_state', 'SELECT')
     OR has_table_privilege(r.rolname, 'private.insights_batch_state', 'INSERT')
     OR has_table_privilege(r.rolname, 'private.insights_batch_state', 'UPDATE');

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'generate-insights schedule: batch state readable/writable by %', v_offenders
      USING ERRCODE = '42501';
  END IF;
END
$$;

COMMIT;
