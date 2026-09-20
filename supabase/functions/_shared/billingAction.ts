import {
  effectiveSubscriptionTier,
  isSubscriptionEntitled,
} from './subscriptionEntitlement.ts';

/**
 * The single billing routing predicate (R-11).
 *
 * Every surface that has to decide "what can this user do with billing right
 * now?" asks this function, so no two surfaces can disagree:
 *
 *   - `paddle-update-subscription` decides between a plan change, an
 *     update-payment transaction, a refresh and `checkout_required`.
 *   - `paddle-checkout-custom-data` refuses to sign a new checkout with 409
 *     `existing_subscription` for anything but `checkout`.
 *   - The SPA (`src/hooks/useSubscription.ts`, imported by relative path)
 *     picks the CTA and decides whether `openCheckout` may run at all.
 *
 * Because signing is refused exactly when the action is not `checkout`, and
 * `checkout_required` is returned exactly when it is, no state can both
 * demand a checkout and have that checkout refused (F-022, A-016).
 */

export type BillingActionName = 'manage' | 'refresh' | 'checkout';

export type BillingActionReason =
  /** No stored Paddle subscription id: nothing to manage. */
  | 'no_subscription'
  /** Paddle ended the subscription (cancel or pause, both stored as canceled). */
  | 'canceled_subscription'
  /** Entitled, but Paddle's last charge failed — the card needs updating. */
  | 'payment_past_due'
  /** Entitled: manage the existing subscription. */
  | 'entitled'
  /** A live subscription id whose stored state is not entitled — ask Paddle. */
  | 'entitlement_lapsed';

export interface BillingActionRow {
  paddle_subscription_id?: string | null;
  status?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
  /**
   * Stored tier. Required for `manage`: a row whose status is live but whose
   * tier is FREE or unrecognised grants nothing, so calling it `manage` would
   * leave the user with no access AND (via the 409 on signing) no way to buy
   * any. Such a row is `refresh` — ask Paddle what is really going on.
   */
  tier?: string | null;
}

export interface BillingActionResult {
  action: BillingActionName;
  reason: BillingActionReason;
  /**
   * `past_due`: the user keeps access during Paddle's retry window (binding
   * user decision, R-33) but must update their payment method.
   */
  needsPaymentUpdate: boolean;
  /** Entitled right now (`manage` is exactly the entitled set). */
  entitled: boolean;
  /** The subscription to manage, or null when a checkout is the only route. */
  paddleSubscriptionId: string | null;
}

/**
 * - `checkout`: no stored Paddle subscription id, or the stored status is
 *   `canceled` (Paddle's `paused` maps to `canceled` too). Starting a new
 *   subscription is safe: there is nothing live to double-bill.
 * - `manage`: entitled. `past_due` is entitled and additionally sets
 *   `needsPaymentUpdate`.
 * - `refresh`: a live, non-`canceled` Paddle subscription id whose stored
 *   state is not entitled — e.g. `active` with the period ended while the
 *   renewal webhook is late. Ask Paddle for the truth instead of selling the
 *   user a second subscription.
 */
export function billingAction(
  row: BillingActionRow | null | undefined,
  now: Date = new Date(),
): BillingActionResult {
  const paddleSubscriptionId = row?.paddle_subscription_id?.trim() || null;
  if (!paddleSubscriptionId) {
    return {
      action: 'checkout',
      reason: 'no_subscription',
      needsPaymentUpdate: false,
      entitled: false,
      paddleSubscriptionId: null,
    };
  }

  const status = row?.status ?? 'none';
  if (status === 'canceled') {
    return {
      action: 'checkout',
      reason: 'canceled_subscription',
      needsPaymentUpdate: false,
      entitled: false,
      paddleSubscriptionId: null,
    };
  }

  // Entitlement means "grants a paid tier right now", not merely "the status
  // and period look alive" — effectiveSubscriptionTier folds in the stored
  // tier and fails closed on an unrecognised one.
  const entitled = effectiveSubscriptionTier(
    row?.tier,
    status,
    row?.current_period_end ?? null,
    { cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end), now },
  ) !== 'FREE';

  if (!entitled) {
    return {
      action: 'refresh',
      reason: 'entitlement_lapsed',
      needsPaymentUpdate: false,
      entitled: false,
      paddleSubscriptionId,
    };
  }

  return {
    action: 'manage',
    reason: status === 'past_due' ? 'payment_past_due' : 'entitled',
    // Only an entitled (i.e. `manage`) past_due row asks for a new card; a
    // refresh row has no plan worth saving yet.
    needsPaymentUpdate: status === 'past_due',
    entitled: true,
    paddleSubscriptionId,
  };
}

/** Signing a brand-new checkout is allowed only for the `checkout` action. */
export function mayOpenNewCheckout(result: BillingActionResult): boolean {
  return result.action === 'checkout';
}

export const EXISTING_SUBSCRIPTION_HTTP_STATUS = 409;

export function existingSubscriptionResponseBody(result: BillingActionResult): {
  error: 'existing_subscription';
  code: 'existing_subscription';
  message: string;
  action: BillingActionName;
  reason: BillingActionReason;
} {
  return {
    error: 'existing_subscription',
    code: 'existing_subscription',
    message: result.needsPaymentUpdate
      ? 'Your last payment failed. Update your payment method instead of subscribing again.'
      : 'You already have a subscription. Manage it instead of subscribing again.',
    action: result.action,
    reason: result.reason,
  };
}

// ─── Foreign subscription events ────────────────────────────────────────────

export type SubscriptionEventTarget = 'apply' | 'ignore_untracked_subscription';

/**
 * Portal statuses that can leave a user entitled, i.e. the states an
 * untracked subscription may be adopted in. Mirrors the `status=` filter the
 * webhook sends to Paddle and the `p_status IN (…)` test inside
 * `public.apply_subscription_event` — change all three together.
 */
export const ENTITLEMENT_KEEPING_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'trialing',
  'past_due',
]);

/**
 * The same set as the `status=` filter Paddle's list-subscriptions API wants.
 * Derived, not restated, so the listing cannot ask for a status the adoption
 * path would then refuse (or vice versa) — that mismatch is what made a
 * past-due sibling un-adoptable and stranded a paying user on FREE.
 *
 * The only copy that cannot be shared from here is the `p_status IN (…)` test
 * inside `public.apply_subscription_event` (migration 20260920004400), which
 * names this constant in its comment and is covered by
 * supabase/tests/database/subscription_event_guard.test.sql.
 */
export const PADDLE_LIVE_STATUS_FILTER = [...ENTITLEMENT_KEEPING_STATUSES].join(
  ',',
);

export interface SubscriptionEventTargetInput {
  /** `data.id` of the incoming Paddle event. */
  incomingSubscriptionId: string | null | undefined;
  /** Portal status the incoming event maps to. */
  incomingStatus: string;
  /** The stored row (`null` when the user has none yet). */
  storedRow: BillingActionRow | null | undefined;
  now?: Date;
}

/**
 * Decide whether a webhook event may write the user's single subscription row.
 *
 * The row is keyed by `user_id`, so a customer with two Paddle subscriptions
 * has both of them writing the same row. The older subscription's
 * `subscription.canceled` would then revoke the access the newer, paid one
 * grants (F-022).
 *
 * An event whose subscription id differs from the stored, non-null one is
 * ignored — unless the incoming status is `active`/`trialing` and the stored
 * row is not entitled, which is how a user who resubscribed under a new
 * subscription gets adopted rather than locked out (R-34).
 *
 * The same rule is enforced inside `public.apply_subscription_event` so a
 * concurrent delivery cannot slip through the read-then-decide gap.
 */
export function classifySubscriptionEventTarget(
  input: SubscriptionEventTargetInput,
): SubscriptionEventTarget {
  const storedId = input.storedRow?.paddle_subscription_id?.trim() || null;
  const incomingId = input.incomingSubscriptionId?.trim() || null;
  if (!storedId || !incomingId || storedId === incomingId) {
    return 'apply';
  }

  // `past_due` belongs here: it keeps access during Paddle's retry window
  // (binding user decision, R-33). Leaving it out would make the rescue
  // unable to adopt a past-due sibling and drop a paying user to FREE.
  if (!ENTITLEMENT_KEEPING_STATUSES.has(input.incomingStatus)) {
    return 'ignore_untracked_subscription';
  }

  const storedEntitled = isSubscriptionEntitled(
    input.storedRow?.status ?? 'none',
    input.storedRow?.current_period_end ?? null,
    {
      cancelAtPeriodEnd: Boolean(input.storedRow?.cancel_at_period_end),
      now: input.now ?? new Date(),
    },
  );
  return storedEntitled ? 'ignore_untracked_subscription' : 'apply';
}
