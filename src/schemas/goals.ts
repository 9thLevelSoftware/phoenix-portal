import { z } from "zod";

// --- Goal Schema (DB row → application type) ---

export const goalSchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid(),
	goal_type: z.enum(["frequency", "volume", "pr"]),
	target_value: z.number(),
	target_unit: z.string(),
	exercise_name: z.string().nullable(),
	deadline: z
		.string()
		.nullable()
		.transform((s) => (s ? new Date(s) : null)),
	period: z.enum(["weekly", "monthly"]),
	status: z.enum(["active", "completed", "archived"]),
	completed_at: z
		.string()
		.nullable()
		.transform((s) => (s ? new Date(s) : null)),
	created_at: z.string().transform((s) => new Date(s)),
	updated_at: z.string().transform((s) => new Date(s)),
});

export const goalListSchema = z.array(goalSchema);

export type Goal = z.infer<typeof goalSchema>;

// --- Create Goal Schema (form validation) ---

export const createGoalSchema = z
	.object({
		goal_type: z.enum(["frequency", "volume", "pr"]),
		target_value: z.number().positive("Target must be a positive number"),
		exercise_name: z.string().optional(),
		deadline: z.string().optional(),
		period: z.enum(["weekly", "monthly"]).default("weekly"),
	})
	.refine(
		(data) => {
			if (data.goal_type === "pr" && !data.exercise_name) {
				return false;
			}
			return true;
		},
		{ message: "Exercise name is required for PR goals", path: ["exercise_name"] },
	);

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
