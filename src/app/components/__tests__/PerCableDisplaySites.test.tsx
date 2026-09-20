import { describe, expect, it } from "vitest";
import { exerciseProgressSchema } from "@/schemas/telemetry";
import {
	personalRecordSchema,
	routineExerciseSchema,
} from "@/schemas/transforms";
import { formatPersonalRecordValue } from "../Dashboard";
import { formatExerciseSummary } from "../RoutineBuilder";
import { formatExercisePrescription } from "../RoutineDetail";

// KD-8 regression guards: each display site takes a stored per-cable value of
// 20 through its real schema and must show "20 kg per cable", never 40.

const UUID_A = "00000000-0000-4000-8000-0000000000c1";
const UUID_B = "00000000-0000-4000-8000-0000000000c2";

describe("per-cable display sites (KD-8)", () => {
	it("Dashboard recent PRs show the record per cable", () => {
		const record = personalRecordSchema.parse({
			id: UUID_A,
			user_id: UUID_B,
			exercise_name: "Bench Press",
			muscle_group: "Chest",
			record_type: "MAX_WEIGHT",
			value: 20,
			unit: "kg",
			achieved_at: "2026-09-01T00:00:00Z",
			previous_value: null,
		});
		const text = formatPersonalRecordValue(record, "kg");
		expect(text).toBe("20 kg per cable");
		expect(text).not.toMatch(/40/);
	});

	it("RoutineDetail prescription shows the routine weight per cable", () => {
		const exercise = routineExerciseSchema.parse({
			id: UUID_A,
			routine_id: UUID_B,
			name: "Row",
			muscle_group: "Back",
			sets: 3,
			reps: 10,
			weight: 20,
			rest_seconds: 60,
			mode: "OLD_SCHOOL",
			order_index: 0,
			created_at: "2026-09-01T00:00:00Z",
		});
		const text = formatExercisePrescription(exercise, "kg");
		expect(text).toContain("20 kg per cable");
		expect(text).not.toMatch(/40 kg/);
	});

	it("RoutineBuilder summary shows the builder weight per cable", () => {
		const text = formatExerciseSummary(
			{
				sets: 3,
				reps: 10,
				weight: 20,
				durationSeconds: null,
				isAmrap: false,
				isBodyweight: false,
				mode: "OLD_SCHOOL",
			} as Parameters<typeof formatExerciseSummary>[0],
			"kg",
		);
		expect(text).toContain("20 kg per cable");
		expect(text).not.toMatch(/40 kg/);
	});

	it("exercise_progress weights and both 1RMs pass through per cable", () => {
		const row = exerciseProgressSchema.parse({
			id: UUID_A,
			user_id: UUID_B,
			exercise_name: "Bench Press",
			session_id: UUID_A,
			recorded_at: "2026-09-01T00:00:00Z",
			max_weight_kg: 20,
			total_volume_kg: 160,
			estimated_1rm_kg: 25,
			velocity_estimated_1rm_kg: 22,
			max_reps: 8,
			set_count: 1,
		});
		expect(row.max_weight_kg).toBe(20);
		expect(row.total_volume_kg).toBe(160);
		expect(row.estimated_1rm_kg).toBe(25);
		expect(row.velocity_estimated_1rm_kg).toBe(22);
		expect(
			exerciseProgressSchema.parse({
				...row,
				recorded_at: "2026-09-01T00:00:00Z",
				velocity_estimated_1rm_kg: null,
			}).velocity_estimated_1rm_kg,
		).toBeNull();
	});
});
