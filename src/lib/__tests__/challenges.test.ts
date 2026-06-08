import { describe, expect, it } from "vitest";
import { formatChallengeValue } from "../challenges";

describe("formatChallengeValue", () => {
	it("formats volume challenges with the preferred weight unit", () => {
		expect(formatChallengeValue(1000, "volume", "lbs", "kg")).toBe("2.2K lbs");
	});

	it("leaves non-volume challenge metrics unit-specific without conversion", () => {
		expect(formatChallengeValue(12, "workouts", "lbs", "workouts")).toBe(
			"12 workouts",
		);
	});
});
