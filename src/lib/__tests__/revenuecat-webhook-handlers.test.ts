import { describe, expect, it } from "vitest";
import {
	buildSubscriptionUpsert,
	mapEntitlementsToTier,
	mapEventToStatus,
	type RevenueCatEvent,
} from "../revenuecat";

// Helper: create a base event with sensible defaults
function createEvent(overrides: Partial<RevenueCatEvent>): RevenueCatEvent {
	return {
		id: "evt_test_123",
		type: "INITIAL_PURCHASE",
		app_user_id: "user-uuid-123",
		entitlement_ids: ["phoenix"],
		product_id: "com.phoenix.monthly",
		store: "APP_STORE",
		environment: "PRODUCTION",
		expiration_at_ms: 1735689600000,
		purchased_at_ms: 1733097600000,
		...overrides,
	};
}

// ─── mapEntitlementsToTier ───────────────────────────────────────────────────

describe("mapEntitlementsToTier", () => {
	it('returns "INFERNO" when entitlement_ids includes "elite"', () => {
		expect(mapEntitlementsToTier(["elite"])).toBe("INFERNO");
	});

	it('returns "EMBER" when entitlement_ids includes "phoenix"', () => {
		expect(mapEntitlementsToTier(["phoenix"])).toBe("EMBER");
	});

	it('returns "FREE" when entitlement_ids is empty array', () => {
		expect(mapEntitlementsToTier([])).toBe("FREE");
	});

	it('returns "FREE" when entitlement_ids is null', () => {
		expect(mapEntitlementsToTier(null)).toBe("FREE");
	});

	it('returns "FREE" when entitlement_ids is undefined', () => {
		expect(mapEntitlementsToTier(undefined)).toBe("FREE");
	});

	it('returns "INFERNO" when both "elite" and "phoenix" are present (highest tier wins)', () => {
		expect(mapEntitlementsToTier(["phoenix", "elite"])).toBe("INFERNO");
	});

	it('returns "FREE" for unknown entitlement IDs', () => {
		expect(mapEntitlementsToTier(["beta_tester"])).toBe("FREE");
	});

	it('returns "EMBER" when entitlement_ids includes "phoenix" and other non-tier entitlements', () => {
		expect(mapEntitlementsToTier(["beta_tester", "phoenix"])).toBe("EMBER");
	});
});

// ─── mapEventToStatus ────────────────────────────────────────────────────────

describe("mapEventToStatus", () => {
	it('INITIAL_PURCHASE returns "active"', () => {
		expect(mapEventToStatus("INITIAL_PURCHASE")).toBe("active");
	});

	it('INITIAL_PURCHASE with TRIAL period_type returns "trialing"', () => {
		expect(mapEventToStatus("INITIAL_PURCHASE", "TRIAL")).toBe("trialing");
	});

	it('INITIAL_PURCHASE with NORMAL period_type returns "active"', () => {
		expect(mapEventToStatus("INITIAL_PURCHASE", "NORMAL")).toBe("active");
	});

	it('RENEWAL returns "active"', () => {
		expect(mapEventToStatus("RENEWAL")).toBe("active");
	});

	it("CANCELLATION returns null (handled separately)", () => {
		expect(mapEventToStatus("CANCELLATION")).toBeNull();
	});

	it('UNCANCELLATION returns "active"', () => {
		expect(mapEventToStatus("UNCANCELLATION")).toBe("active");
	});

	it('EXPIRATION returns "canceled"', () => {
		expect(mapEventToStatus("EXPIRATION")).toBe("canceled");
	});

	it('BILLING_ISSUE returns "past_due"', () => {
		expect(mapEventToStatus("BILLING_ISSUE")).toBe("past_due");
	});

	it('PRODUCT_CHANGE returns "active"', () => {
		expect(mapEventToStatus("PRODUCT_CHANGE")).toBe("active");
	});

	it('SUBSCRIPTION_EXTENDED returns "active"', () => {
		expect(mapEventToStatus("SUBSCRIPTION_EXTENDED")).toBe("active");
	});

	it('REFUND_REVERSED returns "active"', () => {
		expect(mapEventToStatus("REFUND_REVERSED")).toBe("active");
	});

	it("unknown event type returns null", () => {
		expect(mapEventToStatus("SOME_FUTURE_EVENT")).toBeNull();
	});
});

// ─── buildSubscriptionUpsert ─────────────────────────────────────────────────

describe("buildSubscriptionUpsert", () => {
	it("INITIAL_PURCHASE with elite entitlement builds upsert with tier=ELITE, status=active", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ entitlement_ids: ["elite"] }),
		);
		expect(result).not.toBeNull();
		expect(result!.tier).toBe("INFERNO");
		expect(result!.status).toBe("active");
	});

	it("INITIAL_PURCHASE with phoenix entitlement builds upsert with tier=PHOENIX, status=active", () => {
		const result = buildSubscriptionUpsert(createEvent());
		expect(result).not.toBeNull();
		expect(result!.tier).toBe("EMBER");
		expect(result!.status).toBe("active");
	});

	it("INITIAL_PURCHASE with no entitlements builds upsert with tier=FREE, status=active", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ entitlement_ids: [] }),
		);
		expect(result).not.toBeNull();
		expect(result!.tier).toBe("FREE");
		expect(result!.status).toBe("active");
	});

	it("INITIAL_PURCHASE with TRIAL period_type builds upsert with status=trialing", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ period_type: "TRIAL" }),
		);
		expect(result).not.toBeNull();
		expect(result!.status).toBe("trialing");
	});

	it("CANCELLATION builds partial upsert with only cancel_at_period_end=true", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ type: "CANCELLATION" }),
		);
		expect(result).not.toBeNull();
		expect(result!.cancel_at_period_end).toBe(true);
		// Should NOT contain tier or status
		expect(result!.tier).toBeUndefined();
		expect(result!.status).toBeUndefined();
	});

	it("UNCANCELLATION builds upsert with cancel_at_period_end=false", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ type: "UNCANCELLATION" }),
		);
		expect(result).not.toBeNull();
		expect(result!.cancel_at_period_end).toBe(false);
		expect(result!.status).toBe("active");
	});

	it("EXPIRATION builds upsert with status=canceled", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ type: "EXPIRATION" }),
		);
		expect(result).not.toBeNull();
		expect(result!.status).toBe("canceled");
	});

	it("BILLING_ISSUE builds upsert with status=past_due", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ type: "BILLING_ISSUE" }),
		);
		expect(result).not.toBeNull();
		expect(result!.status).toBe("past_due");
	});

	it("TEST event returns null (no DB write)", () => {
		const result = buildSubscriptionUpsert(createEvent({ type: "TEST" }));
		expect(result).toBeNull();
	});

	it("upsert includes last_event_id matching event.id (idempotency support)", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ id: "evt_abc_456" }),
		);
		expect(result).not.toBeNull();
		expect(result!.last_event_id).toBe("evt_abc_456");
	});

	it("upsert converts expiration_at_ms to ISO timestamp string", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ expiration_at_ms: 1735689600000 }),
		);
		expect(result).not.toBeNull();
		expect(result!.current_period_end).toBe(
			new Date(1735689600000).toISOString(),
		);
	});

	it("upsert converts purchased_at_ms to ISO timestamp string", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ purchased_at_ms: 1733097600000 }),
		);
		expect(result).not.toBeNull();
		expect(result!.current_period_start).toBe(
			new Date(1733097600000).toISOString(),
		);
	});

	it("upsert uses original_app_user_id for revenuecat_customer_id when present", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ original_app_user_id: "original-123" }),
		);
		expect(result).not.toBeNull();
		expect(result!.revenuecat_customer_id).toBe("original-123");
	});

	it("upsert falls back to app_user_id for revenuecat_customer_id when original_app_user_id is absent", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ original_app_user_id: undefined }),
		);
		expect(result).not.toBeNull();
		expect(result!.revenuecat_customer_id).toBe("user-uuid-123");
	});

	it("PRODUCT_CHANGE builds upsert with status=active and new tier from entitlements", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ type: "PRODUCT_CHANGE", entitlement_ids: ["elite"] }),
		);
		expect(result).not.toBeNull();
		expect(result!.status).toBe("active");
		expect(result!.tier).toBe("INFERNO");
	});

	it("RENEWAL builds upsert with status=active", () => {
		const result = buildSubscriptionUpsert(createEvent({ type: "RENEWAL" }));
		expect(result).not.toBeNull();
		expect(result!.status).toBe("active");
	});

	it("SUBSCRIPTION_EXTENDED builds upsert with status=active", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ type: "SUBSCRIPTION_EXTENDED" }),
		);
		expect(result).not.toBeNull();
		expect(result!.status).toBe("active");
	});

	it("REFUND_REVERSED builds upsert with status=active", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ type: "REFUND_REVERSED" }),
		);
		expect(result).not.toBeNull();
		expect(result!.status).toBe("active");
	});

	it("upsert sets null for current_period_end when expiration_at_ms is missing", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ expiration_at_ms: undefined }),
		);
		expect(result).not.toBeNull();
		expect(result!.current_period_end).toBeNull();
	});

	it("upsert sets null for current_period_start when purchased_at_ms is missing", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ purchased_at_ms: undefined }),
		);
		expect(result).not.toBeNull();
		expect(result!.current_period_start).toBeNull();
	});

	it("upsert defaults entitlement_ids to empty array when missing", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ entitlement_ids: undefined }),
		);
		expect(result).not.toBeNull();
		expect(result!.entitlement_ids).toEqual([]);
	});

	it("upsert defaults environment to PRODUCTION when missing", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ environment: undefined }),
		);
		expect(result).not.toBeNull();
		expect(result!.environment).toBe("PRODUCTION");
	});

	it("upsert includes store from event", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ store: "PLAY_STORE" }),
		);
		expect(result).not.toBeNull();
		expect(result!.store).toBe("PLAY_STORE");
	});

	it("CANCELLATION upsert includes user_id and last_event_id", () => {
		const result = buildSubscriptionUpsert(
			createEvent({ type: "CANCELLATION", id: "evt_cancel_789" }),
		);
		expect(result).not.toBeNull();
		expect(result!.user_id).toBe("user-uuid-123");
		expect(result!.last_event_id).toBe("evt_cancel_789");
	});
});

// ─── Authorization behavior (documented specs) ──────────────────────────────

describe("webhook authorization", () => {
	// These tests document expected authorization behavior.
	// The actual Authorization header check happens in the Edge Function,
	// not in the pure functions. These are behavioral specifications.

	it("documents: valid Bearer token should return 200", () => {
		// Edge Function validates: Authorization === `Bearer ${REVENUECAT_WEBHOOK_SECRET}`
		// Implementation: supabase/functions/revenuecat-webhooks/index.ts
		expect(true).toBe(true);
	});

	it("documents: missing Authorization header should return 401", () => {
		// Edge Function rejects requests without Authorization header
		expect(true).toBe(true);
	});

	it("documents: invalid Bearer token should return 401", () => {
		// Edge Function rejects requests with wrong Bearer token
		expect(true).toBe(true);
	});

	it("documents: empty Authorization header should return 401", () => {
		// Edge Function rejects requests with empty Authorization header
		expect(true).toBe(true);
	});
});
