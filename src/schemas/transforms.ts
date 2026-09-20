import { z } from "zod";
import {
	normalizeEccentricLoad,
	toEchoLevel,
	toRepCountTiming,
	toStopAtPosition,
	toSupersetColorName,
	toWireMode,
} from "../../supabase/functions/_shared/workoutModes.ts";

// Routine-exercise settings read in mobile's vocabulary. A value outside it
// (legacy portal "light"/"low"/free text) is what the phone parsed to its
// default, so it reads as null; legacy hex colours read as their name.
const nullableSetting = <T>(normalize: (value: unknown) => T | null) =>
	z
		.string()
		.nullish()
		.transform((value) => normalize(value));

// Per-cable to total weight conversion
// The trainer has dual cables; DB stores per-cable, portal shows total
// Change to 1 if DB convention changes to store total
export const WEIGHT_MULTIPLIER = 2;

// Nullable ISO timestamp → Date | null, rejecting malformed strings (which would
// otherwise parse as `Invalid Date` and corrupt downstream sorting/formatting).
const validDate = (d: Date | null) =>
	d === null || Number.isFinite(d.getTime());

const nullableDate = z
	.string()
	.nullable()
	.transform((s) => (s ? new Date(s) : null))
	.refine(validDate, { message: "Invalid date" });

const nullableOptionalDate = z
	.string()
	.nullable()
	.optional()
	.transform((s) => (s ? new Date(s) : null))
	.refine(validDate, { message: "Invalid date" });
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
	CLASSIC: "Old School", // Android legacy alias for OLD_SCHOOL
};

const workoutModeSchema = z
	.string()
	.nullable()
	.transform((mode) => (mode ? (workoutModeMap[mode] ?? mode) : null));

// --- Equipment Display ---

export const equipmentDisplayMap: Record<string, string> = {
	HANDLES: "Handles",
	BAR: "Bar",
	LONG_BAR: "Long Bar",
	SHORT_BAR: "Short Bar",
	ROPE: "Rope",
	BELT: "Belt",
	BENCH: "Bench",
	STRAPS: "Straps",
	GREY_CABLES: "Cables",
	BARBELL: "Barbell",
	DUMBBELL: "Dumbbell",
	CABLE: "Cable",
	MACHINE: "Machine",
	BODYWEIGHT: "Bodyweight",
	KETTLEBELL: "Kettlebell",
	BANDS: "Bands",
	EZ_BAR: "EZ Bar",
	MEDICINE_BALL: "Medicine Ball",
	EXERCISE_BALL: "Exercise Ball",
	FOAM_ROLL: "Foam Roll",
	PULL_UP_BAR: "Pull-up Bar",
	OTHER: "Other",
};

export function formatEquipment(codes: string[]): string {
	return codes.map((c) => equipmentDisplayMap[c] ?? c).join(", ");
}

// --- Workout Session ---

export const workoutSessionSchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid(),
	name: z
		.string()
		.nullable()
		.transform((name) => name?.trim() || "Untitled Workout"),
	started_at: z.coerce.date(),
	duration_seconds: z.number(),
	total_volume: z.number(), // Total volume in kg — already total (not per-cable). Phase 40 fix: removed weightTransform that was incorrectly doubling volume.
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
	exercise_id: z.string().nullable().optional(),
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
	exercise_id: z.string().nullable().optional(),
	muscle_group: z.string(),
	record_type: z.string(),
	value: weightTransform,
	unit: z.string(),
	achieved_at: z.coerce.date(),
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
	/** Stored as seconds in DB; exposed to portal UI as minutes */
	estimated_duration: z.number().transform((sec) => Math.round(sec / 60)),
	times_completed: z.number(),
	last_used_at: nullableDate,
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
	started_at: nullableOptionalDate,
	last_used_at: nullableDate,
	local_profile_id: z.string().nullable().optional(),
	template_id: z.string().nullable().optional(),
});

export const trainingCycleListSchema = z.array(trainingCycleSchema);

export type TrainingCycle = z.infer<typeof trainingCycleSchema>;

// --- Analytics Summary ---

export const analyticsSummarySchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid(),
	period: z.string(),
	total_workouts: z.number(),
	total_volume: z.number(), // Total volume in kg — already total (not per-cable). Phase 40 fix: removed weightTransform.
	total_duration: z.number(),
	avg_session_duration: z.number(),
	streak_days: z.number(),
	computed_at: z.coerce.date(),
});

export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;

// --- Routine Exercise ---

export const routineExerciseSchema = z.object({
	id: z.string().uuid(),
	routine_id: z.string().uuid(),
	name: z.string(),
	muscle_group: z.string(),
	exercise_id: z.string().nullable().optional(),
	sets: z.number(),
	reps: z.number(),
	weight: weightTransform,
	rest_seconds: z.number(),
	duration_seconds: z.number().nullable().optional(),
	// Stored as wire names; legacy display names / aliases normalize to wire.
	// Unknown values pass through so one odd row can't blank the routine list.
	mode: z.string().transform((mode) => toWireMode(mode) ?? mode),
	order_index: z.number(),
	superset_id: z.string().nullable().optional(),
	superset_color: nullableSetting(toSupersetColorName),
	superset_order: z.number().nullable().optional(),
	// Stored per-cable to match the single `weight` column; multiply back to
	// display totals so the UI keeps round-trip symmetry with `weight`.
	per_set_weights: z
		.unknown()
		.nullable()
		.optional()
		.transform((v) =>
			Array.isArray(v)
				? v.map((x) => (typeof x === "number" ? x * WEIGHT_MULTIPLIER : x))
				: v,
		),
	per_set_rest: z.unknown().nullable().optional(),
	per_set_reps: z.unknown().nullable().optional(),
	per_set_echo_levels: z.unknown().nullable().optional(),
	warmup_sets: z.unknown().nullable().optional(),
	is_amrap: z
		.boolean()
		.nullish()
		.transform((v) => v ?? false),
	is_bodyweight: z
		.boolean()
		.nullish()
		.transform((v) => v ?? false),
	pr_percentage: z.number().nullable().optional(),
	rep_count_timing: nullableSetting(toRepCountTiming),
	stop_at_position: nullableSetting(toStopAtPosition),
	stall_detection: z
		.boolean()
		.nullish()
		.transform((v) => v ?? true),
	eccentric_load: nullableSetting(normalizeEccentricLoad),
	echo_level: nullableSetting(toEchoLevel),
	drop_set_enabled: z
		.boolean()
		.nullish()
		.transform((v) => v ?? false),
	drop_set_min_weight_kg: z
		.number()
		.nullable()
		.optional()
		.transform((v) => (v == null ? null : v * WEIGHT_MULTIPLIER)),
	created_at: z.coerce.date(),
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
	earned_at: z.coerce.date(),
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
	updated_at: nullableOptionalDate,
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
	updated_at: nullableOptionalDate,
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
	started_at: nullableOptionalDate,
	progression_settings: z.unknown().nullable().optional(),
	deload_settings: z.unknown().nullable().optional(),
});

export type CycleDetail = z.infer<typeof cycleDetailSchema>;

// --- Cycle progression settings (shared with mobile) ---
//
// Mobile decodes training_cycles.progression_settings as a Kotlin
// Map<String, String> with a non-lenient Json (Project-Phoenix-MP
// SqlDelightSyncRepository.mergePortalCycles). A single non-string value
// (number, boolean, null) makes the whole decode fail and the phone drops
// the cycle's progression. So EVERY value must be a JSON string.
//
// Mobile-owned keys (read by the phone; the push owns them, PR 18 merge):
//   frequencyCycles, weightIncreasePercent, echoLevelIncrease,
//   eccentricLoadIncreasePercent
// Portal-only keys (ignored by the phone, kept by the push merge):
//   type, amount, frequency, trigger, upperIncrement, lowerIncrement

export const MOBILE_PROGRESSION_KEYS = [
	"frequencyCycles",
	"weightIncreasePercent",
	"echoLevelIncrease",
	"eccentricLoadIncreasePercent",
] as const;

/** What mobile can decode: a flat object of string values. */
export const mobileProgressionSettingsSchema = z.record(z.string(), z.string());

export type CycleProgressionSettings = z.infer<
	typeof mobileProgressionSettingsSchema
>;

export type ProgressionType = "percentage" | "fixed" | "manual";
export type ProgressionTrigger = "all_sets" | "target_rpe" | "cycle_complete";

export interface CycleProgressionForm {
	type: ProgressionType;
	amount: number;
	frequency: number;
	trigger: ProgressionTrigger;
	upperIncrement: number;
	lowerIncrement: number;
}

/** Mobile's progression-frequency stepper range (ProgressionSettingsSheet). */
export const MIN_FREQUENCY_CYCLES = 1;
export const MAX_FREQUENCY_CYCLES = 10;
/** What the phone uses when frequencyCycles is absent. */
export const MOBILE_DEFAULT_FREQUENCY_CYCLES = 2;

/** Integer 1-10, as mobile's toLongOrNull() and stepper expect. */
export function clampFrequencyCycles(value: number): number {
	const n = Math.round(value);
	if (!Number.isFinite(n)) return MIN_FREQUENCY_CYCLES;
	return Math.min(MAX_FREQUENCY_CYCLES, Math.max(MIN_FREQUENCY_CYCLES, n));
}

/** Which mobile-mapped controls the user changed in this edit session. */
export interface ProgressionTouched {
	/** Progression type or increase amount. */
	weight: boolean;
	/** Progress-every-N-cycles control. */
	frequency: boolean;
}

/**
 * Builds progression_settings for a portal save, every value a string.
 *
 * Portal-only keys always reflect the form. Mobile keys are passed through
 * from the stored settings unchanged unless the user changed the matching
 * control in this session, so a portal save (e.g. a rename) never
 * resurrects a key the phone cleared or injects a default:
 *   - frequency touched  -> frequencyCycles = form frequency (integer 1-10)
 *   - weight touched     -> weightIncreasePercent = amount for a percentage
 *                           type, removed for fixed/manual (the machine only
 *                           applies percentage increases)
 * echoLevelIncrease / eccentricLoadIncreasePercent have no portal control
 * and are always passed through.
 */
export function buildCycleProgressionSettings(
	form: CycleProgressionForm,
	existing: unknown,
	touched: ProgressionTouched,
): CycleProgressionSettings {
	const settings: CycleProgressionSettings = {
		type: form.type,
		amount: String(form.amount),
		frequency: String(form.frequency),
		trigger: form.trigger,
		upperIncrement: String(form.upperIncrement),
		lowerIncrement: String(form.lowerIncrement),
	};
	if (existing && typeof existing === "object" && !Array.isArray(existing)) {
		const stored = existing as Record<string, unknown>;
		for (const key of MOBILE_PROGRESSION_KEYS) {
			const value = stored[key];
			if (value !== null && value !== undefined) {
				settings[key] = String(value);
			}
		}
	}
	if (touched.frequency) {
		settings.frequencyCycles = String(clampFrequencyCycles(form.frequency));
	}
	if (touched.weight) {
		if (form.type === "percentage" && Number.isFinite(form.amount)) {
			settings.weightIncreasePercent = String(form.amount);
		} else {
			delete settings.weightIncreasePercent;
		}
	}
	return settings;
}

const finiteNumber = (value: unknown): number | undefined => {
	if (value === null || value === undefined || value === "") return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
};

/**
 * Reads stored progression_settings (string values, legacy numeric values,
 * or a mobile-only object) back into builder form values, showing what the
 * machine applies:
 *   - weightIncreasePercent present -> percentage at that value;
 *   - mobile keys present but weightIncreasePercent absent -> the phone has
 *     weight increases off, so a stored "percentage" type reads as "manual";
 *   - frequencyCycles wins over the legacy portal `frequency` (read as-is).
 */
export function readCycleProgressionSettings(
	raw: unknown,
): Partial<CycleProgressionForm> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const ps = raw as Record<string, unknown>;
	const out: Partial<CycleProgressionForm> = {};

	if (ps.type === "percentage" || ps.type === "fixed" || ps.type === "manual") {
		out.type = ps.type;
	}
	if (
		ps.trigger === "all_sets" ||
		ps.trigger === "target_rpe" ||
		ps.trigger === "cycle_complete"
	) {
		out.trigger = ps.trigger;
	}

	// Mobile keys win over portal keys: a phone push rewrites the mobile keys
	// and leaves the portal ones alone, so the mobile key is never staler.
	// Preferring it keeps a later portal save from reverting a phone edit.
	const weightIncreasePercent = finiteNumber(ps.weightIncreasePercent);
	const amount = finiteNumber(ps.amount);
	const hasMobileKeys = MOBILE_PROGRESSION_KEYS.some(
		(key) => ps[key] !== undefined && ps[key] !== null,
	);
	if (weightIncreasePercent !== undefined) {
		out.amount = weightIncreasePercent;
		out.type = "percentage";
	} else {
		if (amount !== undefined) out.amount = amount;
		if (hasMobileKeys && out.type === "percentage") out.type = "manual";
	}

	const frequency =
		finiteNumber(ps.frequencyCycles) ?? finiteNumber(ps.frequency);
	if (frequency !== undefined && frequency >= 1) out.frequency = frequency;

	const upper = finiteNumber(ps.upperIncrement);
	if (upper !== undefined) out.upperIncrement = upper;
	const lower = finiteNumber(ps.lowerIncrement);
	if (lower !== undefined) out.lowerIncrement = lower;

	return out;
}

// --- Challenge ---

export const challengeSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	description: z.string().nullable(),
	challenge_type: z.enum(["volume", "frequency", "streak", "pr_count"]),
	target_value: z.number(),
	target_unit: z.string().nullable(),
	start_date: nullableDate,
	end_date: nullableDate,
	difficulty: z.string(),
	prize: z.string().nullable(),
	created_at: z.coerce.date(),
	is_active: z.boolean(),
});

export const challengeListSchema = z.array(challengeSchema);

export type Challenge = z.infer<typeof challengeSchema>;

// --- Challenge Participant ---

export const challengeParticipantSchema = z.object({
	id: z.string().uuid(),
	challenge_id: z.string().uuid(),
	user_id: z.string().uuid(),
	joined_at: z.coerce.date(),
	completed_at: nullableDate,
});

export const challengeParticipantListSchema = z.array(
	challengeParticipantSchema,
);

export type ChallengeParticipant = z.infer<typeof challengeParticipantSchema>;

// --- Body Intelligence ---

export const bodyIntelligenceRowSchema = z.object({
	id: z.string().uuid(),
	exercise_id: z.string().nullable().optional(),
	name: z.string(),
	muscle_group: z.string().nullable(),
	session_id: z.string().uuid(),
	setCount: z.number(),
	sets: z
		.array(
			z.object({
				id: z.string().uuid(),
				actual_reps: z.number().nullable(),
				weight_kg: z.number().nullable(),
			}),
		)
		.optional(),
	workout_sessions: z.object({
		id: z.string().uuid(),
		started_at: z.coerce.date(),
		user_id: z.string().uuid(),
	}),
});

export const bodyIntelligenceSchema = z.array(bodyIntelligenceRowSchema);

// --- Exercise Catalog ---

export const catalogExerciseSchema = z.object({
	id: z.string(),
	name: z.string(),
	display_name: z.string(),
	description: z.string().nullable(),
	muscle_group: z.string(),
	muscle_groups: z.array(z.string()),
	muscles: z.array(z.string()).nullable(),
	equipment: z.array(z.string()),
	movement: z.string().nullable(),
	sidedness: z.string().nullable(),
	grip: z.string().nullable(),
	grip_width: z.string().nullable(),
	default_cable_config: z.string(),
	min_rep_range: z.number().nullable(),
	popularity: z.number(),
	aliases: z.array(z.string()).nullable(),
	thumbnail_url: z.string().nullable(),
	archived: z.boolean(),
	is_custom: z.boolean(),
	source: z.string().nullable().optional(),
	source_id: z.string().nullable().optional(),
	license: z.string().nullable().optional(),
	license_author: z.string().nullable().optional(),
	license_url: z.string().nullable().optional(),
});

export const catalogExerciseListSchema = z.array(catalogExerciseSchema);

export type CatalogExercise = z.infer<typeof catalogExerciseSchema>;

export function getExerciseDisplayName(exercise: CatalogExercise): string {
	return exercise.display_name;
}
