import { describe, expect, it } from "vitest";
import type { CycleDay } from "@/schemas/transforms";
import { computeNextWorkout } from "./computeNextWorkout";

const makeCycleDay = (
	overrides: Partial<CycleDay> & { day_number: number; day_type: string },
): CycleDay => ({
	id: crypto.randomUUID(),
	cycle_id: "cycle-1",
	routine_id: overrides.day_type === "rest" ? null : "routine-1",
	weight_adjustment: 0,
	rep_modifier: 0,
	rest_override: null,
	notes: null,
	rest_type: overrides.day_type === "rest" ? "active" : null,
	...overrides,
});

function makeWeek(): CycleDay[] {
	return [
		makeCycleDay({ day_number: 1, day_type: "workout" }),
		makeCycleDay({ day_number: 2, day_type: "workout" }),
		makeCycleDay({ day_number: 3, day_type: "rest" }),
		makeCycleDay({ day_number: 4, day_type: "workout" }),
		makeCycleDay({ day_number: 5, day_type: "workout" }),
		makeCycleDay({ day_number: 6, day_type: "rest" }),
		makeCycleDay({ day_number: 7, day_type: "workout" }),
	];
}

describe("computeNextWorkout", () => {
	const startDate = new Date(2026, 0, 5); // Jan 5, 2026 (Monday)

	it("returns null when cycleDays is empty", () => {
		const result = computeNextWorkout([], startDate, 4, startDate);
		expect(result).toBeNull();
	});

	it("returns correct day on first day of cycle", () => {
		const days = makeWeek();
		const result = computeNextWorkout(days, startDate, 4, startDate);
		expect(result).not.toBeNull();
		expect(result!.dayNumber).toBe(1);
		expect(result!.dayType).toBe("workout");
		expect(result!.isRestDay).toBe(false);
	});

	it("returns correct day mid-cycle", () => {
		const days = makeWeek();
		// 3 days after start = index 3 = day_number 4
		const today = new Date(2026, 0, 8);
		const result = computeNextWorkout(days, startDate, 4, today);
		expect(result).not.toBeNull();
		expect(result!.dayNumber).toBe(4);
	});

	it("handles rest days", () => {
		const days = makeWeek();
		// 2 days after start = index 2 = day_number 3 (rest day)
		const today = new Date(2026, 0, 7);
		const result = computeNextWorkout(days, startDate, 4, today);
		expect(result).not.toBeNull();
		expect(result!.isRestDay).toBe(true);
		expect(result!.routineId).toBeNull();
		expect(result!.dayType).toBe("rest");
	});

	it("wraps around when days exceed cycleDays.length", () => {
		const days = makeWeek();
		// 8 days after start (Jan 13) => daysSinceStart=8, index = 8%7=1 => day_number 2
		const today = new Date(2026, 0, 13);
		const result = computeNextWorkout(days, startDate, 4, today);
		expect(result).not.toBeNull();
		expect(result!.dayNumber).toBe(2);
	});

	it("returns null when cycle has ended", () => {
		const days = makeWeek();
		// 4 weeks = 28 days. Day 28 (index 27, 0-based daysSinceStart) is last valid day.
		// daysSinceStart = 28 means cycle ended.
		const today = new Date(2026, 1, 2); // Feb 2 = 28 days after Jan 5
		const result = computeNextWorkout(days, startDate, 4, today);
		expect(result).toBeNull();
	});

	it("returns null when today is before cycle start", () => {
		const days = makeWeek();
		const today = new Date(2026, 0, 4); // Jan 4 = 1 day before start
		const result = computeNextWorkout(days, startDate, 4, today);
		expect(result).toBeNull();
	});

	it("computes correct cycleWeek", () => {
		const days = makeWeek();

		// Day 1 (index 0) = week 1
		const day1 = computeNextWorkout(days, startDate, 4, startDate);
		expect(day1!.cycleWeek).toBe(1);

		// Day 8 (index 7, daysSinceStart=7) = week 2
		const day8 = computeNextWorkout(days, startDate, 4, new Date(2026, 0, 12));
		expect(day8!.cycleWeek).toBe(2);

		// Day 14 (daysSinceStart=13) = week 2
		const day14 = computeNextWorkout(days, startDate, 4, new Date(2026, 0, 18));
		expect(day14!.cycleWeek).toBe(2);

		// Day 15 (daysSinceStart=14) = week 3
		const day15 = computeNextWorkout(days, startDate, 4, new Date(2026, 0, 19));
		expect(day15!.cycleWeek).toBe(3);
	});
});
