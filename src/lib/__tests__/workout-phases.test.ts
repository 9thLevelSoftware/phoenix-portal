import { describe, expect, it } from "vitest";
import {
	formatWorkoutPhase,
	isNonCombinedWorkoutPhase,
	isWorkoutPhase,
	normalizeWorkoutPhase,
	WORKOUT_PHASE_FILTERS,
} from "@/lib/workout-phases";

describe("workout phase helpers", () => {
	it("normalizes API, database, and display phase values", () => {
		expect(normalizeWorkoutPhase("COMBINED")).toBe("Combined");
		expect(normalizeWorkoutPhase("Concentric")).toBe("Concentric");
		expect(normalizeWorkoutPhase("eccentric")).toBe("Eccentric");
		expect(normalizeWorkoutPhase(null)).toBe("Combined");
	});

	it("keeps phase filter order stable", () => {
		expect(WORKOUT_PHASE_FILTERS).toEqual([
			"all",
			"Combined",
			"Concentric",
			"Eccentric",
		]);
	});

	it("detects valid and non-combined phases", () => {
		expect(isWorkoutPhase("Concentric")).toBe(true);
		expect(isWorkoutPhase("Other")).toBe(false);
		expect(isNonCombinedWorkoutPhase("CONCENTRIC")).toBe(true);
		expect(isNonCombinedWorkoutPhase("COMBINED")).toBe(false);
	});

	it("formats unknown values defensively as Combined", () => {
		expect(formatWorkoutPhase("unexpected")).toBe("Combined");
	});
});
