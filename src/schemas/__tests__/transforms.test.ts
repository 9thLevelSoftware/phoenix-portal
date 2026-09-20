import { describe, expect, it } from "vitest";
import {
	analyticsSummarySchema,
	exerciseSchema,
	gamificationStatsSchema,
	personalRecordSchema,
	routineExerciseSchema,
	setSchema,
	trainingCycleSchema,
	workoutSessionSchema,
} from "../transforms";

/**
 * Weight Transform Validation Tests (Plan 04-01)
 *
 * All loads are stored per cable and the schemas pass them through
 * unchanged (KD-8). Totals are derived only by src/lib/units/loadDisplay.ts
 * when the exercise's cable count is known; schemas never double.
 */
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

	it("passes total_volume through without doubling", () => {
		const result = workoutSessionSchema.parse(validSession);
		// total_volume is per cable as stored (KD-8); no transform applied.
		expect(result.total_volume).toBe(100);
	});

	it("passes duration_seconds through unchanged as seconds", () => {
		const result = workoutSessionSchema.parse(validSession);
		// 120 seconds stays as 120 — no transform applied
		expect(result.duration_seconds).toBe(120);
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

	it("passes heaviest_lift_kg through per cable (no doubling)", () => {
		const result = workoutSessionSchema.parse({
			...validSession,
			heaviest_lift_kg: 75,
		});
		expect(result.heaviest_lift_kg).toBe(75);
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
		// No transform: 0 stays 0
		expect(result.total_volume).toBe(0);
	});

	it("handles decimal total_volume with precision", () => {
		const result = workoutSessionSchema.parse({
			...validSession,
			total_volume: 55.5,
		});
		// No transform: passes through as-is
		expect(result.total_volume).toBe(55.5);
	});

	it("handles max per-cable weight (110kg) correctly", () => {
		const result = workoutSessionSchema.parse({
			...validSession,
			heaviest_lift_kg: MAX_PER_CABLE_KG,
		});
		expect(result.heaviest_lift_kg).toBe(MAX_PER_CABLE_KG);
	});
});

describe("exerciseSchema cable_count", () => {
	const base = {
		id: UUID,
		session_id: UUID2,
		name: "Bench Press",
		muscle_group: "Chest",
		order_index: 0,
	};

	it("keeps a known cable count of 1 or 2", () => {
		expect(exerciseSchema.parse({ ...base, cable_count: 1 }).cable_count).toBe(
			1,
		);
		expect(exerciseSchema.parse({ ...base, cable_count: 2 }).cable_count).toBe(
			2,
		);
	});

	it("treats NULL, absent, or out-of-range counts as unknown (never 2)", () => {
		expect(
			exerciseSchema.parse({ ...base, cable_count: null }).cable_count,
		).toBeNull();
		expect(exerciseSchema.parse(base).cable_count).toBeNull();
		expect(
			exerciseSchema.parse({ ...base, cable_count: 3 }).cable_count,
		).toBeNull();
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

	it("passes weight_kg through per cable (no doubling)", () => {
		const result = setSchema.parse(validSet);
		expect(result.weight_kg).toBe(50);
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
		expect(result.weight_kg).toBe(0);
	});

	it("handles minimum weight (1kg per-cable) correctly", () => {
		const result = setSchema.parse({
			...validSet,
			weight_kg: 1,
		});
		expect(result.weight_kg).toBe(1);
	});

	it("handles decimal weight with precision", () => {
		const result = setSchema.parse({
			...validSet,
			weight_kg: 55.5,
		});
		expect(result.weight_kg).toBe(55.5);
	});

	it("handles max per-cable weight correctly", () => {
		const result = setSchema.parse({
			...validSet,
			weight_kg: MAX_PER_CABLE_KG,
		});
		expect(result.weight_kg).toBe(MAX_PER_CABLE_KG);
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

	it("passes value through per cable (no doubling)", () => {
		const result = personalRecordSchema.parse(validPR);
		expect(result.value).toBe(75);
	});

	it("passes previous_value through per cable when not null", () => {
		const result = personalRecordSchema.parse(validPR);
		expect(result.previous_value).toBe(60);
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
		expect(result.value).toBe(0);
	});

	it("handles decimal PR value with precision", () => {
		const result = personalRecordSchema.parse({
			...validPR,
			value: 55.5,
		});
		expect(result.value).toBe(55.5);
	});

	it("handles max per-cable PR value correctly", () => {
		const result = personalRecordSchema.parse({
			...validPR,
			value: MAX_PER_CABLE_KG,
		});
		expect(result.value).toBe(MAX_PER_CABLE_KG);
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

	it("passes weight through per cable, like set/PR schemas", () => {
		const result = routineExerciseSchema.parse(validRoutineExercise);
		expect(result.weight).toBe(50);
	});

	it("passes per_set_weights through per cable", () => {
		const perSetWeights = [50, 55, 60, 55]; // Pyramid scheme stored per-cable
		const result = routineExerciseSchema.parse({
			...validRoutineExercise,
			per_set_weights: perSetWeights,
		});
		expect(result.per_set_weights).toEqual([50, 55, 60, 55]);
	});

	it("handles null per_set_weights", () => {
		const result = routineExerciseSchema.parse({
			...validRoutineExercise,
			per_set_weights: null,
		});
		expect(result.per_set_weights).toBeNull();
	});

	it("defaults omitted drop-set fields and keeps the per-cable floor", () => {
		expect(routineExerciseSchema.parse(validRoutineExercise)).toMatchObject({
			drop_set_enabled: false,
			drop_set_min_weight_kg: null,
		});

		const enabled = routineExerciseSchema.parse({
			...validRoutineExercise,
			drop_set_enabled: true,
			drop_set_min_weight_kg: 12.5,
		});
		expect(enabled.drop_set_enabled).toBe(true);
		expect(enabled.drop_set_min_weight_kg).toBe(12.5);
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

	it("passes total_volume through without doubling", () => {
		const result = analyticsSummarySchema.parse(validSummary);
		// total_volume is per cable as stored (KD-8); no transform applied.
		expect(result.total_volume).toBe(10000);
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

describe("trainingCycleSchema", () => {
	it("preserves template_id so sync-loaded template cycles keep their identity", () => {
		const result = trainingCycleSchema.parse({
			id: UUID,
			user_id: UUID2,
			name: "Template Cycle",
			description: null,
			duration_weeks: 4,
			current_week: 1,
			status: "draft",
			workout_days: 4,
			rest_days: 3,
			started_at: null,
			last_used_at: null,
			local_profile_id: null,
			template_id: "template_531",
		});

		expect(result.template_id).toBe("template_531");
	});
});
