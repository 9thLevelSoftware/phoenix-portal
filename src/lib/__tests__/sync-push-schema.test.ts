import { describe, expect, it } from "vitest";
import {
	findPushPayloadDuplicateConflictKeys,
	findPushPayloadIncompleteRoutines,
	formatPushPayloadError,
	localProfileIdSchema,
	platformSchema,
	pushPayloadSchema,
} from "../../../supabase/functions/_shared/pushPayloadSchema.ts";

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const UUID2 = "a1b2c3d4-e5f6-4789-abcd-0123456789ab";

describe("platformSchema", () => {
	it("canonicalizes real mobile inputs", () => {
		expect(platformSchema.parse("Android 34")).toBe("android");
		expect(platformSchema.parse("iOS 18.4")).toBe("ios");
		expect(platformSchema.parse("android")).toBe("android");
	});

	it("returns unknown for missing or blank inputs", () => {
		expect(platformSchema.parse(undefined)).toBe("unknown");
		expect(platformSchema.parse(null)).toBe("unknown");
		expect(platformSchema.parse("")).toBe("unknown");
		expect(platformSchema.parse("   ")).toBe("unknown");
	});

	it("returns unknown for anything that isn't android or ios", () => {
		expect(platformSchema.parse("windows")).toBe("unknown");
		expect(platformSchema.parse(42)).toBe("unknown");
	});
});

describe("localProfileIdSchema", () => {
	it("accepts default sentinel", () => {
		expect(localProfileIdSchema.parse("default")).toBe("default");
	});
	it("accepts UUID", () => {
		expect(localProfileIdSchema.parse(UUID)).toBe(UUID);
	});
	it("rejects anything else", () => {
		expect(() => localProfileIdSchema.parse("Default")).toThrow();
		expect(() => localProfileIdSchema.parse("bogus")).toThrow();
	});
});

describe("pushPayloadSchema", () => {
	it("fills every NOT-NULL-DEFAULT scalar with the DB default when the field is missing", () => {
		const parsed = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "android",
			sessions: [
				{
					id: UUID,
					userId: "u1",
					startedAt: "2026-04-20T12:00:00.000Z",
					exercises: [
						{
							id: UUID2,
							sessionId: UUID,
							name: "Squat",
							sets: [
								{
									id: "11111111-1111-1111-1111-111111111111",
									exerciseId: UUID2,
									setNumber: 1,
								},
							],
						},
					],
				},
			],
		});
		// biome-ignore lint/style/noNonNullAssertion: test accesses known element in parsed array
		const session = parsed.sessions[0]!;
		expect(session.durationSeconds).toBe(0);
		expect(session.totalVolume).toBe(0);
		expect(session.setCount).toBe(0);
		expect(session.exerciseCount).toBe(0);
		expect(session.prCount).toBe(0);
		// biome-ignore lint/style/noNonNullAssertion: test accesses known element in parsed array
		const exercise = session.exercises[0]!;
		expect(exercise.muscleGroup).toBe("General");
		expect(exercise.orderIndex).toBe(0);
		// biome-ignore lint/style/noNonNullAssertion: test accesses known element in parsed array
		const set = exercise.sets[0]!;
		expect(set.actualReps).toBe(0);
		expect(set.weightKg).toBe(0);
		expect(set.isPr).toBe(false);
		expect(set.repSummaries).toEqual([]);
	});

	it("coerces missing top-level arrays to []", () => {
		const parsed = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "android",
		});
		expect(parsed.sessions).toEqual([]);
		expect(parsed.telemetry).toEqual([]);
		expect(parsed.routines).toEqual([]);
		expect(parsed.cycles).toEqual([]);
		expect(parsed.badges).toEqual([]);
		expect(parsed.phaseStatistics).toEqual([]);
		expect(parsed.exerciseSignatures).toEqual([]);
		expect(parsed.assessments).toEqual([]);
		expect(parsed.personalRecords).toEqual([]);
	});

	it("rejects non-array values in array positions", () => {
		// arrayOf() intentionally rejects non-array, non-null values to prevent
		// the client from silently losing sync data (see pushPayloadSchema.ts comment)
		expect(() =>
			pushPayloadSchema.parse({
				deviceId: "d1",
				platform: "android",
				sessions: "not-an-array",
				telemetry: null,
				routines: 42,
			}),
		).toThrow();
	});

	it("coerces null array fields to empty arrays", () => {
		const parsed = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "android",
			sessions: null,
			telemetry: null,
			routines: null,
		});
		expect(parsed.sessions).toEqual([]);
		expect(parsed.telemetry).toEqual([]);
		expect(parsed.routines).toEqual([]);
	});

	it("preserves per-set routine reps through validation", () => {
		const parsed = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "android",
			routines: [
				{
					id: UUID,
					userId: "u1",
					name: "AMRAP Routine",
					exercises: [
						{
							id: UUID2,
							routineId: UUID,
							name: "Deadlift",
							perSetReps: "[null,null,null]",
							isAmrap: true,
						},
					],
				},
			],
		});

		expect(parsed.routines[0]?.exercises[0]?.perSetReps).toBe(
			"[null,null,null]",
		);
	});

	it("defaults missing or null routine stall detection to true and preserves explicit values", () => {
		const parsed = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "android",
			routines: [
				{
					id: UUID,
					userId: "u1",
					name: "Stall Detection Routine",
					exercises: [
						{
							id: UUID2,
							routineId: UUID,
							name: "Missing",
						},
						{
							id: "22222222-2222-4222-8222-222222222222",
							routineId: UUID,
							name: "Null",
							stallDetection: null,
						},
						{
							id: "33333333-3333-4333-8333-333333333333",
							routineId: UUID,
							name: "True",
							stallDetection: true,
						},
						{
							id: "44444444-4444-4444-8444-444444444444",
							routineId: UUID,
							name: "False",
							stallDetection: false,
						},
					],
				},
			],
		});

		expect(
			parsed.routines[0]?.exercises.map((ex) => ex.stallDetection),
		).toEqual([true, true, true, false]);
	});

	it("preserves catalog exercise IDs on session and routine exercises", () => {
		const catalogExerciseId = "4kmhj9yyZcBI54Vi";
		const parsed = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "android",
			sessions: [
				{
					id: UUID,
					userId: "u1",
					exercises: [
						{
							id: UUID2,
							sessionId: UUID,
							exerciseId: catalogExerciseId,
							name: "100s",
						},
					],
				},
			],
			routines: [
				{
					id: "22222222-2222-4222-8222-222222222222",
					userId: "u1",
					name: "Core",
					exercises: [
						{
							id: "33333333-3333-4333-8333-333333333333",
							routineId: "22222222-2222-4222-8222-222222222222",
							exerciseId: catalogExerciseId,
							name: "100s",
						},
					],
				},
			],
		});

		expect(parsed.sessions[0]?.exercises[0]?.exerciseId).toBe(
			catalogExerciseId,
		);
		expect(parsed.routines[0]?.exercises[0]?.exerciseId).toBe(
			catalogExerciseId,
		);
	});

	it("preserves custom exercises through validation", () => {
		const parsed = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "android",
			customExercises: [
				{
					clientId: "custom_1714700000000",
					name: "My Custom Press",
					displayName: "My Custom Press",
					muscleGroup: "Chest",
					equipment: "HANDLES,BENCH",
					defaultCableConfig: "DOUBLE",
				},
			],
		});

		expect(parsed.customExercises).toEqual([
			{
				clientId: "custom_1714700000000",
				name: "My Custom Press",
				displayName: "My Custom Press",
				muscleGroup: "Chest",
				equipment: "HANDLES,BENCH",
				defaultCableConfig: "DOUBLE",
			},
		]);
	});

	it("preserves top-level mobile personalRecords through validation", () => {
		const parsed = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "android",
			profileId: "default",
			personalRecords: [
				{
					id: "11111111-1111-4111-8111-111111111111",
					userId: "u1",
					exerciseName: "Bench Press",
					exerciseId: "catalog-bench-press",
					muscleGroup: "Chest",
					recordType: "MAX_VOLUME",
					value: null,
					volume: 1875,
					weightKg: 125,
					reps: 15,
					workoutPhase: "ECCENTRIC",
					sessionId: "22222222-2222-4222-8222-222222222222",
					achievedAt: "2026-04-21T12:00:00.000Z",
					updatedAt: "2026-04-21T12:30:00.000Z",
					localProfileId: "default",
					workoutMode: "OLD_SCHOOL",
				},
			],
		});

		expect(parsed.personalRecords).toEqual([
			{
				id: "11111111-1111-4111-8111-111111111111",
				userId: "u1",
				exerciseName: "Bench Press",
				exerciseId: "catalog-bench-press",
				muscleGroup: "Chest",
				recordType: "MAX_VOLUME",
				value: null,
				volume: 1875,
				weightKg: 125,
				reps: 15,
				workoutPhase: "ECCENTRIC",
				sessionId: "22222222-2222-4222-8222-222222222222",
				achievedAt: "2026-04-21T12:00:00.000Z",
				updatedAt: "2026-04-21T12:30:00.000Z",
				localProfileId: "default",
				workoutMode: "OLD_SCHOOL",
			},
		]);
	});

	it("rejects whitespace-only custom exercise names", () => {
		const result = pushPayloadSchema.safeParse({
			deviceId: "d1",
			platform: "android",
			customExercises: [
				{
					clientId: "custom_1714700000000",
					name: "   ",
				},
			],
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			const paths = result.error.issues.map((issue) => issue.path.join("."));
			expect(paths).toContain("customExercises.0.name");
		}
	});

	it("accepts profileId default sentinel and rejects garbage", () => {
		const ok = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "android",
			profileId: "default",
		});
		expect(ok.profileId).toBe("default");

		expect(() =>
			pushPayloadSchema.parse({
				deviceId: "d1",
				platform: "android",
				profileId: "bogus",
			}),
		).toThrow();
	});

	it("fails with a precise path on a non-UUID session id", () => {
		const result = pushPayloadSchema.safeParse({
			deviceId: "d1",
			platform: "android",
			sessions: [
				{
					id: "not-a-uuid",
					userId: "u1",
					startedAt: "2026-04-20T12:00:00.000Z",
				},
			],
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const paths = result.error.issues.map((i) => i.path.join("."));
			expect(paths).toContain("sessions.0.id");
		}
	});

	it("fails with a precise path on missing required top-level deviceId", () => {
		const result = pushPayloadSchema.safeParse({
			platform: "android",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.path).toContain("deviceId");
		}
	});

	it("leaves allProfiles distinct: undefined vs null vs array", () => {
		expect(
			pushPayloadSchema.parse({ deviceId: "d1", platform: "android" })
				.allProfiles,
		).toBeUndefined();
		expect(
			pushPayloadSchema.parse({
				deviceId: "d1",
				platform: "android",
				allProfiles: null,
			}).allProfiles,
		).toBeNull();
		const withArr = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "android",
			allProfiles: [{ id: "default", name: "Default", colorIndex: 0 }],
		});
		expect(withArr.allProfiles).toEqual([
			{ id: "default", name: "Default", colorIndex: 0 },
		]);
	});

	it("normalizes platform even when mobile sends the full OS string", () => {
		expect(
			pushPayloadSchema.parse({ deviceId: "d1", platform: "Android 34" })
				.platform,
		).toBe("android");
		expect(
			pushPayloadSchema.parse({ deviceId: "d1", platform: undefined }).platform,
		).toBe("unknown");
	});

	it("reports duplicate session exercise IDs before bulk upsert", () => {
		const parsed = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "ios",
			sessions: [
				{
					id: UUID,
					userId: "u1",
					exercises: [
						{ id: UUID2, sessionId: UUID, name: "Squat" },
						{ id: UUID2, sessionId: UUID, name: "Squat Again" },
					],
				},
			],
		});

		expect(findPushPayloadDuplicateConflictKeys(parsed)).toContainEqual({
			table: "exercises",
			ids: [UUID2],
		});
	});

	it("reports case-insensitive duplicate exercise IDs (iOS uppercase vs Android lowercase)", () => {
		const lowerUuid = "a1b2c3d4-e5f6-4789-abcd-0123456789ab";
		const upperUuid = "A1B2C3D4-E5F6-4789-ABCD-0123456789AB";
		const parsed = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "ios",
			sessions: [
				{
					id: UUID,
					userId: "u1",
					exercises: [
						{ id: lowerUuid, sessionId: UUID, name: "Squat" },
						{ id: upperUuid, sessionId: UUID, name: "Squat Again" },
					],
				},
			],
		});

		const dups = findPushPayloadDuplicateConflictKeys(parsed);
		const exerciseDups = dups.find((d) => d.table === "exercises");
		expect(exerciseDups).toBeDefined();
		expect(exerciseDups?.ids).toContain(upperUuid);
	});

	it("reports duplicate routine exercise IDs before orphan cleanup", () => {
		const routineId = "22222222-2222-4222-8222-222222222222";
		const routineExerciseId = "33333333-3333-4333-8333-333333333333";
		const parsed = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "ios",
			routines: [
				{
					id: routineId,
					userId: "u1",
					name: "Duplicate Routine",
					exerciseCount: 2,
					exercises: [
						{
							id: routineExerciseId,
							routineId,
							name: "Press",
						},
						{
							id: routineExerciseId,
							routineId,
							name: "Press Again",
						},
					],
				},
			],
		});

		expect(findPushPayloadDuplicateConflictKeys(parsed)).toContainEqual({
			table: "routine_exercises",
			ids: [routineExerciseId],
		});
	});

	it("reports duplicate cycle day compound conflict keys", () => {
		const cycleId = "44444444-4444-4444-8444-444444444444";
		const parsed = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "ios",
			cycles: [
				{
					id: cycleId,
					userId: "u1",
					name: "Cycle",
					days: [
						{
							id: "55555555-5555-4555-8555-555555555555",
							cycleId,
							dayNumber: 1,
						},
						{
							id: "66666666-6666-4666-8666-666666666666",
							cycleId,
							dayNumber: 1,
						},
					],
				},
			],
		});

		expect(findPushPayloadDuplicateConflictKeys(parsed)).toContainEqual({
			table: "cycle_days",
			ids: [`${cycleId}:1`],
		});
	});

	it("reports duplicate assessment exercise/time conflict keys", () => {
		const exerciseId = "88888888-8888-4888-8888-888888888888";
		const createdAt = "2026-05-24T03:00:00.000Z";
		const parsed = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "ios",
			assessments: [
				{
					id: "99999999-9999-4999-8999-999999999999",
					exerciseId,
					estimatedOneRepMaxKg: 120,
					loadVelocityData: "{}",
					assessmentSessionId: null,
					userOverrideKg: null,
					createdAt,
				},
				{
					id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					exerciseId,
					estimatedOneRepMaxKg: 125,
					loadVelocityData: "{}",
					assessmentSessionId: null,
					userOverrideKg: null,
					createdAt,
				},
			],
		});

		expect(findPushPayloadDuplicateConflictKeys(parsed)).toContainEqual({
			table: "vbt_assessments",
			ids: [`${exerciseId}:${createdAt}`],
		});
	});

	it("reports duplicate local profile IDs before profile upsert", () => {
		const parsed = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "ios",
			allProfiles: [
				{ id: "default", name: "Default", colorIndex: 0 },
				{ id: "default", name: "Default Again", colorIndex: 1 },
			],
		});

		expect(findPushPayloadDuplicateConflictKeys(parsed)).toContainEqual({
			table: "local_profiles",
			ids: ["default"],
		});
	});

	it("parses estimatedOneRepMaxKg on an exercise", () => {
		const parsed = pushPayloadSchema.parse({
			deviceId: "dev-1",
			platform: "android",
			sessions: [
				{
					id: "11111111-1111-1111-1111-111111111111",
					userId: "u1",
					startedAt: "2026-04-20T12:00:00.000Z",
					exercises: [
						{
							id: "22222222-2222-2222-2222-222222222222",
							sessionId: "11111111-1111-1111-1111-111111111111",
							name: "Squat",
							estimatedOneRepMaxKg: 133.33,
							sets: [],
						},
					],
				},
			],
		});
		expect(parsed.sessions[0].exercises[0].estimatedOneRepMaxKg).toBeCloseTo(
			133.33,
		);
	});

	it("parses velocityEstimatedOneRepMaxKg distinctly from the rep-based estimate", () => {
		const parsed = pushPayloadSchema.parse({
			deviceId: "dev-1",
			platform: "android",
			sessions: [
				{
					id: "11111111-1111-1111-1111-111111111111",
					userId: "u1",
					startedAt: "2026-04-20T12:00:00.000Z",
					exercises: [
						{
							id: "22222222-2222-2222-2222-222222222222",
							sessionId: "11111111-1111-1111-1111-111111111111",
							name: "Squat",
							estimatedOneRepMaxKg: 133.33,
							velocityEstimatedOneRepMaxKg: 142.5,
							sets: [],
						},
					],
				},
			],
		});
		const exercise = parsed.sessions[0].exercises[0];
		expect(exercise.velocityEstimatedOneRepMaxKg).toBeCloseTo(142.5);
		// Rep-based estimate is preserved independently.
		expect(exercise.estimatedOneRepMaxKg).toBeCloseTo(133.33);
	});

	it("leaves velocityEstimatedOneRepMaxKg undefined when the field is absent (builder coalesces to null)", () => {
		const parsed = pushPayloadSchema.parse({
			deviceId: "dev-1",
			platform: "android",
			sessions: [
				{
					id: "11111111-1111-1111-1111-111111111111",
					userId: "u1",
					startedAt: "2026-04-20T12:00:00.000Z",
					exercises: [
						{
							id: "22222222-2222-2222-2222-222222222222",
							sessionId: "11111111-1111-1111-1111-111111111111",
							name: "Squat",
							sets: [],
						},
					],
				},
			],
		});
		expect(
			parsed.sessions[0].exercises[0].velocityEstimatedOneRepMaxKg,
		).toBeUndefined();
	});

	it("reports routines that claim exercises but omit the routine exercise projection", () => {
		const routineId = "77777777-7777-4777-8777-777777777777";
		const parsed = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "ios",
			routines: [
				{
					id: routineId,
					userId: "u1",
					name: "Incomplete Routine",
					exerciseCount: 3,
					exercises: [],
				},
			],
		});

		expect(findPushPayloadIncompleteRoutines(parsed)).toEqual([routineId]);
	});

	it("preserves cycle templateId strings through validation", () => {
		const parsed = pushPayloadSchema.parse({
			deviceId: "d1",
			platform: "android",
			cycles: [
				{
					id: "12345678-1234-4234-8234-1234567890ab",
					userId: "u1",
					name: "Template Cycle",
					templateId: "template_531",
					days: [],
				},
				{
					id: "22345678-1234-4234-8234-1234567890ab",
					userId: "u1",
					name: "Local Cycle",
					templateId: null,
					days: [],
				},
			],
		});

		expect(parsed.cycles[0]?.templateId).toBe("template_531");
		expect(parsed.cycles[1]?.templateId).toBeNull();
	});
});

describe("formatPushPayloadError", () => {
	it("produces {error, issues[{path, message}]} with readable paths", () => {
		const result = pushPayloadSchema.safeParse({
			deviceId: "d1",
			platform: "android",
			sessions: [
				{
					id: "bad",
					userId: "u1",
					startedAt: "2026-04-20T12:00:00.000Z",
				},
			],
		});
		if (result.success) throw new Error("expected failure");
		const formatted = formatPushPayloadError(result.error);
		expect(formatted.error).toBe("Invalid push payload");
		expect(formatted.issues.length).toBeGreaterThan(0);
		expect(formatted.issues[0]?.path).toBe("sessions.0.id");
		expect(typeof formatted.issues[0]?.message).toBe("string");
	});

	it("caps issues at 25 to keep response bodies small", () => {
		const manyBadSessions = Array.from({ length: 50 }, () => ({
			id: "not-a-uuid",
			userId: "u",
			startedAt: "2026-04-20T12:00:00.000Z",
		}));
		const result = pushPayloadSchema.safeParse({
			deviceId: "d1",
			platform: "android",
			sessions: manyBadSessions,
		});
		if (result.success) throw new Error("expected failure");
		const formatted = formatPushPayloadError(result.error);
		expect(formatted.issues.length).toBeLessThanOrEqual(25);
	});
});
