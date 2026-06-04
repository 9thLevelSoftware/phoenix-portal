import { describe, expect, it } from "vitest";
import { buildStrengthPhaseSeries } from "./strengthPhaseTransforms";

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
});
