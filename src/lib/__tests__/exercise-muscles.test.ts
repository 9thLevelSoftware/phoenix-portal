import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	EXERCISE_MAP,
	getExerciseProfile,
	normalizeExerciseName,
} from "@/lib/exercise-muscles";

const BACKFILL_MIGRATION = "20260529000000_backfill_exercise_muscle_groups.sql";

function parseBackfillNameMap(): {
	entries: Map<string, string>;
	duplicates: string[];
} {
	const sql = readFileSync(
		join(process.cwd(), "supabase", "migrations", BACKFILL_MIGRATION),
		"utf8",
	);
	const entries = new Map<string, string>();
	const duplicates: string[] = [];
	for (const match of sql.matchAll(/\('((?:''|[^'])*)',\s*'([^']+)'\)/g)) {
		const name = match[1].replace(/''/g, "'");
		if (entries.has(name)) {
			duplicates.push(name);
		}
		entries.set(name, match[2]);
	}
	return { entries, duplicates };
}

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
			["Deadlifts", "Back"],
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
			["Leg Presses", "Legs"],
			["Close Grip Pulldown", "Back"],
			["Wide Grip Pulldown", "Back"],
			["Lying Pec Fly", "Chest"],
			["Incline Pec Fly", "Chest"],
			["Reverse Flies", "Shoulders"],
			["Cable Fly", "Chest"],
			["Lat Pullover", "Chest"],
			["Pullovers", "Chest"],
			["Prone Lat Pullover", "Chest"],
			["SL Hamstring Curl", "Legs"],
			["Standing Hamstring Curl", "Legs"],
			["Lying Leg Extension", "Legs"],
			["SL Glute Bridge", "Legs"],
			["Split Stance RDL", "Legs"],
			["SL RDL w/ Knee Raise", "Legs"],
			["Stiff Leg Deadlift", "Legs"],
			["Stiff-Legged Deadlift", "Legs"],
			["Crossover Lateral Raise", "Shoulders"],
			["Lateral Raises", "Shoulders"],
			["Double Arm Front Raise", "Shoulders"],
			["Shoulder Press - Neutral Grip", "Shoulders"],
			["Shoulder Presses", "Shoulders"],
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
			["Cable Crossovers", "Chest"],
			["Pushups", "Chest"],
			["Pull-ups", "Back"],
			["Chin-ups", "Back"],
			["Bent Over Tricep Extension", "Arms"],
			["Tricep Kick Back", "Arms"],
			["Alternating Oblique Punch", "Core"],
			["SA Bicycle Crunch", "Core"],
			["High Crunch", "Core"],
			["Crunches", "Core"],
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
			expect(getExerciseProfile("Bar Rotation").primary.group).toBe("General");
			expect(getExerciseProfile("B Stance Bar Rotation").primary.group).toBe(
				"General",
			);
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

describe("exercise muscle group backfill migration", () => {
	it("covers every exact EXERCISE_MAP name with the same primary group", () => {
		const { entries, duplicates } = parseBackfillNameMap();
		const mismatches = Object.entries(EXERCISE_MAP)
			.filter(([name, profile]) => entries.get(name) !== profile.primary.group)
			.map(([name, profile]) => ({
				name,
				expected: profile.primary.group,
				actual: entries.get(name) ?? "missing",
			}));

		expect(duplicates).toEqual([]);
		expect(mismatches).toEqual([]);
	});
});
