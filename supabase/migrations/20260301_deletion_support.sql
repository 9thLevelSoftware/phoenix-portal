-- Migration: Account deletion support (GDPR Article 17 - Right to Erasure)
-- Creates deletion_requests table and migrates community content FKs from
-- CASCADE to SET NULL so user deletion anonymizes rather than destroys shared content.

-- =============================================================================
-- 1. deletion_requests — tracks pending account deletion requests
-- =============================================================================
CREATE TABLE deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 days',
  cancelled_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'executed')),
  UNIQUE(user_id)
);

ALTER TABLE deletion_requests ENABLE ROW LEVEL SECURITY;

-- User can view their own deletion request
CREATE POLICY "Users can view own deletion request"
  ON deletion_requests FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- User can insert their own deletion request
CREATE POLICY "Users can insert own deletion request"
  ON deletion_requests FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

-- User can update their own deletion request (e.g. cancel)
CREATE POLICY "Users can update own deletion request"
  ON deletion_requests FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- =============================================================================
-- 2. community_comments: Change CASCADE to SET NULL for user deletion anonymization
-- =============================================================================

-- Step a: Make user_id nullable
ALTER TABLE community_comments ALTER COLUMN user_id DROP NOT NULL;

-- Step b: Drop existing FK constraint and recreate with SET NULL
ALTER TABLE community_comments
  DROP CONSTRAINT community_comments_user_id_fkey;

ALTER TABLE community_comments
  ADD CONSTRAINT community_comments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- =============================================================================
-- 3. shared_routines: Change CASCADE to SET NULL for user deletion anonymization
-- =============================================================================

ALTER TABLE shared_routines ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE shared_routines
  DROP CONSTRAINT shared_routines_user_id_fkey;

ALTER TABLE shared_routines
  ADD CONSTRAINT shared_routines_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- =============================================================================
-- 4. shared_cycles: Change CASCADE to SET NULL for user deletion anonymization
-- =============================================================================

ALTER TABLE shared_cycles ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE shared_cycles
  DROP CONSTRAINT shared_cycles_user_id_fkey;

ALTER TABLE shared_cycles
  ADD CONSTRAINT shared_cycles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
