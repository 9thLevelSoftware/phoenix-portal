export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'trialing'
  | 'incomplete'
  | 'none';

const ACTIVE_SUBSCRIPTION_STATUSES = new Set<SubscriptionStatus>(['active', 'trialing']);

export function isSubscriptionEntitled(
  status: SubscriptionStatus,
  currentPeriodEnd: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(status) || !currentPeriodEnd) {
    return false;
  }

  const periodEndMs = Date.parse(currentPeriodEnd);
  return Number.isFinite(periodEndMs) && periodEndMs > now.getTime();
}
