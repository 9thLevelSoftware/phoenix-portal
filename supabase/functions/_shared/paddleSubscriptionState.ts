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
  eventId,
  occurredAt,
}: {
  userId: string;
  subscription: PaddleSubscriptionState;
  tier: string;
  eventId?: string;
  occurredAt?: string;
}): Record<string, unknown> {
  const status = mapPaddleStatusToSubscriptionStatus(subscription.status);
  const priceId = subscription.items?.[0]?.price?.id ?? '';
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
