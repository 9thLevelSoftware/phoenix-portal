import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { buildBodyMuscleFocusModel } from "@/lib/body-muscle-analytics";
import {
	type AnalyticsRepSummaryRow,
	type AnalyticsWorkoutExerciseSummaryRow,
	buildWorkoutExerciseSummaryRows,
	fetchAllSupabasePages,
	fetchAllSupabasePagesForChunks,
	generateDailyExerciseSummaryCsv,
	generateMuscleContributionCsv,
	generateRepSummaryCsv,
	generateWorkoutExerciseSummaryCsv,
} from "@/lib/export/analytics-tables";

function parse(csv: string) {
	return Papa.parse<Record<string, string>>(csv, {
		header: true,
		skipEmptyLines: false,
	}).data;
}

const workoutRows: AnalyticsWorkoutExerciseSummaryRow[] = [
	{
		date: "2026-06-01T12:00:00Z",
		workoutName: "=Import",
		exerciseId: "exercise-1",
		exerciseName: "Bench Press",
		muscleGroup: "Chest",
		sets: 2,
		reps: 10,
		volumeKg: 1000,
		maxWeightKg: 100,
	},
	{
		date: "2026-06-01T12:00:00Z",
		workoutName: "Push",
		exerciseId: "exercise-2",
		exerciseName: "Bench Press",
		muscleGroup: "Chest",
		sets: 1,
		reps: 5,
		volumeKg: 500,
		maxWeightKg: 100,
	},
];

const repRows: AnalyticsRepSummaryRow[] = [
	{
		date: "2026-06-01T12:00:00Z",
		workoutName: "Push",
		exerciseName: "+Bench Press",
		setNumber: 1,
		repNumber: 1,
		meanVelocityMps: 0.5,
		peakVelocityMps: 0.8,
		meanForceN: 900,
		peakForceN: 1100,
		powerWatts: 450,
		romMm: 120,
		tutMs: 1100,
		asymmetryPct: 3,
		vbtZone: "strength",
	},
];

describe("analytics table CSV generators", () => {
	it("generates workout-exercise summaries with converted units and formula escaping", () => {
		const csv = generateWorkoutExerciseSummaryCsv(workoutRows, "lbs");
		const rows = parse(csv);

		expect(csv.split("\n")[0]).toContain("Volume (lbs)");
		expect(rows[0].Workout).toBe("'=Import");
		expect(Number(rows[0]["Volume (lbs)"])).toBeCloseTo(2204.6, 1);
		expect(Number(rows[0]["Max Weight (lbs)"])).toBeCloseTo(220.5, 1);
	});

	it("generates daily exercise summaries by date and exercise", () => {
		const rows = parse(generateDailyExerciseSummaryCsv(workoutRows, "kg"));

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			Date: "2026-06-01",
			Exercise: "Bench Press",
			Sets: "3",
			Reps: "15",
			"Volume (kg)": "1500",
		});
	});

	it("builds workout summaries from raw per-cable set weights", () => {
		const rows = buildWorkoutExerciseSummaryRows(
			[
				{
					id: "session-1",
					name: "Push",
					started_at: "2026-06-01T12:00:00Z",
				},
			],
			[
				{
					id: "exercise-1",
					name: "Bench Press",
					muscle_group: "Chest",
					session_id: "session-1",
				},
			],
			[
				{
					id: "set-1",
					exercise_id: "exercise-1",
					set_number: 1,
					actual_reps: 5,
					weight_kg: 50,
				},
			],
		);

		expect(rows[0]).toMatchObject({
			reps: 5,
			volumeKg: 500,
			maxWeightKg: 100,
		});
	});

	it("generates muscle contribution summaries without sensitive fields", () => {
		const model = buildBodyMuscleFocusModel([
			{
				id: "exercise-1",
				name: "Bench Press",
				muscle_group: "Chest",
				session_id: "session-1",
				sets: [
					{ id: "set-1", actual_reps: 5, weight_kg: 100 },
					{ id: "set-2", actual_reps: 5, weight_kg: 100 },
				],
				workout_sessions: { started_at: "2026-06-01T12:00:00Z" },
			},
		]);
		const csv = generateMuscleContributionCsv(model);

		expect(csv).toContain("Muscle ID,Muscle,Body Group");
		expect(csv).toContain("chest-upper-left");
		expect(csv).not.toMatch(/oauth|token|provider_customer|billing/i);
	});

	it("generates rep summaries with formula escaping and no raw telemetry fields", () => {
		const csv = generateRepSummaryCsv(repRows);
		const rows = parse(csv);

		expect(rows[0].Exercise).toBe("'+Bench Press");
		expect(rows[0]["Mean Force (N)"]).toBe("900");
		expect(csv).not.toContain("access_token");
		expect(csv).not.toContain("position_mm");
	});

	it("keeps headers for empty analytics tables", () => {
		expect(generateWorkoutExerciseSummaryCsv([])).toContain(
			"Date,Workout,Exercise",
		);
		expect(generateDailyExerciseSummaryCsv([])).toContain(
			"Date,Workout,Exercise",
		);
		expect(
			generateMuscleContributionCsv(buildBodyMuscleFocusModel([])),
		).toContain("Muscle ID,Muscle,Body Group");
		expect(generateRepSummaryCsv([])).toContain("Date,Workout,Exercise");
	});

	it("paginates Supabase analytics reads until a short page is returned", async () => {
		const pages = [
			Array.from({ length: 1000 }, (_, index) => ({ id: index })),
			Array.from({ length: 1000 }, (_, index) => ({ id: index + 1000 })),
			[{ id: 2000 }],
		];
		const ranges: Array<[number, number]> = [];

		const rows = await fetchAllSupabasePages(async (from, to) => {
			ranges.push([from, to]);
			return { data: pages.shift() ?? [], error: null };
		});

		expect(rows).toHaveLength(2001);
		expect(rows.at(-1)).toEqual({ id: 2000 });
		expect(ranges).toEqual([
			[0, 999],
			[1000, 1999],
			[2000, 2999],
		]);
	});

	it("surfaces Supabase pagination errors", async () => {
		await expect(
			fetchAllSupabasePages(async () => ({
				data: null,
				error: new Error("range failed"),
			})),
		).rejects.toThrow("range failed");
	});

	it("paginates Supabase reads separately for each chunked filter value set", async () => {
		const calls: Array<{ ids: string[]; range: [number, number] }> = [];
		const rows = await fetchAllSupabasePagesForChunks(
			["session-1", "session-2", "session-3"],
			async (ids, from, to) => {
				calls.push({ ids, range: [from, to] });
				return {
					data:
						from === 0
							? [
									{ id: `${ids.join("+")}-${from}` },
									{ id: `${ids.join("+")}-${to}` },
								]
							: [],
					error: null,
				};
			},
			{ chunkSize: 2, pageSize: 2 },
		);

		expect(calls).toEqual([
			{ ids: ["session-1", "session-2"], range: [0, 1] },
			{ ids: ["session-1", "session-2"], range: [2, 3] },
			{ ids: ["session-3"], range: [0, 1] },
			{ ids: ["session-3"], range: [2, 3] },
		]);
		expect(rows).toHaveLength(4);
	});
});
