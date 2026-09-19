export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'trialing'
  | 'incomplete'
  | 'none';

export type SubscriptionTier = 'FREE' | 'EMBER' | 'FLAME' | 'INFERNO';

/**
 * Renewal grace for `status = 'active'`: access continues while
 * `now < current_period_end + ENTITLEMENT_GRACE_HOURS`, covering the gap
 * between the period rolling over and Paddle's renewal webhook landing.
 *
 * PARITY: the same predicate lives in src/lib/subscription-entitlement.ts and
 * in SQL `public.subscription_tier_for(uuid)`. All three are checked against
 * tests/fixtures/entitlement-cases.json; change them together.
 */
export const ENTITLEMENT_GRACE_HOURS = 48;

const GRACE_MS = ENTITLEMENT_GRACE_HOURS * 60 * 60 * 1000;

const PAID_TIERS = new Set<string>(['EMBER', 'FLAME', 'INFERNO']);

/**
 * - `past_due`: entitled whatever `current_period_end` says (Paddle is still
 *   retrying payment; access ends when Paddle cancels or pauses, both stored
 *   locally as `canceled`).
 * - `active`: entitled until `current_period_end + ENTITLEMENT_GRACE_HOURS`.
 * - `trialing`: entitled until `current_period_end` (no grace).
 * - anything else, or a missing/invalid period end where one is needed: not entitled.
 */
export function isSubscriptionEntitled(
  status: SubscriptionStatus | string,
  currentPeriodEnd: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (status === 'past_due') {
    return true;
  }
  if ((status !== 'active' && status !== 'trialing') || !currentPeriodEnd) {
    return false;
  }

  const periodEndMs = Date.parse(currentPeriodEnd);
  if (!Number.isFinite(periodEndMs)) {
    return false;
  }
  const accessEndMs = status === 'active' ? periodEndMs + GRACE_MS : periodEndMs;
  return now.getTime() < accessEndMs;
}

/** Effective tier: the stored paid tier when entitled, otherwise FREE (also for unknown tiers). */
export function effectiveSubscriptionTier(
  tier: string | null | undefined,
  status: SubscriptionStatus | string,
  currentPeriodEnd: string | null | undefined,
  now: Date = new Date(),
): SubscriptionTier {
  if (!tier || !PAID_TIERS.has(tier)) {
    return 'FREE';
  }
  return isSubscriptionEntitled(status, currentPeriodEnd, now) ? (tier as SubscriptionTier) : 'FREE';
}
