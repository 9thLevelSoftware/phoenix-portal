import { type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

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

/**
 * Check whether a user meets the minimum subscription tier.
 *
 * Returns `{ allowed: true, tier }` if the user's active/trialing subscription
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
): Promise<
  | { allowed: true; tier: SubscriptionTier }
  | { allowed: false; tier: SubscriptionTier; response: Response }
> {
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('tier, status')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing'])
    .maybeSingle();

  const tier = (subscription?.tier as SubscriptionTier) ?? 'FREE';
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
