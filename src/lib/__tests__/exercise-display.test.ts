import { describe, expect, it } from "vitest";
import {
	displayExerciseName,
	isUntaggedExercise,
	UNTAGGED_EXERCISE_LABEL,
} from "@/lib/exercise-display";

describe("displayExerciseName", () => {
	it("maps the Unknown Exercise placeholder to the friendly label", () => {
		expect(displayExerciseName("Unknown Exercise")).toBe(
			UNTAGGED_EXERCISE_LABEL,
		);
	});

	it("maps null / undefined / blank names to the friendly label", () => {
		expect(displayExerciseName(null)).toBe(UNTAGGED_EXERCISE_LABEL);
		expect(displayExerciseName(undefined)).toBe(UNTAGGED_EXERCISE_LABEL);
		expect(displayExerciseName("   ")).toBe(UNTAGGED_EXERCISE_LABEL);
	});

	it("passes real exercise names through unchanged (trimmed)", () => {
		expect(displayExerciseName("Bench Press")).toBe("Bench Press");
		expect(displayExerciseName("  Bicep Curl  ")).toBe("Bicep Curl");
	});
});

describe("isUntaggedExercise", () => {
	it("detects the placeholder and empty names", () => {
		expect(isUntaggedExercise("Unknown Exercise")).toBe(true);
		expect(isUntaggedExercise(null)).toBe(true);
		expect(isUntaggedExercise("")).toBe(true);
	});

	it("returns false for real exercise names", () => {
		expect(isUntaggedExercise("Bench Press")).toBe(false);
	});
});
