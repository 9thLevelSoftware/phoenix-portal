import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ENTITLEMENT_GRACE_HOURS,
	getEffectiveSubscriptionTier,
	hasCurrentPeriodAccess,
	isStaleActiveSubscription,
	type SubscriptionStatus,
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

	it("grants a trialing subscription with a future period end", () => {
		expect(
			getEffectiveSubscriptionTier(
				"EMBER",
				"trialing",
				"2026-06-01T00:00:00Z",
				now,
			),
		).toBe("EMBER");
		expect(
			hasCurrentPeriodAccess("trialing", "2026-06-01T00:00:00Z", now),
		).toBe(true);
	});

	it("denies a trialing subscription when current_period_end equals now", () => {
		expect(
			hasCurrentPeriodAccess("trialing", "2026-05-17T12:00:00Z", now),
		).toBe(false);
		expect(
			getEffectiveSubscriptionTier(
				"FLAME",
				"trialing",
				"2026-05-17T12:00:00Z",
				now,
			),
		).toBe("FREE");
	});

	it("keeps a stale active subscription entitled during the renewal grace", () => {
		const periodEnd = "2026-05-16T12:00:00Z";
		expect(
			getEffectiveSubscriptionTier("FLAME", "active", periodEnd, now),
		).toBe("FLAME");
		// Still stale, so the portal asks Paddle for a refresh.
		expect(isStaleActiveSubscription("active", periodEnd, now)).toBe(true);
	});
});

type EntitlementCase = {
	id: string;
	status: string;
	tier: string;
	periodEndOffsetSeconds: number | null;
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
				c.tier,
				c.status as SubscriptionStatus,
				periodEnd,
				now,
			),
		).toBe(c.expectedTier);
	});

	it("keeps the generated pgTAP parity test in sync with the fixture", () => {
		expect(() =>
			execFileSync(
				process.execPath,
				[
					join(repoRoot, "scripts", "gen-entitlement-parity-test.mjs"),
					"--check",
				],
				{ stdio: "pipe" },
			),
		).not.toThrow();
	});
});
