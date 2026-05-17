import { describe, expect, it } from "vitest";
import {
	getEffectiveSubscriptionTier,
	hasCurrentPeriodAccess,
	isStaleActiveSubscription,
} from "./subscription-entitlement";

describe("subscription entitlement", () => {
	const now = new Date("2026-05-17T12:00:00Z");

	it("grants the paid tier for an active subscription with a future period end", () => {
		expect(
			getEffectiveSubscriptionTier(
				"FLAME",
				"active",
				"2026-06-01T00:00:00Z",
				now,
			),
		).toBe("FLAME");
		expect(hasCurrentPeriodAccess("active", "2026-06-01T00:00:00Z", now)).toBe(
			true,
		);
	});

	it("denies the paid tier for an active subscription with a past period end", () => {
		expect(
			getEffectiveSubscriptionTier(
				"FLAME",
				"active",
				"2026-04-17T00:00:00Z",
				now,
			),
		).toBe("FREE");
		expect(
			isStaleActiveSubscription("active", "2026-04-17T00:00:00Z", now),
		).toBe(true);
	});

	it("grants access for a scheduled cancellation until the future period end", () => {
		expect(
			getEffectiveSubscriptionTier(
				"EMBER",
				"active",
				"2026-06-17T00:00:00Z",
				now,
			),
		).toBe("EMBER");
	});

	it.each([
		"canceled",
		"past_due",
		"incomplete",
		"none",
	] as const)("denies the paid tier for status %s", (status) => {
		expect(
			getEffectiveSubscriptionTier(
				"INFERNO",
				status,
				"2026-06-17T00:00:00Z",
				now,
			),
		).toBe("FREE");
	});

	it("denies active subscriptions with missing or invalid period ends", () => {
		expect(getEffectiveSubscriptionTier("FLAME", "active", null, now)).toBe(
			"FREE",
		);
		expect(
			getEffectiveSubscriptionTier("FLAME", "active", "not-a-date", now),
		).toBe("FREE");
		expect(isStaleActiveSubscription("active", null, now)).toBe(true);
		expect(isStaleActiveSubscription("active", "not-a-date", now)).toBe(true);
	});
});
