-- Phase 11: User onboarding state persistence
-- Tracks onboarding completion, version awareness, and feature hint dismissals

CREATE TABLE IF NOT EXISTS user_onboarding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ,
  version_seen TEXT,
  dismissed_hints JSONB NOT NULL DEFAULT '{}'::jsonb,
  dismissed_whats_new BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_onboarding_user_id_unique UNIQUE (user_id)
);

-- Index for fast lookup by user_id (also enforced by unique constraint)
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_user ON user_onboarding(user_id);

-- Enable Row Level Security
ALTER TABLE user_onboarding ENABLE ROW LEVEL SECURITY;

-- Users can only read their own onboarding state
CREATE POLICY "Users can read own onboarding"
  ON user_onboarding FOR SELECT
  USING (user_id = auth.uid());

-- Users can insert their own onboarding state
CREATE POLICY "Users can insert own onboarding"
  ON user_onboarding FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update their own onboarding state
CREATE POLICY "Users can update own onboarding"
  ON user_onboarding FOR UPDATE
  USING (user_id = auth.uid());
