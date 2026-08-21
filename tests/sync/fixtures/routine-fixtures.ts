/**
 * Routine Entity Fixtures for Beta Sync Validation
 *
 * These factories create valid DTO shapes for routine-related entities
 * as they flow through the sync pipeline.
 *
 * Key features:
 * - Superset support with grouping IDs and colors
 * - Per-set weight and rest overrides
 * - AMRAP and PR-scaling configurations
 * - Advanced mode settings (eccentric load, echo level, stall detection)
 */

import type { Database, Json } from "@/lib/database.types";
import { WORKOUT_MODES, type WorkoutMode } from "./workout-fixtures";

// Type aliases
type RoutineRow = Database["public"]["Tables"]["routines"]["Row"];
type RoutineInsert = Database["public"]["Tables"]["routines"]["Insert"];
type RoutineExerciseRow =
	Database["public"]["Tables"]["routine_exercises"]["Row"];
type RoutineExerciseInsert =
	Database["public"]["Tables"]["routine_exercises"]["Insert"];

// Default test user and timestamp
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_TIMESTAMP = "2026-04-12T10:00:00.000Z";

// Superset colors for visual grouping
export const SUPERSET_COLORS = [
	"#FF6B35", // Phoenix Ember
	"#3B82F6", // Blue
	"#10B981", // Forge Green
	"#F59E0B", // Gold
	"#8B5CF6", // Purple
] as const;

let uuidCounter = 2000;
function generateTestUuid(seed: number): string {
	const hex = seed.toString(16).padStart(8, "0");
	return `${hex.slice(0, 8)}-0000-4000-8000-${hex.padStart(12, "0")}`;
}

function nextTestUuid(): string {
	return generateTestUuid(uuidCounter++);
}

/**
 * Create a routine fixture with sensible defaults.
 *
 * @param overrides - Partial routine data to override defaults
 * @returns A valid RoutineRow shape
 */
export function createRoutineFixture(
	overrides: Partial<RoutineRow> = {},
): RoutineRow {
	const id = overrides.id ?? nextTestUuid();

	return {
		id,
		user_id: overrides.user_id ?? DEFAULT_USER_ID,
		name: "Push Day A",
		description: "Chest, shoulders, and triceps focused workout",
		exercise_count: 5,
		estimated_duration: 60, // minutes
		times_completed: 12,
		last_used_at: DEFAULT_TIMESTAMP,
		tags: ["push", "chest", "strength"],
		is_favorite: true,
		local_profile_id: null,
		created_at: DEFAULT_TIMESTAMP,
		updated_at: DEFAULT_TIMESTAMP,
		...overrides,
	} satisfies RoutineRow;
}

/**
 * Create a routine exercise fixture with full support for advanced features.
 *
 * @param overrides - Partial exercise data to override defaults
 * @returns A valid RoutineExerciseRow shape
 */
export function createRoutineExerciseFixture(
	overrides: Partial<RoutineExerciseRow> = {},
): RoutineExerciseRow {
	const id = overrides.id ?? nextTestUuid();

	return {
		id,
		routine_id: overrides.routine_id ?? nextTestUuid(),
		name: "Bench Press",
		muscle_group: "Chest",
		sets: 4,
		reps: 10,
		weight: 50, // Per-cable
		rest_seconds: 90,
		mode: "OLD_SCHOOL" as WorkoutMode,
		order_index: 0,
		created_at: DEFAULT_TIMESTAMP,

		// Superset configuration
		superset_id: null,
		superset_color: null,
		superset_order: null,

		// Per-set customization (JSON arrays)
		per_set_weights: null,
		per_set_rest: null,
		per_set_echo_levels: null,

		// AMRAP and PR-scaling
		is_amrap: false,
		pr_percentage: null,

		// Advanced mode settings
		eccentric_load: null, // "LIGHT", "MODERATE", "HEAVY"
		echo_level: null, // "1", "2", "3", "4", "5"
		stall_detection: false,
		stop_at_position: null, // "TOP", "BOTTOM", "MID"
		rep_count_timing: null, // "PAUSE_AT_TOP", "PAUSE_AT_BOTTOM", etc.

		// Warmup configuration
		warmup_sets: null, // JSON for warmup set structure

		// Drop-set retry (mobile #673). Floor is per-cable kg.
		is_bodyweight: false,
		duration_seconds: null,
		per_set_reps: null,
		drop_set_enabled: false,
		drop_set_min_weight_kg: null,
		...overrides,
	} satisfies RoutineExerciseRow;
}

/**
 * Create a routine exercise with per-set weight customization.
 *
 * Example: Progressive overload across sets
 */
export function createRoutineExerciseWithPerSetWeights(
	routineId: string,
	weights: number[],
	overrides: Partial<RoutineExerciseRow> = {},
): RoutineExerciseRow {
	return createRoutineExerciseFixture({
		routine_id: routineId,
		sets: weights.length,
		weight: weights[0], // Base weight
		per_set_weights: weights as unknown as Json,
		...overrides,
	});
}

/**
 * Create a routine exercise with per-set rest customization.
 *
 * Example: Decreasing rest for intensity
 */
export function createRoutineExerciseWithPerSetRest(
	routineId: string,
	restSeconds: number[],
	overrides: Partial<RoutineExerciseRow> = {},
): RoutineExerciseRow {
	return createRoutineExerciseFixture({
		routine_id: routineId,
		sets: restSeconds.length,
		rest_seconds: restSeconds[0], // Base rest
		per_set_rest: restSeconds as unknown as Json,
		...overrides,
	});
}

/**
 * Create an AMRAP (As Many Reps As Possible) exercise fixture.
 */
export function createAmrapExerciseFixture(
	routineId: string,
	overrides: Partial<RoutineExerciseRow> = {},
): RoutineExerciseRow {
	return createRoutineExerciseFixture({
		routine_id: routineId,
		is_amrap: true,
		reps: 0, // No target reps for AMRAP
		...overrides,
	});
}

/**
 * Create a PR-scaled exercise fixture (weight based on % of PR).
 */
export function createPrScaledExerciseFixture(
	routineId: string,
	prPercentage: number,
	overrides: Partial<RoutineExerciseRow> = {},
): RoutineExerciseRow {
	return createRoutineExerciseFixture({
		routine_id: routineId,
		pr_percentage: prPercentage, // e.g., 80 for 80% of PR
		weight: 0, // Weight calculated from PR at runtime
		...overrides,
	});
}

/**
 * Superset configuration type for organizing exercises.
 */
export interface SupersetConfig {
	supersetId: string;
	color: string;
	exerciseNames: string[];
	muscleGroups: string[];
}

/**
 * Create a group of exercises configured as a superset.
 */
export function createSupersetExercises(
	routineId: string,
	config: SupersetConfig,
	baseOrderIndex: number = 0,
): RoutineExerciseRow[] {
	return config.exerciseNames.map((name, index) =>
		createRoutineExerciseFixture({
			routine_id: routineId,
			name,
			muscle_group: config.muscleGroups[index] ?? "Full Body",
			order_index: baseOrderIndex + index,
			superset_id: config.supersetId,
			superset_color: config.color,
			superset_order: index,
		}),
	);
}

/**
 * Nested routine fixture type for comprehensive testing.
 */
export interface NestedRoutineFixture {
	routine: RoutineRow;
	exercises: RoutineExerciseRow[];
}

/**
 * Create a complete routine with exercises.
 *
 * @param options - Configuration for the nested fixture
 * @returns A fully nested routine structure
 */
export function createNestedRoutineFixture(
	options: {
		exerciseCount?: number;
		includeSuperset?: boolean;
		includeAmrap?: boolean;
		includePrScaling?: boolean;
		routineOverrides?: Partial<RoutineRow>;
		userId?: string;
	} = {},
): NestedRoutineFixture {
	const {
		exerciseCount = 5,
		includeSuperset = false,
		includeAmrap = false,
		includePrScaling = false,
		routineOverrides = {},
		userId = DEFAULT_USER_ID,
	} = options;

	const routineId = nextTestUuid();

	const exerciseTemplates = [
		{ name: "Bench Press", muscleGroup: "Chest", mode: "OLD_SCHOOL" },
		{ name: "Incline Press", muscleGroup: "Chest", mode: "ECHO" },
		{ name: "Cable Fly", muscleGroup: "Chest", mode: "PUMP" },
		{ name: "Shoulder Press", muscleGroup: "Shoulders", mode: "TUT" },
		{ name: "Lateral Raise", muscleGroup: "Shoulders", mode: "TUT_BEAST" },
		{ name: "Tricep Extension", muscleGroup: "Arms", mode: "ECCENTRIC_ONLY" },
	];

	const exercises: RoutineExerciseRow[] = [];
	let orderIndex = 0;

	// Add superset if requested (first two exercises)
	if (includeSuperset && exerciseCount >= 2) {
		const supersetExercises = createSupersetExercises(
			routineId,
			{
				supersetId: nextTestUuid(),
				color: SUPERSET_COLORS[0],
				exerciseNames: [exerciseTemplates[0].name, exerciseTemplates[1].name],
				muscleGroups: [
					exerciseTemplates[0].muscleGroup,
					exerciseTemplates[1].muscleGroup,
				],
			},
			orderIndex,
		);
		exercises.push(...supersetExercises);
		orderIndex += supersetExercises.length;
	}

	// Add remaining exercises
	const startIndex = includeSuperset ? 2 : 0;
	const remainingCount = exerciseCount - exercises.length;

	for (let i = 0; i < remainingCount; i++) {
		const template =
			exerciseTemplates[(startIndex + i) % exerciseTemplates.length];

		let exercise: RoutineExerciseRow;

		// Add AMRAP for last exercise if requested
		if (includeAmrap && i === remainingCount - 1) {
			exercise = createAmrapExerciseFixture(routineId, {
				name: template.name,
				muscle_group: template.muscleGroup,
				mode: template.mode as WorkoutMode,
				order_index: orderIndex,
			});
		}
		// Add PR-scaled exercise if requested (second-to-last)
		else if (includePrScaling && i === remainingCount - 2) {
			exercise = createPrScaledExerciseFixture(routineId, 85, {
				name: template.name,
				muscle_group: template.muscleGroup,
				mode: template.mode as WorkoutMode,
				order_index: orderIndex,
			});
		}
		// Regular exercise
		else {
			exercise = createRoutineExerciseFixture({
				routine_id: routineId,
				name: template.name,
				muscle_group: template.muscleGroup,
				mode: template.mode as WorkoutMode,
				order_index: orderIndex,
			});
		}

		exercises.push(exercise);
		orderIndex++;
	}

	const routine = createRoutineFixture({
		id: routineId,
		user_id: userId,
		exercise_count: exercises.length,
		estimated_duration: exercises.length * 12, // ~12 min per exercise
		...routineOverrides,
	});

	return { routine, exercises };
}

/**
 * Create routines for each workout mode.
 */
export function createRoutineFixturesForAllModes(
	userId: string = DEFAULT_USER_ID,
): NestedRoutineFixture[] {
	return WORKOUT_MODES.filter((mode) => mode !== "CLASSIC").map((mode) => {
		const routineId = nextTestUuid();
		const exercises = [
			createRoutineExerciseFixture({
				routine_id: routineId,
				mode: mode as WorkoutMode,
				name: `${mode} Exercise`,
			}),
		];

		return {
			routine: createRoutineFixture({
				id: routineId,
				user_id: userId,
				name: `${mode} Routine`,
				exercise_count: 1,
			}),
			exercises,
		};
	});
}

/**
 * Create insert-ready versions of fixtures.
 */
export function toRoutineInsert(row: RoutineRow): RoutineInsert {
	const { id, created_at, updated_at, ...rest } = row;
	return rest;
}

export function toRoutineExerciseInsert(
	row: RoutineExerciseRow,
): RoutineExerciseInsert {
	const { id, created_at, ...rest } = row;
	return rest;
}
