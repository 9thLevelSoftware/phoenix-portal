import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const doubles = vi.hoisted(() => ({
	adminCreateUser: vi.fn(),
	adminDeleteUser: vi.fn(),
	getAnonClient: vi.fn(),
	getServiceClient: vi.fn(),
	insertSubscription: vi.fn(),
	signInWithPassword: vi.fn(),
	from: vi.fn(),
}));

vi.mock("./supabase-test-client", () => ({
	getAnonClient: doubles.getAnonClient,
	getEdgeFunctionUrl: (name: string) =>
		`https://preview.example/functions/v1/${name}`,
	getServiceClient: doubles.getServiceClient,
	getSupabaseConfig: () => ({
		url: "https://preview.example",
		anonKey: "synthetic-anon-key",
		serviceKey: "synthetic-service-key",
	}),
}));

vi.mock("./mock-edge-functions", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./mock-edge-functions")>();
	return {
		...actual,
		isMockMode: () => false,
	};
});

import {
	callPullEndpoint,
	callPushEndpoint,
	cleanupTestUser,
	createMinimalPushPayload,
	createTestUser,
} from "./edge-function-harness";

const userId = "11111111-1111-4111-8111-111111111111";
const email = "sync-test-12345-abcde@test.local";
const password = "SyntheticPassword123!";
const accessToken = "synthetic-user-access-token";
const originalDebug = process.env.SYNC_LIVE_DEBUG_FAILURES;

function completeUser() {
	return {
		id: userId,
		aud: "authenticated",
		role: "authenticated",
		email,
		email_confirmed_at: "2026-07-16T12:00:00.000Z",
		phone: "",
		confirmed_at: "2026-07-16T12:00:00.000Z",
		last_sign_in_at: "2026-07-16T12:01:00.000Z",
		app_metadata: { provider: "email", providers: ["email"] },
		user_metadata: {},
		identities: [],
		created_at: "2026-07-16T12:00:00.000Z",
		updated_at: "2026-07-16T12:01:00.000Z",
		is_anonymous: false,
	};
}

function completeSession() {
	return {
		access_token: accessToken,
		token_type: "bearer",
		expires_in: 3600,
		expires_at: 1_800_000_000,
		refresh_token: "synthetic-refresh-token",
		user: completeUser(),
	};
}

beforeEach(() => {
	vi.restoreAllMocks();
	delete process.env.SYNC_LIVE_DEBUG_FAILURES;
	doubles.adminCreateUser.mockReset().mockResolvedValue({
		data: { user: completeUser() },
		error: null,
	});
	doubles.adminDeleteUser.mockReset().mockResolvedValue({
		data: { user: null },
		error: null,
	});
	doubles.insertSubscription.mockReset().mockResolvedValue({
		data: null,
		error: null,
	});
	doubles.signInWithPassword.mockReset().mockResolvedValue({
		data: { user: completeUser(), session: completeSession() },
		error: null,
	});
	doubles.getAnonClient.mockReset().mockReturnValue({
		auth: { signInWithPassword: doubles.signInWithPassword },
	});
	doubles.getServiceClient.mockReset().mockReturnValue({
		auth: {
			admin: {
				createUser: doubles.adminCreateUser,
				deleteUser: doubles.adminDeleteUser,
			},
		},
		from: doubles.from,
	});
	doubles.from.mockReset().mockImplementation((table: string) => {
		if (table !== "subscriptions") {
			throw new Error("Unexpected synthetic table");
		}
		return { insert: doubles.insertSubscription };
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

afterAll(() => {
	if (originalDebug === undefined) {
		delete process.env.SYNC_LIVE_DEBUG_FAILURES;
	} else {
		process.env.SYNC_LIVE_DEBUG_FAILURES = originalDebug;
	}
});

describe("live test-user provisioning", () => {
	it("sanitizes client initialization failures", async () => {
		const sensitiveMessage = "configuration contained a sensitive value";
		doubles.getAnonClient.mockImplementationOnce(() => {
			throw new Error(sensitiveMessage);
		});

		let failure: unknown;
		try {
			await createTestUser(email, password);
		} catch (error) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toBe(
			"Failed to provision disposable sync test user.",
		);
		expect((failure as Error).message).not.toContain(sensitiveMessage);
		expect(doubles.adminCreateUser).not.toHaveBeenCalled();
	});

	it("admin-creates a confirmed user, seeds EMBER, and signs in through anon", async () => {
		const startedAt = Date.now();

		await expect(createTestUser(email, password)).resolves.toEqual({
			id: userId,
			email,
			accessToken,
		});
		expect(doubles.adminCreateUser).toHaveBeenCalledWith({
			email,
			password,
			email_confirm: true,
		});
		expect(doubles.insertSubscription).toHaveBeenCalledTimes(1);
		const subscription = doubles.insertSubscription.mock.calls[0]?.[0];
		expect(subscription).toMatchObject({
			user_id: userId,
			tier: "EMBER",
			status: "active",
		});
		expect(Date.parse(subscription.current_period_end)).toBeGreaterThan(
			startedAt,
		);
		expect(doubles.signInWithPassword).toHaveBeenCalledWith({
			email,
			password,
		});
		expect(doubles.adminDeleteUser).not.toHaveBeenCalled();
	});

	it("supports the explicit unsubscribed option", async () => {
		await createTestUser(email, password, { seedSubscription: false });

		expect(doubles.insertSubscription).not.toHaveBeenCalled();
		expect(doubles.signInWithPassword).toHaveBeenCalledWith({
			email,
			password,
		});
	});

	it.each([
		["subscription", doubles.insertSubscription],
		["sign-in", doubles.signInWithPassword],
	])("deletes the created auth user after a %s failure", async (_phase, call) => {
		const sensitiveMessage = "sensitive upstream failure with an identity";
		call.mockResolvedValueOnce({
			data: null,
			error: { message: sensitiveMessage },
		});

		let failure: unknown;
		try {
			await createTestUser(email, password);
		} catch (error) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toBe(
			"Failed to provision disposable sync test user.",
		);
		expect((failure as Error).message).not.toContain(sensitiveMessage);
		expect(doubles.adminDeleteUser).toHaveBeenCalledWith(userId);
	});
});

describe("live test-user cleanup logging", () => {
	it("never logs a user ID or free-form cleanup error", async () => {
		const sensitiveMessage = "upstream cleanup exposed a sensitive value";
		doubles.from.mockImplementationOnce(() => {
			throw new Error(sensitiveMessage);
		});
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(cleanupTestUser(userId)).resolves.toBeUndefined();

		expect(warning).toHaveBeenCalledWith(
			"[Sync Tests] Test user cleanup failed.",
		);
		const transcript = warning.mock.calls.flat().join(" ");
		expect(transcript).not.toContain(userId);
		expect(transcript).not.toContain(sensitiveMessage);
	});
});

describe("opt-in live failure diagnostics", () => {
	it("logs only bounded labels for a non-OK push response when enabled", async () => {
		process.env.SYNC_LIVE_DEBUG_FAILURES = "true";
		const sensitiveMessage = `subscription denied for ${email} and ${userId}`;
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					Response.json(
						{ error: sensitiveMessage, code: "SUBSCRIPTION_REQUIRED" },
						{ status: 402 },
					),
				),
		);
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

		const result = await callPushEndpoint(
			createMinimalPushPayload(userId),
			accessToken,
		);

		expect(result.status).toBe(402);
		expect(warning).toHaveBeenCalledWith(
			"[Sync Live Failure] endpoint=push status=402 code=SUBSCRIPTION_REQUIRED error=UNAVAILABLE",
		);
		expect(warning.mock.calls.flat().join(" ")).not.toContain(sensitiveMessage);
		expect(warning.mock.calls.flat().join(" ")).not.toContain(email);
		expect(warning.mock.calls.flat().join(" ")).not.toContain(userId);
		expect(warning.mock.calls.flat().join(" ")).not.toContain(accessToken);
	});

	it("does not log a non-OK pull response unless diagnostics are enabled", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					Response.json(
						{ error: "do not print this", code: "SUBSCRIPTION_REQUIRED" },
						{ status: 402 },
					),
				),
		);
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

		const result = await callPullEndpoint(0, accessToken);

		expect(result.status).toBe(402);
		expect(warning).not.toHaveBeenCalled();
	});

	it("logs bounded labels for a non-OK pull response when enabled", async () => {
		process.env.SYNC_LIVE_DEBUG_FAILURES = "true";
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					Response.json(
						{ error: "RATE_LIMITED", code: "RATE_LIMITED" },
						{ status: 429 },
					),
				),
		);
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

		const result = await callPullEndpoint(0, accessToken);

		expect(result.status).toBe(429);
		expect(warning).toHaveBeenCalledWith(
			"[Sync Live Failure] endpoint=pull status=429 code=RATE_LIMITED error=RATE_LIMITED",
		);
	});
});
