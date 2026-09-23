import { ENTITLEMENT_KEEPING_STATUSES } from "./billingAction.ts";

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
  /** Paddle's own last-modified clock; used to order writes it did not push. */
  updated_at?: string | null;
  /**
   * Checkout custom_data. `user_id` is only trustworthy together with a
   * `cd_sig` that verifies (see _shared/paddleWebhookSecurity.ts) — a Paddle
   * customer is keyed by a buyer-typed email, so sharing a customer proves
   * nothing about who owns a subscription.
   */
  custom_data?: { user_id?: unknown; cd_sig?: unknown } | null;
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

// ─── The ordered writer ─────────────────────────────────────────────────────

/**
 * Minimal shape of the service-role client used to call the ordered writer.
 * Narrow on purpose so handler tests can pass a fake.
 */
export interface ApplySubscriptionEventClient {
  rpc(
    fn: "apply_subscription_event",
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * What `public.apply_subscription_event` did with the write.
 *
 * The RPC `RETURNS BOOLEAN` and `false` means "stale OR refused by the
 * untracked-subscription guard" (PR 44). Callers have to tell those apart —
 * one is routine, the other is worth an alert — so this splits them.
 */
export type SubscriptionEventWriteOutcome =
  /** The row now holds this state. */
  | "applied"
  /** A newer event already wrote the row; the row was left alone. */
  | "stale"
  /** The SQL guard refused: a different subscription, not entitlement-keeping. */
  | "untracked_subscription"
  /** 23505: this Paddle subscription is already bound to another user. */
  | "already_bound"
  /** Anything else the database reported. */
  | "error";

export interface SubscriptionEventWriteResult {
  outcome: SubscriptionEventWriteOutcome;
  error?: unknown;
}

/**
 * Paddle's own last-modified clock for a subscription it just returned, used
 * to order a write Paddle did not push to us.
 *
 * Falls back to the local clock rather than to `null`: a null
 * `p_last_event_occurred_at` writes unconditionally AND clears the stored
 * clock, after which every later event — including a redelivered stale one —
 * applies. The local fallback can only mis-order by clock skew (seconds),
 * which is strictly the smaller failure.
 */
export function paddleEventOccurredAt(
  subscription: Pick<PaddleSubscriptionState, "updated_at"> | null | undefined,
  now: Date,
): string {
  const updatedAt = typeof subscription?.updated_at === "string"
    ? subscription.updated_at.trim()
    : "";
  return updatedAt || now.toISOString();
}

/**
 * Synthetic event id for a write no Paddle webhook delivered, e.g.
 * `refresh:sub_123:2026-05-17T12:00:00Z`. Paddle's own ids are `evt_…`, so
 * these cannot collide with a real delivery.
 */
export function syntheticSubscriptionEventId(
  source: "refresh" | "update" | "cancel",
  paddleSubscriptionId: string | null | undefined,
  occurredAt: string,
): string {
  return `${source}:${paddleSubscriptionId ?? "none"}:${occurredAt}`;
}

/**
 * Write a subscription state through `public.apply_subscription_event` — the
 * one ordered, guarded writer — instead of a direct `.upsert`/`.update`.
 *
 * `payload` is a row built by `buildSubscriptionUpsertFromPaddleState` with
 * `eventId`/`occurredAt` supplied, so the ordering clock travels with the
 * write.
 */
export async function applySubscriptionEvent(
  client: ApplySubscriptionEventClient,
  payload: Record<string, unknown>,
  options: { storedSubscriptionId: string | null },
): Promise<SubscriptionEventWriteResult> {
  const status = typeof payload.status === "string" ? payload.status : "";
  const writtenSubscriptionId =
    (payload.paddle_subscription_id as string | null) ?? null;

  const { data, error } = await client.rpc("apply_subscription_event", {
    p_user_id: payload.user_id,
    p_paddle_customer_id: (payload.paddle_customer_id as string | null) ?? null,
    p_paddle_subscription_id: writtenSubscriptionId,
    p_tier: payload.tier,
    p_status: status,
    p_price_id: (payload.price_id as string | null) ?? null,
    p_current_period_start:
      (payload.current_period_start as string | null) ?? null,
    p_current_period_end: (payload.current_period_end as string | null) ?? null,
    p_cancel_at_period_end: Boolean(payload.cancel_at_period_end),
    p_last_event_id: (payload.last_event_id as string | null) ?? null,
    p_last_event_occurred_at:
      (payload.last_event_occurred_at as string | null) ?? null,
  });

  if (error) {
    // The partial UNIQUE index on paddle_subscription_id (migration
    // 20260920004400) refuses to bind one Paddle subscription to two users.
    // That is a nameable state, not an opaque database failure.
    if ((error as { code?: unknown } | null)?.code === "23505") {
      return { outcome: "already_bound", error };
    }
    return { outcome: "error", error };
  }

  if (data === false) {
    // Exactly the SQL guard's own predicate (migration 20260920004400): a
    // different, non-null subscription id whose status is not in
    // ENTITLEMENT_KEEPING_STATUSES. Anything else returning false lost the
    // ordering race. Reusing the shared constant keeps the adoptable-status
    // set in one place.
    if (
      options.storedSubscriptionId &&
      writtenSubscriptionId &&
      options.storedSubscriptionId !== writtenSubscriptionId &&
      !ENTITLEMENT_KEEPING_STATUSES.has(status)
    ) {
      return { outcome: "untracked_subscription" };
    }
    return { outcome: "stale" };
  }

  return { outcome: "applied" };
}
