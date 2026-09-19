import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { effectiveSubscriptionTier } from './subscriptionEntitlement.ts';

/**
 * Subscription tier hierarchy.
 * Each tier grants access to itself and everything below it.
 */
const TIER_LEVEL: Record<string, number> = {
  FREE: 0,
  EMBER: 1,
  FLAME: 2,
  INFERNO: 3,
};

export type SubscriptionTier = 'FREE' | 'EMBER' | 'FLAME' | 'INFERNO';

const KNOWN_TIERS = new Set<string>(['FREE', 'EMBER', 'FLAME', 'INFERNO']);
const KNOWN_STATUSES = new Set<string>([
  'active',
  'past_due',
  'canceled',
  'trialing',
  'incomplete',
  'none',
]);

function configurationError(corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      error: 'subscription_unavailable',
      message: 'Subscription status is temporarily unavailable. Please retry shortly.',
    }),
    {
      status: 503,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': '30',
      },
    },
  );
}

/**
 * Check whether a user meets the minimum subscription tier.
 *
 * Returns `{ allowed: true, tier }` if the user's effective tier (shared
 * entitlement predicate, see subscriptionEntitlement.ts)
 * is at or above `minimumTier`, or `{ allowed: false, tier, response }` with a
 * ready-made 402 Response if not.
 *
 * Usage:
 * ```ts
 * const gate = await requireSubscription(supabase, userId, 'EMBER', cors);
 * if (!gate.allowed) return gate.response;
 * ```
 */
export async function requireSubscription(
  supabase: SupabaseClient,
  userId: string,
  minimumTier: SubscriptionTier,
  corsHeaders: Record<string, string>,
  now: Date = new Date(),
): Promise<
  | { allowed: true; tier: SubscriptionTier }
  | { allowed: false; tier: SubscriptionTier; response: Response }
> {
  const { data: subscription, error } = await supabase
    .from('subscriptions')
    .select('tier, status, current_period_end, cancel_at_period_end')
    .eq('user_id', userId)
    .maybeSingle();

  // fix(F328): A DB outage, RLS/service-role misconfig, schema drift, or
  // duplicate-row error must NOT be silently treated as "no subscription"
  // (which would downgrade a paying user to FREE and return a 402). Fail
  // closed with a retryable 503 so operators see the infra failure instead
  // of a billing denial.
  if (error) {
    console.error('[requireSubscription] subscription lookup failed:', error);
    return { allowed: false, tier: 'FREE', response: configurationError(corsHeaders) };
  }

  // The effective tier comes from the shared entitlement predicate (parity
  // with SQL subscription_tier_for and the SPA; fixture:
  // tests/fixtures/entitlement-cases.json). An unknown tier or status (schema
  // drift, legacy PHOENIX/ELITE, a new Paddle status) resolves to FREE, so
  // the request is refused with the normal 402 (fail closed). It is logged so
  // operators can see the drift.
  const rawTierValue = subscription?.tier ?? 'FREE';
  const rawStatusValue = subscription?.status ?? 'none';
  if (!KNOWN_TIERS.has(rawTierValue) || !KNOWN_STATUSES.has(rawStatusValue)) {
    console.error(
      '[requireSubscription] unknown tier/status in subscriptions row:',
      { tier: rawTierValue, status: rawStatusValue },
    );
  }

  const tier = effectiveSubscriptionTier(
    rawTierValue,
    rawStatusValue,
    subscription?.current_period_end ?? null,
    { cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end), now },
  );
  const userLevel = TIER_LEVEL[tier] ?? 0;
  const requiredLevel = TIER_LEVEL[minimumTier] ?? 0;

  if (userLevel < requiredLevel) {
    return {
      allowed: false,
      tier,
      response: new Response(
        JSON.stringify({
          error: 'subscription_required',
          message: `A ${minimumTier.charAt(0)}${minimumTier.slice(1).toLowerCase()} subscription or higher is required for this feature.`,
          requiredTier: minimumTier,
          currentTier: tier,
        }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      ),
    };
  }

  return { allowed: true, tier };
}
