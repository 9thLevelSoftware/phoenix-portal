/**
 * Conflict Resolution — harness/fixture smoke
 *
 * These cases run against the in-memory mock in
 * `tests/sync/helpers/mock-edge-functions.ts`, which has no user scoping, no
 * profile scoping, no LWW and no per-row delta. They therefore prove that the
 * fixtures and the push/pull harness round-trip a multi-device shaped payload
 * — nothing about the server's conflict semantics.
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
 * Do not add assertions here that restate mock behaviour. See
 * `tests/sync/BASELINE.md` for the list of invariants this suite cannot prove.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
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

describe("Conflict Resolution harness/fixture smoke (mock Edge)", () => {
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
