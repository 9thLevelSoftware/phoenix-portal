-- Community Safety: content_reports + user_blocks tables
-- Phase 18 Plan 01: Foundation for content reporting and user blocking

-- ============================================================================
-- content_reports: tracks user-submitted content reports
-- ============================================================================

CREATE TABLE IF NOT EXISTS content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_id UUID NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('routine', 'cycle', 'comment')),
  category TEXT NOT NULL CHECK (category IN ('harmful_content', 'impersonation', 'spam', 'malware', 'other')),
  description TEXT CHECK (char_length(description) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(reporter_id, content_id, content_type)
);

ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;

-- Users can insert their own reports
DROP POLICY IF EXISTS "Users can insert own reports" ON content_reports;
CREATE POLICY "Users can insert own reports"
  ON content_reports FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = reporter_id);

-- Users can view their own reports (to check "already reported")
DROP POLICY IF EXISTS "Users can view own reports" ON content_reports;
CREATE POLICY "Users can view own reports"
  ON content_reports FOR SELECT TO authenticated
  USING ((select auth.uid()) = reporter_id);

-- Index for looking up reports by content
CREATE INDEX IF NOT EXISTS idx_content_reports_content ON content_reports (content_id, content_type);

-- ============================================================================
-- user_blocks: tracks user-to-user blocks
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(blocker_id, blocked_id),
  CHECK (blocker_id != blocked_id)
);

ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;

-- Users can view their own blocks
DROP POLICY IF EXISTS "Users can view own blocks" ON user_blocks;
CREATE POLICY "Users can view own blocks"
  ON user_blocks FOR SELECT TO authenticated
  USING ((select auth.uid()) = blocker_id);

-- Users can insert their own blocks
DROP POLICY IF EXISTS "Users can insert own blocks" ON user_blocks;
CREATE POLICY "Users can insert own blocks"
  ON user_blocks FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = blocker_id);

-- Users can delete their own blocks (unblock)
DROP POLICY IF EXISTS "Users can delete own blocks" ON user_blocks;
CREATE POLICY "Users can delete own blocks"
  ON user_blocks FOR DELETE TO authenticated
  USING ((select auth.uid()) = blocker_id);

-- Index for efficient blocked user lookups
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks (blocker_id);
