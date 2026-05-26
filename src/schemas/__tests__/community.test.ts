import { describe, expect, it } from "vitest";
import {
	cycleSnapshotSchema,
	routineExercisesSnapshotSchema,
} from "@/schemas/community";

describe("community snapshot schemas", () => {
	it("accepts full routine exercise snapshots", () => {
		const result = routineExercisesSnapshotSchema.parse([
			{
				name: "Bench Press",
				muscle_group: "Chest",
				exercise_id: "bench-press",
				sets: 3,
				reps: 8,
				weight: 40,
				rest_seconds: 90,
				duration_seconds: null,
				mode: "OLD_SCHOOL",
				order_index: 0,
				superset_id: "push-a",
				superset_color: "#ff6b35",
				superset_order: 0,
				per_set_weights: [40, 42.5, 45],
				per_set_rest: [90, 90, 120],
				per_set_reps: [8, 8, 6],
				per_set_echo_levels: null,
				is_amrap: false,
				is_bodyweight: false,
				pr_percentage: null,
				rep_count_timing: "top",
				stop_at_position: null,
				stall_detection: true,
				eccentric_load: "medium",
				echo_level: null,
				warmup_sets: null,
			},
		]);

		expect(result[0]?.name).toBe("Bench Press");
		expect(result[0]?.per_set_weights).toEqual([40, 42.5, 45]);
	});

	it("accepts full cycle snapshots with embedded routines", () => {
		const result = cycleSnapshotSchema.safeParse({
			duration_weeks: 7,
			workout_days: 1,
			rest_days: 1,
			progression_settings: { type: "percentage", amount: 5 },
			deload_settings: null,
			days: [
				{
					day_number: 1,
					day_type: "workout",
					routine_id: "source-routine",
					weight_adjustment: 5,
					rep_modifier: 0,
					rest_override: null,
					notes: "Push day",
					rest_type: null,
					routine: {
						source_routine_id: "source-routine",
						name: "Push Routine",
						description: "Upper body",
						exercise_count: 1,
						estimated_duration: 2700,
						tags: ["Chest"],
						exercises: [
							{
								name: "Bench Press",
								muscle_group: "Chest",
								sets: 3,
								reps: 8,
								weight: 40,
								rest_seconds: 90,
								mode: "OLD_SCHOOL",
								order_index: 0,
							},
						],
					},
				},
			],
		});

		expect(result.success).toBe(true);
	});

	it("rejects malformed cycle snapshots", () => {
		const result = cycleSnapshotSchema.safeParse({
			duration_weeks: "seven",
			days: "not an array",
		});

		expect(result.success).toBe(false);
	});
});
