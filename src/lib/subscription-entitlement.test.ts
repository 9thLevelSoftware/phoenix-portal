import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderEntitlementParityTest } from "../../scripts/gen-entitlement-parity-test.mjs";
import {
	ENTITLEMENT_GRACE_HOURS,
	getEffectiveSubscriptionTier,
	hasCurrentPeriodAccess,
	isStaleActiveSubscription,
	PAST_DUE_REFRESH_AFTER_DAYS,
	type SubscriptionStatus,
	type SubscriptionTier,
} from "./subscription-entitlement";

describe("subscription entitlement", () => {
	const now = new Date("2026-05-17T12:00:00Z");

	it("grants the paid tier for an active subscription with a future period end", () => {
		expect(
			getEffectiveSubscriptionTier("FLAME", "active", "2026-06-01T00:00:00Z", {
				now,
			}),
		).toBe("FLAME");
		expect(
			hasCurrentPeriodAccess("active", "2026-06-01T00:00:00Z", { now }),
		).toBe(true);
	});

	it("denies the paid tier for an active subscription past the grace window", () => {
		expect(
			getEffectiveSubscriptionTier("FLAME", "active", "2026-04-17T00:00:00Z", {
				now,
			}),
		).toBe("FREE");
		expect(
			isStaleActiveSubscription("active", "2026-04-17T00:00:00Z", { now }),
		).toBe(true);
	});

	it("grants access for a scheduled cancellation until the future period end", () => {
		expect(
			getEffectiveSubscriptionTier("EMBER", "active", "2026-06-17T00:00:00Z", {
				now,
				cancelAtPeriodEnd: true,
			}),
		).toBe("EMBER");
	});

	it("gives a scheduled cancellation no renewal grace", () => {
		expect(
			getEffectiveSubscriptionTier("EMBER", "active", "2026-05-17T11:00:00Z", {
				now,
				cancelAtPeriodEnd: true,
			}),
		).toBe("FREE");
		expect(
			getEffectiveSubscriptionTier("EMBER", "active", "2026-05-17T11:00:00Z", {
				now,
			}),
		).toBe("EMBER");
	});

	it.each([
		"canceled",
		"incomplete",
		"none",
	] as const)("denies the paid tier for status %s", (status) => {
		expect(
			getEffectiveSubscriptionTier("INFERNO", status, "2026-06-17T00:00:00Z", {
				now,
			}),
		).toBe("FREE");
	});

	it("keeps the paid tier for past_due whatever the period end says", () => {
		expect(
			getEffectiveSubscriptionTier(
				"INFERNO",
				"past_due",
				"2026-05-07T12:00:00Z",
				{ now },
			),
		).toBe("INFERNO");
		expect(
			getEffectiveSubscriptionTier("INFERNO", "past_due", null, { now }),
		).toBe("INFERNO");
	});

	it("denies active subscriptions with missing or invalid period ends", () => {
		expect(getEffectiveSubscriptionTier("FLAME", "active", null, { now })).toBe(
			"FREE",
		);
		expect(
			getEffectiveSubscriptionTier("FLAME", "active", "not-a-date", { now }),
		).toBe("FREE");
		expect(isStaleActiveSubscription("active", null, { now })).toBe(true);
		expect(isStaleActiveSubscription("active", "not-a-date", { now })).toBe(
			true,
		);
	});

	it("grants a trialing subscription with a future period end", () => {
		expect(
			getEffectiveSubscriptionTier(
				"EMBER",
				"trialing",
				"2026-06-01T00:00:00Z",
				{ now },
			),
		).toBe("EMBER");
		expect(
			hasCurrentPeriodAccess("trialing", "2026-06-01T00:00:00Z", { now }),
		).toBe(true);
	});

	it("denies a trialing subscription when current_period_end equals now", () => {
		expect(
			hasCurrentPeriodAccess("trialing", "2026-05-17T12:00:00Z", { now }),
		).toBe(false);
		expect(
			getEffectiveSubscriptionTier(
				"FLAME",
				"trialing",
				"2026-05-17T12:00:00Z",
				{ now },
			),
		).toBe("FREE");
	});

	it("keeps a stale active subscription entitled during the renewal grace", () => {
		const periodEnd = "2026-05-16T12:00:00Z";
		expect(
			getEffectiveSubscriptionTier("FLAME", "active", periodEnd, { now }),
		).toBe("FLAME");
		// Still stale, so the portal asks Paddle for a refresh.
		expect(isStaleActiveSubscription("active", periodEnd, { now })).toBe(true);
	});

	it("maps a raw tier that slipped past parsing to FREE", () => {
		expect(
			getEffectiveSubscriptionTier(
				"PHOENIX" as SubscriptionTier,
				"active",
				"2026-06-01T00:00:00Z",
				{ now },
			),
		).toBe("FREE");
	});
});

describe("past_due staleness (lost cancel/pause webhook self-heal)", () => {
	const now = new Date("2026-05-17T12:00:00Z");
	const daysAgo = (days: number, extraMs = 0) =>
		new Date(
			now.getTime() - days * 24 * 60 * 60 * 1000 - extraMs,
		).toISOString();

	it("uses a 3-day threshold", () => {
		expect(PAST_DUE_REFRESH_AFTER_DAYS).toBe(3);
	});

	it("is not stale while the period ended at most 3 days ago", () => {
		expect(isStaleActiveSubscription("past_due", daysAgo(1), { now })).toBe(
			false,
		);
		expect(isStaleActiveSubscription("past_due", daysAgo(3), { now })).toBe(
			false,
		);
	});

	it("is stale once the period ended more than 3 days ago", () => {
		expect(
			isStaleActiveSubscription("past_due", daysAgo(3, 1000), { now }),
		).toBe(true);
		expect(isStaleActiveSubscription("past_due", daysAgo(10), { now })).toBe(
			true,
		);
	});

	it("uses the row's updated_at when there is no period end", () => {
		expect(
			isStaleActiveSubscription("past_due", null, {
				now,
				updatedAt: daysAgo(2),
			}),
		).toBe(false);
		expect(
			isStaleActiveSubscription("past_due", null, {
				now,
				updatedAt: daysAgo(4),
			}),
		).toBe(true);
		// No timestamp to judge by: not stale (no refresh loop on bad data).
		expect(isStaleActiveSubscription("past_due", null, { now })).toBe(false);
	});

	it("never changes past_due access", () => {
		expect(
			getEffectiveSubscriptionTier("FLAME", "past_due", daysAgo(10), { now }),
		).toBe("FLAME");
	});

	it("is never stale for canceled rows", () => {
		expect(isStaleActiveSubscription("canceled", daysAgo(10), { now })).toBe(
			false,
		);
	});
});

type EntitlementCase = {
	id: string;
	status: string;
	tier: string;
	periodEndOffsetSeconds: number | null;
	cancelAtPeriodEnd: boolean;
	expectedTier: string;
};

const repoRoot = process.cwd();
const fixture = JSON.parse(
	readFileSync(
		join(repoRoot, "tests", "fixtures", "entitlement-cases.json"),
		"utf8",
	),
) as { graceHours: number; cases: EntitlementCase[] };

describe("subscription entitlement parity fixture (client)", () => {
	const now = new Date("2026-05-17T12:00:00Z");

	it("uses the fixture's grace window", () => {
		expect(ENTITLEMENT_GRACE_HOURS).toBe(fixture.graceHours);
	});

	it.each(fixture.cases)("$id -> $expectedTier", (c) => {
		const periodEnd =
			c.periodEndOffsetSeconds === null
				? null
				: new Date(
						now.getTime() + c.periodEndOffsetSeconds * 1000,
					).toISOString();
		expect(
			getEffectiveSubscriptionTier(
				c.tier as SubscriptionTier,
				c.status as SubscriptionStatus,
				periodEnd,
				{ now, cancelAtPeriodEnd: c.cancelAtPeriodEnd },
			),
		).toBe(c.expectedTier);
	});

	it("keeps the generated pgTAP parity test in sync with the fixture", () => {
		const committed = readFileSync(
			join(
				repoRoot,
				"supabase",
				"tests",
				"database",
				"entitlement_parity.test.sql",
			),
			"utf8",
		).replace(/\r\n/g, "\n");
		expect(committed).toBe(renderEntitlementParityTest(fixture));
	});
});
