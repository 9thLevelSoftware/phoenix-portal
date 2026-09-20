import { isSubscriptionEntitled } from './subscriptionEntitlement.ts';

export type PaddleSubscriptionPatchDecision =
  | { action: 'already_current' }
  | {
    action: 'uncancel';
    body: { scheduled_change: null; on_payment_failure: 'prevent_change' };
  }
  | {
    action: 'switch';
    body: {
      items: Array<{ price_id: string; quantity: number }>;
      proration_billing_mode: 'prorated_immediately';
      // Explicit, not Paddle's implicit default: if the prorated charge fails,
      // Paddle rejects the change instead of applying it unpaid.
      on_payment_failure: 'prevent_change';
      scheduled_change?: null;
    };
  };

/** A single existing Paddle subscription item, as needed to rebuild the item list. */
export interface PaddleSubscriptionItemRef {
  price?: { id?: string };
  quantity?: number;
}

/**
 * Build the desired item list for a plan switch.
 *
 * Paddle's update API treats `items` as the complete desired item list, so any
 * existing item omitted here is removed. To avoid silently dropping add-ons or
 * metered items, carry forward every current item, swapping only the base plan
 * item (identified by `currentPriceId`) for `newPriceId` while preserving its
 * quantity. Falls back to a single base-plan item when no current items are
 * known.
 */
function buildSwitchItems(
  currentItems: ReadonlyArray<PaddleSubscriptionItemRef> | null | undefined,
  currentPriceId: string | null | undefined,
  newPriceId: string,
): Array<{ price_id: string; quantity: number }> {
  const items = (currentItems ?? [])
    .map((item) => ({
      price_id: item.price?.id,
      quantity: typeof item.quantity === 'number' ? item.quantity : 1,
    }))
    .filter((item): item is { price_id: string; quantity: number } =>
      typeof item.price_id === 'string' && item.price_id.length > 0
    );

  if (items.length === 0) {
    return [{ price_id: newPriceId, quantity: 1 }];
  }

  let swapped = false;
  const next = items.map((item) => {
    if (!swapped && (currentPriceId == null || item.price_id === currentPriceId)) {
      swapped = true;
      return { price_id: newPriceId, quantity: item.quantity };
    }
    return item;
  });

  // The base plan item was not present in the known item list — add it so the
  // switch still applies the requested plan rather than only carrying add-ons.
  if (!swapped) {
    next.push({ price_id: newPriceId, quantity: 1 });
  }

  return next;
}

export function buildPaddleSubscriptionPatch(
  currentPriceId: string | null | undefined,
  newPriceId: string,
  cancelAtPeriodEnd: boolean,
  currentItems?: ReadonlyArray<PaddleSubscriptionItemRef> | null,
): PaddleSubscriptionPatchDecision {
  if (currentPriceId === newPriceId) {
    return cancelAtPeriodEnd
      ? {
        action: 'uncancel',
        body: { scheduled_change: null, on_payment_failure: 'prevent_change' },
      }
      : { action: 'already_current' };
  }

  return {
    action: 'switch',
    body: {
      items: buildSwitchItems(currentItems, currentPriceId, newPriceId),
      proration_billing_mode: 'prorated_immediately',
      on_payment_failure: 'prevent_change',
      ...(cancelAtPeriodEnd ? { scheduled_change: null } : {}),
    },
  };
}

export function checkoutRequiredResponseBody(reason: string): {
  error: 'checkout_required';
  code: 'checkout_required';
  message: string;
  reason: string;
} {
  return {
    error: 'checkout_required',
    code: 'checkout_required',
    message: 'Open checkout to start a new subscription.',
    reason,
  };
}

export interface LocalSubscriptionGateRow {
  paddle_subscription_id?: string | null;
  status?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
}

export type PlanChangeGate =
  | {
    action: 'checkout_required';
    reason: 'missing_subscription' | 'inactive_or_expired_subscription';
  }
  | { action: 'payment_past_due' }
  | { action: 'proceed'; paddleSubscriptionId: string };

/**
 * Decide whether paddle-update-subscription may send a plan change to Paddle.
 *
 * `past_due` keeps access (shared entitlement predicate), but Paddle rejects
 * item changes on a past-due subscription (`subscription_update_when_past_due`)
 * and a second checkout would risk a duplicate subscription. So a past_due
 * row is refused explicitly and the user is asked to update their payment
 * method.
 */
export function decidePlanChangeGate(
  sub: LocalSubscriptionGateRow | null | undefined,
  now: Date = new Date(),
): PlanChangeGate {
  if (!sub || !sub.paddle_subscription_id) {
    return { action: 'checkout_required', reason: 'missing_subscription' };
  }
  if (sub.status === 'past_due') {
    return { action: 'payment_past_due' };
  }
  if (
    !isSubscriptionEntitled(sub.status ?? 'none', sub.current_period_end ?? null, {
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      now,
    })
  ) {
    return { action: 'checkout_required', reason: 'inactive_or_expired_subscription' };
  }
  return { action: 'proceed', paddleSubscriptionId: sub.paddle_subscription_id };
}

export const PAYMENT_PAST_DUE_HTTP_STATUS = 409;

export function paymentPastDueResponseBody(): {
  error: 'payment_past_due';
  code: 'payment_past_due';
  message: string;
} {
  return {
    error: 'payment_past_due',
    code: 'payment_past_due',
    message: 'Your last payment failed. Update your payment method before changing your plan.',
  };
}

export type PaddleCancelRequest =
  | { allowed: false }
  | {
    allowed: true;
    effectiveFrom: 'next_billing_period' | 'immediately';
    localPatch:
      | { cancel_at_period_end: true }
      | { status: 'canceled'; cancel_at_period_end: false };
  };

/**
 * Decide how paddle-cancel-subscription cancels a subscription.
 *
 * - active / trialing: cancel at the end of the billing period (Paddle
 *   `next_billing_period`), keeping access until then.
 * - past_due: the user keeps access during Paddle's retry window and may
 *   leave. A scheduled cancel is the wrong model while payment is
 *   outstanding, so cancel immediately.
 * - anything else: nothing to cancel.
 */
export function resolvePaddleCancelRequest(
  status: string | null | undefined,
): PaddleCancelRequest {
  if (status === 'active' || status === 'trialing') {
    return {
      allowed: true,
      effectiveFrom: 'next_billing_period',
      localPatch: { cancel_at_period_end: true },
    };
  }
  if (status === 'past_due') {
    return {
      allowed: true,
      effectiveFrom: 'immediately',
      localPatch: { status: 'canceled', cancel_at_period_end: false },
    };
  }
  return { allowed: false };
}
