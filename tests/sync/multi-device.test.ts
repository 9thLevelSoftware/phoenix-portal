/**
 * Multi-device — harness/fixture smoke (mock Edge)
 *
 * These cases push two device-shaped payloads through the in-memory mock in
 * `tests/sync/helpers/mock-edge-functions.ts` and pull them back. The mock
 * keeps one global store with no user column, no profile column, no LWW and
 * no per-row delta, so the only thing these cases can prove is that the
 * fixtures and the harness carry a multi-device payload intact. Whatever the
 * describe blocks are named, they do not prove a server invariant.
 *
 * Where the server invariants are actually proven:
 * - profile scoping: `supabase/functions/mobile-sync-pull/index.test.ts`
 *   ("parity RPCs get lastSync minus the commit-time overlap when lastSync > 0",
 *   "real lastSync with empty known ids uses every id RPC and no timestamp-only
 *   table read"), plus the Docker-gated
 *   "integration: real mutation canonicals equal isolated first-page pull and
 *   absence never creates"
 * - delta / commit-time overlap: same file, "every lastSync-based table filter
 *   uses lastSync minus the overlap"
 * - personal-record precedence: `supabase/functions/mobile-sync-push/index.test.ts`
 *   ("a newer active personal record cannot resurrect a stored tombstone",
 *   "deletedAt is the LWW timestamp when a tombstone omits updatedAt")
 *
 * Do not add assertions here that restate mock behaviour, and do not add a
 * case whose only assertion is `expect(result.success).toBe(true)`.
 * See `tests/sync/BASELINE.md` for the invariants this suite cannot prove.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type BadgeDto,
	type CycleDto,
	callPullEndpoint,
	callPushEndpoint,
	createMinimalPushPayload,
	createTestUser,
	generateTestId,
	type RoutineDto,
	type SessionDto,
} from "./helpers/edge-function-harness";
import { resetMockStore } from "./helpers/mock-edge-functions";

// Configure longer timeout for integration tests
vi.setConfig({ testTimeout: 30000 });

describe("Multi-device harness/fixture smoke (mock Edge)", () => {
	// Simulated device identifiers
	const DEVICE_A = {
		deviceId: `device-a-${Date.now()}`,
		name: "Phone",
	};
	const DEVICE_B = {
		deviceId: `device-b-${Date.now()}`,
		name: "Tablet",
	};

	let testUser: { id: string; email: string; accessToken: string };

	beforeEach(async () => {
		resetMockStore();
		testUser = await createTestUser();
	});

	// ===========================================================================
	// Scenario 1: Clean Sync (Baseline)
	// ===========================================================================
	describe("Scenario 1: Clean Sync - Device A Push, Device B Pull", () => {
		it("should transfer all session data from Device A to Device B", async () => {
			// Device A creates and pushes a complete session
			const sessionId = generateTestId();
			const exerciseId = generateTestId();
			const setId = generateTestId();

			const session: SessionDto = {
				id: sessionId,
				userId: testUser.id,
				name: "Morning Workout",
				startedAt: new Date().toISOString(),
				durationSeconds: 3600,
				totalVolume: 5000,
				setCount: 3,
				exerciseCount: 1,
				prCount: 0,
				routineName: null,
				workoutMode: "OLD_SCHOOL",
				routineSessionId: null,
				exercises: [
					{
						id: exerciseId,
						sessionId,
						name: "Bench Press",
						muscleGroup: "Chest",
						orderIndex: 0,
						sets: [
							{
								id: setId,
								exerciseId,
								setNumber: 1,
								targetReps: 10,
								actualReps: 10,
								weightKg: 80,
								rpe: 7,
								isPr: false,
								notes: null,
								workoutMode: "OLD_SCHOOL",
								repSummaries: [],
							},
						],
					},
				],
			};

			// Device A pushes
			const deviceAPayload = createMinimalPushPayload(testUser.id, {
				deviceId: DEVICE_A.deviceId,
				sessions: [session],
			});
			const pushResult = await callPushEndpoint(
				deviceAPayload,
				testUser.accessToken,
			);
			expect(pushResult.success).toBe(true);

			// Device B pulls with lastSync=0 (initial sync)
			const pullResult = await callPullEndpoint(0, testUser.accessToken, {
				deviceId: DEVICE_B.deviceId,
			});
			expect(pullResult.success).toBe(true);

			// Verify session transferred
			const pulledSession = pullResult.data?.sessions.find(
				(s) => s.id === sessionId,
			);
			expect(pulledSession).toBeDefined();
			expect(pulledSession?.name).toBe("Morning Workout");
			expect(pulledSession?.exercises).toHaveLength(1);
			expect(pulledSession?.exercises[0].sets).toHaveLength(1);
		});

		it("should transfer all routine data from Device A to Device B", async () => {
			const routineId = generateTestId();
			const routine: RoutineDto = {
				id: routineId,
				userId: testUser.id,
				name: "Push Day",
				description: "Chest, shoulders, triceps",
				exerciseCount: 3,
				estimatedDuration: 60,
				timesCompleted: 5,
				isFavorite: true,
				exercises: [
					{
						id: generateTestId(),
						routineId,
						name: "Bench Press",
						muscleGroup: "Chest",
						sets: 4,
						reps: 8,
						weight: 80,
						restSeconds: 120,
						mode: "OLD_SCHOOL",
						orderIndex: 0,
					},
					{
						id: generateTestId(),
						routineId,
						name: "Overhead Press",
						muscleGroup: "Shoulders",
						sets: 3,
						reps: 10,
						weight: 40,
						restSeconds: 90,
						mode: "OLD_SCHOOL",
						orderIndex: 1,
					},
					{
						id: generateTestId(),
						routineId,
						name: "Tricep Pushdown",
						muscleGroup: "Triceps",
						sets: 3,
						reps: 12,
						weight: 25,
						restSeconds: 60,
						mode: "OLD_SCHOOL",
						orderIndex: 2,
					},
				],
			};

			// Device A pushes
			const deviceAPayload = createMinimalPushPayload(testUser.id, {
				deviceId: DEVICE_A.deviceId,
				routines: [routine],
			});
			await callPushEndpoint(deviceAPayload, testUser.accessToken);

			// Device B pulls
			const pullResult = await callPullEndpoint(0, testUser.accessToken, {
				deviceId: DEVICE_B.deviceId,
			});

			const pulledRoutine = pullResult.data?.routines.find(
				(r) => r.id === routineId,
			);
			expect(pulledRoutine).toBeDefined();
			expect(pulledRoutine?.name).toBe("Push Day");
			expect(pulledRoutine?.exercises).toHaveLength(3);
			expect(pulledRoutine?.exercises[0].name).toBe("Bench Press");
			expect(pulledRoutine?.exercises[2].name).toBe("Tricep Pushdown");
		});

		it("should transfer cycle data with days from Device A to Device B", async () => {
			const cycleId = generateTestId();
			const cycle: CycleDto = {
				id: cycleId,
				userId: testUser.id,
				name: "PPL Cycle",
				description: "Push Pull Legs rotation",
				durationWeeks: 4,
				workoutDays: 6,
				restDays: 1,
				currentWeek: 1,
				status: "active",
				startedAt: new Date().toISOString(),
				lastUsedAt: null,
				progressionSettings: null,
				deloadSettings: null,
				days: [
					{
						id: generateTestId(),
						cycleId,
						dayNumber: 1,
						dayType: "push",
						routineId: generateTestId(),
						weightAdjustment: 0,
						repModifier: 0,
						restOverride: null,
						restType: null,
						notes: null,
					},
					{
						id: generateTestId(),
						cycleId,
						dayNumber: 2,
						dayType: "pull",
						routineId: generateTestId(),
						weightAdjustment: 0,
						repModifier: 0,
						restOverride: null,
						restType: null,
						notes: null,
					},
				],
			};

			// Device A pushes
			const deviceAPayload = createMinimalPushPayload(testUser.id, {
				deviceId: DEVICE_A.deviceId,
				cycles: [cycle],
			});
			await callPushEndpoint(deviceAPayload, testUser.accessToken);

			// Device B pulls
			const pullResult = await callPullEndpoint(0, testUser.accessToken, {
				deviceId: DEVICE_B.deviceId,
			});

			const pulledCycle = pullResult.data?.cycles.find((c) => c.id === cycleId);
			expect(pulledCycle).toBeDefined();
			expect(pulledCycle?.name).toBe("PPL Cycle");
			expect(pulledCycle?.days).toHaveLength(2);
		});
	});

	// ===========================================================================
	// Scenario 2: Overlapping Sessions (Same ID Conflict)
	// ===========================================================================
	describe("Scenario 2: Session ID Conflict - Last Push Wins", () => {
		/**
		 * CRITICAL: This tests ACTUAL behavior (Last Push Wins),
		 * not the plan's claimed behavior (Local Wins).
		 */
		it("should overwrite session when both devices push same ID (last push wins)", async () => {
			const sessionId = generateTestId();

			// Device A creates session
			const deviceASession: SessionDto = {
				id: sessionId,
				userId: testUser.id,
				name: "Device A Morning Workout",
				startedAt: "2026-04-12T08:00:00.000Z",
				durationSeconds: 3600,
				totalVolume: 5000,
				setCount: 10,
				exerciseCount: 3,
				prCount: 1,
				routineName: "Push Day",
				workoutMode: "OLD_SCHOOL",
				routineSessionId: null,
				exercises: [],
			};

			// Device B creates session with SAME ID but different content
			const deviceBSession: SessionDto = {
				id: sessionId, // Same ID!
				userId: testUser.id,
				name: "Device B Evening Workout", // Different name
				startedAt: "2026-04-12T18:00:00.000Z", // Different time
				durationSeconds: 2400, // Different duration
				totalVolume: 3500, // Different volume
				setCount: 8,
				exerciseCount: 2,
				prCount: 0,
				routineName: null,
				workoutMode: "PUMP", // Different mode
				routineSessionId: null,
				exercises: [],
			};

			// Device A pushes first
			const deviceAPayload = createMinimalPushPayload(testUser.id, {
				deviceId: DEVICE_A.deviceId,
				sessions: [deviceASession],
			});
			const pushAResult = await callPushEndpoint(
				deviceAPayload,
				testUser.accessToken,
			);
			expect(pushAResult.success).toBe(true);

			// Device B pushes second with same session ID
			const deviceBPayload = createMinimalPushPayload(testUser.id, {
				deviceId: DEVICE_B.deviceId,
				sessions: [deviceBSession],
			});
			const pushBResult = await callPushEndpoint(
				deviceBPayload,
				testUser.accessToken,
			);
			expect(pushBResult.success).toBe(true);

			// Pull to see final state
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			const finalSession = pullResult.data?.sessions.find(
				(s) => s.id === sessionId,
			);
			expect(finalSession).toBeDefined();

			// ACTUAL BEHAVIOR: Last push wins (Device B's data)
			expect(finalSession?.name).toBe("Device B Evening Workout");
			expect(finalSession?.workoutMode).toBe("PUMP");
			expect(finalSession?.durationSeconds).toBe(2400);

			// Only one session should exist with this ID
			const sessionsWithId = pullResult.data?.sessions.filter(
				(s) => s.id === sessionId,
			);
			expect(sessionsWithId).toHaveLength(1);
		});
	});

	// ===========================================================================
	// Scenario 3: Routine Conflict
	// ===========================================================================
	describe("Scenario 3: Routine Conflict - Last Push Wins", () => {
		it("should overwrite routine when Device B pushes after Device A", async () => {
			const routineId = generateTestId();

			// Initial routine state (both devices start with this)
			const baseExercise = {
				id: generateTestId(),
				routineId,
				name: "Bench Press",
				muscleGroup: "Chest",
				sets: 3,
				reps: 10,
				weight: 50,
				restSeconds: 90,
				mode: "OLD_SCHOOL",
				orderIndex: 0,
			};

			// Device A's modification: changes name, adds exercise
			const deviceARoutine: RoutineDto = {
				id: routineId,
				userId: testUser.id,
				name: "Push Day v2 - Device A",
				description: "Modified by Device A",
				exerciseCount: 2,
				estimatedDuration: 45,
				timesCompleted: 3,
				isFavorite: true,
				exercises: [
					baseExercise,
					{
						id: generateTestId(),
						routineId,
						name: "Incline Press",
						muscleGroup: "Chest",
						sets: 3,
						reps: 12,
						weight: 40,
						restSeconds: 90,
						mode: "OLD_SCHOOL",
						orderIndex: 1,
					},
				],
			};

			// Device B's modification: changes name, removes original exercise
			const deviceBRoutine: RoutineDto = {
				id: routineId,
				userId: testUser.id,
				name: "Push Day Modified - Device B",
				description: "Modified by Device B",
				exerciseCount: 1,
				estimatedDuration: 30,
				timesCompleted: 5,
				isFavorite: false,
				exercises: [
					{
						id: generateTestId(),
						routineId,
						name: "Overhead Press",
						muscleGroup: "Shoulders",
						sets: 4,
						reps: 8,
						weight: 35,
						restSeconds: 120,
						mode: "OLD_SCHOOL",
						orderIndex: 0,
					},
				],
			};

			// Device A pushes first
			await callPushEndpoint(
				createMinimalPushPayload(testUser.id, {
					deviceId: DEVICE_A.deviceId,
					routines: [deviceARoutine],
				}),
				testUser.accessToken,
			);

			// Device B pushes second
			await callPushEndpoint(
				createMinimalPushPayload(testUser.id, {
					deviceId: DEVICE_B.deviceId,
					routines: [deviceBRoutine],
				}),
				testUser.accessToken,
			);

			// Pull to verify final state
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			const finalRoutine = pullResult.data?.routines.find(
				(r) => r.id === routineId,
			);
			expect(finalRoutine).toBeDefined();

			// Device B's version should win (last push)
			expect(finalRoutine?.name).toBe("Push Day Modified - Device B");
			expect(finalRoutine?.description).toBe("Modified by Device B");
			expect(finalRoutine?.isFavorite).toBe(false);

			// Note: Exercise cleanup may depend on implementation details
			// The mock may retain exercises from both, real impl may clean orphans
		});
	});

	// ===========================================================================
	// Scenario 4: Multiple Active Cycles
	// ===========================================================================
	describe("Scenario 4: Multiple Active Training Cycles", () => {
		it("should allow both active cycles to exist (no server-side enforcement)", async () => {
			const cycleIdA = generateTestId();
			const cycleIdB = generateTestId();

			// Device A creates an active cycle
			const deviceACycle: CycleDto = {
				id: cycleIdA,
				userId: testUser.id,
				name: "PPL Cycle",
				description: "Push Pull Legs",
				durationWeeks: 4,
				workoutDays: 6,
				restDays: 1,
				currentWeek: 1,
				status: "active",
				startedAt: new Date().toISOString(),
				lastUsedAt: null,
				progressionSettings: null,
				deloadSettings: null,
				days: [],
			};

			// Device B creates a DIFFERENT active cycle
			const deviceBCycle: CycleDto = {
				id: cycleIdB,
				userId: testUser.id,
				name: "Upper Lower Split",
				description: "Upper Lower rotation",
				durationWeeks: 6,
				workoutDays: 4,
				restDays: 3,
				currentWeek: 1,
				status: "active", // Also active!
				startedAt: new Date().toISOString(),
				lastUsedAt: null,
				progressionSettings: null,
				deloadSettings: null,
				days: [],
			};

			// Both devices push their cycles
			await callPushEndpoint(
				createMinimalPushPayload(testUser.id, {
					deviceId: DEVICE_A.deviceId,
					cycles: [deviceACycle],
				}),
				testUser.accessToken,
			);

			await callPushEndpoint(
				createMinimalPushPayload(testUser.id, {
					deviceId: DEVICE_B.deviceId,
					cycles: [deviceBCycle],
				}),
				testUser.accessToken,
			);

			// Pull to see final state
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			// Both cycles should exist
			const cycleA = pullResult.data?.cycles.find((c) => c.id === cycleIdA);
			const cycleB = pullResult.data?.cycles.find((c) => c.id === cycleIdB);

			expect(cycleA).toBeDefined();
			expect(cycleB).toBeDefined();
			expect(cycleA?.name).toBe("PPL Cycle");
			expect(cycleB?.name).toBe("Upper Lower Split");

			// Note: Server does not enforce single active cycle
			// Client-side logic determines which is "current"
			const activeCycles = pullResult.data?.cycles.filter(
				(c) => c.status === "active",
			);
			expect(activeCycles.length).toBeGreaterThanOrEqual(1);
		});
	});

	// ===========================================================================
	// Scenario 5: Badge Accumulation (Union Merge)
	// ===========================================================================
	describe("Scenario 5: Badge Accumulation - Union Merge Behavior", () => {
		it("should accumulate unique badges from both devices", async () => {
			// Device A earns badges
			const deviceABadges: BadgeDto[] = [
				{
					id: generateTestId(),
					badgeId: "FIRST_WORKOUT",
					badgeName: "First Workout",
					badgeDescription: "Complete your first workout",
					badgeTier: "bronze",
					earnedAt: "2026-01-15T10:00:00.000Z",
				},
				{
					id: generateTestId(),
					badgeId: "WEEK_WARRIOR",
					badgeName: "Week Warrior",
					badgeDescription: "7-day workout streak",
					badgeTier: "silver",
					earnedAt: "2026-01-22T10:00:00.000Z",
				},
			];

			// Device B earns badges (one overlapping)
			const deviceBBadges: BadgeDto[] = [
				{
					id: generateTestId(),
					badgeId: "FIRST_WORKOUT", // Duplicate badge_id
					badgeName: "First Workout",
					badgeDescription: "Complete your first workout",
					badgeTier: "bronze",
					earnedAt: "2026-01-15T10:00:00.000Z",
				},
				{
					id: generateTestId(),
					badgeId: "PR_KING",
					badgeName: "PR King",
					badgeDescription: "Set 10 personal records",
					badgeTier: "silver",
					earnedAt: "2026-02-01T10:00:00.000Z",
				},
			];

			// Device A pushes its badges
			await callPushEndpoint(
				createMinimalPushPayload(testUser.id, {
					deviceId: DEVICE_A.deviceId,
					badges: deviceABadges,
				}),
				testUser.accessToken,
			);

			// Device B pushes its badges
			await callPushEndpoint(
				createMinimalPushPayload(testUser.id, {
					deviceId: DEVICE_B.deviceId,
					badges: deviceBBadges,
				}),
				testUser.accessToken,
			);

			// Pull to verify union behavior
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			// Extract unique badge IDs
			const badgeIds = pullResult.data?.badges.map((b) => b.badgeId);
			const uniqueBadgeIds = [...new Set(badgeIds)];

			// Should have all unique badges: FIRST_WORKOUT, WEEK_WARRIOR, PR_KING
			expect(uniqueBadgeIds).toContain("FIRST_WORKOUT");
			expect(uniqueBadgeIds).toContain("WEEK_WARRIOR");
			expect(uniqueBadgeIds).toContain("PR_KING");

			// FIRST_WORKOUT should not be duplicated (upsert on user_id, badge_id)
			const firstWorkoutBadges = pullResult.data?.badges.filter(
				(b) => b.badgeId === "FIRST_WORKOUT",
			);
			expect(firstWorkoutBadges.length).toBe(1);
		});
	});

	// ===========================================================================
	// Additional Edge Cases
	// ===========================================================================
	describe("Edge Cases", () => {
		it("should handle empty payloads gracefully", async () => {
			const emptyPayload = createMinimalPushPayload(testUser.id, {
				deviceId: DEVICE_A.deviceId,
				sessions: [],
				routines: [],
				cycles: [],
				badges: [],
			});

			const pushResult = await callPushEndpoint(
				emptyPayload,
				testUser.accessToken,
			);
			expect(pushResult.success).toBe(true);

			const pullResult = await callPullEndpoint(0, testUser.accessToken);
			expect(pullResult.success).toBe(true);
		});

		it("should handle rapid sequential pushes from different devices", async () => {
			const promises = [];

			// Device A rapid pushes
			for (let i = 0; i < 3; i++) {
				const session: SessionDto = {
					id: generateTestId(),
					userId: testUser.id,
					name: `Device A Session ${i}`,
					startedAt: new Date().toISOString(),
					durationSeconds: 3600,
					totalVolume: 5000,
					setCount: 10,
					exerciseCount: 3,
					prCount: 0,
					routineName: null,
					workoutMode: "OLD_SCHOOL",
					routineSessionId: null,
					exercises: [],
				};

				promises.push(
					callPushEndpoint(
						createMinimalPushPayload(testUser.id, {
							deviceId: DEVICE_A.deviceId,
							sessions: [session],
						}),
						testUser.accessToken,
					),
				);
			}

			// Device B rapid pushes (in parallel with A)
			for (let i = 0; i < 3; i++) {
				const session: SessionDto = {
					id: generateTestId(),
					userId: testUser.id,
					name: `Device B Session ${i}`,
					startedAt: new Date().toISOString(),
					durationSeconds: 2400,
					totalVolume: 3000,
					setCount: 8,
					exerciseCount: 2,
					prCount: 0,
					routineName: null,
					workoutMode: "PUMP",
					routineSessionId: null,
					exercises: [],
				};

				promises.push(
					callPushEndpoint(
						createMinimalPushPayload(testUser.id, {
							deviceId: DEVICE_B.deviceId,
							sessions: [session],
						}),
						testUser.accessToken,
					),
				);
			}

			const results = await Promise.all(promises);

			// All pushes should succeed
			for (const result of results) {
				expect(result.success).toBe(true);
			}

			// Pull should have all 6 sessions
			const pullResult = await callPullEndpoint(0, testUser.accessToken);
			expect(pullResult.data?.sessions.length).toBeGreaterThanOrEqual(6);
		});
	});
});
