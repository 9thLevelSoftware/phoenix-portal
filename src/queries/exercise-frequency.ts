import { z } from "zod";

/**
 * `exercise_frequency` returns one jsonb array (20260920004000). The generator
 * types a jsonb scalar as `Json`, so validate the shape at runtime instead of
 * trusting the FunctionOverrides cast in src/lib/database.ts.
 */
export const exerciseFrequencySchema = z.array(
	z.object({
		exercise_name: z.string().nullable(),
		muscle_group: z.string().nullable(),
		sessions: z.number().int().nonnegative(),
	}),
);
