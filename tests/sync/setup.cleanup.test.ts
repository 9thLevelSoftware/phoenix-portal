import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
	cleanupTestUser: vi.fn(),
	createTestUser: vi.fn(),
}));

vi.mock("./helpers/edge-function-harness", () => ({
	cleanupTestUser: doubles.cleanupTestUser,
	createTestUser: doubles.createTestUser,
}));

import { cleanupAllTestUsers, createTrackedTestUser } from "./setup";

const userId = "11111111-1111-4111-8111-111111111111";
const email = "sync-test-12345-abcde@test.local";

beforeEach(async () => {
	vi.restoreAllMocks();
	doubles.cleanupTestUser.mockReset().mockResolvedValue(undefined);
	doubles.createTestUser.mockReset().mockResolvedValue({
		id: userId,
		email,
		accessToken: "synthetic-user-access-token",
	});
	await cleanupAllTestUsers();
});

describe("tracked test-user cleanup logging", () => {
	it("never logs a user ID or free-form cleanup error", async () => {
		const sensitiveMessage = "tracked cleanup exposed a sensitive value";
		await createTrackedTestUser();
		doubles.cleanupTestUser.mockRejectedValueOnce(new Error(sensitiveMessage));
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(cleanupAllTestUsers()).resolves.toBeUndefined();

		expect(warning).toHaveBeenCalledWith(
			"[Sync Tests] Tracked test user cleanup failed.",
		);
		const transcript = warning.mock.calls.flat().join(" ");
		expect(transcript).not.toContain(userId);
		expect(transcript).not.toContain(sensitiveMessage);
	});
});
