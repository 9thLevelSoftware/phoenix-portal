-- A provider sync run saves its user_integrations state (status, watermark,
-- backfill cursor) only while it still owns its sync_queue row, in ONE
-- statement sequence under the row lock. A separate "is my row still
-- processing?" check followed by an UPDATE left a window in which a
-- disconnect (which cancels the row) or a lease reclaim could land, and the
-- stale run then marked a disconnected integration connected again.
--
-- The integration row and then the queue row are locked FOR UPDATE (the
-- order disconnect_integration uses), so a concurrent cancel/reclaim waits
-- for this transaction or has already committed (and then the row is not
-- `processing`). A run without a queue row (p_queue_id NULL) always saves.
-- Only the listed state keys are written; any other key is ignored.
-- Returns false, writing nothing, when the row is no longer this run's.
--
-- SECURITY INVOKER, service_role only (the Edge admin client).
-- Idempotent: safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.save_sync_state_if_queue_owned(
  p_user_id UUID,
  p_provider TEXT,
  p_queue_id UUID,
  p_state JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL OR p_provider IS NULL OR p_state IS NULL
     OR jsonb_typeof(p_state) <> 'object' THEN
    RAISE EXCEPTION 'save_sync_state_if_queue_owned: user, provider and a state object are required'
      USING ERRCODE = '22023';
  END IF;

  -- Lock order matches disconnect_integration (user_integrations, then
  -- sync_queue), so a concurrent disconnect and save cannot deadlock.
  PERFORM 1 FROM public.user_integrations i
    WHERE i.user_id = p_user_id AND i.provider = p_provider
    FOR UPDATE;

  IF p_queue_id IS NOT NULL THEN
    PERFORM 1
      FROM public.sync_queue q
     WHERE q.id = p_queue_id
       AND q.user_id = p_user_id
       AND q.provider = p_provider
       AND q.status = 'processing'
       FOR UPDATE;
    IF NOT FOUND THEN
      RETURN FALSE;
    END IF;
  END IF;

  UPDATE public.user_integrations i SET
    status = CASE WHEN p_state ? 'status' THEN p_state ->> 'status' ELSE i.status END,
    error_message = CASE WHEN p_state ? 'error_message' THEN p_state ->> 'error_message' ELSE i.error_message END,
    last_sync_at = CASE WHEN p_state ? 'last_sync_at' THEN (p_state ->> 'last_sync_at')::TIMESTAMPTZ ELSE i.last_sync_at END,
    backfill_before = CASE WHEN p_state ? 'backfill_before' THEN (p_state ->> 'backfill_before')::TIMESTAMPTZ ELSE i.backfill_before END,
    backfill_after = CASE WHEN p_state ? 'backfill_after' THEN (p_state ->> 'backfill_after')::TIMESTAMPTZ ELSE i.backfill_after END,
    backfill_started_at = CASE WHEN p_state ? 'backfill_started_at' THEN (p_state ->> 'backfill_started_at')::TIMESTAMPTZ ELSE i.backfill_started_at END
  WHERE i.user_id = p_user_id AND i.provider = p_provider;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.save_sync_state_if_queue_owned(UUID, TEXT, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_sync_state_if_queue_owned(UUID, TEXT, UUID, JSONB)
  TO service_role;

COMMENT ON FUNCTION public.save_sync_state_if_queue_owned(UUID, TEXT, UUID, JSONB) IS
  'Provider sync: write user_integrations sync state only while the run still owns its processing sync_queue row (row-locked). false = not owned, nothing written. Service role only.';

COMMIT;
