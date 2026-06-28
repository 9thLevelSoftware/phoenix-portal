-- F311 + F303: fold two multi-statement edge-function writes into single
-- transactions so a mid-way failure cannot leave a partial/empty state.
--
-- Both RPCs are SECURITY DEFINER and service_role-only: generate-insights and
-- disconnect-integration already perform these writes with the service-role
-- client (bypassing RLS) after verifying the caller's identity, so the RPCs
-- replace those raw statements with an atomic equivalent.

-- F311: generate-insights refreshed the cached user_insights for a (user,
-- period) by DELETE-then-INSERT in two separate statements. A failure after the
-- delete wiped the user's cached insights until the next regeneration. This RPC
-- performs the delete + insert in one transaction.
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
       metric_name, metric_value, metric_unit, metric_delta, period)
    SELECT p_user_id, insight_type, title, description, recommendation,
           metric_name, metric_value, metric_unit, metric_delta, p_period
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

-- F303: disconnect-integration ran the token delete, integration-state update,
-- and sync-queue update concurrently (Promise.all) outside any transaction, so
-- a partial failure could strand the account (e.g. tokens deleted but the
-- integration still flagged connected). This RPC performs all three writes in
-- one transaction.
CREATE OR REPLACE FUNCTION public.disconnect_integration(
  p_user_id UUID,
  p_provider TEXT,
  p_timestamp TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.oauth_tokens
  WHERE user_id = p_user_id
    AND provider = p_provider;

  UPDATE public.user_integrations
  SET status = 'disconnected',
      connected_at = NULL,
      provider_user_id = NULL,
      error_message = NULL
  WHERE user_id = p_user_id
    AND provider = p_provider;

  UPDATE public.sync_queue
  SET status = 'failed',
      error_message = 'Integration disconnected by user',
      completed_at = p_timestamp
  WHERE user_id = p_user_id
    AND provider = p_provider
    AND status IN ('pending', 'processing');
END;
$$;

REVOKE ALL ON FUNCTION public.replace_user_insights(UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_user_insights(UUID, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.replace_user_insights(UUID, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.replace_user_insights(UUID, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.disconnect_integration(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disconnect_integration(UUID, TEXT, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.disconnect_integration(UUID, TEXT, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.disconnect_integration(UUID, TEXT, TIMESTAMPTZ) TO service_role;
