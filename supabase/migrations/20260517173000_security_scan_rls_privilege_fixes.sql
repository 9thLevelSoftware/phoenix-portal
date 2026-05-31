-- Security scan follow-up: keep server-owned sync, ranking, comment target,
-- and provider identity fields out of direct authenticated-client writes.

-- 1. Mobile parity RPCs are Edge Function internals. Cover the current
-- get_*_excluding_ids names and the older get_updated_* family if either
-- exists in the target database.
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'get_sessions_excluding_ids',
        'get_routines_excluding_ids',
        'get_cycles_excluding_ids',
        'get_badges_excluding_ids',
        'get_personal_records_excluding_ids',
        'get_updated_sessions',
        'get_updated_routines',
        'get_updated_cycles',
        'get_updated_badges',
        'get_updated_personal_records'
      ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- 2. Public profile display data gets a narrow surface. Full profile rows stay
-- readable only through the owner RLS policy.
DROP POLICY IF EXISTS "Public profiles are visible to authenticated users"
  ON public.profiles;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Users can view own profile'
  ) THEN
    CREATE POLICY "Users can view own profile"
      ON public.profiles FOR SELECT
      USING (auth.uid() = id);
  END IF;
END $$;

CREATE OR REPLACE VIEW public.public_profiles
  WITH (security_barrier = true)
AS
SELECT
  id,
  user_id,
  display_name,
  avatar_url
FROM public.profiles
WHERE profile_visible = true;

REVOKE ALL ON public.public_profiles FROM PUBLIC;
REVOKE ALL ON public.public_profiles FROM anon;
GRANT SELECT ON public.public_profiles TO authenticated;
GRANT SELECT ON public.public_profiles TO service_role;

REVOKE SELECT ON public.profiles FROM PUBLIC;
REVOKE SELECT ON public.profiles FROM anon;
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (
  id,
  user_id,
  display_name,
  avatar_url,
  created_at,
  updated_at,
  weight_unit,
  email_digests,
  push_notifications,
  streak_reminders,
  challenge_updates,
  profile_visible,
  leaderboard_participation
) ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO service_role;

CREATE OR REPLACE VIEW public.creator_stats
  WITH (security_invoker = true)
AS
SELECT
  p.id AS user_id,
  p.display_name,
  p.avatar_url,
  COALESCE(r.routine_count, 0) + COALESCE(c.cycle_count, 0) AS total_shares,
  COALESCE(r.routine_votes, 0) + COALESCE(c.cycle_votes, 0) AS total_upvotes,
  COALESCE(r.featured_routines, 0) + COALESCE(c.featured_cycles, 0) AS featured_count
FROM public.public_profiles p
LEFT JOIN (
  SELECT
    user_id,
    COUNT(*) AS routine_count,
    COALESCE(SUM(vote_count), 0) AS routine_votes,
    COUNT(*) FILTER (WHERE vote_count >= 10) AS featured_routines
  FROM public.shared_routines
  GROUP BY user_id
) r ON r.user_id = p.id
LEFT JOIN (
  SELECT
    user_id,
    COUNT(*) AS cycle_count,
    COALESCE(SUM(vote_count), 0) AS cycle_votes,
    COUNT(*) FILTER (WHERE vote_count >= 10) AS featured_cycles
  FROM public.shared_cycles
  GROUP BY user_id
) c ON c.user_id = p.id
WHERE COALESCE(r.routine_count, 0) + COALESCE(c.cycle_count, 0) > 0;

GRANT SELECT ON public.creator_stats TO authenticated;
GRANT SELECT ON public.creator_stats TO service_role;

-- 3. Ranking counters are maintained by server-side triggers/functions, not
-- by owner edits to shared content rows.
DROP POLICY IF EXISTS "Users can update own shared routines"
  ON public.shared_routines;
CREATE POLICY "Users can update own shared routines"
  ON public.shared_routines FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own shared cycles"
  ON public.shared_cycles;
CREATE POLICY "Users can update own shared cycles"
  ON public.shared_cycles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE INSERT, UPDATE ON public.shared_routines FROM PUBLIC;
REVOKE INSERT, UPDATE ON public.shared_routines FROM anon;
REVOKE INSERT, UPDATE ON public.shared_routines FROM authenticated;
GRANT INSERT (
  user_id,
  routine_id,
  name,
  description,
  exercise_count,
  estimated_duration,
  exercises_snapshot,
  tags,
  difficulty
) ON public.shared_routines TO authenticated;
GRANT UPDATE (
  routine_id,
  name,
  description,
  exercise_count,
  estimated_duration,
  exercises_snapshot,
  tags,
  difficulty,
  updated_at
) ON public.shared_routines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_routines TO service_role;

REVOKE INSERT, UPDATE ON public.shared_cycles FROM PUBLIC;
REVOKE INSERT, UPDATE ON public.shared_cycles FROM anon;
REVOKE INSERT, UPDATE ON public.shared_cycles FROM authenticated;
GRANT INSERT (
  user_id,
  cycle_id,
  name,
  description,
  duration_weeks,
  tags,
  difficulty
) ON public.shared_cycles TO authenticated;
GRANT UPDATE (
  cycle_id,
  name,
  description,
  duration_weeks,
  tags,
  difficulty,
  updated_at
) ON public.shared_cycles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_cycles TO service_role;

-- 4. Comment targets are immutable after insert; soft-delete decrements the
-- original target even if a legacy row somehow reaches the update trigger.
CREATE OR REPLACE FUNCTION public.prevent_community_comment_target_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.item_id IS DISTINCT FROM OLD.item_id
     OR NEW.item_type IS DISTINCT FROM OLD.item_type THEN
    RAISE EXCEPTION 'community comment target cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_community_comment_target_change
  ON public.community_comments;
CREATE TRIGGER prevent_community_comment_target_change
  BEFORE UPDATE OF item_id, item_type ON public.community_comments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_community_comment_target_change();

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
    IF OLD.item_type = 'routine' THEN
      UPDATE public.shared_routines SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.item_id;
    ELSE
      UPDATE public.shared_cycles SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.item_id;
    END IF;
    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_community_comment_target_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_community_comment_target_change() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_community_comment_target_change() FROM authenticated;

-- 5. Provider identity bindings are server-attested. Authenticated clients may
-- maintain integration state, but not provider_user_id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_integrations_provider_user_id_unique
  ON public.user_integrations (provider, provider_user_id)
  WHERE provider_user_id IS NOT NULL;

DROP POLICY IF EXISTS "Users can update own integrations"
  ON public.user_integrations;
CREATE POLICY "Users can update own integrations"
  ON public.user_integrations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE INSERT, UPDATE ON public.user_integrations FROM PUBLIC;
REVOKE INSERT, UPDATE ON public.user_integrations FROM anon;
REVOKE INSERT, UPDATE ON public.user_integrations FROM authenticated;
GRANT INSERT (
  user_id,
  provider,
  connected_at,
  last_sync_at,
  status,
  error_message
) ON public.user_integrations TO authenticated;
GRANT UPDATE (
  user_id,
  provider,
  connected_at,
  last_sync_at,
  status,
  error_message
) ON public.user_integrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_integrations TO service_role;
