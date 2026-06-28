import { z } from "zod";

/**
 * Zod schema for user_onboarding table rows.
 * Validates and transforms dates from ISO strings to Date objects.
 */
export const onboardingSchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid(),
	completed_at: z
		.string()
		.nullable()
		.transform((s) => (s ? new Date(s) : null))
		.refine((d) => d === null || Number.isFinite(d.getTime()), {
			message: "Invalid date",
		}),
	version_seen: z.string().nullable(),
	dismissed_hints: z.record(z.boolean()).default({}),
	dismissed_whats_new: z.boolean(),
	created_at: z.coerce.date(),
});

export type OnboardingRow = z.infer<typeof onboardingSchema>;
