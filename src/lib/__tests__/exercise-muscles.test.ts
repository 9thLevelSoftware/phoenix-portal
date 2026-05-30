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

	describe("keyword fallback tier (real DB names)", () => {
		// These names exist in production data, normalize to something not in
		// EXERCISE_MAP, and score below the 0.7 fuzzy threshold, so before the
		// keyword tier they all collapsed to "General".
		const cases: Array<[string, string]> = [
			["Conventional Deadlift", "Back"],
			["Suitcase Deadlift", "Back"],
			["Bayesian Curl", "Arms"],
			["Outward Bicep Curl", "Arms"],
			["Alternating Bicep Curls", "Arms"],
			["Alternating Hammer Curl", "Arms"],
			["Low Bar Squat", "Legs"],
			["High Bar Squat", "Legs"],
			["Squat Pulses", "Legs"],
			["Suitcase Squat", "Legs"],
			["Bulgarian Split Squats", "Legs"],
			["Side Lunge", "Legs"],
			["Close Grip Pulldown", "Back"],
			["Wide Grip Pulldown", "Back"],
			["Lying Pec Fly", "Chest"],
			["Incline Pec Fly", "Chest"],
			["Cable Fly", "Chest"],
			["Lat Pullover", "Chest"],
			["Prone Lat Pullover", "Chest"],
			["SL Hamstring Curl", "Legs"],
			["Standing Hamstring Curl", "Legs"],
			["Lying Leg Extension", "Legs"],
			["SL Glute Bridge", "Legs"],
			["Split Stance RDL", "Legs"],
			["SL RDL w/ Knee Raise", "Legs"],
			["Stiff Leg Deadlift", "Legs"],
			["Crossover Lateral Raise", "Shoulders"],
			["Double Arm Front Raise", "Shoulders"],
			["Shoulder Press - Neutral Grip", "Shoulders"],
			["Rear Delt Row", "Shoulders"],
			["Crossover Rear Delt Row - Single Arm", "Shoulders"],
			["Face Pulls", "Shoulders"],
			["Kneeling Row", "Back"],
			["Seated SA Row", "Back"],
			["Bent Over Row - Wide Grip", "Back"],
			["Bent Over Shrug", "Back"],
			["Neutral Grip Bench Press", "Chest"],
			["Alternating Bench Press", "Chest"],
			["Chest Press - Gym Ball", "Chest"],
			["Bench Press - Wide Grip", "Chest"],
			["Bent Over Tricep Extension", "Arms"],
			["Tricep Kick Back", "Arms"],
			["Alternating Oblique Punch", "Core"],
			["SA Bicycle Crunch", "Core"],
			["High Crunch", "Core"],
			["Double Leg Raise (Bench Supported)", "Core"],
		];

		for (const [name, expected] of cases) {
			it(`classifies "${name}" as ${expected}`, () => {
				expect(getExerciseProfile(name).primary.group).toBe(expected);
			});
		}

		it("does not let generic 'curl' override 'hamstring curl' -> Legs", () => {
			expect(getExerciseProfile("Seated Hamstring Curl").primary.group).toBe(
				"Legs",
			);
		});

		it("does not let generic 'row' override 'rear delt' -> Shoulders", () => {
			expect(getExerciseProfile("Rear Delt Row").primary.group).toBe(
				"Shoulders",
			);
		});

		it("leaves genuinely unknown / ambiguous names as General", () => {
			expect(getExerciseProfile("Unknown Exercise").primary.group).toBe(
				"General",
			);
			expect(getExerciseProfile("Bear Crawl").primary.group).toBe("General");
		});

		it("still prefers an explicit dbMuscleGroup over keyword guessing only when name is unclassifiable", () => {
			// classifiable name wins over db hint
			expect(getExerciseProfile("Bayesian Curl", "Back").primary.group).toBe(
				"Arms",
			);
			// unclassifiable name falls back to db hint
			expect(getExerciseProfile("Bear Crawl", "Core").primary.group).toBe(
				"Core",
			);
		});
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
