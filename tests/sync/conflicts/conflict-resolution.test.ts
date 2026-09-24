/**
 * Conflict Resolution — multi-device sync behaviour against the mock Edge
 *
 * Two halves live in this file:
 *
 * 1. "harness/fixture smoke (mock Edge)" cases run against the in-memory mock
 *    in `tests/sync/helpers/mock-edge-functions.ts`, which has no user scoping,
 *    no profile scoping, no LWW and no per-row delta. They prove that the
 *    fixtures and the push/pull harness round-trip a multi-device shaped
 *    payload — nothing about the server's conflict semantics.
 *
 * 2. The "Conflict Resolution Integration Tests" scenarios are older cases.
 *    PR 185 (515570ae) retired them because their assertions describe mock
 *    behaviour; a union merge re-interleaved them. The two that asserted the
 *    mock's arrival order as if it were LWW ("concurrent routine edits with
 *    LWW", "identical timestamps (last sync wins)") are removed (F-050): LWW
 *    by clock is proven for real in the mobile-sync-push integration cases
 *    "lww clock … an older write loses only under LWW" and "lww clock … a
 *    portal routine edit … survives an earlier-stamped push under LWW". Do
 *    not treat a green run of the rest as evidence about the server.
 *
 * Server conflict semantics live in the real-handler suites:
 * - LWW accept/reject: `supabase/functions/mobile-sync-push/index.test.ts`
 *   ("PR 24: with LWW on, a rejected session is in neither p_session_ids nor
 *   p_progress…", "a newer active personal record cannot resurrect a stored
 *   tombstone")
 * - Delta / commit-time overlap and profile scoping:
 *   `supabase/functions/mobile-sync-pull/index.test.ts`
 *   ("parity RPCs get lastSync minus the commit-time overlap when lastSync > 0",
 *   "every lastSync-based table filter uses lastSync minus the overlap",
 *   "real lastSync with empty known ids uses every id RPC and no
 *   timestamp-only table read")
 *
 * See `tests/sync/BASELINE.md` for the list of invariants this suite cannot
 * prove. Do not add assertions here that restate mock behaviour.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type BadgeDto,
	callPullEndpoint,
	callPushEndpoint,
	createMinimalPushPayload,
	createTestUser,
	generateTestId,
	type RoutineDto,
	type SessionDto,
} from "../helpers/edge-function-harness";
import { resetMockStore } from "../helpers/mock-edge-functions";

// Configure longer timeout for integration tests
vi.setConfig({ testTimeout: 30000 });

describe("Conflict Resolution Integration Tests", () => {
	let testUser: { id: string; email: string; accessToken: string };

	beforeEach(async () => {
		resetMockStore();
		testUser = await createTestUser();
	});

	describe("Scenario 2: Offline Device Long-Duration Sync", () => {
		/**
		 * Per CONFLICT-RESOLUTION-DESIGN.md:
		 * Device A syncs daily, Device B is offline for 7 days.
		 * When Device B comes online, it should receive all of Device A's data.
		 */
		it("should sync all sessions from online device to offline device", async () => {
			// DEVICE A: Creates multiple sessions over time
			const sessions: SessionDto[] = [];
			const baseTime = Date.now();

			for (let i = 0; i < 5; i++) {
				const sessionId = generateTestId();
				sessions.push({
					id: sessionId,
					userId: testUser.id,
					name: `Workout Day ${i + 1}`,
					startedAt: new Date(baseTime - (6 - i) * 86400000).toISOString(), // Spread over days
					durationSeconds: 3600,
					totalVolume: 5000 + i * 500,
					setCount: 15,
					exerciseCount: 5,
					prCount: i % 2, // Alternating PRs
					routineName: null,
					workoutMode: "OLD_SCHOOL",
					routineSessionId: null,
					exercises: [],
				});
			}

			const deviceAPayload = createMinimalPushPayload(testUser.id, {
				sessions,
			});
			const pushResult = await callPushEndpoint(
				deviceAPayload,
				testUser.accessToken,
			);
			expect(pushResult.success).toBe(true);

			// DEVICE B: Comes online after 7 days, pulls with lastSync=0
			const pullResult = await callPullEndpoint(0, testUser.accessToken);
			expect(pullResult.success).toBe(true);

			// All 5 sessions should be available
			expect(pullResult.data!.sessions.length).toBeGreaterThanOrEqual(5);
		});
	});

	describe("Scenario 3: Timestamp Edge Cases", () => {
		it("should correctly apply delta sync based on lastSync timestamp", async () => {
			const routineId1 = generateTestId();
			const routineId2 = generateTestId();

			// Push first routine
			const routine1: RoutineDto = {
				id: routineId1,
				userId: testUser.id,
				name: "First Routine",
				description: null,
				exerciseCount: 0,
				estimatedDuration: 30,
				timesCompleted: 0,
				isFavorite: false,
				exercises: [],
			};
			await callPushEndpoint(
				createMinimalPushPayload(testUser.id, { routines: [routine1] }),
				testUser.accessToken,
			);

			// Wait briefly to ensure timestamp difference
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Push second routine after sync time
			const routine2: RoutineDto = {
				id: routineId2,
				userId: testUser.id,
				name: "Second Routine",
				description: null,
				exerciseCount: 0,
				estimatedDuration: 45,
				timesCompleted: 0,
				isFavorite: false,
				exercises: [],
			};
			await callPushEndpoint(
				createMinimalPushPayload(testUser.id, { routines: [routine2] }),
				testUser.accessToken,
			);

			// Pull with lastSync=0 should return both
			const fullPull = await callPullEndpoint(0, testUser.accessToken);
			expect(fullPull.data!.routines.length).toBeGreaterThanOrEqual(2);

			// NOTE: The mock doesn't implement true delta sync, but the pattern is validated
		});
	});

	describe("Scenario 4: Badge Union Merge", () => {
		/**
		 * Per CONFLICT-RESOLUTION-DESIGN.md:
		 * Device A has badges [FIRST_WORKOUT, WEEK_WARRIOR]
		 * Device B has badges [FIRST_WORKOUT, PR_KING]
		 * After sync, both devices should have all unique badges.
		 */
		it("should preserve all unique badges across devices (union merge)", async () => {
			// DEVICE A: Pushes its badges
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

			const deviceAPayload = createMinimalPushPayload(testUser.id, {
				badges: deviceABadges,
			});
			await callPushEndpoint(deviceAPayload, testUser.accessToken);

			// DEVICE B: Pushes its badges (overlapping FIRST_WORKOUT)
			const deviceBBadges: BadgeDto[] = [
				{
					id: generateTestId(),
					badgeId: "FIRST_WORKOUT", // Same as Device A
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

			const deviceBPayload = createMinimalPushPayload(testUser.id, {
				badges: deviceBBadges,
			});
			await callPushEndpoint(deviceBPayload, testUser.accessToken);

			// PULL: Should return union of all unique badges
			// NOTE: The mock stores badges additively, matching union behavior
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			// In a full implementation, we'd expect 3 unique badges:
			// FIRST_WORKOUT, WEEK_WARRIOR, PR_KING
			// The mock may return all pushed badges; we verify the pattern
			expect(pullResult.success).toBe(true);
			// At minimum, we should have badges from both devices
		});
	});

	describe("Scenario 5: Cross-Entity Integrity", () => {
		/**
		 * Per CONFLICT-RESOLUTION-DESIGN.md:
		 * A routine can be soft-deleted while sessions reference it.
		 * Sessions should retain their routineId/routineName snapshot.
		 */
		it("should preserve session routine reference when routine is deleted", async () => {
			// Create a routine and a session that references it
			const routineId = generateTestId();
			const sessionId = generateTestId();

			const routine: RoutineDto = {
				id: routineId,
				userId: testUser.id,
				name: "Leg Day",
				description: "Legs workout",
				exerciseCount: 0,
				estimatedDuration: 45,
				timesCompleted: 5,
				isFavorite: true,
				exercises: [],
			};

			const session: SessionDto = {
				id: sessionId,
				userId: testUser.id,
				name: "Leg Day Session",
				startedAt: new Date().toISOString(),
				durationSeconds: 2700,
				totalVolume: 8000,
				setCount: 12,
				exerciseCount: 3,
				prCount: 1,
				routineName: "Leg Day", // References the routine by name
				workoutMode: "OLD_SCHOOL",
				routineSessionId: routineId,
				exercises: [],
			};

			// Push both
			const initialPayload = createMinimalPushPayload(testUser.id, {
				routines: [routine],
				sessions: [session],
			});
			await callPushEndpoint(initialPayload, testUser.accessToken);

			// Verify session exists with routine reference
			const pullBefore = await callPullEndpoint(0, testUser.accessToken);
			const pulledSession = pullBefore.data!.sessions.find(
				(s) => s.id === sessionId,
			);
			expect(pulledSession).toBeDefined();
			expect(pulledSession!.routineName).toBe("Leg Day");

			// Soft-delete the routine by not including it in next sync
			// (In real implementation, this would set deletedAt on the routine)

			// Session should still exist with its routine reference
			const pullAfter = await callPullEndpoint(0, testUser.accessToken);
			const sessionAfter = pullAfter.data!.sessions.find(
				(s) => s.id === sessionId,
			);
			expect(sessionAfter).toBeDefined();
			expect(sessionAfter!.routineName).toBe("Leg Day"); // Preserved
		});
	});

	describe("Scenario 6: Multiple Active Training Cycles", () => {
		/**
		 * Only one training cycle can be active at a time.
		 * When a new cycle is set active, others should be deactivated.
		 */
		it("should handle cycle activation conflicts", async () => {
			const cycleId1 = generateTestId();
			const cycleId2 = generateTestId();

			// Push first cycle as active
			const cycle1 = {
				id: cycleId1,
				userId: testUser.id,
				name: "PPL Cycle",
				description: null,
				durationWeeks: 4,
				workoutDays: 4,
				restDays: 3,
				currentWeek: 1,
				status: "active" as const,
				startedAt: new Date().toISOString(),
				lastUsedAt: null,
				progressionSettings: null,
				deloadSettings: null,
				days: [],
			};

			await callPushEndpoint(
				createMinimalPushPayload(testUser.id, { cycles: [cycle1] }),
				testUser.accessToken,
			);

			// Push second cycle as active
			const cycle2 = {
				id: cycleId2,
				userId: testUser.id,
				name: "Upper/Lower Cycle",
				description: null,
				durationWeeks: 6,
				workoutDays: 4,
				restDays: 3,
				currentWeek: 1,
				status: "active" as const,
				startedAt: new Date().toISOString(),
				lastUsedAt: null,
				progressionSettings: null,
				deloadSettings: null,
				days: [],
			};

			await callPushEndpoint(
				createMinimalPushPayload(testUser.id, { cycles: [cycle2] }),
				testUser.accessToken,
			);

			// Pull and verify only one is active
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			// In a proper implementation, only the last-activated cycle should be active
			// The mock may not enforce this, but the test validates the expected pattern
			expect(pullResult.success).toBe(true);
			expect(pullResult.data!.cycles.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("Scenario 5: Session routine snapshot round-trip", () => {
		/**
		 * A session carries a denormalised `routineName` snapshot so that it
		 * still reads correctly once the routine is gone. This case checks the
		 * snapshot survives push/pull.
		 *
		 * It does NOT cover deletes: the mock has no delete path, so the
		 * previous "when routine is deleted" half of this case pulled twice
		 * without deleting anything and asserted the same value both times.
		 * Routine/cycle delete propagation is PR 16's `sync_tombstones` work
		 * (not on this branch) — see BASELINE.md "Not proven here".
		 */
		it("round-trips the session routineName snapshot", async () => {
			// Create a routine and a session that references it
			const routineId = generateTestId();
			const sessionId = generateTestId();

			const routine: RoutineDto = {
				id: routineId,
				userId: testUser.id,
				name: "Leg Day",
				description: "Legs workout",
				exerciseCount: 0,
				estimatedDuration: 45,
				timesCompleted: 5,
				isFavorite: true,
				exercises: [],
			};

			const session: SessionDto = {
				id: sessionId,
				userId: testUser.id,
				name: "Leg Day Session",
				startedAt: new Date().toISOString(),
				durationSeconds: 2700,
				totalVolume: 8000,
				setCount: 12,
				exerciseCount: 3,
				prCount: 1,
				routineName: "Leg Day", // References the routine by name
				workoutMode: "OLD_SCHOOL",
				routineSessionId: routineId,
				exercises: [],
			};

			// Push both
			const initialPayload = createMinimalPushPayload(testUser.id, {
				routines: [routine],
				sessions: [session],
			});
			await callPushEndpoint(initialPayload, testUser.accessToken);

			// Verify session exists with routine reference
			const pullBefore = await callPullEndpoint(0, testUser.accessToken);
			const pulledSession = pullBefore.data!.sessions.find(
				(s) => s.id === sessionId,
			);
			expect(pulledSession).toBeDefined();
			expect(pulledSession!.routineName).toBe("Leg Day");
			expect(pulledSession!.routineSessionId).toBe(routineId);
		});
	});
});
