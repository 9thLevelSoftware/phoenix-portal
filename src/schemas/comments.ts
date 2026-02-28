import { z } from "zod";

// --- Comment Row (database response) ---

export const commentSchema = z.object({
	id: z.string().uuid(),
	item_id: z.string().uuid(),
	item_type: z.enum(["routine", "cycle"]),
	user_id: z.string().uuid().nullable(),
	body: z.string(),
	created_at: z.string().transform((s) => new Date(s)),
	updated_at: z.string().transform((s) => new Date(s)),
	deleted_at: z
		.string()
		.nullable()
		.transform((s) => (s ? new Date(s) : null)),
	profiles: z
		.object({
			display_name: z.string(),
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
		.min(1, "Comment cannot be empty")
		.max(500, "Comment must be 500 characters or less"),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
