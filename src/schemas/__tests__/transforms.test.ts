import { describe, expect, it } from "vitest";
import {
	personalRecordSchema,
	setSchema,
	workoutSessionSchema,
} from "../transforms";

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

	it("maps POWER to 'Power'", () => {
		const result = workoutSessionSchema.parse({
			...validSession,
			workout_mode: "POWER",
		});
		expect(result.workout_mode).toBe("Power");
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
});
