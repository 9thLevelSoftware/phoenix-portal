import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	callPullEndpoint,
	callPushEndpoint,
	cleanupTestUser,
	createMinimalPushPayload,
	createTestExercise,
	createTestSession,
	createTestSet,
	createTestUser,
	type TestUser,
} from "../helpers/edge-function-harness";
import { liveSyncTestsEnabled, validateEnvVars } from "../setup";

const liveDescribe = liveSyncTestsEnabled() ? describe : describe.skip;

liveDescribe("isolated Supabase preview sync smoke", () => {
	let testUser: TestUser;

	beforeAll(async () => {
		expect(validateEnvVars()).toEqual([]);
		testUser = await createTestUser();
	});

	afterAll(async () => {
		if (testUser) {
			await cleanupTestUser(testUser.id);
		}
	});

	it("accepts an ordinary legacy empty push and pull", async () => {
		const push = await callPushEndpoint(
			createMinimalPushPayload(testUser.id),
			testUser.accessToken,
		);
		expect(push.status).toBe(200);
		expect(push.success).toBe(true);

		const pull = await callPullEndpoint(0, testUser.accessToken);
		expect(pull.status).toBe(200);
		expect(pull.success).toBe(true);
	});

	it("round-trips a strict-valid workout hierarchy", async () => {
		const session = createTestSession(testUser.id);
		const exercise = createTestExercise(session.id);
		exercise.sets = [createTestSet(exercise.id)];
		session.exercises = [exercise];

		const push = await callPushEndpoint(
			createMinimalPushPayload(testUser.id, { sessions: [session] }),
			testUser.accessToken,
		);
		expect(push.status).toBe(200);
		expect(push.success).toBe(true);

		const pull = await callPullEndpoint(0, testUser.accessToken);
		expect(pull.status).toBe(200);
		expect(pull.success).toBe(true);
		expect(pull.data?.sessions.some((row) => row.id === session.id)).toBe(true);
	});
});
