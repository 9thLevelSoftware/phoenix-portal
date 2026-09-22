export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'trialing'
  | 'incomplete'
  | 'none';

export type SubscriptionTier = 'FREE' | 'EMBER' | 'FLAME' | 'INFERNO';

/**
 * Renewal grace for `status = 'active'` rows that will renew
 * (`cancel_at_period_end = false`): access continues while
 * `now < current_period_end + ENTITLEMENT_GRACE_HOURS`, covering the gap
 * between the period rolling over and Paddle's renewal webhook landing.
 *
 * PARITY: the same predicate lives in src/lib/subscription-entitlement.ts and
 * in SQL `public.subscription_tier_for(uuid)`. All three are checked against
 * tests/fixtures/entitlement-cases.json; change them together.
 */
export const ENTITLEMENT_GRACE_HOURS = 48;

// Applied only when `cancelAtPeriodEnd` is false. Callers that read a
// `subscriptions` row must select `cancel_at_period_end` alongside
// `current_period_end` — without that column the grace is granted to a
// subscription already scheduled to cancel at period end.
const GRACE_MS = ENTITLEMENT_GRACE_HOURS * 60 * 60 * 1000;

const PAID_TIERS = new Set<string>(['EMBER', 'FLAME', 'INFERNO']);

export interface EntitlementOptions {
  /** Row is scheduled to cancel at period end: no renewal grace. */
  cancelAtPeriodEnd?: boolean | null;
  now?: Date;
}

/**
 * - `past_due`: entitled whatever `current_period_end` says (Paddle is still
 *   retrying payment; access ends when Paddle cancels or pauses, both stored
 *   locally as `canceled`).
 * - `active`: entitled until `current_period_end + ENTITLEMENT_GRACE_HOURS`,
 *   or until `current_period_end` when `cancel_at_period_end` is set.
 * - `trialing`: entitled until `current_period_end` (no grace).
 * - anything else, or a missing/invalid period end where one is needed: not entitled.
 */
export function isSubscriptionEntitled(
  status: SubscriptionStatus | string,
  currentPeriodEnd: string | null | undefined,
  options: EntitlementOptions = {},
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
  const graceMs = status === 'active' && !options.cancelAtPeriodEnd ? GRACE_MS : 0;
  const nowMs = (options.now ?? new Date()).getTime();
  return nowMs < periodEndMs + graceMs;
}

/**
 * Effective tier for a raw `subscriptions` row: the stored paid tier when
 * entitled, otherwise FREE. Takes raw DB strings; an unknown tier or status
 * resolves to FREE (fail closed). requireSubscription rejects unknown values
 * with 503 before calling this.
 */
export function effectiveSubscriptionTier(
  tier: string | null | undefined,
  status: string | null | undefined,
  currentPeriodEnd: string | null | undefined,
  options: EntitlementOptions = {},
): SubscriptionTier {
  if (!tier || !PAID_TIERS.has(tier)) {
    return 'FREE';
  }
  return isSubscriptionEntitled(status ?? 'none', currentPeriodEnd, options)
    ? (tier as SubscriptionTier)
    : 'FREE';
}
