-- Make leaderboard inputs server-written only, and close the goal-cap bypass
-- (FP-2, FP-4, F-094, F-063).
--
-- Leaderboard inputs are gamification_stats / rpg_attributes and the rows
-- that feed them and compute-rankings: workout_sessions (total_volume,
-- duration_seconds, started_at) and personal_records (pr_count). The portal
-- only reads these, apart from editing workout_sessions.notes
-- (src/mutations/workouts.ts). The mobile app writes all of them through
-- mobile-sync-push, which uses the service_role client (bypasses RLS and
-- table/column grants). The SECURITY DEFINER triggers
-- update_profile_stats_on_workout / update_pr_count_on_record run as their
-- owner and keep writing gamification_stats.
--
-- This removes every browser write path to those inputs:
--   1. gamification_stats / rpg_attributes: drop the client INSERT/UPDATE
--      policies (SELECT kept) AND revoke INSERT/UPDATE/DELETE from anon and
--      authenticated, so a write policy that survives under a drifted name
--      cannot reopen them.
--   2. workout_sessions: drop the client INSERT policy and revoke INSERT
--      from anon/authenticated; authenticated may UPDATE only `notes`, anon
--      may not UPDATE at all. Triggers that set updated_at are unaffected
--      (column privileges apply to the SET list only).
--   3. personal_records: drop the client INSERT policy and revoke INSERT
--      and UPDATE from anon/authenticated.
--   4. The caller-rights LWW upsert RPCs (public.upsert_*_lww) are only
--      called by mobile-sync-push as service_role; the SPA has no caller.
--      Revoke EXECUTE from PUBLIC/anon/authenticated on every overload.
--      Not included (no leaderboard input, the portal writes them):
--      exercises/sets/rep_summaries/exercise_progress INSERT policies — see
--      the PR 10 summary follow-ups.
--   5. check_goal_limit: the trigger was BEFORE INSERT only, so a user could
--      archive a goal and flip it back to 'active' to exceed the tier cap.
--      INSERT is still always checked (FREE may insert no goal of any
--      status); UPDATE is checked when a goal moves into 'active'. A
--      per-user transaction advisory lock serialises concurrent activations
--      so two requests cannot both pass the count. Body starts from
--      20260628170000_goal_limit_no_free_tier.sql (KD-3 3a); the error
--      message is unchanged.
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

REVOKE INSERT, UPDATE, DELETE ON public.gamification_stats FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.rpg_attributes FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. workout_sessions: no client INSERT; authenticated UPDATE only on notes.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can insert own sessions" ON public.workout_sessions;
REVOKE INSERT, UPDATE ON public.workout_sessions FROM anon, authenticated;
GRANT UPDATE (notes) ON public.workout_sessions TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. personal_records: no client INSERT (and no UPDATE: there was never an
--    UPDATE policy; the grant is revoked so a drifted one cannot reopen it).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can insert own records" ON public.personal_records;
REVOKE INSERT, UPDATE ON public.personal_records FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. LWW upsert RPCs: service_role only (every overload, by name).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname LIKE 'upsert\_%\_lww'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Goal cap: INSERT always checked, UPDATE checked on activation.
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
  -- UPDATE: only a goal that becomes active counts against the cap. Editing
  -- an active goal, or archiving/completing one, is not capped.
  IF TG_OP = 'UPDATE'
     AND NOT (NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active') THEN
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

  -- Serialise the count-then-write per user for the rest of the
  -- transaction, so concurrent activations cannot both pass the check.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('user_goals:' || NEW.user_id::text, 0)
  );

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
