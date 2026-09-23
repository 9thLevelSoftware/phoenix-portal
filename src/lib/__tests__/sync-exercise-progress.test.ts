import { describe, expect, it } from "vitest";
import {
	buildExerciseProgressRows,
	estimateOneRepMaxKg,
} from "../../../supabase/functions/_shared/exerciseProgressRows.ts";
import {
	expectHybrid1rm,
	HYBRID_1RM_DIGITS,
	HYBRID_1RM_GOLDENS,
} from "./hybrid-1rm-goldens";

const USER_ID = "00000000-0000-0000-0000-000000000001";

describe("estimateOneRepMaxKg (hybrid)", () => {
	it("uses Brzycki at or below 10 reps", () => {
		expectHybrid1rm(estimateOneRepMaxKg(100, 5), 112.5);
	});
	it("is continuous at 10 reps", () => {
		expectHybrid1rm(estimateOneRepMaxKg(100, 10), 100 * (36 / 27));
	});
	it("uses Epley above 10 reps", () => {
		expectHybrid1rm(estimateOneRepMaxKg(100, 11), 100 * (1 + 11 / 30));
	});
	it("matches mobile hybrid goldens without rounding", () => {
		for (const { weight, reps, expected } of HYBRID_1RM_GOLDENS) {
			expectHybrid1rm(estimateOneRepMaxKg(weight, reps), expected);
		}
	});
	it("rejects 2dp stand-ins that default toBeCloseTo would accept", () => {
		expect(estimateOneRepMaxKg(100, 10)).not.toBeCloseTo(
			133.33,
			HYBRID_1RM_DIGITS,
		);
		expect(estimateOneRepMaxKg(100, 11)).not.toBeCloseTo(
			136.67,
			HYBRID_1RM_DIGITS,
		);
	});
	it("returns 0 for invalid input and weight for a single rep", () => {
		expect(estimateOneRepMaxKg(0, 5)).toBe(0);
		expect(estimateOneRepMaxKg(100, 0)).toBe(0);
		expect(estimateOneRepMaxKg(100, 1)).toBe(100);
	});
});

describe("buildExerciseProgressRows", () => {
	const session = (estimatedOneRepMaxKg?: number) => ({
		id: "s1",
		startedAt: "2026-04-20T12:00:00.000Z",
		exercises: [
			{
				name: "Squat",
				exerciseId: null,
				estimatedOneRepMaxKg,
				sets: [{ weightKg: 60, actualReps: 5 }],
			},
		],
	});

	it("stores the mobile-provided estimate verbatim with no rounding", () => {
		const rows = buildExerciseProgressRows(
			[session(100 * (1 + 11 / 30))],
			USER_ID,
			"default",
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].estimated_1rm_kg).toBe(100 * (1 + 11 / 30));
	});

	it("stores a mobile estimate of 0 verbatim instead of substituting a fallback", () => {
		const rows = buildExerciseProgressRows([session(0)], USER_ID, "default");
		expect(rows[0].estimated_1rm_kg).toBe(0);
	});

	it("falls back to the hybrid (2dp) when the field is absent", () => {
		const rows = buildExerciseProgressRows(
			[session(undefined)],
			USER_ID,
			"default",
		);
		expect(rows[0].estimated_1rm_kg).toBe(67.5);
	});

	it("rounds only the sets fallback, not a mobile verbatim value", () => {
		const fallback = buildExerciseProgressRows(
			[
				{
					id: "s1",
					startedAt: "2026-04-20T12:00:00.000Z",
					exercises: [
						{
							name: "Squat",
							sets: [{ weightKg: 100, actualReps: 10 }],
						},
					],
				},
			],
			USER_ID,
			"default",
		);
		expect(fallback[0].estimated_1rm_kg).toBe(133.33);

		const verbatim = buildExerciseProgressRows(
			[
				{
					id: "s1",
					startedAt: "2026-04-20T12:00:00.000Z",
					exercises: [
						{
							name: "Squat",
							estimatedOneRepMaxKg: 100 * (36 / 27),
							sets: [{ weightKg: 100, actualReps: 10 }],
						},
					],
				},
			],
			USER_ID,
			"default",
		);
		expect(verbatim[0].estimated_1rm_kg).toBe(100 * (36 / 27));
	});

	it("carries velocity_estimated_1rm_kg verbatim and null when absent", () => {
		const rows = buildExerciseProgressRows(
			[
				{
					id: "s1",
					startedAt: "2026-06-27T00:00:00.000Z",
					exercises: [
						{
							name: "Bench",
							exerciseId: "ex1",
							estimatedOneRepMaxKg: 100,
							velocityEstimatedOneRepMaxKg: 92,
							sets: [{ weightKg: 80, actualReps: 5 }],
						},
						{
							name: "Row",
							exerciseId: "ex2",
							estimatedOneRepMaxKg: 90,
							// no velocity estimate
							sets: [{ weightKg: 60, actualReps: 5 }],
						},
					],
				},
			],
			USER_ID,
			"default",
		);
		expect(rows[0].velocity_estimated_1rm_kg).toBe(92);
		expect(rows[1].velocity_estimated_1rm_kg).toBeNull();
		// Rep-based estimate is untouched by the velocity field.
		expect(rows[0].estimated_1rm_kg).toBe(100);
	});

	it("skips exercises with no sets", () => {
		const rows = buildExerciseProgressRows(
			[
				{
					id: "s2",
					startedAt: "x",
					exercises: [{ name: "E", exerciseId: null, sets: [] }],
				},
			],
			USER_ID,
			null,
		);
		expect(rows).toHaveLength(0);
	});
});
