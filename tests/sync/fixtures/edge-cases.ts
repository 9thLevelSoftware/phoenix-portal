/**
 * Edge Case Fixtures for Beta Sync Validation
 *
 * These factories create fixtures that test boundary conditions, edge cases,
 * and potential failure scenarios in the sync pipeline.
 *
 * Categories:
 * - Empty array variants (0 exercises, 0 sets)
 * - Max value variants (weight=220, velocity=2.0, attributes=100)
 * - Unicode variants (emoji, special characters)
 * - Null optional field variants
 * - Boundary values for transforms
 */

import type { Database } from "@/lib/database.types";
import {
	createCycleDayFixture,
	createCycleFixture,
	type NestedCycleFixture,
} from "./cycle-fixtures";
import { createExternalActivityFixture } from "./external-fixtures";
import {
	createBadgeFixture,
	createGamificationStatsFixture,
	createPersonalRecordFixture,
	createRpgAttributesFixture,
} from "./gamification-fixtures";
import {
	createRoutineExerciseFixture,
	createRoutineFixture,
	type NestedRoutineFixture,
} from "./routine-fixtures";
import {
	ASYMMETRY_BALANCED_THRESHOLD,
	createExerciseFixture,
	createRepSummaryFixture,
	createSessionFixture,
	createSetFixture,
	type NestedSessionFixture,
	VELOCITY_ZONES,
} from "./workout-fixtures";

// Type aliases for cleaner code
type WorkoutSessionRow =
	Database["public"]["Tables"]["workout_sessions"]["Row"];
type RoutineRow = Database["public"]["Tables"]["routines"]["Row"];
type TrainingCycleRow = Database["public"]["Tables"]["training_cycles"]["Row"];
type PersonalRecordRow =
	Database["public"]["Tables"]["personal_records"]["Row"];
type RpgAttributesRow = Database["public"]["Tables"]["rpg_attributes"]["Row"];
type EarnedBadgeRow = Database["public"]["Tables"]["earned_badges"]["Row"];
type GamificationStatsRow =
	Database["public"]["Tables"]["gamification_stats"]["Row"];
type ExternalActivityRow =
	Database["public"]["Tables"]["external_activities"]["Row"];
type RoutineExerciseRow =
	Database["public"]["Tables"]["routine_exercises"]["Row"];
type CycleDayRow = Database["public"]["Tables"]["cycle_days"]["Row"];

// ============================================================================
// EMPTY ARRAY VARIANTS
// ============================================================================

/**
 * Create a session with zero exercises.
 * Tests handling of empty workout sessions (e.g., aborted workouts).
 */
export function createEmptySessionFixture(
	userId?: string,
): NestedSessionFixture {
	const session = createSessionFixture({
		user_id: userId,
		name: "Empty Workout",
		exercise_count: 0,
		set_count: 0,
		total_volume: 0,
		pr_count: 0,
	});

	return {
		session,
		exercises: [],
	};
}

/**
 * Create a routine with zero exercises.
 * Tests handling of template routines before exercises are added.
 */
export function createEmptyRoutineFixture(
	userId?: string,
): NestedRoutineFixture {
	const routine = createRoutineFixture({
		user_id: userId,
		name: "Empty Routine",
		exercise_count: 0,
		estimated_duration: 0,
		times_completed: 0,
	});

	return {
		routine,
		exercises: [],
	};
}

/**
 * Create a cycle with zero days.
 * Tests handling of draft cycles before configuration.
 */
export function createEmptyCycleFixture(userId?: string): NestedCycleFixture {
	const cycle = createCycleFixture({
		user_id: userId,
		name: "Empty Cycle",
		status: "draft",
		duration_weeks: 0,
		workout_days: 0,
		rest_days: 0,
	});

	return {
		cycle,
		days: [],
	};
}

// ============================================================================
// MAX VALUE VARIANTS
// ============================================================================

/**
 * Maximum weight per-cable (Vitruvian max is 220kg per cable).
 */
export const MAX_WEIGHT_KG = 220;

/**
 * Maximum realistic velocity in m/s.
 */
export const MAX_VELOCITY_MPS = 2.0;

/**
 * Maximum RPG attribute value.
 */
export const MAX_RPG_ATTRIBUTE = 100;

/**
 * Create a session with maximum values.
 */
export function createMaxValueSessionFixture(
	userId?: string,
): WorkoutSessionRow {
	return createSessionFixture({
		user_id: userId,
		name: "Max Value Workout",
		duration_seconds: 86400, // 24 hours (extreme)
		total_volume: MAX_WEIGHT_KG * 100 * 20, // 220kg x 100 reps x 20 sets
		set_count: 100,
		exercise_count: 20,
		pr_count: 20,
		avg_velocity_mps: MAX_VELOCITY_MPS,
		avg_asymmetry_pct: 50, // Maximum asymmetry
		velocity_loss_pct: 100, // Complete velocity loss
		form_score: 100,
		peak_force_n: 5000, // Very high force
		estimated_calories: 5000,
		heaviest_lift_kg: MAX_WEIGHT_KG,
		warmup_reps: 100,
		working_reps: 500,
	});
}

/**
 * Create a set with maximum weight.
 */
export function createMaxWeightSetFixture(
	exerciseId?: string,
	userId?: string,
) {
	return createSetFixture({
		exercise_id: exerciseId,
		user_id: userId,
		weight_kg: MAX_WEIGHT_KG,
		actual_reps: 1, // 1RM
		target_reps: 1,
		rpe: 10, // Maximum effort
		is_pr: true,
	});
}

/**
 * Create a rep summary with maximum velocity (explosive zone).
 */
export function createMaxVelocityRepFixture(setId?: string, userId?: string) {
	return createRepSummaryFixture({
		set_id: setId,
		user_id: userId,
		mean_velocity_mps: MAX_VELOCITY_MPS,
		peak_velocity_mps: MAX_VELOCITY_MPS * 1.2,
		vbt_zone: "EXPLOSIVE",
	});
}

/**
 * Create RPG attributes at maximum values.
 */
export function createMaxRpgAttributesFixture(
	userId?: string,
): RpgAttributesRow {
	return createRpgAttributesFixture({
		user_id: userId,
		strength: MAX_RPG_ATTRIBUTE,
		power: MAX_RPG_ATTRIBUTE,
		stamina: MAX_RPG_ATTRIBUTE,
		consistency: MAX_RPG_ATTRIBUTE,
		mastery: MAX_RPG_ATTRIBUTE,
		level: 100,
		experience_points: 999999,
		character_class: "Titan",
	});
}

/**
 * Create gamification stats with maximum values.
 */
export function createMaxGamificationStatsFixture(
	userId?: string,
): GamificationStatsRow {
	return createGamificationStatsFixture({
		user_id: userId,
		total_workouts: 10000,
		total_reps: 1000000,
		total_volume_kg: 100000000, // 100,000 tonnes
		longest_streak: 3650, // 10 years
		current_streak: 365, // 1 year
		total_time_seconds: 36000000, // 10,000 hours
	});
}

// ============================================================================
// UNICODE VARIANTS
// ============================================================================

/**
 * Unicode test strings for various fields.
 */
export const UNICODE_TEST_STRINGS = {
	emoji: "Morning Workout 💪🔥",
	chinese: "早晨锻炼",
	japanese: "朝のトレーニング",
	arabic: "تمرين الصباح",
	russian: "Утренняя тренировка",
	mixed: "Workout 💪 训练 🏋️‍♂️ トレーニング",
	specialChars: "Bench Press (3-4 sec) @85% 1RM — Heavy!",
	longEmoji: "🏋️‍♂️🔥💪🦵🏃‍♂️🚴‍♂️🏊‍♂️🤸‍♂️🧘‍♂️🥇🏆",
} as const;

/**
 * Create a session with Unicode in the name.
 */
export function createUnicodeSessionFixture(
	variant: keyof typeof UNICODE_TEST_STRINGS = "emoji",
	userId?: string,
): WorkoutSessionRow {
	return createSessionFixture({
		user_id: userId,
		name: UNICODE_TEST_STRINGS[variant],
		notes: `Notes with ${UNICODE_TEST_STRINGS[variant]}`,
	});
}

/**
 * Create an exercise with Unicode name.
 */
export function createUnicodeExerciseFixture(
	variant: keyof typeof UNICODE_TEST_STRINGS = "emoji",
	sessionId?: string,
	userId?: string,
) {
	return createExerciseFixture({
		session_id: sessionId,
		user_id: userId,
		name: `Bench Press ${UNICODE_TEST_STRINGS[variant]}`,
	});
}

/**
 * Create a routine with Unicode in name and description.
 */
export function createUnicodeRoutineFixture(
	variant: keyof typeof UNICODE_TEST_STRINGS = "emoji",
	userId?: string,
): RoutineRow {
	return createRoutineFixture({
		user_id: userId,
		name: UNICODE_TEST_STRINGS[variant],
		description: `A workout routine with ${UNICODE_TEST_STRINGS[variant]} characters`,
		tags: ["unicode", "test", UNICODE_TEST_STRINGS.emoji],
	});
}

/**
 * Create a badge with Unicode description.
 */
export function createUnicodeBadgeFixture(
	variant: keyof typeof UNICODE_TEST_STRINGS = "emoji",
	userId?: string,
): EarnedBadgeRow {
	return createBadgeFixture({
		user_id: userId,
		badge_name: `Achievement ${UNICODE_TEST_STRINGS[variant]}`,
		badge_description: `Earned by ${UNICODE_TEST_STRINGS[variant]}`,
	});
}

// ============================================================================
// NULL OPTIONAL FIELD VARIANTS
// ============================================================================

/**
 * Create a session with all optional fields null.
 */
export function createMinimalSessionFixture(
	userId?: string,
): WorkoutSessionRow {
	return createSessionFixture({
		user_id: userId,
		name: null,
		routine_name: null,
		workout_mode: null,
		notes: null,
		local_profile_id: null,
		// All enrichment fields null
		avg_velocity_mps: null,
		avg_asymmetry_pct: null,
		velocity_loss_pct: null,
		dominant_side: null,
		strength_profile: null,
		form_score: null,
		deload_warnings: null,
		rom_violations: null,
		spotter_activations: null,
		peak_force_n: null,
		estimated_calories: null,
		heaviest_lift_kg: null,
		eccentric_load: null,
		echo_level: null,
		warmup_reps: null,
		working_reps: null,
	});
}

/**
 * Create a routine exercise with all optional fields null.
 */
export function createMinimalRoutineExerciseFixture(
	routineId?: string,
): RoutineExerciseRow {
	return createRoutineExerciseFixture({
		routine_id: routineId,
		// All optional fields null
		superset_id: null,
		superset_color: null,
		superset_order: null,
		per_set_weights: null,
		per_set_rest: null,
		per_set_echo_levels: null,
		is_amrap: null,
		pr_percentage: null,
		eccentric_load: null,
		echo_level: null,
		stall_detection: null,
		stop_at_position: null,
		rep_count_timing: null,
		warmup_sets: null,
	});
}

/**
 * Create a cycle day with all optional fields null.
 */
export function createMinimalCycleDayFixture(cycleId?: string): CycleDayRow {
	return createCycleDayFixture({
		cycle_id: cycleId,
		routine_id: null,
		rest_override: null,
		notes: null,
		rest_type: null,
	});
}

/**
 * Create a personal record with optional fields null.
 */
export function createMinimalPersonalRecordFixture(
	userId?: string,
): PersonalRecordRow {
	return createPersonalRecordFixture({
		user_id: userId,
		previous_value: null,
		workout_phase: null,
		local_profile_id: null,
	});
}

// ============================================================================
// BOUNDARY VALUE VARIANTS
// ============================================================================

/**
 * Boundary values for weight transform testing.
 * Portal multiplies per-cable weight by 2 for display.
 */
export const WEIGHT_BOUNDARY_VALUES = {
	zero: 0,
	minimum: 0.5, // 0.5kg per cable = 1kg total
	standard: 50, // 50kg per cable = 100kg total
	maximum: MAX_WEIGHT_KG, // 220kg per cable = 440kg total
} as const;

/**
 * Create sets with boundary weight values.
 */
export function createWeightBoundarySetFixtures(
	exerciseId?: string,
	userId?: string,
) {
	return Object.entries(WEIGHT_BOUNDARY_VALUES).map(([name, weight]) =>
		createSetFixture({
			exercise_id: exerciseId,
			user_id: userId,
			weight_kg: weight,
			notes: `Weight boundary test: ${name}`,
		}),
	);
}

/**
 * Asymmetry boundary values (2% = BALANCED threshold).
 */
export const ASYMMETRY_BOUNDARY_VALUES = {
	perfect: 0,
	nearBalanced: ASYMMETRY_BALANCED_THRESHOLD - 0.1, // 1.9%
	atThreshold: ASYMMETRY_BALANCED_THRESHOLD, // 2.0%
	slightlyOver: ASYMMETRY_BALANCED_THRESHOLD + 0.1, // 2.1%
	moderate: 10,
	severe: 25,
	extreme: 50,
} as const;

/**
 * Create rep summaries with asymmetry boundary values.
 */
export function createAsymmetryBoundaryRepFixtures(
	setId?: string,
	userId?: string,
) {
	return Object.entries(ASYMMETRY_BOUNDARY_VALUES).map(([name, asymmetry]) =>
		createRepSummaryFixture({
			set_id: setId,
			user_id: userId,
			asymmetry_pct: asymmetry,
			// Reflect asymmetry in force values
			left_force_avg: 225,
			right_force_avg: 225 * (1 + asymmetry / 100),
		}),
	);
}

/**
 * Velocity zone boundary values.
 */
export const VELOCITY_BOUNDARY_VALUES = {
	grind: 0.1, // Deep in GRIND zone
	grindToSlow: VELOCITY_ZONES.SLOW - 0.01, // Just under SLOW threshold
	slow: VELOCITY_ZONES.SLOW, // Exactly at SLOW threshold
	slowToModerate: VELOCITY_ZONES.MODERATE - 0.01,
	moderate: VELOCITY_ZONES.MODERATE,
	moderateToFast: VELOCITY_ZONES.FAST - 0.01,
	fast: VELOCITY_ZONES.FAST,
	fastToExplosive: VELOCITY_ZONES.EXPLOSIVE - 0.01,
	explosive: VELOCITY_ZONES.EXPLOSIVE,
	superExplosive: MAX_VELOCITY_MPS,
} as const;

/**
 * Create rep summaries for all velocity zone boundaries.
 */
export function createVelocityBoundaryRepFixtures(
	setId?: string,
	userId?: string,
) {
	const zoneForVelocity = (v: number): string => {
		if (v >= VELOCITY_ZONES.EXPLOSIVE) return "EXPLOSIVE";
		if (v >= VELOCITY_ZONES.FAST) return "FAST";
		if (v >= VELOCITY_ZONES.MODERATE) return "MODERATE";
		if (v >= VELOCITY_ZONES.SLOW) return "SLOW";
		return "GRIND";
	};

	return Object.entries(VELOCITY_BOUNDARY_VALUES).map(([name, velocity]) =>
		createRepSummaryFixture({
			set_id: setId,
			user_id: userId,
			mean_velocity_mps: velocity,
			peak_velocity_mps: velocity * 1.2,
			vbt_zone: zoneForVelocity(velocity) as
				| "EXPLOSIVE"
				| "FAST"
				| "MODERATE"
				| "SLOW"
				| "GRIND",
		}),
	);
}

// ============================================================================
// AGGREGATE EDGE CASE FIXTURES
// ============================================================================

/**
 * Collection of all edge case fixtures for comprehensive testing.
 */
export interface EdgeCaseFixtureCollection {
	emptySessions: NestedSessionFixture[];
	emptyRoutines: NestedRoutineFixture[];
	emptyCycles: NestedCycleFixture[];
	maxValueSessions: WorkoutSessionRow[];
	maxRpgAttributes: RpgAttributesRow[];
	maxGamificationStats: GamificationStatsRow[];
	unicodeSessions: WorkoutSessionRow[];
	unicodeRoutines: RoutineRow[];
	minimalSessions: WorkoutSessionRow[];
	minimalRecords: PersonalRecordRow[];
	weightBoundarySets: ReturnType<typeof createSetFixture>[];
	asymmetryBoundaryReps: ReturnType<typeof createRepSummaryFixture>[];
	velocityBoundaryReps: ReturnType<typeof createRepSummaryFixture>[];
}

/**
 * Create a comprehensive collection of edge case fixtures.
 */
export function createEdgeCaseCollection(
	userId?: string,
): EdgeCaseFixtureCollection {
	return {
		emptySessions: [createEmptySessionFixture(userId)],
		emptyRoutines: [createEmptyRoutineFixture(userId)],
		emptyCycles: [createEmptyCycleFixture(userId)],
		maxValueSessions: [createMaxValueSessionFixture(userId)],
		maxRpgAttributes: [createMaxRpgAttributesFixture(userId)],
		maxGamificationStats: [createMaxGamificationStatsFixture(userId)],
		unicodeSessions: Object.keys(UNICODE_TEST_STRINGS).map((variant) =>
			createUnicodeSessionFixture(
				variant as keyof typeof UNICODE_TEST_STRINGS,
				userId,
			),
		),
		unicodeRoutines: Object.keys(UNICODE_TEST_STRINGS).map((variant) =>
			createUnicodeRoutineFixture(
				variant as keyof typeof UNICODE_TEST_STRINGS,
				userId,
			),
		),
		minimalSessions: [createMinimalSessionFixture(userId)],
		minimalRecords: [createMinimalPersonalRecordFixture(userId)],
		weightBoundarySets: createWeightBoundarySetFixtures(undefined, userId),
		asymmetryBoundaryReps: createAsymmetryBoundaryRepFixtures(
			undefined,
			userId,
		),
		velocityBoundaryReps: createVelocityBoundaryRepFixtures(undefined, userId),
	};
}
