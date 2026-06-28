export type PaddleSubscriptionPatchDecision =
  | { action: 'already_current' }
  | { action: 'uncancel'; body: { scheduled_change: null } }
  | {
    action: 'switch';
    body: {
      items: Array<{ price_id: string; quantity: number }>;
      proration_billing_mode: 'prorated_immediately';
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
      ? { action: 'uncancel', body: { scheduled_change: null } }
      : { action: 'already_current' };
  }

  return {
    action: 'switch',
    body: {
      items: buildSwitchItems(currentItems, currentPriceId, newPriceId),
      proration_billing_mode: 'prorated_immediately',
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
