-- =============================================================================
-- Tighten RLS on rate_limit_tracking
--
-- Now that rate_limit_tracking contains user_id, the existing RLS policy
-- (which allowed any authenticated user to SELECT all rows) would expose
-- other users' rate-limit data. Since this table is only accessed by
-- service-role Edge Functions, revoke all client-facing access.
-- =============================================================================

-- Ensure RLS is enabled (no-op if already enabled)
ALTER TABLE IF EXISTS rate_limit_tracking ENABLE ROW LEVEL SECURITY;

-- Drop any existing permissive SELECT policies for authenticated/anon users
DROP POLICY IF EXISTS "Allow authenticated read" ON rate_limit_tracking;
DROP POLICY IF EXISTS "Authenticated users can view rate limits" ON rate_limit_tracking;

-- Revoke direct table privileges from client-facing roles.
-- Service-role bypasses RLS and retains full access.
REVOKE SELECT, INSERT, UPDATE, DELETE ON rate_limit_tracking FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON rate_limit_tracking FROM anon;
