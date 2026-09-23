import { describe, expect, it } from "vitest";
import { personalRecordSchema } from "@/schemas/transforms";
import { getGoalLabel } from "../GoalDashboardWidget";
import { computePrGoalProgress, getGoalDescription } from "../Goals";

const squatGoal = {
	exercise_name: "Squat",
	exercise_id: null as string | null,
	target_value: 100,
};

describe("computePrGoalProgress", () => {
	it("does not complete a weight PR goal from a MAX_VOLUME record", () => {
		const progress = computePrGoalProgress(squatGoal, [
			{
				exercise_name: "Squat",
				exercise_id: null,
				record_type: "MAX_VOLUME",
				value: 5000,
			},
		]);
		expect(progress).toBe(0);
	});

	it("takes Math.max over MAX_WEIGHT and 1RM only", () => {
		const progress = computePrGoalProgress(
			{ ...squatGoal, target_value: 200 },
			[
				{
					exercise_name: "Squat",
					exercise_id: null,
					record_type: "MAX_WEIGHT",
					value: 100,
				},
				{
					exercise_name: "Squat",
					exercise_id: null,
					record_type: "1RM",
					value: 150,
				},
				{
					exercise_name: "Squat",
					exercise_id: null,
					record_type: "MAX_VOLUME",
					value: 9000,
				},
			],
		);
		expect(progress).toBe(75);
	});
});

describe("PR goals are per cable (KD-8)", () => {
	it("a per-cable record meets a per-cable target without doubling", () => {
		// Stored record value 40 per cable; the legacy target 80 (a doubled
		// total) was halved to 40 by migration 20260920003000.
		const record = personalRecordSchema.parse({
			id: "00000000-0000-4000-8000-000000000001",
			user_id: "00000000-0000-4000-8000-000000000002",
			exercise_name: "Squat",
			muscle_group: "Legs",
			record_type: "MAX_WEIGHT",
			value: 40,
			unit: "kg",
			achieved_at: "2026-09-01T00:00:00Z",
			previous_value: null,
		});
		expect(record.value).toBe(40);
		expect(
			computePrGoalProgress({ ...squatGoal, target_value: 40 }, [record]),
		).toBe(100);
		expect(
			computePrGoalProgress({ ...squatGoal, target_value: 80 }, [record]),
		).toBe(50);
	});

	it("labels PR targets and volume targets per cable", () => {
		expect(
			getGoalDescription(
				{
					goal_type: "pr",
					target_value: 40,
					period: "weekly",
					exercise_name: "Squat",
				},
				"kg",
			),
		).toBe("Squat: 40 kg per cable");
		expect(
			getGoalDescription(
				{
					goal_type: "volume",
					target_value: 500,
					period: "weekly",
					exercise_name: null,
				},
				"kg",
			),
		).toBe("500 kg per cable per week");
		expect(
			getGoalLabel(
				{
					goal_type: "pr",
					target_value: 40,
					target_unit: "kg",
					exercise_name: "Squat",
				},
				"kg",
			),
		).toBe("Squat: 40 kg per cable PR");
	});
});
