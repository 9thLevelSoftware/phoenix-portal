-- =============================================================================
-- Add per-user rate limiting support to rate_limit_tracking
--
-- The existing table only tracks per-provider API rate limits (one row per
-- provider). For per-user endpoint rate limiting we need:
--   - a `key` column identifying the endpoint (e.g. 'delete-account')
--   - a `user_id` column for per-user tracking
--   - a composite unique constraint on (key, user_id)
--
-- The existing provider-based rows continue to work because they will have
-- user_id = NULL (provider-level rate limits are global, not per-user).
-- =============================================================================

-- 1. Add new columns (nullable so existing rows stay valid)
ALTER TABLE rate_limit_tracking
  ADD COLUMN IF NOT EXISTS key TEXT,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Backfill existing rows: set key = provider for backwards compatibility
UPDATE rate_limit_tracking SET key = provider WHERE key IS NULL;

-- 3. Drop the old provider UNIQUE constraint so we can have multiple rows
--    per provider (one global + potentially per-user in future).
ALTER TABLE rate_limit_tracking DROP CONSTRAINT IF EXISTS rate_limit_tracking_provider_key;

-- 4. Add composite unique constraint for per-user endpoint rate limits.
--    Using COALESCE ensures NULL user_id rows (provider-level) remain unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_limit_key_user
  ON rate_limit_tracking (key, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 5. Index for fast lookups by key + user_id in the hot path
CREATE INDEX IF NOT EXISTS idx_rate_limit_key_user_window
  ON rate_limit_tracking (key, user_id, window_started_at);
