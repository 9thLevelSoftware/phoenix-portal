import { beforeEach, describe, expect, it } from "vitest";
import {
	callPullEndpoint,
	callPushEndpoint,
	createMinimalPushPayload,
	createTestUser,
	generateTestId,
	type SessionDto,
	type TestUser,
} from "./helpers/edge-function-harness";
import {
	resetMockStore,
	setMockChildPageSize,
} from "./helpers/mock-edge-functions";

function sessionWithExercises(
	userId: string,
	exerciseCount: number,
): SessionDto {
	const sessionId = generateTestId();
	return {
		id: sessionId,
		userId,
		name: "Overflow fixture",
		startedAt: new Date().toISOString(),
		durationSeconds: 60,
		totalVolume: 0,
		setCount: 0,
		exerciseCount,
		prCount: 0,
		routineName: null,
		workoutMode: null,
		routineSessionId: null,
		exercises: Array.from({ length: exerciseCount }, (_, i) => ({
			id: generateTestId(),
			sessionId,
			name: `Ex ${i}`,
			muscleGroup: "Chest",
			orderIndex: i,
			sets: [],
		})),
	};
}

describe("mock pull child overflow (KD-28)", () => {
	let testUser: TestUser;

	beforeEach(async () => {
		resetMockStore();
		testUser = await createTestUser();
	});

	it("503s when one parent exceeds the cap", async () => {
		setMockChildPageSize(2);
		const payload = createMinimalPushPayload(testUser.id);
		payload.sessions = [sessionWithExercises(testUser.id, 3)];
		const pushed = await callPushEndpoint(payload, testUser.accessToken);
		expect(pushed.success).toBe(true);

		const pulled = await callPullEndpoint(0, testUser.accessToken);
		expect(pulled.success).toBe(false);
		expect(pulled.status).toBe(503);
		expect(pulled.error?.code).toBe("CHILD_OVERFLOW");
	});

	it("200s when a complete graph last page is exactly PAGE", async () => {
		setMockChildPageSize(2);
		const payload = createMinimalPushPayload(testUser.id);
		payload.sessions = [sessionWithExercises(testUser.id, 2)];
		const pushed = await callPushEndpoint(payload, testUser.accessToken);
		expect(pushed.success).toBe(true);

		const pulled = await callPullEndpoint(0, testUser.accessToken);
		expect(pulled.success).toBe(true);
		expect(pulled.status).toBe(200);
		expect(pulled.data?.sessions[0]?.exercises).toHaveLength(2);
	});
});
