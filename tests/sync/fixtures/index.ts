/**
 * Fixture Index for Beta Sync Validation
 *
 * This module re-exports all fixture factories and provides aggregate
 * payload generators for comprehensive sync testing.
 *
 * Usage:
 *   import { createSessionFixture, createFullSyncPayload } from '@/tests/sync/fixtures';
 */

// ============================================================================
// RE-EXPORTS: Cycle Fixtures
// ============================================================================
export {
	// Constants
	CYCLE_STATUS,
	// Types
	type CycleStatus,
	// Cycle day fixtures
	createCycleDayFixture,
	// Cycle fixtures
	createCycleFixture,
	createCycleFixturesForAllStatuses,
	createDeloadDayFixture,
	// Nested fixtures
	createNestedCycleFixture,
	createPPLCycleFixture,
	createRestDayFixture,
	createWorkoutDayFixture,
	DAY_TYPES,
	type DayType,
	type DeloadSettings,
	type NestedCycleFixture,
	type ProgressionSettings,
	REST_TYPES,
	type RestType,
	toCycleDayInsert,
	// Insert helpers
	toCycleInsert,
} from "./cycle-fixtures";
// ============================================================================
// RE-EXPORTS: Edge Case Fixtures
// ============================================================================
export {
	ASYMMETRY_BOUNDARY_VALUES,
	createAsymmetryBoundaryRepFixtures,
	// Aggregate edge cases
	createEdgeCaseCollection,
	createEmptyCycleFixture,
	createEmptyRoutineFixture,
	// Empty fixtures
	createEmptySessionFixture,
	createMaxGamificationStatsFixture,
	createMaxRpgAttributesFixture,
	// Max value fixtures
	createMaxValueSessionFixture,
	createMaxVelocityRepFixture,
	createMaxWeightSetFixture,
	createMinimalCycleDayFixture,
	createMinimalPersonalRecordFixture,
	createMinimalRoutineExerciseFixture,
	// Minimal fixtures
	createMinimalSessionFixture,
	createUnicodeBadgeFixture,
	createUnicodeExerciseFixture,
	createUnicodeRoutineFixture,
	// Unicode fixtures
	createUnicodeSessionFixture,
	createVelocityBoundaryRepFixtures,
	// Boundary fixtures
	createWeightBoundarySetFixtures,
	// Types
	type EdgeCaseFixtureCollection,
	MAX_RPG_ATTRIBUTE,
	MAX_VELOCITY_MPS,
	// Constants
	MAX_WEIGHT_KG,
	UNICODE_TEST_STRINGS,
	VELOCITY_BOUNDARY_VALUES,
	WEIGHT_BOUNDARY_VALUES,
} from "./edge-cases";
// ============================================================================
// RE-EXPORTS: External Activity Fixtures
// ============================================================================
export {
	ACTIVITY_TYPES,
	createCorrelatedWeightActivity,
	// External activity fixtures
	createExternalActivityFixture,
	createExternalActivityFixturesForAllProviders,
	createFitbitActivityFixture,
	createGarminActivityFixture,
	createHeartRateActivityFixture,
	createProviderActivitySeries,
	createStravaActivityFixture,
	type FitbitActivityType,
	type GarminActivityType,
	// Constants
	PROVIDERS,
	// Types
	type Provider,
	type StravaActivityType,
	// Insert helpers
	toExternalActivityInsert,
} from "./external-fixtures";

// ============================================================================
// RE-EXPORTS: Gamification Fixtures
// ============================================================================
export {
	type AggregateGamificationFixture,
	BADGE_DEFINITIONS,
	BADGE_TIERS,
	type BadgeId,
	type BadgeTier,
	CHARACTER_CLASSES,
	type CharacterClass,
	// Aggregate fixtures
	createAggregateGamificationFixture,
	createBadgeCollectionFixture,
	// Badge fixtures
	createBadgeFixture,
	createBadgeFixturesForAllTiers,
	// Gamification stats fixtures
	createGamificationStatsFixture,
	// Personal record fixtures
	createPersonalRecordFixture,
	createPersonalRecordFixturesForAllPhases,
	createPersonalRecordFixturesForAllTypes,
	// RPG attribute fixtures
	createRpgAttributesFixture,
	createRpgAttributesFixturesForAllClasses,
	RECORD_TYPES,
	type RecordType,
	RPG_ATTRIBUTES,
	type RpgAttribute,
	toBadgeInsert,
	toGamificationStatsInsert,
	// Insert helpers
	toPersonalRecordInsert,
	toRpgAttributesInsert,
	// Constants
	WORKOUT_PHASES,
	// Types
	type WorkoutPhase,
} from "./gamification-fixtures";
// ============================================================================
// RE-EXPORTS: Routine Fixtures
// ============================================================================
export {
	createAmrapExerciseFixture,
	// Nested fixtures
	createNestedRoutineFixture,
	createPrScaledExerciseFixture,
	// Routine exercise fixtures
	createRoutineExerciseFixture,
	createRoutineExerciseWithPerSetRest,
	createRoutineExerciseWithPerSetWeights,
	// Routine fixtures
	createRoutineFixture,
	createRoutineFixturesForAllModes,
	// Superset fixtures
	createSupersetExercises,
	type NestedRoutineFixture,
	// Constants
	SUPERSET_COLORS,
	// Types
	type SupersetConfig,
	toRoutineExerciseInsert,
	// Insert helpers
	toRoutineInsert,
} from "./routine-fixtures";
// ============================================================================
// RE-EXPORTS: Workout Fixtures
// ============================================================================
export {
	ASYMMETRY_BALANCED_THRESHOLD,
	// Exercise fixtures
	createExerciseFixture,
	// Nested fixtures
	createNestedSessionFixture,
	// Rep summary fixtures
	createRepSummaryFixture,
	createRepSummaryFixturesForAllZones,
	// Rep telemetry fixtures
	createRepTelemetryFixture,
	createRepTelemetrySeriesFixture,
	// Session fixtures
	createSessionFixture,
	createSessionFixturesForAllModes,
	// Set fixtures
	createSetFixture,
	type NestedSessionFixture,
	toExerciseInsert,
	toRepSummaryInsert,
	toRepTelemetryInsert,
	// Insert helpers
	toSessionInsert,
	toSetInsert,
	VELOCITY_ZONES,
	type VelocityZone,
	// Constants
	WORKOUT_MODES,
	// Types
	type WorkoutMode,
} from "./workout-fixtures";

// ============================================================================
// AGGREGATE SYNC PAYLOAD TYPES
// ============================================================================

import type { Database } from "@/lib/database.types";
import {
	createNestedCycleFixture,
	type NestedCycleFixture,
} from "./cycle-fixtures";
import { createExternalActivityFixturesForAllProviders } from "./external-fixtures";
import {
	type AggregateGamificationFixture,
	createAggregateGamificationFixture,
} from "./gamification-fixtures";
import {
	createNestedRoutineFixture,
	type NestedRoutineFixture,
} from "./routine-fixtures";
import {
	createNestedSessionFixture,
	type NestedSessionFixture,
} from "./workout-fixtures";

type ExternalActivityRow =
	Database["public"]["Tables"]["external_activities"]["Row"];

/**
 * Complete sync payload containing all 12 entity types.
 *
 * This mirrors the structure sent via mobile-sync-push and received via mobile-sync-pull.
 */
export interface FullSyncPayload {
	/** User ID for all entities */
	userId: string;

	/** Workout sessions with nested exercises, sets, rep summaries, and telemetry */
	sessions: NestedSessionFixture[];

	/** Routines with nested exercises */
	routines: NestedRoutineFixture[];

	/** Training cycles with nested days */
	cycles: NestedCycleFixture[];

	/** Gamification data: stats, RPG attributes, badges, and personal records */
	gamification: AggregateGamificationFixture;

	/** External activities from Strava, Fitbit, and Garmin */
	externalActivities: ExternalActivityRow[];

	/** Timestamp for sync */
	syncedAt: string;
}

/**
 * Minimal sync payload for basic connectivity tests.
 */
export interface MinimalSyncPayload {
	userId: string;
	sessions: NestedSessionFixture[];
	syncedAt: string;
}

// Default test user
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_TIMESTAMP = "2026-04-12T10:00:00.000Z";

/**
 * Create a complete sync payload with all 12 entity types populated.
 *
 * This is useful for:
 * - End-to-end sync validation
 * - Integration testing with real Supabase
 * - Load testing with realistic data volumes
 *
 * @param options - Configuration for the payload
 * @returns A complete sync payload
 */
export function createFullSyncPayload(
	options: {
		userId?: string;
		sessionCount?: number;
		routineCount?: number;
		cycleCount?: number;
		badgeCount?: number;
		prCount?: number;
		externalActivityCount?: number;
		includeTelemetry?: boolean;
	} = {},
): FullSyncPayload {
	const {
		userId = DEFAULT_USER_ID,
		sessionCount = 3,
		routineCount = 2,
		cycleCount = 1,
		badgeCount = 5,
		prCount = 10,
		externalActivityCount = 3,
		includeTelemetry = false,
	} = options;

	// Generate sessions with varying configurations
	const sessions: NestedSessionFixture[] = [];
	for (let i = 0; i < sessionCount; i++) {
		sessions.push(
			createNestedSessionFixture({
				userId,
				exerciseCount: 3 + i,
				setsPerExercise: 3,
				repsPerSet: 10 - i, // Varying rep schemes
				includeTelemetry,
				sessionOverrides: {
					name: `Workout Session ${i + 1}`,
				},
			}),
		);
	}

	// Generate routines with varying features
	const routines: NestedRoutineFixture[] = [];
	for (let i = 0; i < routineCount; i++) {
		routines.push(
			createNestedRoutineFixture({
				userId,
				exerciseCount: 4 + i,
				includeSuperset: i === 0,
				includeAmrap: i === 1,
				includePrScaling: i === 1,
				routineOverrides: {
					name: `Routine ${i + 1}`,
				},
			}),
		);
	}

	// Generate cycles
	const cycles: NestedCycleFixture[] = [];
	const routineIds = routines.map((r) => r.routine.id);
	for (let i = 0; i < cycleCount; i++) {
		cycles.push(
			createNestedCycleFixture({
				userId,
				durationWeeks: 4,
				workoutDaysPerWeek: 4,
				includeDeload: true,
				routineIds,
				cycleOverrides: {
					name: `Training Cycle ${i + 1}`,
				},
			}),
		);
	}

	// Generate gamification data
	const gamification = createAggregateGamificationFixture({
		userId,
		badgeCount,
		prCount,
	});

	// Generate external activities
	let externalActivities: ExternalActivityRow[] = [];
	if (externalActivityCount > 0) {
		// Start with one from each provider
		externalActivities = createExternalActivityFixturesForAllProviders(userId);

		// Add more if needed
		while (externalActivities.length < externalActivityCount) {
			const providerIndex = externalActivities.length % 3;
			const providers = ["strava", "fitbit", "garmin"] as const;
			externalActivities.push(
				...createExternalActivityFixturesForAllProviders(userId).filter(
					(_, i) => i === providerIndex,
				),
			);
		}

		externalActivities = externalActivities.slice(0, externalActivityCount);
	}

	return {
		userId,
		sessions,
		routines,
		cycles,
		gamification,
		externalActivities,
		syncedAt: DEFAULT_TIMESTAMP,
	};
}

/**
 * Create a minimal sync payload for basic tests.
 *
 * This is useful for:
 * - Quick connectivity tests
 * - Smoke tests
 * - Unit tests that don't need full data
 *
 * @param userId - User ID for the payload
 * @returns A minimal sync payload with one session
 */
export function createMinimalSyncPayload(
	userId: string = DEFAULT_USER_ID,
): MinimalSyncPayload {
	return {
		userId,
		sessions: [
			createNestedSessionFixture({
				userId,
				exerciseCount: 1,
				setsPerExercise: 1,
				repsPerSet: 5,
				includeTelemetry: false,
			}),
		],
		syncedAt: DEFAULT_TIMESTAMP,
	};
}

/**
 * Create a sync payload specifically for transform testing.
 *
 * Includes values that exercise all transform logic:
 * - Various weight values (for WEIGHT_MULTIPLIER)
 * - All workout modes (for workoutModeMap)
 * - All workout phases (for workoutPhaseMap)
 * - Velocity zone boundaries
 * - Asymmetry threshold values
 */
export function createTransformTestPayload(
	userId: string = DEFAULT_USER_ID,
): FullSyncPayload {
	const payload = createFullSyncPayload({
		userId,
		sessionCount: 6, // One for each workout mode
		routineCount: 1,
		cycleCount: 1,
		badgeCount: 3,
		prCount: 15, // 5 phases x 3 record types
		includeTelemetry: false,
	});

	// Ensure we have sessions for each workout mode
	const modes = [
		"OLD_SCHOOL",
		"ECHO",
		"PUMP",
		"TUT",
		"TUT_BEAST",
		"ECCENTRIC_ONLY",
	];
	payload.sessions = payload.sessions.map((session, i) => ({
		...session,
		session: {
			...session.session,
			workout_mode: modes[i % modes.length],
		},
	}));

	return payload;
}

/**
 * Entity count summary for a sync payload.
 */
export interface PayloadEntityCounts {
	sessions: number;
	exercises: number;
	sets: number;
	repSummaries: number;
	telemetryPoints: number;
	routines: number;
	routineExercises: number;
	cycles: number;
	cycleDays: number;
	personalRecords: number;
	badges: number;
	externalActivities: number;
	totalEntities: number;
}

/**
 * Count all entities in a sync payload.
 *
 * Useful for verifying expected data volumes in tests.
 */
export function countPayloadEntities(
	payload: FullSyncPayload,
): PayloadEntityCounts {
	let exercises = 0;
	let sets = 0;
	let repSummaries = 0;
	let telemetryPoints = 0;
	let routineExercises = 0;
	let cycleDays = 0;

	for (const session of payload.sessions) {
		exercises += session.exercises.length;
		for (const exercise of session.exercises) {
			sets += exercise.sets.length;
			for (const set of exercise.sets) {
				repSummaries += set.repSummaries.length;
				telemetryPoints += set.telemetry?.length ?? 0;
			}
		}
	}

	for (const routine of payload.routines) {
		routineExercises += routine.exercises.length;
	}

	for (const cycle of payload.cycles) {
		cycleDays += cycle.days.length;
	}

	const counts: PayloadEntityCounts = {
		sessions: payload.sessions.length,
		exercises,
		sets,
		repSummaries,
		telemetryPoints,
		routines: payload.routines.length,
		routineExercises,
		cycles: payload.cycles.length,
		cycleDays,
		personalRecords: payload.gamification.personalRecords.length,
		badges: payload.gamification.badges.length,
		externalActivities: payload.externalActivities.length,
		totalEntities: 0,
	};

	// Calculate total
	counts.totalEntities =
		counts.sessions +
		counts.exercises +
		counts.sets +
		counts.repSummaries +
		counts.telemetryPoints +
		counts.routines +
		counts.routineExercises +
		counts.cycles +
		counts.cycleDays +
		counts.personalRecords +
		counts.badges +
		counts.externalActivities +
		1 + // RPG attributes
		1; // Gamification stats

	return counts;
}
