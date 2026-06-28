-- F368 (server-side): align the check_goal_limit() trigger with the "no free
-- tier" goal policy.
--
-- The client gate now treats a non-subscriber's goal allowance as 0
-- (Goals.tsx: maxGoals = isInferno ? Infinity : isPremium ? 3 : 0), but the
-- BEFORE INSERT trigger still granted the FREE tier one active goal
-- (20260324130000:138-139). A user could bypass the client and create a
-- paid-only goal with a direct Supabase insert. Mirror the client's per-tier
-- limits in the trigger so the server enforces the same policy:
--   INFERNO      -> unlimited
--   EMBER/FLAME  -> 3
--   FREE/unknown -> 0 (no goals without a paid subscription)
--
-- user_subscription_tier() returns 'FREE' unless the user has an
-- active/trialing subscription, so a lapsed/absent subscription correctly
-- falls into the 0-goal branch.
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

  SELECT COUNT(*) INTO active_count FROM public.user_goals
    WHERE user_id = NEW.user_id AND status = 'active';

  IF active_count >= max_goals THEN
    RAISE EXCEPTION 'Goal limit reached for your subscription tier'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;
