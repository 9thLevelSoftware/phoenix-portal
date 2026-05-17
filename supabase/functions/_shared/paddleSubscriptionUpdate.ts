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

export function buildPaddleSubscriptionPatch(
  currentPriceId: string | null | undefined,
  newPriceId: string,
  cancelAtPeriodEnd: boolean,
): PaddleSubscriptionPatchDecision {
  if (currentPriceId === newPriceId) {
    return cancelAtPeriodEnd
      ? { action: 'uncancel', body: { scheduled_change: null } }
      : { action: 'already_current' };
  }

  return {
    action: 'switch',
    body: {
      items: [{ price_id: newPriceId, quantity: 1 }],
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
