import { z } from "zod";

const difficultyEnum = z.enum(["Beginner", "Intermediate", "Advanced"]);
const itemTypeEnum = z.enum(["routine", "cycle"]);

// --- Shared Routine ---

export const sharedRoutineSchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid().nullable(),
	routine_id: z.string().uuid(),
	name: z.string(),
	description: z.string(),
	exercise_count: z.number(),
	estimated_duration: z.number(),
	exercises_snapshot: z.unknown(),
	tags: z.array(z.string()),
	difficulty: difficultyEnum,
	vote_count: z.number(),
	save_count: z.number(),
	hot_score: z.number(),
	comment_count: z.number().default(0),
	shared_at: z.string().transform((s) => new Date(s)),
	updated_at: z.string().transform((s) => new Date(s)),
	profiles: z
		.object({
			display_name: z.string().nullable(),
			avatar_url: z.string().nullable(),
		})
		.optional()
		.nullable(),
});

export type SharedRoutine = z.infer<typeof sharedRoutineSchema>;

// --- Shared Cycle ---

export const sharedCycleSchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid().nullable(),
	cycle_id: z.string().uuid(),
	name: z.string(),
	description: z.string(),
	duration_weeks: z.number(),
	tags: z.array(z.string()),
	difficulty: difficultyEnum,
	vote_count: z.number(),
	save_count: z.number(),
	hot_score: z.number(),
	comment_count: z.number().default(0),
	shared_at: z.string().transform((s) => new Date(s)),
	updated_at: z.string().transform((s) => new Date(s)),
	profiles: z
		.object({
			display_name: z.string().nullable(),
			avatar_url: z.string().nullable(),
		})
		.optional()
		.nullable(),
});

export type SharedCycle = z.infer<typeof sharedCycleSchema>;

// --- Community Vote ---

export const communityVoteSchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid(),
	item_id: z.string().uuid(),
	item_type: itemTypeEnum,
	created_at: z.string().transform((s) => new Date(s)),
});

export type CommunityVote = z.infer<typeof communityVoteSchema>;

// --- Saved Item ---

export const savedItemSchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid(),
	shared_item_id: z.string().uuid(),
	item_type: itemTypeEnum,
	saved_at: z.string().transform((s) => new Date(s)),
});

export type SavedItem = z.infer<typeof savedItemSchema>;

// --- Creator Stats ---

export const creatorStatsSchema = z.object({
	user_id: z.string().uuid(),
	display_name: z.string(),
	avatar_url: z.string().nullable(),
	total_shares: z.number(),
	total_upvotes: z.number(),
	featured_count: z.number(),
});

export type CreatorStats = z.infer<typeof creatorStatsSchema>;

// --- Report & Block ---

export const reportCategoryEnum = z.enum([
	"harmful_content",
	"impersonation",
	"spam",
	"malware",
	"other",
]);
export type ReportCategory = z.infer<typeof reportCategoryEnum>;

export const reportContentSchema = z.object({
	contentId: z.string().uuid(),
	contentType: z.enum(["routine", "cycle", "comment"]),
	category: reportCategoryEnum,
	description: z.string().max(500).optional(),
});

export const blockUserSchema = z.object({
	blockedId: z.string().uuid(),
});

// --- Union type for feed items ---

export type CommunityFeedItem = SharedRoutine | SharedCycle;
