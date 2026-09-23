import { describe, expect, it } from "vitest";
import { pushPayloadSchema } from "../../../supabase/functions/_shared/pushPayloadSchema";
import {
	createMinimalPushPayload,
	createTestExercise,
	createTestRoutine,
	createTestSession,
	createTestSet,
} from "./edge-function-harness";

const userId = "11111111-1111-4111-8111-111111111111";

function expectStrictPushPayload(payload: unknown) {
	const result = pushPayloadSchema.strict().safeParse(payload);
	expect(
		result.success,
		result.success ? undefined : JSON.stringify(result.error.issues, null, 2),
	).toBe(true);
}

describe("live sync fixture contract", () => {
	it("builds a strict-valid empty push payload", () => {
		expectStrictPushPayload(createMinimalPushPayload(userId));
	});

	it("builds strict-valid workout hierarchy and routine payloads", () => {
		const session = createTestSession(userId);
		const exercise = createTestExercise(session.id);
		const set = createTestSet(exercise.id);
		exercise.sets = [set];
		session.exercises = [exercise];

		expectStrictPushPayload(
			createMinimalPushPayload(userId, {
				sessions: [session],
				routines: [createTestRoutine(userId)],
			}),
		);
	});
});
