export type PortalSubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'trialing'
  | 'incomplete'
  | 'none';

export interface PaddleSubscriptionState {
  id: string;
  customer_id: string;
  status: string;
  items?: Array<{
    price?: {
      id?: string;
    };
    quantity?: number;
  }>;
  current_billing_period?: {
    starts_at?: string | null;
    ends_at?: string | null;
  } | null;
  scheduled_change?: {
    action?: string | null;
    effective_at?: string | null;
  } | null;
}

/**
 * Resolve the base plan price ID from a Paddle subscription's items.
 *
 * Paddle subscriptions can contain multiple items (add-ons, metered items),
 * which are not guaranteed to be ordered with the base plan first. When an
 * allowlist of configured paid price IDs is provided, the first item whose
 * price matches the allowlist is treated as the base plan. Falls back to the
 * first item's price (legacy behavior) when no allowlisted item is found.
 */
export function resolveBasePlanPriceId(
  subscription: Pick<PaddleSubscriptionState, "items">,
  allowedPriceIds?: ReadonlySet<string>,
): string {
  const items = subscription.items ?? [];
  if (allowedPriceIds && allowedPriceIds.size > 0) {
    for (const item of items) {
      const id = item.price?.id;
      if (id && allowedPriceIds.has(id)) {
        return id;
      }
    }
  }
  return items[0]?.price?.id ?? "";
}

export function mapPaddleStatusToSubscriptionStatus(
  paddleStatus: string,
): PortalSubscriptionStatus {
  switch (paddleStatus) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'paused':
      return 'canceled';
    case 'canceled':
      return 'canceled';
    case 'past_due':
      return 'past_due';
    default:
      return 'none';
  }
}

export function hasPendingPaddleScheduledChange(
  subscription: PaddleSubscriptionState,
): boolean {
  const status = mapPaddleStatusToSubscriptionStatus(subscription.status);
  if (status !== 'active' && status !== 'trialing') {
    return false;
  }

  const action = subscription.scheduled_change?.action;
  return action === 'cancel' || action === 'pause';
}

export function buildSubscriptionUpsertFromPaddleState({
  userId,
  subscription,
  tier,
  priceId: explicitPriceId,
  eventId,
  occurredAt,
}: {
  userId: string;
  subscription: PaddleSubscriptionState;
  tier: string;
  /**
   * Explicitly resolved base plan price ID. When omitted, falls back to the
   * first subscription item's price (legacy behavior). Callers that resolve
   * the base plan against a configured allowlist should pass it here so a
   * leading add-on item cannot write the wrong/null price_id.
   */
  priceId?: string;
  eventId?: string;
  occurredAt?: string;
}): Record<string, unknown> {
  const status = mapPaddleStatusToSubscriptionStatus(subscription.status);
  const priceId = explicitPriceId ?? subscription.items?.[0]?.price?.id ?? '';
  const isCanceled = status === 'canceled';

  return {
    user_id: userId,
    paddle_customer_id: subscription.customer_id,
    paddle_subscription_id: subscription.id,
    tier,
    status,
    price_id: priceId || null,
    current_period_start: isCanceled
      ? null
      : subscription.current_billing_period?.starts_at ?? null,
    current_period_end: isCanceled
      ? null
      : subscription.current_billing_period?.ends_at ?? null,
    cancel_at_period_end: hasPendingPaddleScheduledChange(subscription),
    ...(eventId ? { last_event_id: eventId } : {}),
    ...(occurredAt ? { last_event_occurred_at: occurredAt } : {}),
    updated_at: new Date().toISOString(),
  };
}
