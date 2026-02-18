-- Phase 11: Community Comments
-- Creates community_comments table with RLS, rate limit trigger, indexes, and realtime.
-- Adds comment_count column and auto-update trigger to shared_routines/shared_cycles.

-- ============================================================
-- 1. community_comments
-- ============================================================
CREATE TABLE community_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('routine', 'cycle')),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- CRITICAL: RLS immediately after CREATE TABLE (CVE-2025-48757)
ALTER TABLE community_comments ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. RLS Policies
-- ============================================================

-- SELECT: authenticated users can view non-deleted comments
CREATE POLICY "Authenticated users can view comments"
  ON community_comments FOR SELECT
  TO authenticated
  USING (deleted_at IS NULL);

-- INSERT: PHOENIX/ELITE users only
CREATE POLICY "Premium users can post comments"
  ON community_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.user_subscription_tier() IN ('PHOENIX', 'ELITE')
  );

-- UPDATE: own comments within 5-minute window
CREATE POLICY "Users can edit own comments within 5 minutes"
  ON community_comments FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND created_at > now() - INTERVAL '5 minutes'
  );

-- DELETE: own comments only (soft-delete via UPDATE, but allow real delete for admin)
CREATE POLICY "Users can delete own comments"
  ON community_comments FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- 3. Rate Limit Trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_comment_rate_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  recent_count INT;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM community_comments
  WHERE user_id = NEW.user_id
    AND created_at > now() - INTERVAL '1 hour';

  IF recent_count >= 5 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 5 comments per hour';
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER enforce_comment_rate_limit
  BEFORE INSERT ON community_comments
  FOR EACH ROW EXECUTE FUNCTION public.check_comment_rate_limit();

-- ============================================================
-- 4. Indexes
-- ============================================================

-- Fetch comments by item (excluding soft-deleted)
CREATE INDEX idx_community_comments_item_id
  ON community_comments (item_id)
  WHERE deleted_at IS NULL;

-- Fetch comments by user
CREATE INDEX idx_community_comments_user_id
  ON community_comments (user_id);

-- Rate limit check composite index
CREATE INDEX idx_community_comments_rate_limit
  ON community_comments (user_id, created_at);

-- ============================================================
-- 5. Realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE community_comments;

-- ============================================================
-- 6. comment_count column on shared_routines and shared_cycles
-- ============================================================
ALTER TABLE shared_routines ADD COLUMN IF NOT EXISTS comment_count INT NOT NULL DEFAULT 0;
ALTER TABLE shared_cycles ADD COLUMN IF NOT EXISTS comment_count INT NOT NULL DEFAULT 0;

-- ============================================================
-- 7. Auto-update comment_count trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_comment_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.item_type = 'routine' THEN
      UPDATE shared_routines SET comment_count = comment_count + 1 WHERE id = NEW.item_id;
    ELSE
      UPDATE shared_cycles SET comment_count = comment_count + 1 WHERE id = NEW.item_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF NEW.item_type = 'routine' THEN
      UPDATE shared_routines SET comment_count = GREATEST(0, comment_count - 1) WHERE id = NEW.item_id;
    ELSE
      UPDATE shared_cycles SET comment_count = GREATEST(0, comment_count - 1) WHERE id = NEW.item_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER update_comment_count_on_change
  AFTER INSERT OR UPDATE ON community_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_comment_count();
