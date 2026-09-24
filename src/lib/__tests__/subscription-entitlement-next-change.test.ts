import { describe, expect, it } from "vitest";
import { nextEntitlementChangeAt } from "../subscription-entitlement";

const NOW = new Date("2026-09-23T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const at = (iso: string) => Date.parse(iso);

describe("nextEntitlementChangeAt (NF-35)", () => {
	it("returns the period end first, then the end of the renewal grace", () => {
		const periodEnd = "2026-09-24T12:00:00.000Z";
		expect(nextEntitlementChangeAt("active", periodEnd, { now: NOW })).toBe(
			at(periodEnd),
		);
		expect(
			nextEntitlementChangeAt("active", periodEnd, {
				now: new Date(at(periodEnd) + HOUR),
			}),
		).toBe(at(periodEnd) + 48 * HOUR);
	});

	it("returns the period end for a trial", () => {
		const periodEnd = "2026-09-23T13:00:00.000Z";
		expect(nextEntitlementChangeAt("trialing", periodEnd, { now: NOW })).toBe(
			at(periodEnd),
		);
	});

	it("returns the past_due refresh threshold, from the period end or last update", () => {
		expect(
			nextEntitlementChangeAt("past_due", "2026-09-22T12:00:00.000Z", {
				now: NOW,
			}),
		).toBe(at("2026-09-25T12:00:00.000Z"));
		expect(
			nextEntitlementChangeAt("past_due", null, {
				now: NOW,
				updatedAt: "2026-09-21T12:00:00.000Z",
			}),
		).toBe(at("2026-09-24T12:00:00.000Z"));
	});

	it("returns null when nothing can change with time", () => {
		expect(
			nextEntitlementChangeAt("active", "2026-09-01T00:00:00.000Z", {
				now: NOW,
			}),
		).toBeNull();
		expect(
			nextEntitlementChangeAt("canceled", "2026-12-01T00:00:00.000Z", {
				now: NOW,
			}),
		).toBeNull();
		expect(nextEntitlementChangeAt("active", null, { now: NOW })).toBeNull();
		expect(
			nextEntitlementChangeAt("active", "not a date", { now: NOW }),
		).toBeNull();
	});
});
