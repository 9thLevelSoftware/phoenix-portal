/**
 * Fixture Sanity Tests
 *
 * Verifies that all fixture factories can be imported and produce valid data.
 */

import { describe, expect, it } from "vitest";
import {
	ASYMMETRY_BALANCED_THRESHOLD,
	CYCLE_STATUS,
	countPayloadEntities,
	createAggregateGamificationFixture,
	// Cycle fixtures
	createCycleFixture,
	// Edge case fixtures
	createEmptySessionFixture,
	// External fixtures
	createExternalActivityFixture,
	createFitbitActivityFixture,
	// Aggregate fixtures
	createFullSyncPayload,
	createGarminActivityFixture,
	createMaxValueSessionFixture,
	createMinimalSessionFixture,
	createMinimalSyncPayload,
	createNestedCycleFixture,
	createNestedRoutineFixture,
	createNestedSessionFixture,
	// Gamification fixtures
	createPersonalRecordFixture,
	// Routine fixtures
	createRoutineFixture,
	createRpgAttributesFixture,
	// Workout fixtures
	createSessionFixture,
	createStravaActivityFixture,
	createUnicodeSessionFixture,
	MAX_RPG_ATTRIBUTE,
	MAX_WEIGHT_KG,
	PROVIDERS,
	RPG_ATTRIBUTES,
	SUPERSET_COLORS,
	VELOCITY_ZONES,
	WORKOUT_MODES,
	WORKOUT_PHASES,
} from "./index";

describe("Workout Fixtures", () => {
	it("creates a valid session fixture", () => {
		const session = createSessionFixture();
		expect(session.id).toBeDefined();
		expect(session.user_id).toBeDefined();
		expect(session.total_volume).toBeGreaterThan(0);
	});

	it("creates a session for each workout mode", () => {
		const modes = WORKOUT_MODES.filter((m) => m !== "CLASSIC");
		for (const mode of modes) {
			const session = createSessionFixture({ workout_mode: mode });
			expect(session.workout_mode).toBe(mode);
		}
	});

	it("creates a nested session with all components", () => {
		const nested = createNestedSessionFixture({
			exerciseCount: 2,
			setsPerExercise: 2,
			repsPerSet: 3,
		});

		expect(nested.session.exercise_count).toBe(2);
		expect(nested.exercises).toHaveLength(2);
		expect(nested.exercises[0].sets).toHaveLength(2);
		expect(nested.exercises[0].sets[0].repSummaries).toHaveLength(3);
	});

	it("includes telemetry when requested", () => {
		const nested = createNestedSessionFixture({
			exerciseCount: 1,
			setsPerExercise: 1,
			repsPerSet: 1,
			includeTelemetry: true,
		});

		expect(nested.exercises[0].sets[0].telemetry).toBeDefined();
		expect(nested.exercises[0].sets[0].telemetry?.length).toBeGreaterThan(0);
	});
});

describe("Routine Fixtures", () => {
	it("creates a valid routine fixture", () => {
		const routine = createRoutineFixture();
		expect(routine.id).toBeDefined();
		expect(routine.name).toBeDefined();
		expect(routine.exercise_count).toBeGreaterThan(0);
	});

	it("creates routine exercises with superset support", () => {
		const nested = createNestedRoutineFixture({
			exerciseCount: 3,
			includeSuperset: true,
		});

		// First two exercises should be in a superset
		const supersetExercises = nested.exercises.filter((e) => e.superset_id);
		expect(supersetExercises.length).toBeGreaterThanOrEqual(2);
	});

	it("creates AMRAP exercises", () => {
		const nested = createNestedRoutineFixture({
			exerciseCount: 3,
			includeAmrap: true,
		});

		const amrapExercises = nested.exercises.filter((e) => e.is_amrap);
		expect(amrapExercises.length).toBeGreaterThanOrEqual(1);
	});
});

describe("Cycle Fixtures", () => {
	it("creates a valid cycle fixture", () => {
		const cycle = createCycleFixture();
		expect(cycle.id).toBeDefined();
		expect(cycle.duration_weeks).toBeGreaterThan(0);
		expect(CYCLE_STATUS).toContain(cycle.status);
	});

	it("creates cycle days for each day type", () => {
		const nested = createNestedCycleFixture({
			durationWeeks: 1,
			workoutDaysPerWeek: 4,
		});

		expect(nested.days.length).toBe(7);

		const workoutDays = nested.days.filter((d) => d.day_type === "workout");
		const restDays = nested.days.filter((d) => d.day_type === "rest");

		expect(workoutDays.length).toBe(4);
		expect(restDays.length).toBe(3);
	});
});

describe("Gamification Fixtures", () => {
	it("creates personal records for all phases", () => {
		for (const phase of WORKOUT_PHASES) {
			const record = createPersonalRecordFixture({ workout_phase: phase });
			expect(record.workout_phase).toBe(phase);
		}
	});

	it("creates RPG attributes within valid range", () => {
		const attrs = createRpgAttributesFixture();

		for (const attr of RPG_ATTRIBUTES) {
			expect(attrs[attr]).toBeGreaterThanOrEqual(0);
			expect(attrs[attr]).toBeLessThanOrEqual(MAX_RPG_ATTRIBUTE);
		}
	});

	it("creates aggregate gamification fixture with all components", () => {
		const agg = createAggregateGamificationFixture({
			badgeCount: 3,
			prCount: 5,
		});

		expect(agg.stats).toBeDefined();
		expect(agg.rpgAttributes).toBeDefined();
		expect(agg.badges).toHaveLength(3);
		expect(agg.personalRecords).toHaveLength(5);
	});
});

describe("External Activity Fixtures", () => {
	it("creates activities for each provider", () => {
		for (const provider of PROVIDERS) {
			const activity = createExternalActivityFixture({ provider });
			expect(activity.provider).toBe(provider);
		}
	});

	it("creates provider-specific activities with raw data", () => {
		const strava = createStravaActivityFixture("Run");
		expect(strava.raw_data).toBeDefined();

		const fitbit = createFitbitActivityFixture("Run");
		expect(fitbit.raw_data).toBeDefined();

		const garmin = createGarminActivityFixture("running");
		expect(garmin.raw_data).toBeDefined();
	});
});

describe("Edge Case Fixtures", () => {
	it("creates empty session fixture", () => {
		const empty = createEmptySessionFixture();
		expect(empty.session.exercise_count).toBe(0);
		expect(empty.exercises).toHaveLength(0);
	});

	it("creates max value session fixture", () => {
		const max = createMaxValueSessionFixture();
		expect(max.heaviest_lift_kg).toBe(MAX_WEIGHT_KG);
	});

	it("creates unicode session fixture", () => {
		const unicode = createUnicodeSessionFixture("emoji");
		expect(unicode.name).toContain("\u{1F4AA}"); // Flexed bicep emoji
	});

	it("creates minimal session fixture with null optionals", () => {
		const minimal = createMinimalSessionFixture();
		expect(minimal.name).toBeNull();
		expect(minimal.avg_velocity_mps).toBeNull();
		expect(minimal.form_score).toBeNull();
	});
});

describe("Aggregate Sync Payloads", () => {
	it("creates a full sync payload with all entity types", () => {
		const payload = createFullSyncPayload({
			sessionCount: 2,
			routineCount: 1,
			cycleCount: 1,
			badgeCount: 2,
			prCount: 3,
		});

		expect(payload.sessions).toHaveLength(2);
		expect(payload.routines).toHaveLength(1);
		expect(payload.cycles).toHaveLength(1);
		expect(payload.gamification.badges).toHaveLength(2);
		expect(payload.gamification.personalRecords).toHaveLength(3);
		expect(payload.externalActivities.length).toBeGreaterThan(0);
	});

	it("creates a minimal sync payload", () => {
		const minimal = createMinimalSyncPayload();
		expect(minimal.sessions).toHaveLength(1);
		expect(minimal.userId).toBeDefined();
		expect(minimal.syncedAt).toBeDefined();
	});

	it("counts payload entities correctly", () => {
		const payload = createFullSyncPayload({
			sessionCount: 1,
			routineCount: 1,
			cycleCount: 1,
			badgeCount: 1,
			prCount: 1,
		});

		const counts = countPayloadEntities(payload);

		expect(counts.sessions).toBe(1);
		expect(counts.routines).toBe(1);
		expect(counts.cycles).toBe(1);
		expect(counts.badges).toBe(1);
		expect(counts.personalRecords).toBe(1);
		expect(counts.totalEntities).toBeGreaterThan(10);
	});
});

describe("Constants", () => {
	it("exports velocity zone thresholds", () => {
		expect(VELOCITY_ZONES.EXPLOSIVE).toBe(1.0);
		expect(VELOCITY_ZONES.FAST).toBe(0.75);
		expect(VELOCITY_ZONES.MODERATE).toBe(0.5);
		expect(VELOCITY_ZONES.SLOW).toBe(0.25);
		expect(VELOCITY_ZONES.GRIND).toBe(0);
	});

	it("exports asymmetry threshold", () => {
		expect(ASYMMETRY_BALANCED_THRESHOLD).toBe(2);
	});

	it("exports all six workout modes", () => {
		expect(WORKOUT_MODES).toContain("OLD_SCHOOL");
		expect(WORKOUT_MODES).toContain("ECHO");
		expect(WORKOUT_MODES).toContain("PUMP");
		expect(WORKOUT_MODES).toContain("TUT");
		expect(WORKOUT_MODES).toContain("TUT_BEAST");
		expect(WORKOUT_MODES).toContain("ECCENTRIC_ONLY");
	});

	it("exports superset colors", () => {
		expect(SUPERSET_COLORS).toHaveLength(5);
		expect(SUPERSET_COLORS[0]).toBe("#FF6B35"); // Phoenix Ember
	});
});
