import { describe, expect, it } from "vitest";
import { computeWorkoutStreak } from "../useStreak";

describe("computeWorkoutStreak", () => {
	it("golden: 51 consecutive UTC dates ending yesterday → 51", () => {
		const now = new Date(Date.UTC(2026, 7, 23, 15, 0, 0));
		const workouts = Array.from({ length: 51 }, (_, i) => {
			const day = new Date(Date.UTC(2026, 7, 22 - i, 18, 0, 0));
			return { started_at: day };
		});
		expect(computeWorkoutStreak(workouts, now)).toBe(51);
	});

	it("skips empty today and counts from yesterday", () => {
		const now = new Date(Date.UTC(2026, 7, 23, 8, 0, 0));
		const workouts = [
			{ started_at: new Date(Date.UTC(2026, 7, 22, 20, 0, 0)) },
			{ started_at: new Date(Date.UTC(2026, 7, 21, 20, 0, 0)) },
		];
		expect(computeWorkoutStreak(workouts, now)).toBe(2);
	});

	it("returns 0 when today and yesterday are empty", () => {
		const now = new Date(Date.UTC(2026, 7, 23, 8, 0, 0));
		const workouts = [
			{ started_at: new Date(Date.UTC(2026, 7, 20, 20, 0, 0)) },
		];
		expect(computeWorkoutStreak(workouts, now)).toBe(0);
	});
});
