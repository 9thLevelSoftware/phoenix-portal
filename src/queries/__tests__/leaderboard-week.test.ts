import { describe, expect, it } from "vitest";
import { getCurrentWeekStart } from "@/queries/leaderboard";

describe("getCurrentWeekStart", () => {
	it("returns the UTC ISO-week Monday regardless of the browser time zone", () => {
		// Monday 2026-09-14 00:30 in UTC+10 is Sunday 2026-09-13 14:30 UTC.
		expect(getCurrentWeekStart(new Date("2026-09-13T14:30:00Z"))).toBe(
			"2026-09-07",
		);
		expect(getCurrentWeekStart(new Date("2026-09-14T00:00:00Z"))).toBe(
			"2026-09-14",
		);
		expect(getCurrentWeekStart(new Date("2026-09-16T22:00:00Z"))).toBe(
			"2026-09-14",
		);
		expect(getCurrentWeekStart(new Date("2026-09-20T23:59:59Z"))).toBe(
			"2026-09-14",
		);
	});
});
