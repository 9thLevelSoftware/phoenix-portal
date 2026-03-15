/** RevenueCat webhook event types */
export type RevenueCatEventType =
	| "INITIAL_PURCHASE"
	| "RENEWAL"
	| "CANCELLATION"
	| "UNCANCELLATION"
	| "EXPIRATION"
	| "BILLING_ISSUE"
	| "PRODUCT_CHANGE"
	| "SUBSCRIPTION_EXTENDED"
	| "REFUND_REVERSED"
	| "TEST";

/** RevenueCat webhook event payload (relevant fields) */
export interface RevenueCatEvent {
	id: string;
	type: RevenueCatEventType;
	app_user_id: string;
	original_app_user_id?: string;
	aliases?: string[];
	product_id?: string;
	entitlement_ids?: string[];
	period_type?: string;
	purchased_at_ms?: number;
	expiration_at_ms?: number;
	store?: string;
	environment?: string;
	cancel_at_period_end?: boolean;
}

/**
 * Maps RevenueCat entitlement IDs to Phoenix Portal subscription tiers.
 * Priority: INFERNO > EMBER > FREE (highest tier wins).
 *
 * Entitlement IDs are configured in the RevenueCat dashboard.
 * Current mapping: "elite" -> INFERNO, "phoenix" -> EMBER.
 */
export function mapEntitlementsToTier(
	entitlementIds: string[] | null | undefined,
): string {
	if (!entitlementIds?.length) return "FREE";
	if (entitlementIds.includes("elite")) return "INFERNO";
	if (entitlementIds.includes("phoenix")) return "EMBER";
	return "FREE";
}

/**
 * Maps a RevenueCat event type to the portal's subscription status.
 * Returns null for events that don't map to a status change (CANCELLATION is handled separately).
 */
export function mapEventToStatus(
	eventType: string,
	periodType?: string,
): string | null {
	switch (eventType) {
		case "INITIAL_PURCHASE":
			return periodType === "TRIAL" ? "trialing" : "active";
		case "RENEWAL":
		case "UNCANCELLATION":
		case "SUBSCRIPTION_EXTENDED":
		case "REFUND_REVERSED":
		case "PRODUCT_CHANGE":
			return "active";
		case "EXPIRATION":
			return "canceled";
		case "BILLING_ISSUE":
			return "past_due";
		case "CANCELLATION":
			return null; // Handled separately — cancel_at_period_end = true, status stays active
		default:
			return null;
	}
}

/**
 * Builds the upsert payload for the subscriptions table from a RevenueCat event.
 * Returns null for events that should not result in a DB write (TEST, unknown).
 */
export function buildSubscriptionUpsert(
	event: RevenueCatEvent,
): Record<string, unknown> | null {
	if (event.type === "TEST") return null;

	// CANCELLATION is special: don't change tier/status, just flag cancel_at_period_end
	if (event.type === "CANCELLATION") {
		return {
			user_id: event.app_user_id,
			cancel_at_period_end: true,
			updated_at: new Date().toISOString(),
			last_event_id: event.id,
		};
	}

	const status = mapEventToStatus(event.type, event.period_type);
	if (!status) return null;

	const tier = mapEntitlementsToTier(event.entitlement_ids);

	return {
		user_id: event.app_user_id,
		revenuecat_customer_id: event.original_app_user_id ?? event.app_user_id,
		tier,
		status,
		product_id: event.product_id ?? null,
		entitlement_ids: event.entitlement_ids ?? [],
		store: event.store ?? null,
		environment: event.environment ?? "PRODUCTION",
		current_period_end: event.expiration_at_ms
			? new Date(event.expiration_at_ms).toISOString()
			: null,
		current_period_start: event.purchased_at_ms
			? new Date(event.purchased_at_ms).toISOString()
			: null,
		cancel_at_period_end: event.type === "UNCANCELLATION" ? false : undefined,
		updated_at: new Date().toISOString(),
		last_event_id: event.id,
	};
}
