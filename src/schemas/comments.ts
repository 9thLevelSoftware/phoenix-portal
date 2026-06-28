import { z } from "zod";

// --- Comment Row (database response) ---

export const commentSchema = z.object({
	id: z.string().uuid(),
	item_id: z.string().uuid(),
	item_type: z.enum(["routine", "cycle"]),
	user_id: z.string().uuid().nullable(),
	body: z.string(),
	created_at: z.coerce.date(),
	updated_at: z.coerce.date(),
	deleted_at: z
		.string()
		.nullable()
		.transform((s) => (s ? new Date(s) : null))
		.refine((d) => d === null || Number.isFinite(d.getTime()), {
			message: "Invalid date",
		}),
	profiles: z
		.object({
			display_name: z.string().nullable(),
			avatar_url: z.string().nullable(),
		})
		.optional()
		.nullable(),
});

export type Comment = z.infer<typeof commentSchema>;

// --- Create Comment (form validation) ---

export const createCommentSchema = z.object({
	body: z
		.string()
		.trim()
		.min(1, "Comment cannot be empty")
		.max(500, "Comment must be 500 characters or less"),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
