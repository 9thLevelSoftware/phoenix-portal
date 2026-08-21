import { z } from "zod";

const difficultyEnum = z.enum(["Beginner", "Intermediate", "Advanced"]);
const itemTypeEnum = z.enum(["routine", "cycle"]);

const profileSummarySchema = z
	.object({
		display_name: z.string().nullable(),
		avatar_url: z.string().nullable(),
	})
	.optional()
	.nullable();

const nullableUnknownSchema = z.unknown().nullable().optional();

export const routineExerciseSnapshotSchema = z.object({
	name: z.string().default("Exercise"),
	muscle_group: z.string().default("General"),
	exercise_id: z.string().nullable().optional(),
	sets: z.number().int().nonnegative().default(3),
	reps: z.number().int().nonnegative().default(10),
	weight: z.number().finite().nonnegative().default(0),
	rest_seconds: z.number().finite().nonnegative().default(90),
	duration_seconds: z.number().finite().nonnegative().nullable().optional(),
	mode: z.string().default("OLD_SCHOOL"),
	order_index: z.number().int().nonnegative().default(0),
	superset_id: z.string().nullable().optional(),
	superset_color: z.string().nullable().optional(),
	superset_order: z.number().nullable().optional(),
	per_set_weights: nullableUnknownSchema,
	per_set_rest: nullableUnknownSchema,
	per_set_reps: nullableUnknownSchema,
	per_set_echo_levels: nullableUnknownSchema,
	is_amrap: z.boolean().nullable().optional().default(false),
	is_bodyweight: z.boolean().nullable().optional().default(false),
	pr_percentage: z.number().nullable().optional(),
	rep_count_timing: z.string().nullable().optional(),
	stop_at_position: z.string().nullable().optional(),
	stall_detection: z.boolean().nullable().optional().default(true),
	eccentric_load: z.string().nullable().optional(),
	echo_level: z.string().nullable().optional(),
	warmup_sets: nullableUnknownSchema,
	drop_set_enabled: z.boolean().nullable().optional().default(false),
	drop_set_min_weight_kg: z.number().finite().nullable().optional(),
});

export const routineExercisesSnapshotSchema = z.array(
	routineExerciseSnapshotSchema,
);

export type RoutineExerciseSnapshot = z.infer<
	typeof routineExerciseSnapshotSchema
>;

export const embeddedRoutineSnapshotSchema = z.object({
	source_routine_id: z.string().nullable().optional(),
	name: z.string().default("Imported Routine"),
	description: z.string().nullable().optional().default(""),
	exercise_count: z.number().int().nonnegative().default(0),
	estimated_duration: z.number().finite().nonnegative().default(0),
	tags: z.array(z.string()).nullable().optional().default([]),
	exercises: routineExercisesSnapshotSchema.default([]),
});

export type EmbeddedRoutineSnapshot = z.infer<
	typeof embeddedRoutineSnapshotSchema
>;

export const cycleDaySnapshotSchema = z.object({
	day_number: z.number().int().nonnegative(),
	day_type: z.string().default("workout"),
	routine_id: z.string().nullable().optional(),
	// Adjustments may be negative (e.g. deload weeks), so only require finite.
	weight_adjustment: z.number().finite().default(0),
	rep_modifier: z.number().finite().default(0),
	rest_override: z.number().finite().nonnegative().nullable().optional(),
	notes: z.string().nullable().optional(),
	rest_type: z.string().nullable().optional(),
	routine: embeddedRoutineSnapshotSchema.nullable().optional(),
});

export const cycleSnapshotSchema = z.object({
	duration_weeks: z.number().int().positive(),
	workout_days: z.number().int().nonnegative().optional(),
	rest_days: z.number().int().nonnegative().optional(),
	progression_settings: nullableUnknownSchema,
	deload_settings: nullableUnknownSchema,
	days: z.array(cycleDaySnapshotSchema).default([]),
});

export type CycleSnapshot = z.infer<typeof cycleSnapshotSchema>;

const routineSnapshotValueSchema = z
	.preprocess(
		(value) => value ?? null,
		routineExercisesSnapshotSchema.nullable(),
	)
	.catch((ctx) => {
		// Don't fail the whole detail query on a corrupt snapshot, but surface it
		// instead of silently dropping the preview data.
		console.error("[community] invalid exercises_snapshot", ctx.error);
		return null;
	});

const cycleSnapshotValueSchema = z
	.preprocess((value) => value ?? null, cycleSnapshotSchema.nullable())
	.catch((ctx) => {
		console.error("[community] invalid cycle_snapshot", ctx.error);
		return null;
	});

// --- Shared Routine ---

export const sharedRoutineSchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid().nullable(),
	routine_id: z.string().uuid(),
	name: z.string(),
	description: z.string(),
	exercise_count: z.number(),
	estimated_duration: z.number(),
	tags: z.array(z.string()),
	difficulty: difficultyEnum,
	vote_count: z.number(),
	save_count: z.number(),
	hot_score: z.number(),
	comment_count: z.number().default(0),
	shared_at: z.string().transform((s) => new Date(s)),
	updated_at: z.string().transform((s) => new Date(s)),
	profiles: profileSummarySchema,
});

export type SharedRoutine = z.infer<typeof sharedRoutineSchema>;

export const sharedRoutineDetailSchema = sharedRoutineSchema.extend({
	exercises_snapshot: routineSnapshotValueSchema,
});

export type SharedRoutineDetail = z.infer<typeof sharedRoutineDetailSchema>;

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
	profiles: profileSummarySchema,
});

export type SharedCycle = z.infer<typeof sharedCycleSchema>;

export const sharedCycleDetailSchema = sharedCycleSchema.extend({
	cycle_snapshot: cycleSnapshotValueSchema,
});

export type SharedCycleDetail = z.infer<typeof sharedCycleDetailSchema>;

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
	imported_routine_id: z.string().uuid().nullable().optional(),
	imported_cycle_id: z.string().uuid().nullable().optional(),
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
export type CommunityItemDetail = SharedRoutineDetail | SharedCycleDetail;
