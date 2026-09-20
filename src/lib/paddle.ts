/**
 * Paddle cancel-flow copy for the portal UI.
 *
 * The webhook types and signature verification that used to live here were a
 * dead duplicate of the Edge Function's own copy and were removed (PR 7); only
 * the browser-side cancel feedback remains.
 */

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
