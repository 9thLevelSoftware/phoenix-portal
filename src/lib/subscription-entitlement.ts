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

export function hasCurrentPeriodAccess(
	status: SubscriptionStatus,
	currentPeriodEnd: string | null | undefined,
	now: Date = new Date(),
): boolean {
	if (!isActiveSubscriptionStatus(status) || !currentPeriodEnd) {
		return false;
	}

	const periodEndMs = Date.parse(currentPeriodEnd);
	return Number.isFinite(periodEndMs) && periodEndMs > now.getTime();
}

export function getEffectiveSubscriptionTier(
	rawTier: SubscriptionTier,
	status: SubscriptionStatus,
	currentPeriodEnd: string | null | undefined,
	now: Date = new Date(),
): SubscriptionTier {
	return hasCurrentPeriodAccess(status, currentPeriodEnd, now)
		? rawTier
		: "FREE";
}

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
