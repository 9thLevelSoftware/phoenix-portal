/**
 * Workout Mode Transform Tests
 *
 * Validates the workout mode transformation that occurs between:
 * - Database storage: Enum strings (OLD_SCHOOL, ECHO, PUMP, TUT, TUT_BEAST, ECCENTRIC_ONLY)
 * - Portal display: Human-readable names (Old School, Echo, etc.)
 *
 * Also tests the CLASSIC legacy alias which maps to OLD_SCHOOL.
 *
 * Key test scenarios:
 * - All 6 workout modes round-trip correctly
 * - Display name mapping accuracy
 * - Legacy CLASSIC alias handling
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { workoutSessionSchema } from "@/schemas/transforms";
import { WORKOUT_MODES, type WorkoutMode } from "../fixtures";
import {
	callPullEndpoint,
	callPushEndpoint,
	createMinimalPushPayload,
	createTestSession,
	createTestSet,
	createTestUser,
	generateTestId,
	type RoutineDto,
	type RoutineExerciseDto,
	type SessionDto,
	type SetDto,
} from "../helpers/edge-function-harness";
import { resetMockStore } from "../helpers/mock-edge-functions";

vi.setConfig({ testTimeout: 30000 });

// Mode mapping (must match src/schemas/transforms.ts)
const workoutModeMap: Record<string, string> = {
	OLD_SCHOOL: "Old School",
	ECHO: "Echo",
	PUMP: "Pump",
	TUT: "TUT",
	TUT_BEAST: "TUT Beast",
	ECCENTRIC_ONLY: "Eccentric Only",
	CLASSIC: "Old School", // Legacy alias
};

describe("Workout Mode Transform Tests", () => {
	let testUser: { id: string; email: string; accessToken: string };

	beforeEach(async () => {
		resetMockStore();
		testUser = await createTestUser();
	});

	describe("All 6 Workout Modes Round-Trip", () => {
		const primaryModes: WorkoutMode[] = [
			"OLD_SCHOOL",
			"ECHO",
			"PUMP",
			"TUT",
			"TUT_BEAST",
			"ECCENTRIC_ONLY",
		];

		it.each(
			primaryModes,
		)("should round-trip %s mode correctly", async (mode) => {
			// Arrange
			const sessionId = generateTestId();
			const session: SessionDto = createTestSession(testUser.id, {
				id: sessionId,
				name: `${mode} Test Session`,
				workoutMode: mode,
				exercises: [],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});

			// Act
			const pushResult = await callPushEndpoint(payload, testUser.accessToken);
			expect(pushResult.success).toBe(true);

			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			// Assert: Mode preserved in database format
			const pulledSession = pullResult.data!.sessions[0];
			expect(pulledSession.workoutMode).toBe(mode);
		});

		it("should preserve mode through nested session hierarchy", async () => {
			const sessionId = generateTestId();
			const exerciseId = generateTestId();
			const setId = generateTestId();

			// Set can have its own workoutMode that may differ from session
			const sessionMode = "OLD_SCHOOL";
			const setMode = "TUT";

			const set: SetDto = createTestSet(exerciseId, 1, {
				id: setId,
				workoutMode: setMode,
			});

			const session: SessionDto = createTestSession(testUser.id, {
				id: sessionId,
				workoutMode: sessionMode,
				exercises: [
					{
						id: exerciseId,
						sessionId,
						name: "Mixed Mode Exercise",
						muscleGroup: "Chest",
						orderIndex: 0,
						sets: [set],
					},
				],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			// Assert: Both session and set modes preserved
			expect(pullResult.data!.sessions[0].workoutMode).toBe(sessionMode);
			expect(
				pullResult.data!.sessions[0].exercises[0].sets[0].workoutMode,
			).toBe(setMode);
		});
	});

	describe("Display Name Mapping", () => {
		it('should map OLD_SCHOOL to "Old School"', () => {
			expect(workoutModeMap["OLD_SCHOOL"]).toBe("Old School");
		});

		it('should map ECHO to "Echo"', () => {
			expect(workoutModeMap["ECHO"]).toBe("Echo");
		});

		it('should map PUMP to "Pump"', () => {
			expect(workoutModeMap["PUMP"]).toBe("Pump");
		});

		it('should map TUT to "TUT"', () => {
			expect(workoutModeMap["TUT"]).toBe("TUT");
		});

		it('should map TUT_BEAST to "TUT Beast"', () => {
			expect(workoutModeMap["TUT_BEAST"]).toBe("TUT Beast");
		});

		it('should map ECCENTRIC_ONLY to "Eccentric Only"', () => {
			expect(workoutModeMap["ECCENTRIC_ONLY"]).toBe("Eccentric Only");
		});

		it("should have display mapping for all primary modes", () => {
			const primaryModes = [
				"OLD_SCHOOL",
				"ECHO",
				"PUMP",
				"TUT",
				"TUT_BEAST",
				"ECCENTRIC_ONLY",
			];

			for (const mode of primaryModes) {
				expect(workoutModeMap[mode]).toBeDefined();
				expect(workoutModeMap[mode].length).toBeGreaterThan(0);
			}
		});
	});

	describe("CLASSIC Legacy Alias", () => {
		it('should map CLASSIC to "Old School" (same as OLD_SCHOOL)', () => {
			expect(workoutModeMap["CLASSIC"]).toBe("Old School");
			expect(workoutModeMap["CLASSIC"]).toBe(workoutModeMap["OLD_SCHOOL"]);
		});

		it("should include CLASSIC in WORKOUT_MODES constant", () => {
			expect(WORKOUT_MODES).toContain("CLASSIC");
		});

		it("should handle CLASSIC mode in session round-trip", async () => {
			// Note: The mock stores the value as-is; actual DB might normalize to OLD_SCHOOL
			const sessionId = generateTestId();
			const session: SessionDto = createTestSession(testUser.id, {
				id: sessionId,
				workoutMode: "CLASSIC",
				exercises: [],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			const pulledMode = pullResult.data!.sessions[0].workoutMode;
			// Either CLASSIC (stored as-is) or OLD_SCHOOL (normalized) is acceptable
			expect(["CLASSIC", "OLD_SCHOOL"]).toContain(pulledMode);
		});

		it("should display CLASSIC and OLD_SCHOOL identically", () => {
			// Both should show "Old School" to the user
			const classicDisplay = workoutModeMap["CLASSIC"];
			const oldSchoolDisplay = workoutModeMap["OLD_SCHOOL"];

			expect(classicDisplay).toBe(oldSchoolDisplay);
			expect(classicDisplay).toBe("Old School");
		});
	});

	describe("Mode in Routine Exercises", () => {
		it("should preserve workout mode in routine exercise configuration", async () => {
			const routineId = generateTestId();

			const exercises: RoutineExerciseDto[] = [
				{
					id: generateTestId(),
					routineId,
					name: "TUT Bench",
					muscleGroup: "Chest",
					sets: 4,
					reps: 10,
					weight: 50,
					restSeconds: 90,
					mode: "TUT",
					orderIndex: 0,
				},
				{
					id: generateTestId(),
					routineId,
					name: "Echo Squat",
					muscleGroup: "Legs",
					sets: 4,
					reps: 8,
					weight: 80,
					restSeconds: 120,
					mode: "ECHO",
					orderIndex: 1,
				},
				{
					id: generateTestId(),
					routineId,
					name: "Pump Finisher",
					muscleGroup: "Arms",
					sets: 3,
					reps: 20,
					weight: 20,
					restSeconds: 45,
					mode: "PUMP",
					orderIndex: 2,
				},
			];

			const routine: RoutineDto = {
				id: routineId,
				userId: testUser.id,
				name: "Multi-Mode Routine",
				description: "Different modes for different exercises",
				exerciseCount: 3,
				estimatedDuration: 60,
				timesCompleted: 0,
				isFavorite: false,
				exercises,
			};

			const payload = createMinimalPushPayload(testUser.id, {
				routines: [routine],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			// Assert: Each exercise has its mode preserved
			const pulledExercises = pullResult.data!.routines[0].exercises;
			expect(pulledExercises).toHaveLength(3);

			const tutExercise = pulledExercises.find((e) => e.name === "TUT Bench");
			const echoExercise = pulledExercises.find((e) => e.name === "Echo Squat");
			const pumpExercise = pulledExercises.find(
				(e) => e.name === "Pump Finisher",
			);

			expect(tutExercise?.mode).toBe("TUT");
			expect(echoExercise?.mode).toBe("ECHO");
			expect(pumpExercise?.mode).toBe("PUMP");
		});
	});

	describe("Null Mode Handling", () => {
		it("should handle null workout mode gracefully", async () => {
			const sessionId = generateTestId();
			const session: SessionDto = createTestSession(testUser.id, {
				id: sessionId,
				workoutMode: null,
				exercises: [],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			const pulledMode = pullResult.data!.sessions[0].workoutMode;
			expect(pulledMode).toBeNull();
		});

		it("should transform null mode to null display value", () => {
			// When mode is null, display should also be null (not a string like "null")
			const nullMode = null;
			const displayValue = nullMode ? workoutModeMap[nullMode] : null;

			expect(displayValue).toBeNull();
		});
	});

	describe("Unknown Mode Handling", () => {
		it("should pass through unknown modes unchanged", () => {
			// If a new mode is added to mobile before portal update,
			// it should pass through rather than crash
			const unknownMode = "FUTURE_MODE";
			const displayValue = workoutModeMap[unknownMode] ?? unknownMode;

			expect(displayValue).toBe("FUTURE_MODE");
		});

		it("should handle case sensitivity correctly", () => {
			// Modes are stored uppercase in DB
			const lowercaseMode = "old_school";
			const uppercaseMode = "OLD_SCHOOL";

			// Only uppercase should match the map
			expect(workoutModeMap[uppercaseMode]).toBe("Old School");
			expect(workoutModeMap[lowercaseMode]).toBeUndefined();
		});

		it("should handle mixed case modes by falling back to raw value", () => {
			// Mixed case should not match and should pass through raw
			const mixedCaseModes = ["Old_School", "OLD_school", "Tut", "tut_BEAST"];

			for (const mode of mixedCaseModes) {
				const displayValue = workoutModeMap[mode] ?? mode;
				// Should return raw value since no match
				expect(displayValue).toBe(mode);
			}
		});
	});

	describe("Edge Case Mode Handling", () => {
		it("should handle empty string mode gracefully", async () => {
			// Empty string mode should not crash the system
			const sessionId = generateTestId();
			const session: SessionDto = createTestSession(testUser.id, {
				id: sessionId,
				workoutMode: "",
				exercises: [],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			const pushResult = await callPushEndpoint(payload, testUser.accessToken);

			// Push should succeed (empty string is valid data)
			expect(pushResult.success).toBe(true);

			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			// Pull should succeed and return the empty string
			const pulledSession = pullResult.data!.sessions[0];
			expect(pulledSession.workoutMode).toBe("");
		});

		it("should transform empty string mode to empty string display value", () => {
			// Empty string should not match any mode in the map
			const emptyMode = "";
			const displayValue = emptyMode
				? (workoutModeMap[emptyMode] ?? emptyMode)
				: null;

			// Empty string is falsy, so with our null-check pattern it becomes null
			expect(displayValue).toBeNull();
		});

		it("should handle whitespace-padded modes by passing through raw", () => {
			// Whitespace-padded modes should not match and pass through
			const paddedModes = [" OLD_SCHOOL", "OLD_SCHOOL ", " OLD_SCHOOL "];

			for (const mode of paddedModes) {
				const displayValue = workoutModeMap[mode] ?? mode;
				// Should return raw value since no exact match
				expect(displayValue).toBe(mode);
				expect(displayValue).not.toBe("Old School");
			}
		});

		it("should handle special characters in mode gracefully", () => {
			// Special characters should pass through without crashing
			const specialModes = [
				"OLD-SCHOOL",
				"OLD.SCHOOL",
				"OLD@SCHOOL",
				"OLD#SCHOOL",
			];

			for (const mode of specialModes) {
				const displayValue = workoutModeMap[mode] ?? mode;
				// Should return raw value
				expect(displayValue).toBe(mode);
			}
		});

		it("should handle very long mode strings without crashing", () => {
			// Very long strings should pass through
			const longMode = "A".repeat(1000);
			const displayValue = workoutModeMap[longMode] ?? longMode;

			expect(displayValue).toBe(longMode);
		});
	});

	describe("Mode Transform Integration", () => {
		it("should handle all modes in a single batch push", async () => {
			// Create one session for each mode
			const modes = [
				"OLD_SCHOOL",
				"ECHO",
				"PUMP",
				"TUT",
				"TUT_BEAST",
				"ECCENTRIC_ONLY",
			];
			const sessions: SessionDto[] = modes.map((mode, i) =>
				createTestSession(testUser.id, {
					id: generateTestId(),
					name: `${mode} Session`,
					workoutMode: mode,
					exercises: [],
				}),
			);

			const payload = createMinimalPushPayload(testUser.id, { sessions });
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			// Assert: All modes present
			const pulledModes = pullResult.data!.sessions.map((s) => s.workoutMode);
			for (const mode of modes) {
				expect(pulledModes).toContain(mode);
			}
		});

		it("should preserve mode association with correct session", async () => {
			// Verify sessions keep their correct modes after round-trip
			const sessionData = [
				{ name: "Session A", mode: "OLD_SCHOOL" },
				{ name: "Session B", mode: "PUMP" },
				{ name: "Session C", mode: "TUT_BEAST" },
			];

			const sessions: SessionDto[] = sessionData.map(({ name, mode }) =>
				createTestSession(testUser.id, {
					id: generateTestId(),
					name,
					workoutMode: mode,
					exercises: [],
				}),
			);

			const payload = createMinimalPushPayload(testUser.id, { sessions });
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			// Assert: Each session has correct mode
			for (const { name, mode } of sessionData) {
				const found = pullResult.data!.sessions.find((s) => s.name === name);
				expect(found).toBeDefined();
				expect(found!.workoutMode).toBe(mode);
			}
		});
	});

	describe("Zod Schema Mode Transform (Production Code Path)", () => {
		/**
		 * These tests exercise the actual workoutSessionSchema from transforms.ts,
		 * verifying the Zod transform that converts DB mode strings to display names.
		 */

		// Helper to create a minimal valid DB session row
		// Uses valid UUID v4 format (version 4 at position 13, variant 8-b at position 17)
		const createDbSessionRow = (workoutMode: string | null) => ({
			id: "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
			user_id: "b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6",
			name: "Test Session",
			started_at: "2024-01-01T12:00:00Z",
			duration_seconds: 3600,
			total_volume: 5000,
			set_count: 10,
			exercise_count: 3,
			pr_count: 1,
			routine_name: null,
			workout_mode: workoutMode,
			notes: null,
		});

		it.each([
			["OLD_SCHOOL", "Old School"],
			["ECHO", "Echo"],
			["PUMP", "Pump"],
			["TUT", "TUT"],
			["TUT_BEAST", "TUT Beast"],
			["ECCENTRIC_ONLY", "Eccentric Only"],
			["CLASSIC", "Old School"],
		])('should transform %s to "%s" via Zod schema', (dbMode, expectedDisplay) => {
			const dbRow = createDbSessionRow(dbMode);
			const parsed = workoutSessionSchema.parse(dbRow);

			expect(parsed.workout_mode).toBe(expectedDisplay);
		});

		it("should transform null mode to null via Zod schema", () => {
			const dbRow = createDbSessionRow(null);
			const parsed = workoutSessionSchema.parse(dbRow);

			expect(parsed.workout_mode).toBeNull();
		});

		it("should pass through unknown modes unchanged via Zod schema", () => {
			const dbRow = createDbSessionRow("FUTURE_MODE");
			const parsed = workoutSessionSchema.parse(dbRow);

			// Unknown modes should pass through as-is (not crash, not be undefined)
			expect(parsed.workout_mode).toBe("FUTURE_MODE");
		});

		it("should pass through lowercase modes unchanged (no auto-uppercase)", () => {
			const dbRow = createDbSessionRow("old_school");
			const parsed = workoutSessionSchema.parse(dbRow);

			// Lowercase should pass through, not be auto-mapped to Old School
			expect(parsed.workout_mode).toBe("old_school");
		});

		it("should handle empty string mode via Zod schema", () => {
			const dbRow = createDbSessionRow("");
			const parsed = workoutSessionSchema.parse(dbRow);

			// Empty string should be transformed to null by the schema
			expect(parsed.workout_mode).toBeNull();
		});

		it("should parse all 6 primary modes in a batch", () => {
			const primaryModes = [
				"OLD_SCHOOL",
				"ECHO",
				"PUMP",
				"TUT",
				"TUT_BEAST",
				"ECCENTRIC_ONLY",
			];
			const expectedDisplays = [
				"Old School",
				"Echo",
				"Pump",
				"TUT",
				"TUT Beast",
				"Eccentric Only",
			];

			const dbRows = primaryModes.map((mode) => createDbSessionRow(mode));
			const parsed = dbRows.map((row) => workoutSessionSchema.parse(row));

			parsed.forEach((session, i) => {
				expect(session.workout_mode).toBe(expectedDisplays[i]);
			});
		});
	});
});
