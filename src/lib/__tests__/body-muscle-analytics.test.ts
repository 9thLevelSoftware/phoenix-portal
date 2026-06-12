import { describe, expect, it } from "vitest";
import type { BodyMuscleFocusRow } from "@/lib/body-muscle-analytics";
import {
	buildBodyMuscleFocusModel,
	getBodyMuscleMappingForExercise,
} from "@/lib/body-muscle-analytics";

function row(
	overrides: Partial<BodyMuscleFocusRow> & Pick<BodyMuscleFocusRow, "name">,
): BodyMuscleFocusRow {
	return {
		id: crypto.randomUUID(),
		name: overrides.name,
		muscle_group: overrides.muscle_group ?? null,
		session_id: overrides.session_id ?? crypto.randomUUID(),
		setCount: overrides.setCount,
		sets: overrides.sets ?? [
			{ id: crypto.randomUUID(), actual_reps: 5, weight_kg: 100 },
			{ id: crypto.randomUUID(), actual_reps: 5, weight_kg: 100 },
		],
		workout_sessions: {
			started_at:
				overrides.workout_sessions?.started_at ?? "2026-06-01T12:00:00Z",
		},
	};
}

function muscleIdsFor(name: string): string[] {
	return getBodyMuscleMappingForExercise(null, name).bodyMuscles.map(
		(muscle) => muscle.id,
	);
}

describe("body muscle mapping", () => {
	it("maps squat, deadlift, bench press, and core exercises to detailed body regions", () => {
		expect(muscleIdsFor("Back Squat")).toEqual(
			expect.arrayContaining([
				"quads-left",
				"quads-right",
				"gluteus-maximus-left",
				"gluteus-maximus-right",
			]),
		);
		expect(muscleIdsFor("Conventional Deadlift")).toEqual(
			expect.arrayContaining([
				"hamstrings-medial-left",
				"hamstrings-lateral-right",
				"lower-back-erectors-left",
				"lats-upper-right",
			]),
		);
		expect(muscleIdsFor("Bench Press")).toEqual(
			expect.arrayContaining([
				"chest-upper-left",
				"chest-lower-right",
				"triceps-long-left",
			]),
		);
		expect(muscleIdsFor("100s")).toEqual(
			expect.arrayContaining(["abs-upper-left", "obliques-right"]),
		);
	});

	it("allocates sets, reps, and load across mapped muscles without losing totals", () => {
		const model = buildBodyMuscleFocusModel([
			row({ name: "Bench Press" }),
			row({ name: "Conventional Deadlift" }),
		]);

		const allocatedVolume = model.muscles.reduce(
			(sum, muscle) => sum + muscle.totalVolumeKg,
			0,
		);
		const allocatedReps = model.muscles.reduce(
			(sum, muscle) => sum + muscle.totalReps,
			0,
		);

		expect(model.totalVolumeKg).toBe(2000);
		expect(Math.round(allocatedVolume)).toBe(2000);
		expect(Math.round(allocatedReps)).toBe(20);
		expect(model.muscleById["chest-upper-left"]?.exercises[0]).toMatchObject({
			exerciseName: "Bench Press",
			sets: 2,
			reps: 10,
		});
	});

	it("labels custom exercise contributions as estimated fallback mappings", () => {
		const model = buildBodyMuscleFocusModel([
			row({ name: "Mystery Press", muscle_group: "Chest" }),
		]);

		expect(model.estimatedExerciseCount).toBe(1);
		expect(model.unmatchedExerciseCount).toBe(0);
		expect(model.muscleById["chest-upper-left"]?.estimated).toBe(true);
		expect(model.muscleById["chest-upper-left"]?.exercises[0]?.estimated).toBe(
			true,
		);
	});

	it("uses set-count load when reps or weight are unavailable", () => {
		const model = buildBodyMuscleFocusModel([
			row({
				name: "Bench Press",
				sets: [],
				setCount: 3,
			}),
		]);

		expect(model.totalVolumeKg).toBe(0);
		expect(model.muscleById["chest-upper-left"]?.totalSets).toBeGreaterThan(0);
		expect(model.muscleById["chest-upper-left"]?.loadShare).toBeGreaterThan(0);
	});
});
