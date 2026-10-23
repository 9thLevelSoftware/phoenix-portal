import { describe, expect, it, vi } from "vitest";
import { daysRemaining } from "@/lib/daysRemaining";

const DAY_MS = 1000 * 60 * 60 * 24;
const now = Date.parse("2026-06-01T12:00:00.000Z");

describe("daysRemaining", () => {
	it("rounds a partial day up and clamps a past end at zero", () => {
		expect(daysRemaining(now + DAY_MS, now)).toBe(1);
		expect(daysRemaining(now + 1, now)).toBe(1);
		expect(daysRemaining(now + 2 * DAY_MS + 1, now)).toBe(3);
		expect(daysRemaining(now, now)).toBe(0);
		expect(daysRemaining(now - DAY_MS, now)).toBe(0);
	});

	it("accepts an ISO string or Date and defaults now to Date.now()", () => {
		const end = new Date(now + DAY_MS);
		expect(daysRemaining(end.toISOString(), now)).toBe(1);
		expect(daysRemaining(end, now)).toBe(1);

		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(now);
		try {
			expect(daysRemaining(end)).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
