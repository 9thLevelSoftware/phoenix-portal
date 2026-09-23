import { describe, expect, it } from "vitest";
import { createGoalSchema } from "../goals";

describe("createGoalSchema", () => {
	it("parses valid frequency goal without exercise_name", () => {
		const result = createGoalSchema.safeParse({
			goal_type: "frequency",
			target_value: 4,
			target_unit: "workouts",
		});
		expect(result.success).toBe(true);
	});

	it("parses valid volume goal without exercise_name", () => {
		const result = createGoalSchema.safeParse({
			goal_type: "volume",
			target_value: 50000,
			target_unit: "kg",
		});
		expect(result.success).toBe(true);
	});

	it("parses valid PR goal with exercise_name", () => {
		const result = createGoalSchema.safeParse({
			goal_type: "pr",
			target_value: 100,
			target_unit: "kg",
			exercise_name: "Bench Press",
		});
		expect(result.success).toBe(true);
	});

	it("preserves optional catalog exercise_id", () => {
		const result = createGoalSchema.safeParse({
			goal_type: "pr",
			target_value: 100,
			target_unit: "kg",
			exercise_name: "Bench Press",
			exercise_id: "catalog-bench",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.exercise_id).toBe("catalog-bench");
		}
	});

	it("fails PR goal without exercise_name", () => {
		const result = createGoalSchema.safeParse({
			goal_type: "pr",
			target_value: 100,
			target_unit: "kg",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const errorMessages = result.error.issues.map((i) => i.message);
			expect(errorMessages).toContain("Exercise name is required for PR goals");
		}
	});

	it("fails with negative target_value", () => {
		const result = createGoalSchema.safeParse({
			goal_type: "frequency",
			target_value: -5,
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const errorMessages = result.error.issues.map((i) => i.message);
			expect(errorMessages).toContain("Target must be a positive number");
		}
	});

	it("fails with zero target_value", () => {
		const result = createGoalSchema.safeParse({
			goal_type: "frequency",
			target_value: 0,
		});
		expect(result.success).toBe(false);
	});

	it("defaults period to 'weekly'", () => {
		const result = createGoalSchema.safeParse({
			goal_type: "frequency",
			target_value: 3,
			target_unit: "workouts",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.period).toBe("weekly");
		}
	});

	it("accepts explicit period 'monthly'", () => {
		const result = createGoalSchema.safeParse({
			goal_type: "volume",
			target_value: 100000,
			target_unit: "kg",
			period: "monthly",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.period).toBe("monthly");
		}
	});

	it("rejects invalid goal_type", () => {
		const result = createGoalSchema.safeParse({
			goal_type: "invalid",
			target_value: 5,
		});
		expect(result.success).toBe(false);
	});
});
