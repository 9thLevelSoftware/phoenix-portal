/**
 * Portal-side Paddle helpers.
 *
 * Webhook payload types, tier resolution and signature verification live in the
 * Edge modules under `supabase/functions/_shared/` — this module keeps only the
 * UI-facing helpers the SPA needs.
 */

// ─── Cancel feedback ────────────────────────────────────────────────────────

/**
 * Toast text after paddle-cancel-subscription succeeds. A past_due
 * subscription is canceled immediately (`canceledImmediately: true`); others
 * are canceled at the end of the billing period.
 */
export function cancelSuccessMessage(
	data: { canceledImmediately?: boolean } | null | undefined,
): string {
	return data?.canceledImmediately
		? "Subscription canceled. Your paid access has ended."
		: "Subscription canceled. You'll retain access until the end of your billing period.";
}
