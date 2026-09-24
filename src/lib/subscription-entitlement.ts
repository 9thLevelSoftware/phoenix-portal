/**
 * Subscription entitlement for the SPA.
 *
 * The predicate itself has ONE TypeScript implementation (F-059):
 * `supabase/functions/_shared/subscriptionEntitlement.ts`, shared with the Edge
 * Functions. This module re-exports it under the names the SPA already uses
 * and adds only SPA concerns (the refresh-staleness check below). SQL keeps
 * its own copy in `public.subscription_tier_for(uuid)`; both are pinned to
 * tests/fixtures/entitlement-cases.json, so change them together.
 */
import {
	ENTITLEMENT_GRACE_HOURS as ENTITLEMENT_GRACE_HOURS_VALUE,
	type EntitlementOptions,
	effectiveSubscriptionTier,
	isSubscriptionEntitled,
	type SubscriptionStatus,
	type SubscriptionTier,
} from "../../supabase/functions/_shared/subscriptionEntitlement.ts";

export {
	ENTITLEMENT_GRACE_HOURS,
	type EntitlementOptions,
	type SubscriptionStatus,
	type SubscriptionTier,
} from "../../supabase/functions/_shared/subscriptionEntitlement.ts";

export const ACTIVE_SUBSCRIPTION_STATUSES: ReadonlySet<SubscriptionStatus> =
	new Set(["active", "trialing"]);

export function isActiveSubscriptionStatus(
	status: SubscriptionStatus,
): boolean {
	return ACTIVE_SUBSCRIPTION_STATUSES.has(status);
}

/**
 * A past_due row whose period ended (or, with no period end, that has not
 * changed) more than this long ago is treated as stale, so the portal asks
 * Paddle for the current state. Access is unaffected; this only lets a lost
 * cancel/pause webhook heal itself.
 */
export const PAST_DUE_REFRESH_AFTER_DAYS = 3;

const HOUR_MS = 60 * 60 * 1000;
const PAST_DUE_REFRESH_AFTER_MS = PAST_DUE_REFRESH_AFTER_DAYS * 24 * HOUR_MS;

/** Whether the row grants access now; see `isSubscriptionEntitled`. */
export function hasCurrentPeriodAccess(
	status: SubscriptionStatus,
	currentPeriodEnd: string | null | undefined,
	options: EntitlementOptions = {},
): boolean {
	return isSubscriptionEntitled(status, currentPeriodEnd, options);
}

/** The stored paid tier when entitled, otherwise FREE (fails closed). */
export function getEffectiveSubscriptionTier(
	rawTier: SubscriptionTier,
	status: SubscriptionStatus,
	currentPeriodEnd: string | null | undefined,
	options: EntitlementOptions = {},
): SubscriptionTier {
	return effectiveSubscriptionTier(rawTier, status, currentPeriodEnd, options);
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

/**
 * The next instant at which the row's derived state can change with no write
 * to the row: the effective tier, the billing action or `isStale`. A lapse by
 * time sends no Realtime event, so the gate schedules a re-render for this
 * instant instead of showing paid copy until the next refetch (NF-35).
 *
 * - active / trialing: the period end (stale, trial and scheduled-cancel
 *   entitlement, billing action) and the period end plus the renewal grace
 *   (active entitlement).
 * - past_due: the refresh threshold of `isStaleActiveSubscription`.
 *
 * Returns epoch ms, or null when no future boundary exists.
 */
export function nextEntitlementChangeAt(
	status: SubscriptionStatus,
	currentPeriodEnd: string | null | undefined,
	options: { now?: Date; updatedAt?: string | null } = {},
): number | null {
	const nowMs = (options.now ?? new Date()).getTime();
	const candidates: number[] = [];

	if (status === "past_due") {
		const referenceMs = Date.parse(currentPeriodEnd ?? options.updatedAt ?? "");
		if (Number.isFinite(referenceMs)) {
			candidates.push(referenceMs + PAST_DUE_REFRESH_AFTER_MS);
		}
	} else if (isActiveSubscriptionStatus(status) && currentPeriodEnd) {
		const periodEndMs = Date.parse(currentPeriodEnd);
		if (Number.isFinite(periodEndMs)) {
			candidates.push(
				periodEndMs,
				periodEndMs + ENTITLEMENT_GRACE_HOURS_VALUE * HOUR_MS,
			);
		}
	}

	const future = candidates.filter((ms) => ms > nowMs);
	return future.length > 0 ? Math.min(...future) : null;
}
