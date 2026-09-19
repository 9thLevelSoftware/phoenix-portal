export type SubscriptionTier = "FREE" | "EMBER" | "FLAME" | "INFERNO";

export type SubscriptionStatus =
	| "active"
	| "past_due"
	| "canceled"
	| "trialing"
	| "incomplete"
	| "none";

export const ACTIVE_SUBSCRIPTION_STATUSES: ReadonlySet<SubscriptionStatus> =
	new Set(["active", "trialing"]);

export function isActiveSubscriptionStatus(
	status: SubscriptionStatus,
): boolean {
	return ACTIVE_SUBSCRIPTION_STATUSES.has(status);
}

/**
 * Renewal grace for `status = "active"`: access continues while
 * `now < current_period_end + ENTITLEMENT_GRACE_HOURS`.
 *
 * PARITY: the same predicate lives in
 * supabase/functions/_shared/subscriptionEntitlement.ts and in SQL
 * `public.subscription_tier_for(uuid)`. All three are checked against
 * tests/fixtures/entitlement-cases.json; change them together.
 */
export const ENTITLEMENT_GRACE_HOURS = 48;

const GRACE_MS = ENTITLEMENT_GRACE_HOURS * 60 * 60 * 1000;

const PAID_TIERS: ReadonlySet<string> = new Set(["EMBER", "FLAME", "INFERNO"]);

/**
 * - `past_due`: entitled whatever `current_period_end` says (Paddle is still
 *   retrying payment; access ends when Paddle cancels or pauses, both stored
 *   as `canceled`).
 * - `active`: entitled until `current_period_end + ENTITLEMENT_GRACE_HOURS`.
 * - `trialing`: entitled until `current_period_end` (no grace).
 * - anything else, or a missing/invalid period end where one is needed: no access.
 */
export function hasCurrentPeriodAccess(
	status: SubscriptionStatus,
	currentPeriodEnd: string | null | undefined,
	now: Date = new Date(),
): boolean {
	if (status === "past_due") {
		return true;
	}
	if (!isActiveSubscriptionStatus(status) || !currentPeriodEnd) {
		return false;
	}

	const periodEndMs = Date.parse(currentPeriodEnd);
	if (!Number.isFinite(periodEndMs)) {
		return false;
	}
	const accessEndMs =
		status === "active" ? periodEndMs + GRACE_MS : periodEndMs;
	return now.getTime() < accessEndMs;
}

export function getEffectiveSubscriptionTier(
	rawTier: SubscriptionTier | string,
	status: SubscriptionStatus,
	currentPeriodEnd: string | null | undefined,
	now: Date = new Date(),
): SubscriptionTier {
	if (!PAID_TIERS.has(rawTier)) {
		return "FREE";
	}
	return hasCurrentPeriodAccess(status, currentPeriodEnd, now)
		? (rawTier as SubscriptionTier)
		: "FREE";
}

/**
 * True when an active/trialing row's period has ended, so the portal should
 * ask Paddle for a refresh. Deliberately ignores the renewal grace: during
 * the grace window the user stays entitled AND stale, so the refresh runs.
 */
export function isStaleActiveSubscription(
	status: SubscriptionStatus,
	currentPeriodEnd: string | null | undefined,
	now: Date = new Date(),
): boolean {
	if (!isActiveSubscriptionStatus(status)) {
		return false;
	}

	if (!currentPeriodEnd) {
		return true;
	}

	const periodEndMs = Date.parse(currentPeriodEnd);
	return !Number.isFinite(periodEndMs) || periodEndMs <= now.getTime();
}
