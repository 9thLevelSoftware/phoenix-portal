/**
 * WorkoutPhase Round-Trip Tests
 *
 * Personal records (and the originating sets that earn them) carry a
 * `WorkoutPhase` enum valued as one of:
 *   - COMBINED    (default — both concentric and eccentric counted)
 *   - CONCENTRIC  (lifting phase only)
 *   - ECCENTRIC   (lowering phase only)
 *
 * These must round-trip unchanged through push → pull because the mobile
 * app computes them and the portal stores + displays them. Audit 05 lists
 * phase enum coverage as a priority gap (#4).
 *
 * Contract:
 *   - mobile-sync-push/index.ts SetDto.prPhase (line 258)
 *   - PersonalRecordDto.workoutPhase (edge-function-harness.ts line 366)
 *   - shared biomechanics docs: PR can be any of COMBINED | CONCENTRIC |
 *     ECCENTRIC per CLAUDE.md "Personal Record Phases"
 *
 * NOTE: The mock push handler stores SetDto as-is (mock-edge-functions.ts
 * lines 123-133) but does NOT derive personal_records from isPr sets.
 * Tests that depend on the server deriving a PersonalRecordDto from a set
 * are marked `test.skip` with a pointer to the live Edge Function. The
 * round-trip of the `prPhase` field on the SetDto itself runs in mock mode.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	callPullEndpoint,
	callPushEndpoint,
	createMinimalPushPayload,
	createTestUser,
	type ExerciseDto,
	generateTestId,
	type SessionDto,
	type SetDto,
	type TestUser,
} from "./helpers/edge-function-harness";
import { resetMockStore } from "./helpers/mock-edge-functions";

vi.setConfig({ testTimeout: 30000 });

type WorkoutPhase = "COMBINED" | "CONCENTRIC" | "ECCENTRIC";
const ALL_PHASES: WorkoutPhase[] = ["COMBINED", "CONCENTRIC", "ECCENTRIC"];

// SetDto.prPhase is not declared in the test harness type — the harness
// uses a simplified subset. We extend with this local type for tests.
type SetDtoWithPhase = SetDto & { prPhase?: WorkoutPhase | null };

function buildPrSessionForPhase(
	userId: string,
	phase: WorkoutPhase,
): SessionDto {
	const sessionId = generateTestId();
	const exerciseId = generateTestId();
	const setId = generateTestId();

	const prSet: SetDtoWithPhase = {
		id: setId,
		exerciseId,
		setNumber: 1,
		targetReps: 5,
		actualReps: 5,
		weightKg: 100,
		rpe: 9,
		isPr: true,
		notes: null,
		workoutMode: "OLD_SCHOOL",
		repSummaries: [],
		prPhase: phase,
	};

	const exercise: ExerciseDto = {
		id: exerciseId,
		sessionId,
		name: "Bench Press",
		muscleGroup: "Chest",
		orderIndex: 0,
		// SetDto is widened in the harness; cast to SetDto to keep parity
		sets: [prSet as unknown as SetDto],
	};

	return {
		id: sessionId,
		userId,
		name: `PR Session (${phase})`,
		startedAt: new Date().toISOString(),
		durationSeconds: 1800,
		totalVolume: 500,
		setCount: 1,
		exerciseCount: 1,
		prCount: 1,
		routineName: null,
		workoutMode: "OLD_SCHOOL",
		routineSessionId: null,
		exercises: [exercise],
	};
}

describe("WorkoutPhase round-trip", () => {
	let testUser: TestUser;

	beforeEach(async () => {
		resetMockStore();
		testUser = await createTestUser();
	});

	for (const phase of ALL_PHASES) {
		it(`round-trips prPhase=${phase} unchanged through push → pull`, async () => {
			const session = buildPrSessionForPhase(testUser.id, phase);

			const pushResult = await callPushEndpoint(
				createMinimalPushPayload(testUser.id, { sessions: [session] }),
				testUser.accessToken,
			);
			expect(pushResult.success).toBe(true);

			const pullResult = await callPullEndpoint(0, testUser.accessToken);
			expect(pullResult.success).toBe(true);

			const pulled = pullResult.data?.sessions.find((s) => s.id === session.id);
			expect(pulled).toBeDefined();
			expect(pulled?.exercises[0].sets).toHaveLength(1);

			const pulledSet = pulled?.exercises[0]
				.sets[0] as unknown as SetDtoWithPhase;
			// Mock spreads the incoming SetDto onto the response, preserving the
			// prPhase field even though the harness' public SetDto type omits it.
			expect(pulledSet.prPhase).toBe(phase);
			expect(pulledSet.isPr).toBe(true);
		});
	}

	it.skip("personal_records row is derived with workoutPhase=CONCENTRIC when a CONCENTRIC-phase PR set is pushed — requires live Edge Function", async () => {
		// The real push function derives a PersonalRecordDto from SetDto.isPr
		// and surfaces it via the pull response's `personalRecords` array.
		// The mock returns an empty `personalRecords` array unconditionally
		// (mock-edge-functions.ts line 237).
		//
		// Live-mode trigger: push a session with isPr=true + prPhase=CONCENTRIC,
		// then pull and assert data.personalRecords[0].workoutPhase ===
		// 'CONCENTRIC'.
		const session = buildPrSessionForPhase(testUser.id, "CONCENTRIC");
		await callPushEndpoint(
			createMinimalPushPayload(testUser.id, { sessions: [session] }),
			testUser.accessToken,
		);
		const pulled = await callPullEndpoint(0, testUser.accessToken);
		expect(pulled.data?.personalRecords.length).toBeGreaterThan(0);
		expect(pulled.data?.personalRecords[0].workoutPhase).toBe("CONCENTRIC");
	});

	it("default phase is COMBINED when prPhase is omitted", async () => {
		// CLAUDE.md documents COMBINED as the default. Confirm the harness
		// preserves `undefined`/null prPhase (i.e., does not spuriously
		// normalise it to something else) so the mobile classifier can apply
		// its own default.
		const session = buildPrSessionForPhase(testUser.id, "COMBINED");
		const prSet = session.exercises[0].sets[0] as unknown as SetDtoWithPhase;
		delete prSet.prPhase;

		await callPushEndpoint(
			createMinimalPushPayload(testUser.id, { sessions: [session] }),
			testUser.accessToken,
		);

		const pulled = await callPullEndpoint(0, testUser.accessToken);
		const pulledSession = pulled.data?.sessions.find(
			(s) => s.id === session.id,
		);
		expect(pulledSession).toBeDefined();
		const pulledSet = pulledSession?.exercises[0]
			.sets[0] as unknown as SetDtoWithPhase;
		// Round-trip preserves absence — mobile applies its default on consume.
		expect(pulledSet.prPhase).toBeUndefined();
	});
});
