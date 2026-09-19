-- Close self-reported leaderboard inputs and the goal-cap bypass
-- (FP-2, FP-4, F-094, F-063).
--
-- 1. gamification_stats / rpg_attributes: drop the client INSERT/UPDATE
--    policies and keep SELECT. These rows feed rankings and are written only
--    by mobile-sync-push through the service_role client (bypasses RLS) and
--    by the SECURITY DEFINER triggers update_profile_stats_on_workout /
--    update_pr_count_on_record (run as owner). The portal only reads them.
--    With RLS enabled and no INSERT/UPDATE policy, an authenticated INSERT
--    fails WITH CHECK (42501) and an UPDATE matches no row. The LWW RPCs
--    upsert_*_lww are SECURITY INVOKER, so they are closed to browser
--    callers too.
--
-- 2. workout_sessions: authenticated may UPDATE only `notes` (the portal's
--    only session write: src/mutations/workouts.ts). total_volume,
--    duration_seconds, started_at, etc. can no longer be rewritten from the
--    browser. Triggers that set updated_at are unaffected (column privileges
--    are checked on the SET list only). service_role push is unaffected.
--
-- 3. check_goal_limit: the trigger was BEFORE INSERT only, so a user could
--    archive a goal and flip it back to 'active' to exceed the tier cap (a
--    FREE user could re-activate any goal). It now also fires on
--    UPDATE OF status and checks whenever a row becomes active. Body starts
--    from 20260628170000_goal_limit_no_free_tier.sql (KD-3 3a); the error
--    message is unchanged.
--
-- Idempotent: DROP POLICY IF EXISTS, REVOKE/GRANT, CREATE OR REPLACE,
-- DROP TRIGGER IF EXISTS + CREATE TRIGGER.

-- ---------------------------------------------------------------------------
-- 1. Stats tables: SELECT-only for clients.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can insert gamification stats" ON public.gamification_stats;
DROP POLICY IF EXISTS "Users can update gamification stats" ON public.gamification_stats;
DROP POLICY IF EXISTS "Users can insert own gamification stats" ON public.gamification_stats;
DROP POLICY IF EXISTS "Users can update own gamification stats" ON public.gamification_stats;

DROP POLICY IF EXISTS "Users can insert rpg attributes" ON public.rpg_attributes;
DROP POLICY IF EXISTS "Users can update rpg attributes" ON public.rpg_attributes;
DROP POLICY IF EXISTS "Users can insert own RPG attributes" ON public.rpg_attributes;
DROP POLICY IF EXISTS "Users can update own RPG attributes" ON public.rpg_attributes;

-- ---------------------------------------------------------------------------
-- 2. workout_sessions: authenticated UPDATE limited to notes.
-- ---------------------------------------------------------------------------
REVOKE UPDATE ON public.workout_sessions FROM authenticated;
GRANT UPDATE (notes) ON public.workout_sessions TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Goal cap also applies when a goal becomes active via UPDATE.
-- ---------------------------------------------------------------------------
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
  -- Only a row that becomes active counts against the cap: an INSERT of an
  -- active goal, or an UPDATE that moves a goal into 'active'.
  IF NOT (
    NEW.status = 'active'
    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active')
  ) THEN
    RETURN NEW;
  END IF;

  tier := public.user_subscription_tier();

  -- INFERNO: unlimited goals.
  IF tier = 'INFERNO' THEN
    RETURN NEW;
  END IF;

  IF tier = 'EMBER' OR tier = 'FLAME' THEN
    max_goals := 3;
  ELSE
    -- FREE / unknown: no free tier exists, so no goals are allowed.
    max_goals := 0;
  END IF;

  -- On UPDATE the row being activated is not yet 'active', so it is not
  -- counted here.
  SELECT COUNT(*) INTO active_count FROM public.user_goals
    WHERE user_id = NEW.user_id AND status = 'active';

  IF active_count >= max_goals THEN
    RAISE EXCEPTION 'Goal limit reached for your subscription tier'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- KD-3 3b: trigger function, not callable from the browser.
REVOKE ALL ON FUNCTION public.check_goal_limit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_goal_limit() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_goal_limit() TO service_role;

DROP TRIGGER IF EXISTS enforce_goal_limit ON public.user_goals;
CREATE TRIGGER enforce_goal_limit
  BEFORE INSERT OR UPDATE OF status ON public.user_goals
  FOR EACH ROW EXECUTE FUNCTION public.check_goal_limit();
