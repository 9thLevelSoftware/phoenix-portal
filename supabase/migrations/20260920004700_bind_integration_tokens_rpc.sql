-- PR 47 (KD-13, part 1): atomic, identity-first binding of a provider account
-- to a portal account.
--
-- F-067: `strava-oauth` upserts `oauth_tokens` BEFORE it writes
-- `user_integrations.provider_user_id`, so when the provider account is already
-- bound to a different portal user the second write fails on
-- `idx_user_integrations_provider_user_id_unique` and a valid encrypted token
-- pair is left stored under the wrong account. This function does both writes in
-- one transaction, identity first, and refuses with `already_linked` (P0001)
-- when the provider account belongs to someone else — storing nothing at all.
--
-- Caller: the `complete-oauth` Edge Function, with the service-role key. The
-- function is NOT browser-callable (no EXECUTE for anon/authenticated), so it is
-- deliberately NOT part of the browser allow-list in
-- 20260920007600_reconcile_prod_schema_drift.sql; that migration's catalog loop
-- leaves it with exactly the grants set below.
--
-- Tokens arrive already encrypted (AES-GCM, supabase/functions/_shared/
-- oauthTokenCrypto.ts). This function never encrypts, decrypts, logs or returns
-- a token value.
--
-- Idempotent: CREATE OR REPLACE with a fixed signature, then explicit
-- REVOKE/GRANT (KD-3 rule 3b). No lock/statement timeout is set, so no
-- BEGIN/COMMIT wrapper is needed.

CREATE OR REPLACE FUNCTION public.bind_integration_tokens(
  p_user_id UUID,
  p_provider TEXT,
  p_provider_user_id TEXT,
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_token_expires_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
BEGIN
  -- Service-role only. auth.role() is NULL for a direct superuser/psql session,
  -- which coalesces to '' and is refused — the same guard shape PR 1 applies to
  -- the other service-role-only definer functions.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_provider IS NULL OR p_provider_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_binding' USING ERRCODE = '22023';
  END IF;

  -- Identity first: refuse before anything is written when this provider
  -- account is already bound to a different portal user.
  IF EXISTS (
    SELECT 1
    FROM public.user_integrations ui
    WHERE ui.provider = p_provider
      AND ui.provider_user_id = p_provider_user_id
      AND ui.user_id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'already_linked' USING ERRCODE = 'P0001';
  END IF;

  -- The identity row is written first, so a concurrent binding of the same
  -- provider account loses on idx_user_integrations_provider_user_id_unique
  -- (23505) before any token is stored. The caller maps both 'already_linked'
  -- and 23505 to HTTP 409.
  INSERT INTO public.user_integrations (
    user_id,
    provider,
    provider_user_id,
    status,
    connected_at,
    error_message
  )
  VALUES (
    p_user_id,
    p_provider,
    p_provider_user_id,
    'connected',
    v_now,
    NULL
  )
  ON CONFLICT (user_id, provider) DO UPDATE
    SET provider_user_id = EXCLUDED.provider_user_id,
        status = 'connected',
        connected_at = EXCLUDED.connected_at,
        error_message = NULL;

  INSERT INTO public.oauth_tokens (
    user_id,
    provider,
    access_token,
    refresh_token,
    token_expires_at,
    updated_at
  )
  VALUES (
    p_user_id,
    p_provider,
    p_access_token,
    p_refresh_token,
    p_token_expires_at,
    v_now
  )
  ON CONFLICT (user_id, provider) DO UPDATE
    SET access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        token_expires_at = EXCLUDED.token_expires_at,
        updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.bind_integration_tokens(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bind_integration_tokens(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.bind_integration_tokens(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bind_integration_tokens(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

COMMENT ON FUNCTION public.bind_integration_tokens(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) IS
  'PR 47 / KD-13: binds a provider account identity and its encrypted OAuth tokens in one transaction, identity first. Raises already_linked (P0001) and writes nothing when (provider, provider_user_id) belongs to another user. service_role only.';
