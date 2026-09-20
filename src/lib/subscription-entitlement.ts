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
 * Renewal grace for `status = "active"` rows that will renew
 * (`cancel_at_period_end = false`): access continues while
 * `now < current_period_end + ENTITLEMENT_GRACE_HOURS`.
 *
 * PARITY: the same predicate lives in
 * supabase/functions/_shared/subscriptionEntitlement.ts and in SQL
 * `public.subscription_tier_for(uuid)`. All three are checked against
 * tests/fixtures/entitlement-cases.json; change them together.
 */
export const ENTITLEMENT_GRACE_HOURS = 48;

/**
 * A past_due row whose period ended (or, with no period end, that has not
 * changed) more than this long ago is treated as stale, so the portal asks
 * Paddle for the current state. Access is unaffected; this only lets a lost
 * cancel/pause webhook heal itself.
 */
export const PAST_DUE_REFRESH_AFTER_DAYS = 3;

const HOUR_MS = 60 * 60 * 1000;
const GRACE_MS = ENTITLEMENT_GRACE_HOURS * HOUR_MS;
const PAST_DUE_REFRESH_AFTER_MS = PAST_DUE_REFRESH_AFTER_DAYS * 24 * HOUR_MS;

const PAID_TIERS: ReadonlySet<string> = new Set(["EMBER", "FLAME", "INFERNO"]);

export interface EntitlementOptions {
	/** Row is scheduled to cancel at period end: no renewal grace. */
	cancelAtPeriodEnd?: boolean;
	now?: Date;
}

/**
 * - `past_due`: entitled whatever `current_period_end` says (Paddle is still
 *   retrying payment; access ends when Paddle cancels or pauses, both stored
 *   as `canceled`).
 * - `active`: entitled until `current_period_end + ENTITLEMENT_GRACE_HOURS`,
 *   or until `current_period_end` when `cancel_at_period_end` is set.
 * - `trialing`: entitled until `current_period_end` (no grace).
 * - anything else, or a missing/invalid period end where one is needed: no access.
 */
export function hasCurrentPeriodAccess(
	status: SubscriptionStatus,
	currentPeriodEnd: string | null | undefined,
	options: EntitlementOptions = {},
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
	const graceMs =
		status === "active" && !options.cancelAtPeriodEnd ? GRACE_MS : 0;
	const nowMs = (options.now ?? new Date()).getTime();
	return nowMs < periodEndMs + graceMs;
}

export function getEffectiveSubscriptionTier(
	rawTier: SubscriptionTier,
	status: SubscriptionStatus,
	currentPeriodEnd: string | null | undefined,
	options: EntitlementOptions = {},
): SubscriptionTier {
	// Runtime guard as well as a type: a raw value that slipped past parsing
	// (legacy PHOENIX/ELITE) must never grant access.
	if (!PAID_TIERS.has(rawTier)) {
		return "FREE";
	}
	return hasCurrentPeriodAccess(status, currentPeriodEnd, options)
		? rawTier
		: "FREE";
}

/**
 * True when the local row may be out of date, so the portal should ask
 * Paddle for a refresh (the one-time paddle-refresh-subscription call).
 *
 * - active / trialing: the period has ended. Deliberately ignores the
 *   renewal grace: during the grace window the user stays entitled AND
 *   stale, so the refresh runs.
 * - past_due: the period ended more than PAST_DUE_REFRESH_AFTER_DAYS ago, or,
 *   with no period end, the row was last updated more than that long ago.
 *   Access keeps the past_due rule; this only heals a lost cancel/pause
 *   webhook.
 */
export function isStaleActiveSubscription(
	status: SubscriptionStatus,
	currentPeriodEnd: string | null | undefined,
	options: { now?: Date; updatedAt?: string | null } = {},
): boolean {
	const nowMs = (options.now ?? new Date()).getTime();

	if (status === "past_due") {
		const referenceMs = Date.parse(currentPeriodEnd ?? options.updatedAt ?? "");
		return (
			Number.isFinite(referenceMs) &&
			nowMs > referenceMs + PAST_DUE_REFRESH_AFTER_MS
		);
	}

	if (!isActiveSubscriptionStatus(status)) {
		return false;
	}

	if (!currentPeriodEnd) {
		return true;
	}

	const periodEndMs = Date.parse(currentPeriodEnd);
	return !Number.isFinite(periodEndMs) || periodEndMs <= nowMs;
}
