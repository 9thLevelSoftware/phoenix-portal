import { describe, expect, it } from "vitest";
import { computePrGoalProgress } from "../Goals";

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
