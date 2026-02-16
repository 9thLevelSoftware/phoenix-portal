-- Migration: Integration tables for third-party fitness service connections
-- Phase 07-01: Integration Foundation Schema

-- =============================================================================
-- Table 1: user_integrations
-- Stores OAuth tokens and connection status for each provider per user.
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL,  -- 'strava', 'fitbit', 'garmin', 'hevy', 'apple_health', 'google_health'
  provider_user_id TEXT,
  access_token TEXT,       -- NULL for mobile-only providers (apple_health, google_health)
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  api_key TEXT,            -- For Hevy (non-OAuth, API key auth)
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_sync_at TIMESTAMPTZ,
  status TEXT DEFAULT 'connected',  -- 'connected', 'disconnected', 'error', 'token_expired'
  error_message TEXT,
  UNIQUE(user_id, provider)
);

ALTER TABLE user_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own integrations"
  ON user_integrations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own integrations"
  ON user_integrations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own integrations"
  ON user_integrations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own integrations"
  ON user_integrations FOR DELETE
  USING (auth.uid() = user_id);


-- =============================================================================
-- Table 2: sync_queue
-- Database-backed queue for provider sync tasks with retry tracking.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL,
  sync_type TEXT DEFAULT 'incremental',  -- 'initial', 'incremental', 'manual'
  status TEXT DEFAULT 'pending',         -- 'pending', 'processing', 'completed', 'failed'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  retry_count INT DEFAULT 0,
  error_message TEXT
);

ALTER TABLE sync_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sync queue"
  ON sync_queue FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sync tasks"
  ON sync_queue FOR INSERT
  WITH CHECK (auth.uid() = user_id);


-- =============================================================================
-- Table 3: rate_limit_tracking
-- Tracks API rate limit usage per provider. Written by service role (Edge Functions).
-- =============================================================================

CREATE TABLE IF NOT EXISTS rate_limit_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL UNIQUE,
  requests_this_window INT DEFAULT 0,
  window_started_at TIMESTAMPTZ DEFAULT NOW(),
  last_request_at TIMESTAMPTZ,
  last_reset_at TIMESTAMPTZ
);

ALTER TABLE rate_limit_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read rate limits"
  ON rate_limit_tracking FOR SELECT
  USING (auth.role() = 'authenticated');

-- Note: Writes to rate_limit_tracking happen via service role in Edge Functions.
-- No INSERT/UPDATE/DELETE policies for authenticated users.


-- =============================================================================
-- Table 4: external_activities
-- Normalized activities imported from third-party providers.
-- =============================================================================

CREATE TABLE IF NOT EXISTS external_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  external_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  activity_type TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  duration_seconds INT,
  distance_meters DECIMAL,
  calories INT,
  avg_heart_rate INT,
  max_heart_rate INT,
  elevation_gain_meters DECIMAL,
  raw_data JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider, external_id)
);

ALTER TABLE external_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own external activities"
  ON external_activities FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own external activities"
  ON external_activities FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own external activities"
  ON external_activities FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own external activities"
  ON external_activities FOR DELETE
  USING (auth.uid() = user_id);


-- =============================================================================
-- Indexes for common query patterns
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_user_integrations_user_id ON user_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_queue_user_id ON sync_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_external_activities_user_id ON external_activities(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_external_activities_started_at ON external_activities(user_id, started_at DESC);
