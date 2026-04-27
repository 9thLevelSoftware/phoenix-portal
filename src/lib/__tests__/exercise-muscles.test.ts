import { describe, expect, it } from "vitest";
import {
	getExerciseProfile,
	normalizeExerciseName,
} from "@/lib/exercise-muscles";

describe("normalizeExerciseName", () => {
	it("lowercases and trims", () => {
		expect(normalizeExerciseName("  Bench Press  ")).toBe("bench press");
	});

	it("strips common prefixes", () => {
		expect(normalizeExerciseName("DB Curl")).toBe("curl");
		expect(normalizeExerciseName("BB Curl")).toBe("curl");
		expect(normalizeExerciseName("Cable Fly")).toBe("fly");
		expect(normalizeExerciseName("Machine Row")).toBe("row");
	});

	it("strips stacked prefixes iteratively", () => {
		expect(normalizeExerciseName("Seated Cable Fly")).toBe("fly");
		expect(normalizeExerciseName("Incline DB Bench Press")).toBe("bench press");
	});

	it("strips parenthetical suffixes", () => {
		expect(normalizeExerciseName("Incline Press (Dumbbell)")).toBe(
			"incline press",
		);
	});
});

describe("getExerciseProfile", () => {
	it("returns exact match for known exercise", () => {
		const profile = getExerciseProfile("Bench Press");
		expect(profile.primary.group).toBe("Chest");
		expect(profile.primary.activation).toBe(1.0);
		expect(profile.secondary.length).toBeGreaterThan(0);
	});

	it("returns match via normalization", () => {
		const profile = getExerciseProfile("DB Bench Press");
		expect(profile.primary.group).toBe("Chest");
	});

	it("falls back to dbMuscleGroup when no match", () => {
		const profile = getExerciseProfile("Some Unknown Exercise", "Back");
		expect(profile.primary.group).toBe("Back");
		expect(profile.primary.activation).toBe(1.0);
		expect(profile.secondary).toEqual([]);
	});

	it("falls back to General when no match and no dbMuscleGroup", () => {
		const profile = getExerciseProfile("Totally Unknown");
		expect(profile.primary.group).toBe("General");
	});

	it("uses token overlap for fuzzy match", () => {
		const profile = getExerciseProfile("Incline Bench Press");
		expect(profile.primary.group).toBe("Chest");
	});

	it("all profiles use the 6 parent groups", () => {
		const validGroups = new Set([
			"Chest",
			"Back",
			"Shoulders",
			"Arms",
			"Legs",
			"Core",
		]);
		for (const name of [
			"Bench Press",
			"Squat",
			"Bicep Curl",
			"Overhead Press",
			"Deadlift",
			"Plank",
		]) {
			const p = getExerciseProfile(name);
			expect(validGroups.has(p.primary.group)).toBe(true);
			for (const s of p.secondary) {
				expect(validGroups.has(s.group)).toBe(true);
			}
		}
	});
});
