import { describe, expect, it } from "vitest";
import {
	analyticsSummarySchema,
	gamificationStatsSchema,
	personalRecordSchema,
	routineExerciseSchema,
	setSchema,
	workoutSessionSchema,
} from "../transforms";

/**
 * Weight Transform Validation Tests (Plan 04-01)
 *
 * The Vitruvian Trainer has dual cables. All weight values are stored
 * in the database as per-cable values (0-220kg range). The portal
 * applies a x2 multiplier for display to show total weight lifted.
 *
 * WEIGHT_MULTIPLIER = 2 (defined in transforms.ts line 6)
 */
const WEIGHT_MULTIPLIER = 2;
const MAX_PER_CABLE_KG = 110; // Practical machine limit per cable

// Valid UUID for test data
const UUID = "00000000-0000-4000-a000-000000000001";
const UUID2 = "00000000-0000-4000-a000-000000000002";

describe("workoutSessionSchema", () => {
	const validSession = {
		id: UUID,
		user_id: UUID2,
		name: "Morning Workout",
		started_at: "2026-01-15T08:00:00Z",
		duration_seconds: 120,
		total_volume: 100,
		set_count: 9,
		exercise_count: 3,
		pr_count: 1,
		routine_name: "Push Day",
		workout_mode: "OLD_SCHOOL",
		notes: null,
	};

	it("parses a full valid workout session", () => {
		const result = workoutSessionSchema.parse(validSession);
		expect(result.id).toBe(UUID);
		expect(result.name).toBe("Morning Workout");
	});

	it("doubles total_volume (per-cable to total)", () => {
		const result = workoutSessionSchema.parse(validSession);
		// Input 100 -> output 200 (WEIGHT_MULTIPLIER = 2)
		expect(result.total_volume).toBe(200);
	});

	it("converts duration_seconds to minutes", () => {
		const result = workoutSessionSchema.parse(validSession);
		// 120 seconds -> 2 minutes
		expect(result.duration_seconds).toBe(2);
	});

	it("converts started_at string to Date object", () => {
		const result = workoutSessionSchema.parse(validSession);
		expect(result.started_at).toBeInstanceOf(Date);
		expect(result.started_at.toISOString()).toBe("2026-01-15T08:00:00.000Z");
	});

	it("maps OLD_SCHOOL workout mode to 'Old School'", () => {
		const result = workoutSessionSchema.parse(validSession);
		expect(result.workout_mode).toBe("Old School");
	});

	it("maps CLASSIC to 'Old School' (Android alias)", () => {
		const result = workoutSessionSchema.parse({
			...validSession,
			workout_mode: "CLASSIC",
		});
		expect(result.workout_mode).toBe("Old School");
	});

	it("maps ECHO to 'Echo'", () => {
		const result = workoutSessionSchema.parse({
			...validSession,
			workout_mode: "ECHO",
		});
		expect(result.workout_mode).toBe("Echo");
	});

	it("maps PUMP to 'Pump'", () => {
		const result = workoutSessionSchema.parse({
			...validSession,
			workout_mode: "PUMP",
		});
		expect(result.workout_mode).toBe("Pump");
	});

	it("passes through unknown workout mode as-is", () => {
		const result = workoutSessionSchema.parse({
			...validSession,
			workout_mode: "CUSTOM_MODE",
		});
		expect(result.workout_mode).toBe("CUSTOM_MODE");
	});

	it("maps null workout_mode to null", () => {
		const result = workoutSessionSchema.parse({
			...validSession,
			workout_mode: null,
		});
		expect(result.workout_mode).toBeNull();
	});

	it("falls back when synced session name is null", () => {
		const result = workoutSessionSchema.parse({
			...validSession,
			name: null,
		});
		expect(result.name).toBe("Untitled Workout");
	});

	// === Plan 04-01: Weight Transform Edge Cases ===

	it("doubles heaviest_lift_kg (per-cable to total)", () => {
		const result = workoutSessionSchema.parse({
			...validSession,
			heaviest_lift_kg: 75,
		});
		// Input 75 -> output 150
		expect(result.heaviest_lift_kg).toBe(150);
	});

	it("handles null heaviest_lift_kg gracefully", () => {
		const result = workoutSessionSchema.parse({
			...validSession,
			heaviest_lift_kg: null,
		});
		expect(result.heaviest_lift_kg).toBeNull();
	});

	it("handles zero total_volume correctly", () => {
		const result = workoutSessionSchema.parse({
			...validSession,
			total_volume: 0,
		});
		// 0 * 2 = 0
		expect(result.total_volume).toBe(0);
	});

	it("handles decimal total_volume with precision", () => {
		const result = workoutSessionSchema.parse({
			...validSession,
			total_volume: 55.5,
		});
		// 55.5 * 2 = 111
		expect(result.total_volume).toBe(111);
	});

	it("handles max per-cable weight (110kg) correctly", () => {
		const result = workoutSessionSchema.parse({
			...validSession,
			heaviest_lift_kg: MAX_PER_CABLE_KG,
		});
		// 110 * 2 = 220
		expect(result.heaviest_lift_kg).toBe(MAX_PER_CABLE_KG * WEIGHT_MULTIPLIER);
	});
});

describe("setSchema", () => {
	const validSet = {
		id: UUID,
		exercise_id: UUID2,
		set_number: 1,
		target_reps: 10,
		actual_reps: 8,
		weight_kg: 50,
		rpe: 8.5,
		is_pr: false,
		notes: null,
	};

	it("doubles weight_kg (per-cable to total)", () => {
		const result = setSchema.parse(validSet);
		// Input 50 -> output 100
		expect(result.weight_kg).toBe(100);
	});

	it("preserves other fields unchanged", () => {
		const result = setSchema.parse(validSet);
		expect(result.set_number).toBe(1);
		expect(result.actual_reps).toBe(8);
		expect(result.rpe).toBe(8.5);
		expect(result.is_pr).toBe(false);
	});

	it("accepts null target_reps from mobile-synced sets", () => {
		const result = setSchema.parse({
			...validSet,
			target_reps: null,
		});
		expect(result.target_reps).toBeNull();
	});

	// === Plan 04-01: Weight Transform Edge Cases ===

	it("handles zero weight correctly", () => {
		const result = setSchema.parse({
			...validSet,
			weight_kg: 0,
		});
		// 0 * 2 = 0
		expect(result.weight_kg).toBe(0);
	});

	it("handles minimum weight (1kg per-cable) correctly", () => {
		const result = setSchema.parse({
			...validSet,
			weight_kg: 1,
		});
		// 1 * 2 = 2
		expect(result.weight_kg).toBe(2);
	});

	it("handles decimal weight with precision", () => {
		const result = setSchema.parse({
			...validSet,
			weight_kg: 55.5,
		});
		// 55.5 * 2 = 111
		expect(result.weight_kg).toBe(111);
	});

	it("handles max per-cable weight correctly", () => {
		const result = setSchema.parse({
			...validSet,
			weight_kg: MAX_PER_CABLE_KG,
		});
		// 110 * 2 = 220
		expect(result.weight_kg).toBe(MAX_PER_CABLE_KG * WEIGHT_MULTIPLIER);
	});
});

describe("personalRecordSchema", () => {
	const validPR = {
		id: UUID,
		user_id: UUID2,
		exercise_name: "Bench Press",
		muscle_group: "chest",
		record_type: "weight",
		value: 75,
		unit: "kg",
		achieved_at: "2026-01-15T10:00:00Z",
		previous_value: 60,
	};

	it("doubles value (per-cable to total)", () => {
		const result = personalRecordSchema.parse(validPR);
		// Input 75 -> output 150
		expect(result.value).toBe(150);
	});

	it("doubles previous_value when not null", () => {
		const result = personalRecordSchema.parse(validPR);
		// Input 60 -> output 120
		expect(result.previous_value).toBe(120);
	});

	it("keeps previous_value as null when null", () => {
		const result = personalRecordSchema.parse({
			...validPR,
			previous_value: null,
		});
		expect(result.previous_value).toBeNull();
	});

	it("converts achieved_at to Date", () => {
		const result = personalRecordSchema.parse(validPR);
		expect(result.achieved_at).toBeInstanceOf(Date);
	});

	// === Plan 04-01: Weight Transform Edge Cases ===

	it("handles zero PR value correctly", () => {
		const result = personalRecordSchema.parse({
			...validPR,
			value: 0,
		});
		// 0 * 2 = 0
		expect(result.value).toBe(0);
	});

	it("handles decimal PR value with precision", () => {
		const result = personalRecordSchema.parse({
			...validPR,
			value: 55.5,
		});
		// 55.5 * 2 = 111
		expect(result.value).toBe(111);
	});

	it("handles max per-cable PR value correctly", () => {
		const result = personalRecordSchema.parse({
			...validPR,
			value: MAX_PER_CABLE_KG,
		});
		// 110 * 2 = 220
		expect(result.value).toBe(MAX_PER_CABLE_KG * WEIGHT_MULTIPLIER);
	});

	it("defaults workout_phase to 'Combined' when null", () => {
		const result = personalRecordSchema.parse({
			...validPR,
			workout_phase: null,
		});
		expect(result.workout_phase).toBe("Combined");
	});

	it("maps CONCENTRIC phase correctly", () => {
		const result = personalRecordSchema.parse({
			...validPR,
			workout_phase: "CONCENTRIC",
		});
		expect(result.workout_phase).toBe("Concentric");
	});

	it("maps ECCENTRIC phase correctly", () => {
		const result = personalRecordSchema.parse({
			...validPR,
			workout_phase: "ECCENTRIC",
		});
		expect(result.workout_phase).toBe("Eccentric");
	});
});

// === Plan 04-01: Routine Exercise Weight Tests ===

describe("routineExerciseSchema", () => {
	const validRoutineExercise = {
		id: UUID,
		routine_id: UUID2,
		name: "Bench Press",
		muscle_group: "Chest",
		sets: 4,
		reps: 10,
		weight: 50,
		rest_seconds: 90,
		duration_seconds: null,
		mode: "OLD_SCHOOL",
		order_index: 0,
		created_at: "2026-01-15T08:00:00Z",
	};

	it("does NOT transform weight (routines store per-cable for mobile)", () => {
		const result = routineExerciseSchema.parse(validRoutineExercise);
		// Routine weights are NOT transformed - stored as per-cable for mobile execution
		expect(result.weight).toBe(50);
	});

	it("preserves per_set_weights as-is (no transform)", () => {
		const perSetWeights = [50, 55, 60, 55]; // Pyramid scheme
		const result = routineExerciseSchema.parse({
			...validRoutineExercise,
			per_set_weights: perSetWeights,
		});
		// Per-set weights are NOT transformed
		expect(result.per_set_weights).toEqual(perSetWeights);
	});

	it("handles null per_set_weights", () => {
		const result = routineExerciseSchema.parse({
			...validRoutineExercise,
			per_set_weights: null,
		});
		expect(result.per_set_weights).toBeNull();
	});
});

// === Plan 04-01: Analytics Summary Weight Tests ===

describe("analyticsSummarySchema", () => {
	const validSummary = {
		id: UUID,
		user_id: UUID2,
		period: "weekly",
		total_workouts: 5,
		total_volume: 10000,
		total_duration: 300,
		avg_session_duration: 60,
		streak_days: 7,
		computed_at: "2026-01-15T08:00:00Z",
	};

	it("doubles total_volume (per-cable to total)", () => {
		const result = analyticsSummarySchema.parse(validSummary);
		// Input 10000 -> output 20000
		expect(result.total_volume).toBe(20000);
	});

	it("handles zero total_volume correctly", () => {
		const result = analyticsSummarySchema.parse({
			...validSummary,
			total_volume: 0,
		});
		expect(result.total_volume).toBe(0);
	});
});

// === Plan 04-01: Gamification Stats Weight Tests ===

describe("gamificationStatsSchema weight handling", () => {
	const validStats = {
		id: UUID,
		user_id: UUID2,
		total_workouts: 100,
		total_reps: 10000,
		total_volume_kg: 500000,
		longest_streak: 30,
		current_streak: 7,
		total_time_seconds: 360000,
		updated_at: "2026-01-15T08:00:00Z",
	};

	// NOTE: This documents current behavior - gamification_stats does NOT transform total_volume_kg
	// This may be intentional (aggregate already computed) or may need review
	it("does NOT transform total_volume_kg (current behavior)", () => {
		const result = gamificationStatsSchema.parse(validStats);
		// Current behavior: no transform applied
		expect(result.total_volume_kg).toBe(500000);
	});
});
