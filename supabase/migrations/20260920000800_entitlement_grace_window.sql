-- Entitlement parity: renewal grace window, past_due access, and a
-- service-role tier lookup.
--
-- One SQL predicate, used by both functions:
--   * past_due  -> entitled whatever current_period_end says (Paddle's
--                  retry/dunning window; access ends when Paddle cancels or
--                  pauses, both stored locally as 'canceled').
--   * active    -> entitled while now() < current_period_end + 48 hours
--                  (ENTITLEMENT_GRACE_HOURS).
--   * trialing  -> entitled while now() < current_period_end (no grace).
--   * anything else, a NULL period end (except past_due), or a tier outside
--     EMBER/FLAME/INFERNO -> 'FREE'.
--
-- PARITY: the same predicate lives in src/lib/subscription-entitlement.ts
-- and supabase/functions/_shared/subscriptionEntitlement.ts. All three are
-- checked against tests/fixtures/entitlement-cases.json
-- (supabase/tests/database/entitlement_parity.test.sql). Change them together.
--
-- public.subscription_tier_for(uuid): service_role only (Edge can ask for any
-- user's tier). public.user_subscription_tier() becomes a thin wrapper around
-- it for auth.uid(), so the two cannot drift. The wrapper must stay SECURITY
-- DEFINER: RLS evaluates it as the calling role, and only its owner may
-- execute subscription_tier_for.
--
-- Latest previous body of user_subscription_tier():
-- 20260823120000_trust_rls_broadcast_self_leak.sql. Grants follow
-- 20260920000100_lockdown_definer_function_grants.sql (wrapper stays on the
-- browser allow-list: authenticated + service_role).

CREATE OR REPLACE FUNCTION public.subscription_tier_for(p_user_id uuid)
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT s.tier
      FROM public.subscriptions s
      WHERE s.user_id = p_user_id
        AND s.tier IN ('EMBER', 'FLAME', 'INFERNO')
        AND (
          s.status = 'past_due'
          OR (
            s.status = 'active'
            AND s.current_period_end IS NOT NULL
            AND now() < s.current_period_end + interval '48 hours'
          )
          OR (
            s.status = 'trialing'
            AND s.current_period_end IS NOT NULL
            AND now() < s.current_period_end
          )
        )
      LIMIT 1
    ),
    'FREE'
  );
$$;

REVOKE ALL ON FUNCTION public.subscription_tier_for(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subscription_tier_for(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_tier_for(uuid) TO service_role;

COMMENT ON FUNCTION public.subscription_tier_for(uuid) IS
  'Effective subscription tier for a user (past_due keeps access; active has a 48h renewal grace). service_role only. Parity fixture: tests/fixtures/entitlement-cases.json.';

-- Same signature as before; SECURITY DEFINER and search_path are restated
-- because CREATE OR REPLACE resets omitted attributes to their defaults.
CREATE OR REPLACE FUNCTION public.user_subscription_tier()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.subscription_tier_for(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.user_subscription_tier() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_subscription_tier() FROM anon;
GRANT EXECUTE ON FUNCTION public.user_subscription_tier() TO authenticated, service_role;
