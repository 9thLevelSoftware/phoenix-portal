-- FP-2: direct browser imports and continued goal edits require paid tiers.
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "Users can insert own external activities" ON public.external_activities;
CREATE POLICY "Users can insert own external activities"
  ON public.external_activities FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id AND (select public.user_has_min_tier('FLAME')));

DROP POLICY IF EXISTS "Users can update own external activities" ON public.external_activities;
CREATE POLICY "Users can update own external activities"
  ON public.external_activities FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id AND (select public.user_has_min_tier('FLAME')))
  WITH CHECK ((select auth.uid()) = user_id AND (select public.user_has_min_tier('FLAME')));
-- Keep owner SELECT/DELETE: downgrades must not prevent reading/removing data.

CREATE OR REPLACE FUNCTION private.authorize_goal_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- Service jobs maintain snapshots/completion independently of browser tiers.
  IF current_user <> 'authenticated' OR public.user_has_min_tier('EMBER') THEN
    RETURN NEW;
  END IF;
  -- Reactivation is already rejected by enforce_goal_limit below for FREE
  -- users (zero allowance). Preserve its existing P0001/message contract,
  -- including when the caller combines activation with protected field edits.
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;
  -- Compare the entire row so future fields cannot accidentally bypass this
  -- exception. The existing archive mutation also writes updated_at.
  IF NEW.status = 'archived'
     AND (pg_catalog.to_jsonb(NEW) - ARRAY['status', 'updated_at'])
         IS NOT DISTINCT FROM
         (pg_catalog.to_jsonb(OLD) - ARRAY['status', 'updated_at']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'EMBER_REQUIRED' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION private.authorize_goal_edit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS authorize_goal_edit ON public.user_goals;
CREATE TRIGGER authorize_goal_edit BEFORE UPDATE ON public.user_goals
  FOR EACH ROW EXECUTE FUNCTION private.authorize_goal_edit();
-- Existing check_goal_limit still serializes creation/reactivation caps.

COMMIT;
