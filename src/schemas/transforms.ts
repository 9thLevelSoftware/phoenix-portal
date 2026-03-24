import { z } from "zod";

// Per-cable to total weight conversion
// Vitruvian has dual cables; DB stores per-cable, portal shows total
// Change to 1 if DB convention changes to store total
const WEIGHT_MULTIPLIER = 2;
const weightTransform = z
	.number()
	.transform((perCable) => perCable * WEIGHT_MULTIPLIER);

// Workout mode mapping from DB enum values to friendly display names
const workoutModeMap: Record<string, string> = {
	OLD_SCHOOL: "Old School",
	ECHO: "Echo",
	PUMP: "Pump",
	TUT: "TUT",
	TUT_BEAST: "TUT Beast",
	ECCENTRIC_ONLY: "Eccentric Only",
	POWER: "Power",
	CLASSIC: "Old School", // Android alias
};

const workoutModeSchema = z
	.string()
	.nullable()
	.transform((mode) => (mode ? (workoutModeMap[mode] ?? mode) : null));

// --- Workout Session ---

export const workoutSessionSchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid(),
	name: z
		.string()
		.nullable()
		.transform((name) => name?.trim() || "Untitled Workout"),
	started_at: z.string().transform((s) => new Date(s)),
	duration_seconds: z.number().transform((s) => Math.round(s / 60)), // output as minutes
	total_volume: weightTransform,
	set_count: z.number(),
	exercise_count: z.number(),
	pr_count: z.number(),
	routine_name: z.string().nullable(),
	workout_mode: workoutModeSchema,
	notes: z.string().nullable().optional(),
	// Session enrichment (GAPs 3-6)
	avg_velocity_mps: z.number().nullable().optional(),
	avg_asymmetry_pct: z.number().nullable().optional(),
	velocity_loss_pct: z.number().nullable().optional(),
	dominant_side: z.string().nullable().optional(),
	strength_profile: z.string().nullable().optional(),
	form_score: z.number().nullable().optional(),
	deload_warnings: z.number().nullable().optional(),
	rom_violations: z.number().nullable().optional(),
	spotter_activations: z.number().nullable().optional(),
	peak_force_n: z.number().nullable().optional(),
	estimated_calories: z.number().nullable().optional(),
	heaviest_lift_kg: z
		.number()
		.nullable()
		.optional()
		.transform((v) => (v != null ? v * WEIGHT_MULTIPLIER : null)),
	eccentric_load: z.number().nullable().optional(),
	echo_level: z.number().nullable().optional(),
	warmup_reps: z.number().nullable().optional(),
	working_reps: z.number().nullable().optional(),
	local_profile_id: z.string().nullable().optional(),
});

export const workoutListSchema = z.array(workoutSessionSchema);

export type WorkoutSession = z.infer<typeof workoutSessionSchema>;

// --- Exercise ---

export const exerciseSchema = z.object({
	id: z.string().uuid(),
	session_id: z.string().uuid(),
	name: z.string(),
	muscle_group: z.string(),
	order_index: z.number(),
});

export type Exercise = z.infer<typeof exerciseSchema>;

// --- Set ---

export const setSchema = z.object({
	id: z.string().uuid(),
	exercise_id: z.string().uuid(),
	set_number: z.number(),
	target_reps: z.number().nullable(),
	actual_reps: z.number(),
	weight_kg: weightTransform,
	rpe: z.number().nullable(),
	is_pr: z.boolean(),
	notes: z.string().nullable(),
});

export type WorkoutSet = z.infer<typeof setSchema>;

// --- Personal Record ---

// Workout phase display mapping
const workoutPhaseMap: Record<string, string> = {
	COMBINED: "Combined",
	CONCENTRIC: "Concentric",
	ECCENTRIC: "Eccentric",
};

export const personalRecordSchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid(),
	exercise_name: z.string(),
	muscle_group: z.string(),
	record_type: z.string(),
	value: weightTransform,
	unit: z.string(),
	achieved_at: z.string().transform((s) => new Date(s)),
	previous_value: z
		.number()
		.nullable()
		.transform((v) => (v !== null ? v * WEIGHT_MULTIPLIER : null)),
	workout_phase: z
		.string()
		.nullable()
		.optional()
		.transform((p) => (p ? (workoutPhaseMap[p] ?? p) : "Combined")),
	local_profile_id: z.string().nullable().optional(),
});

export const personalRecordListSchema = z.array(personalRecordSchema);

export type PersonalRecord = z.infer<typeof personalRecordSchema>;

// --- Routine ---

export const routineSchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid(),
	name: z.string(),
	description: z.string(),
	exercise_count: z.number(),
	estimated_duration: z.number(),
	times_completed: z.number(),
	last_used_at: z
		.string()
		.nullable()
		.transform((s) => (s ? new Date(s) : null)),
	tags: z.array(z.string()).nullable(),
	is_favorite: z.boolean(),
	local_profile_id: z.string().nullable().optional(),
});

export const routineListSchema = z.array(routineSchema);

export type Routine = z.infer<typeof routineSchema>;

// --- Training Cycle ---

export const trainingCycleSchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid(),
	name: z.string(),
	description: z.string().nullable().optional(),
	duration_weeks: z.number(),
	current_week: z.number(),
	status: z.enum(["active", "completed", "draft"]),
	workout_days: z.number(),
	rest_days: z.number(),
	started_at: z
		.string()
		.nullable()
		.optional()
		.transform((s) => (s ? new Date(s) : null)),
	last_used_at: z
		.string()
		.nullable()
		.transform((s) => (s ? new Date(s) : null)),
	local_profile_id: z.string().nullable().optional(),
});

export const trainingCycleListSchema = z.array(trainingCycleSchema);

export type TrainingCycle = z.infer<typeof trainingCycleSchema>;

// --- Analytics Summary ---

export const analyticsSummarySchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid(),
	period: z.string(),
	total_workouts: z.number(),
	total_volume: weightTransform,
	total_duration: z.number(),
	avg_session_duration: z.number(),
	streak_days: z.number(),
	computed_at: z.string().transform((s) => new Date(s)),
});

export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;

// --- Routine Exercise ---

export const routineExerciseSchema = z.object({
	id: z.string().uuid(),
	routine_id: z.string().uuid(),
	name: z.string(),
	muscle_group: z.string(),
	sets: z.number(),
	reps: z.number(),
	weight: z.number(),
	rest_seconds: z.number(),
	duration_seconds: z.number().nullable().optional(),
	mode: z.string(),
	order_index: z.number(),
	superset_id: z.string().nullable().optional(),
	superset_color: z.string().nullable().optional(),
	superset_order: z.number().nullable().optional(),
	per_set_weights: z.any().nullable().optional(),
	per_set_rest: z.any().nullable().optional(),
	is_amrap: z.boolean().optional().default(false),
	is_bodyweight: z.boolean().optional().default(false),
	pr_percentage: z.number().nullable().optional(),
	rep_count_timing: z.string().nullable().optional(),
	stop_at_position: z.string().nullable().optional(),
	stall_detection: z.boolean().optional().default(false),
	eccentric_load: z.string().nullable().optional(),
	echo_level: z.string().nullable().optional(),
	created_at: z.string().transform((s) => new Date(s)),
});

export const routineExerciseListSchema = z.array(routineExerciseSchema);

export type RoutineExercise = z.infer<typeof routineExerciseSchema>;

// --- Routine Detail (routine + exercises) ---

export const routineDetailSchema = routineSchema.extend({
	routine_exercises: z.array(routineExerciseSchema),
});

export type RoutineDetail = z.infer<typeof routineDetailSchema>;

export const earnedBadgeSchema = z.object({
	id: z.string().uuid().optional(),
	user_id: z.string().uuid(),
	badge_id: z.string(),
	badge_name: z.string(),
	badge_description: z.string().nullable().optional(),
	badge_tier: z.string(),
	earned_at: z.string().transform((s) => new Date(s)),
});

export const earnedBadgeListSchema = z.array(earnedBadgeSchema);

export type EarnedBadge = z.infer<typeof earnedBadgeSchema>;

export const rpgAttributesSchema = z.object({
	id: z.string().uuid().optional(),
	user_id: z.string().uuid(),
	strength: z.number(),
	power: z.number(),
	stamina: z.number(),
	consistency: z.number(),
	mastery: z.number(),
	character_class: z.string().nullable().optional(),
	level: z.number(),
	experience_points: z.number(),
	updated_at: z
		.string()
		.nullable()
		.optional()
		.transform((s) => (s ? new Date(s) : null)),
});

export type RpgAttributes = z.infer<typeof rpgAttributesSchema>;

export const gamificationStatsSchema = z.object({
	id: z.string().uuid().optional(),
	user_id: z.string().uuid(),
	total_workouts: z.number(),
	total_reps: z.number(),
	total_volume_kg: z.number(),
	longest_streak: z.number(),
	current_streak: z.number(),
	total_time_seconds: z.number(),
	updated_at: z
		.string()
		.nullable()
		.optional()
		.transform((s) => (s ? new Date(s) : null)),
});

export type GamificationStats = z.infer<typeof gamificationStatsSchema>;

// --- Cycle Day ---

export const cycleDaySchema = z.object({
	id: z.string().uuid(),
	cycle_id: z.string().uuid(),
	day_number: z.number(),
	day_type: z.string(),
	routine_id: z.string().uuid().nullable(),
	weight_adjustment: z.number(),
	rep_modifier: z.number(),
	rest_override: z.number().nullable(),
	notes: z.string().nullable(),
	rest_type: z.string().nullable(),
});

export type CycleDay = z.infer<typeof cycleDaySchema>;

// --- Cycle Detail (cycle + days) ---

export const cycleDetailSchema = trainingCycleSchema.extend({
	cycle_days: z.array(cycleDaySchema),
	started_at: z
		.string()
		.nullable()
		.optional()
		.transform((s) => (s ? new Date(s) : null)),
	progression_settings: z.any().nullable().optional(),
	deload_settings: z.any().nullable().optional(),
});

export type CycleDetail = z.infer<typeof cycleDetailSchema>;

// --- Challenge ---

export const challengeSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	description: z.string().nullable(),
	challenge_type: z.enum(["volume", "frequency", "streak", "pr_count"]),
	target_value: z.number(),
	target_unit: z.string().nullable(),
	start_date: z
		.string()
		.nullable()
		.transform((s) => (s ? new Date(s) : null)),
	end_date: z
		.string()
		.nullable()
		.transform((s) => (s ? new Date(s) : null)),
	difficulty: z.string(),
	prize: z.string().nullable(),
	created_at: z.string().transform((s) => new Date(s)),
	is_active: z.boolean(),
});

export const challengeListSchema = z.array(challengeSchema);

export type Challenge = z.infer<typeof challengeSchema>;

// --- Challenge Participant ---

export const challengeParticipantSchema = z.object({
	id: z.string().uuid(),
	challenge_id: z.string().uuid(),
	user_id: z.string().uuid(),
	joined_at: z.string().transform((s) => new Date(s)),
	completed_at: z
		.string()
		.nullable()
		.transform((s) => (s ? new Date(s) : null)),
});

export const challengeParticipantListSchema = z.array(
	challengeParticipantSchema,
);

export type ChallengeParticipant = z.infer<typeof challengeParticipantSchema>;

// --- Body Intelligence ---

export const bodyIntelligenceRowSchema = z.object({
	id: z.string(),
	name: z.string(),
	muscle_group: z.string().nullable(),
	session_id: z.string(),
	setCount: z.number(),
	workout_sessions: z.object({
		id: z.string(),
		started_at: z.coerce.date(),
		user_id: z.string(),
	}),
});

export const bodyIntelligenceSchema = z.array(bodyIntelligenceRowSchema);
