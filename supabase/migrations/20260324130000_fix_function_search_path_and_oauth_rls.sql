-- Migration: Fix mutable search_path on all public functions + oauth RLS policies
-- Addresses Supabase linter warnings:
--   - function_search_path_mutable (6 flagged + 1 unflagged)
--   - rls_enabled_no_policy on oauth_states and oauth_tokens
--
-- Every function gets SET search_path = '' and all table references are
-- schema-qualified to prevent search_path hijacking.

-- ============================================================
-- 1. update_updated_at_column — generic updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- 2. handle_new_user — auto-create profile on signup
--    SECURITY DEFINER required: trigger runs on auth.users
--    which authenticated users cannot read.
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, split_part(NEW.email, '@', 1))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 3. user_subscription_tier — returns current user's tier
--    SECURITY DEFINER required: used inside RLS policies and
--    trigger functions that need cross-table reads.
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_subscription_tier()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT tier FROM public.subscriptions
     WHERE user_id = auth.uid()
     AND status IN ('active', 'trialing')
     LIMIT 1),
    'FREE'
  );
$$;

-- ============================================================
-- 4. check_comment_rate_limit — max 5 comments/hour
--    SECURITY DEFINER required: trigger function needs to
--    count rows across the table regardless of RLS.
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_comment_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recent_count INT;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.community_comments
  WHERE user_id = NEW.user_id
    AND created_at > now() - INTERVAL '1 hour';

  IF recent_count >= 5 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 5 comments per hour';
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 5. update_comment_count — maintain denormalized count
--    SECURITY DEFINER required: trigger updates rows in
--    shared_routines/shared_cycles owned by other users.
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_comment_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.item_type = 'routine' THEN
      UPDATE public.shared_routines SET comment_count = comment_count + 1 WHERE id = NEW.item_id;
    ELSE
      UPDATE public.shared_cycles SET comment_count = comment_count + 1 WHERE id = NEW.item_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF NEW.item_type = 'routine' THEN
      UPDATE public.shared_routines SET comment_count = GREATEST(0, comment_count - 1) WHERE id = NEW.item_id;
    ELSE
      UPDATE public.shared_cycles SET comment_count = GREATEST(0, comment_count - 1) WHERE id = NEW.item_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============================================================
-- 6. check_goal_limit — enforce per-tier goal cap
--    SECURITY DEFINER required: trigger needs to call
--    user_subscription_tier() and count across user_goals.
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_goal_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  active_count INT;
  max_goals INT;
  tier TEXT;
BEGIN
  tier := public.user_subscription_tier();
  IF tier = 'FREE' THEN max_goals := 1;
  ELSE max_goals := 3;
  END IF;
  SELECT COUNT(*) INTO active_count FROM public.user_goals
    WHERE user_id = NEW.user_id AND status = 'active';
  IF active_count >= max_goals THEN
    RAISE EXCEPTION 'Goal limit reached for your subscription tier'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 7. update_vote_count — maintain denormalized vote count
--    (Not flagged by linter but has the same issue)
--    SECURITY DEFINER required: trigger updates rows owned
--    by other users in shared_routines/shared_cycles.
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_vote_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.item_type = 'routine' THEN
      UPDATE public.shared_routines SET vote_count = vote_count + 1 WHERE id = NEW.item_id;
    ELSE
      UPDATE public.shared_cycles SET vote_count = vote_count + 1 WHERE id = NEW.item_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.item_type = 'routine' THEN
      UPDATE public.shared_routines SET vote_count = GREATEST(0, vote_count - 1) WHERE id = OLD.item_id;
    ELSE
      UPDATE public.shared_cycles SET vote_count = GREATEST(0, vote_count - 1) WHERE id = OLD.item_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============================================================
-- 8. oauth_tokens — add explicit service_role policy
--    Table is intentionally server-only. service_role already
--    bypasses RLS, but an explicit policy documents the intent
--    and silences the rls_enabled_no_policy linter warning.
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'oauth_tokens'
      AND policyname = 'Service role has full access to oauth tokens'
  ) THEN
    CREATE POLICY "Service role has full access to oauth tokens"
      ON public.oauth_tokens FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ============================================================
-- 9. oauth_states — add explicit service_role policy
--    Same rationale as oauth_tokens above.
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'oauth_states'
      AND policyname = 'Service role has full access to oauth states'
  ) THEN
    CREATE POLICY "Service role has full access to oauth states"
      ON public.oauth_states FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;
