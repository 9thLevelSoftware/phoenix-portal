import { describe, expect, it } from "vitest";
import {
	buildProgressionWorkbenchModel,
	type ProgressionProgressRow,
	type ProgressionRecordRow,
} from "@/lib/progression-workbench";

const progressRows: ProgressionProgressRow[] = [
	{
		id: "p1",
		user_id: "u1",
		exercise_name: "Bench Press",
		session_id: "s1",
		recorded_at: new Date("2026-03-01T00:00:00Z"),
		max_weight_kg: 80,
		total_volume_kg: 2000,
		estimated_1rm_kg: 100,
		max_reps: 8,
		set_count: 4,
	},
	{
		id: "p2",
		user_id: "u1",
		exercise_name: "Bench Press",
		session_id: "s2",
		recorded_at: new Date("2026-04-15T00:00:00Z"),
		max_weight_kg: 82,
		total_volume_kg: 2100,
		estimated_1rm_kg: 101,
		max_reps: 8,
		set_count: 4,
	},
	{
		id: "p3",
		user_id: "u1",
		exercise_name: "Bench Press",
		session_id: "s3",
		recorded_at: new Date("2026-05-20T00:00:00Z"),
		max_weight_kg: 81,
		total_volume_kg: 2050,
		estimated_1rm_kg: 100.5,
		max_reps: 8,
		set_count: 4,
	},
	{
		id: "p4",
		user_id: "u1",
		exercise_name: "Squat",
		session_id: "s4",
		recorded_at: new Date("2026-05-25T00:00:00Z"),
		max_weight_kg: 120,
		total_volume_kg: 3000,
		estimated_1rm_kg: 150,
		max_reps: 6,
		set_count: 5,
	},
	{
		id: "p5",
		user_id: "u1",
		exercise_name: "Squat",
		session_id: "s5",
		recorded_at: new Date("2026-06-05T00:00:00Z"),
		max_weight_kg: 128,
		total_volume_kg: 3400,
		estimated_1rm_kg: 162,
		max_reps: 6,
		set_count: 5,
	},
];

const records: ProgressionRecordRow[] = [
	{
		id: "r1",
		exercise_name: "Bench Press",
		exercise_id: null,
		record_type: "1RM",
		workout_phase: "CONCENTRIC",
		value: 101,
		unit: "kg",
		achieved_at: new Date("2026-04-15T00:00:00Z"),
	},
	{
		id: "r2",
		exercise_name: "Bench Press",
		exercise_id: null,
		record_type: "1RM",
		workout_phase: "ECCENTRIC",
		value: 104,
		unit: "kg",
		achieved_at: new Date("2026-05-20T00:00:00Z"),
	},
	{
		id: "r3",
		exercise_name: "Squat",
		exercise_id: null,
		record_type: "1RM",
		workout_phase: "CONCENTRIC",
		value: 162,
		unit: "kg",
		achieved_at: new Date("2026-06-05T00:00:00Z"),
	},
];

describe("buildProgressionWorkbenchModel", () => {
	it("detects plateau risk and phase-filtered PR counts for the selected exercise", () => {
		const model = buildProgressionWorkbenchModel({
			progressRows,
			records,
			selectedExercise: "Bench Press",
			phaseFilter: "concentric",
			unit: "kg",
			now: new Date("2026-06-05T00:00:00Z"),
		});

		expect(model.selectedExercise?.exerciseName).toBe("Bench Press");
		expect(model.selectedExercise?.plateauRisk).toBe("high");
		expect(model.selectedExercise?.phasePrCount).toBe(1);
		expect(model.selectedExercise?.recommendation.kind).toBe("variation");
	});

	it("prioritizes recent improving exercises and converts display values to lbs", () => {
		const model = buildProgressionWorkbenchModel({
			progressRows,
			records,
			phaseFilter: "all",
			unit: "lbs",
			now: new Date("2026-06-05T00:00:00Z"),
		});

		expect(model.exercises[0].exerciseName).toBe("Squat");
		expect(model.selectedExercise?.plateauRisk).toBe("low");
		expect(model.selectedExercise?.currentOneRm).toBeCloseTo(357.1, 1);
		expect(model.selectedExercise?.gainRatePctPer30Days).toBeGreaterThan(10);
		expect(model.selectedExercise?.recommendation.kind).toBe("load");
	});

	it("returns an empty state when no progress history exists", () => {
		const model = buildProgressionWorkbenchModel({
			progressRows: [],
			records: [],
			phaseFilter: "all",
			unit: "kg",
			now: new Date("2026-06-05T00:00:00Z"),
		});

		expect(model.exercises).toEqual([]);
		expect(model.selectedExercise).toBeNull();
		expect(model.emptyReason).toContain("No exercise progress");
	});

	it("keeps single-session exercises at low plateau risk", () => {
		const model = buildProgressionWorkbenchModel({
			progressRows: [
				{
					id: "p6",
					user_id: "u1",
					exercise_name: "Deadlift",
					session_id: "s6",
					recorded_at: new Date("2026-04-01T00:00:00Z"),
					max_weight_kg: 140,
					total_volume_kg: 2800,
					estimated_1rm_kg: 170,
					max_reps: 5,
					set_count: 4,
				},
			],
			records: [],
			selectedExercise: "Deadlift",
			phaseFilter: "all",
			unit: "kg",
			now: new Date("2026-06-05T00:00:00Z"),
		});

		expect(model.selectedExercise?.plateauRisk).toBe("low");
		expect(model.selectedExercise?.recommendation.kind).toBe("load");
	});
});
