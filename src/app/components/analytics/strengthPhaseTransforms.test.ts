import { describe, expect, it } from "vitest";
import {
	buildMobileStrengthPhaseData,
	buildStrengthPhaseSeries,
	buildStrengthPhaseSummary,
} from "./strengthPhaseTransforms";

describe("buildStrengthPhaseSeries", () => {
	it("keeps concentric and eccentric records as separate series", () => {
		const result = buildStrengthPhaseSeries(
			[
				{
					exercise_name: "Bench Press",
					exercise_id: "bench",
					record_type: "MAX_WEIGHT",
					workout_phase: "CONCENTRIC",
					value: 100,
					achieved_at: "2026-05-01T00:00:00Z",
				},
				{
					exercise_name: "Bench Press",
					exercise_id: "bench",
					record_type: "MAX_WEIGHT",
					workout_phase: "ECCENTRIC",
					value: 130,
					achieved_at: "2026-05-01T00:00:00Z",
				},
			],
			"all",
		);

		expect(result.series.map((s) => s.name)).toEqual([
			"Bench Press Concentric",
			"Bench Press Eccentric",
		]);
		expect(result.points[0]).toMatchObject({
			"bench::Concentric": 100,
			"bench::Eccentric": 130,
		});
	});

	it("filters by selected phase", () => {
		const result = buildStrengthPhaseSeries(
			[
				{
					exercise_name: "Squat",
					exercise_id: "squat",
					record_type: "MAX_WEIGHT",
					workout_phase: "CONCENTRIC",
					value: 140,
					achieved_at: "2026-05-01T00:00:00Z",
				},
				{
					exercise_name: "Squat",
					exercise_id: "squat",
					record_type: "MAX_WEIGHT",
					workout_phase: "ECCENTRIC",
					value: 180,
					achieved_at: "2026-05-01T00:00:00Z",
				},
			],
			"Concentric",
		);

		expect(result.series.map((s) => s.name)).toEqual(["Squat Concentric"]);
	});

	it("excludes non-weight personal records from strength charts", () => {
		const result = buildStrengthPhaseSeries(
			[
				{
					exercise_name: "Squat",
					record_type: "MAX_VOLUME",
					workout_phase: "COMBINED",
					value: 5000,
					achieved_at: "2026-05-01T00:00:00Z",
				},
			],
			"all",
		);

		expect(result.series).toEqual([]);
		expect(result.points).toEqual([]);
	});

	it("orders mobile top lifts by latest weight before selecting the top five", () => {
		const result = buildMobileStrengthPhaseData(
			[
				{
					exercise_name: "Alpha Press",
					record_type: "MAX_WEIGHT",
					workout_phase: "CONCENTRIC",
					value: 10,
					achieved_at: "2026-05-01T00:00:00Z",
				},
				{
					exercise_name: "Bravo Press",
					record_type: "MAX_WEIGHT",
					workout_phase: "CONCENTRIC",
					value: 20,
					achieved_at: "2026-05-01T00:00:00Z",
				},
				{
					exercise_name: "Charlie Press",
					record_type: "MAX_WEIGHT",
					workout_phase: "CONCENTRIC",
					value: 30,
					achieved_at: "2026-05-01T00:00:00Z",
				},
				{
					exercise_name: "Delta Press",
					record_type: "MAX_WEIGHT",
					workout_phase: "CONCENTRIC",
					value: 40,
					achieved_at: "2026-05-01T00:00:00Z",
				},
				{
					exercise_name: "Echo Press",
					record_type: "MAX_WEIGHT",
					workout_phase: "CONCENTRIC",
					value: 50,
					achieved_at: "2026-05-01T00:00:00Z",
				},
				{
					exercise_name: "Zulu Press",
					record_type: "MAX_WEIGHT",
					workout_phase: "CONCENTRIC",
					value: 100,
					achieved_at: "2026-05-01T00:00:00Z",
				},
			],
			"Concentric",
		);

		expect(result.map((item) => item.exercise)).toEqual([
			"Zulu Press Concentric",
			"Echo Press Concentric",
			"Delta Press Concentric",
			"Charlie Press Concentric",
			"Bravo Press Concentric",
		]);
	});

	it("summarizes PR count and recency from the selected strength phase", () => {
		const result = buildStrengthPhaseSummary(
			[
				{
					exercise_name: "Bench Press",
					record_type: "MAX_WEIGHT",
					workout_phase: "CONCENTRIC",
					value: 100,
					achieved_at: "2026-06-01T00:00:00Z",
				},
				{
					exercise_name: "Bench Press",
					record_type: "MAX_WEIGHT",
					workout_phase: "ECCENTRIC",
					value: 140,
					achieved_at: "2026-06-09T00:00:00Z",
				},
				{
					exercise_name: "Bench Press",
					record_type: "MAX_VOLUME",
					workout_phase: "CONCENTRIC",
					value: 2500,
					achieved_at: "2026-06-10T00:00:00Z",
				},
			],
			"Concentric",
			new Date("2026-06-10T00:00:00Z"),
		);

		expect(result).toEqual({
			prCount: 1,
			daysSinceLastPR: 9,
		});
	});
});
