import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import type { PersonalRecord, WorkoutSession } from "@/schemas/transforms";
import { generateRecordsCSV, generateWorkoutCSV } from "./csv";
import { escapeCSVField } from "./csv-security";

const dangerousPrefixes = ["=", "+", "-", "@", "\t", "\r"];

function parseCSV(csv: string): Record<string, string>[] {
	const result = Papa.parse<Record<string, string>>(csv, {
		header: true,
		skipEmptyLines: true,
	});
	return result.data;
}

describe("CSV export formula escaping", () => {
	it.each(
		dangerousPrefixes,
	)("escapes manually generated CSV fields that start with %j", (prefix) => {
		expect(escapeCSVField(`${prefix}formula`)).toContain(`'${prefix}formula`);
	});

	it("preserves regular CSV quoting after formula escaping", () => {
		expect(escapeCSVField('=SUM("a",1)')).toBe(`"'=SUM(""a"",1)"`);
		expect(escapeCSVField("normal text")).toBe("normal text");
	});

	it("escapes formulas in workout history exports", () => {
		const workouts = dangerousPrefixes.map(
			(prefix, index): WorkoutSession => ({
				id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
				user_id: "00000000-0000-4000-8000-000000000999",
				name: `${prefix}workout`,
				started_at: new Date("2026-05-17T12:00:00Z"),
				duration_seconds: 45,
				total_volume: 100,
				set_count: 1,
				exercise_count: 1,
				pr_count: 0,
				routine_name: `${prefix}routine`,
				workout_mode: `${prefix}mode`,
				notes: null,
			}),
		);

		const rows = parseCSV(generateWorkoutCSV(workouts));

		for (const [index, prefix] of dangerousPrefixes.entries()) {
			expect(rows[index]["Workout Name"]).toBe(`'${prefix}workout`);
			expect(rows[index].Routine).toBe(`'${prefix}routine`);
			expect(rows[index].Mode).toBe(`'${prefix}mode`);
		}
	});

	it("escapes formulas in personal record exports", () => {
		const records = dangerousPrefixes.map(
			(prefix, index): PersonalRecord => ({
				id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
				user_id: "00000000-0000-4000-8000-000000000999",
				exercise_name: `${prefix}exercise`,
				exercise_id: null,
				muscle_group: `${prefix}muscle`,
				record_type: `${prefix}record`,
				value: 100,
				unit: "kg",
				achieved_at: new Date("2026-05-17T12:00:00Z"),
				previous_value: null,
				workout_phase: "Combined",
				local_profile_id: null,
			}),
		);

		const rows = parseCSV(generateRecordsCSV(records));

		for (const [index, prefix] of dangerousPrefixes.entries()) {
			expect(rows[index].Exercise).toBe(`'${prefix}exercise`);
			expect(rows[index]["Muscle Group"]).toBe(`'${prefix}muscle`);
			expect(rows[index]["Record Type"]).toBe(`'${prefix}record`);
		}
	});

	it("includes workout phase in personal record exports", () => {
		const records: PersonalRecord[] = [
			{
				id: "00000000-0000-4000-8000-000000000001",
				user_id: "00000000-0000-4000-8000-000000000999",
				exercise_name: "Bench Press",
				exercise_id: null,
				muscle_group: "Chest",
				record_type: "MAX_WEIGHT",
				value: 125,
				unit: "kg",
				achieved_at: new Date("2026-05-17T12:00:00Z"),
				previous_value: null,
				workout_phase: "Concentric",
				local_profile_id: null,
			},
		];

		const rows = parseCSV(generateRecordsCSV(records));

		expect(rows[0]["Workout Phase"]).toBe("Concentric");
	});
});
