-- ============================================================================
-- Phase 14: OAuth Security - Token Isolation and CSRF State Tokens
-- ============================================================================

-- 1. Create oauth_tokens table (server-only - NO browser access)
-- Stores sensitive OAuth credentials that only Edge Functions should read.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  api_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- Enable RLS but grant NO select/insert/update/delete to authenticated role
-- Only service_role can access (Edge Functions use SUPABASE_SERVICE_ROLE_KEY)
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

-- No RLS policies = no access for anon or authenticated roles
-- Service role bypasses RLS automatically

-- 2. Create oauth_states table for CSRF protection
-- Stores server-generated state tokens with 10-minute expiry.
CREATE TABLE IF NOT EXISTS oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_token TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
-- No RLS policies = server-only table

-- 3. Migrate existing token data from user_integrations to oauth_tokens
-- Copy-then-drop pattern with IF EXISTS guards for safety.
INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, token_expires_at, api_key)
SELECT user_id, provider, access_token, refresh_token, token_expires_at, api_key
FROM user_integrations
WHERE access_token IS NOT NULL OR refresh_token IS NOT NULL OR api_key IS NOT NULL
ON CONFLICT (user_id, provider) DO UPDATE SET
  access_token = EXCLUDED.access_token,
  refresh_token = EXCLUDED.refresh_token,
  token_expires_at = EXCLUDED.token_expires_at,
  api_key = EXCLUDED.api_key,
  updated_at = NOW();

-- 4. Remove token columns from user_integrations
-- After migration, these columns should no longer exist in the browser-readable table.
ALTER TABLE user_integrations DROP COLUMN IF EXISTS access_token;
ALTER TABLE user_integrations DROP COLUMN IF EXISTS refresh_token;
ALTER TABLE user_integrations DROP COLUMN IF EXISTS token_expires_at;
ALTER TABLE user_integrations DROP COLUMN IF EXISTS api_key;

-- 5. Index for oauth_states cleanup (delete expired tokens efficiently)
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);

-- 6. Index for oauth_tokens lookups
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user_provider ON oauth_tokens(user_id, provider);
