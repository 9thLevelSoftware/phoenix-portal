import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initiateFitbitConnect } from "./fitbit";
import { initiateGarminConnect } from "./garmin";
import { OAuthInitiateError } from "./oauthRedirect";
import { initiateStravaConnect } from "./strava";

const redirectCalls = vi.hoisted(() => vi.fn());

vi.mock("./oauthRedirect", async () => {
	const actual =
		await vi.importActual<typeof import("./oauthRedirect")>("./oauthRedirect");
	return {
		...actual,
		redirectToValidatedOAuthUrl: (
			provider: Parameters<typeof actual.redirectToValidatedOAuthUrl>[0],
			value: unknown,
			options?: Parameters<typeof actual.redirectToValidatedOAuthUrl>[2],
		) => {
			const validated = actual.validateOAuthRedirectUrl(
				provider,
				value,
				options,
			);
			redirectCalls(provider, validated, options);
		},
	};
});

const SUPABASE_URL = "https://test-project.supabase.co";
const ACCESS_TOKEN = "portal-jwt";

const COMING_SOON = {
	error: "provider_unavailable",
	message:
		"This connection is coming soon. It is not available yet, so we did not start it.",
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("initiateOAuthConnect", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.stubEnv("VITE_SUPABASE_URL", SUPABASE_URL);
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		redirectCalls.mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.stubEnv("VITE_SUPABASE_URL", SUPABASE_URL);
	});

	it("posts each provider to initiate-oauth with the caller's JWT", async () => {
		fetchMock.mockResolvedValue(jsonResponse(COMING_SOON, 400));

		const starters = [
			["strava", initiateStravaConnect],
			["fitbit", initiateFitbitConnect],
			["garmin", initiateGarminConnect],
		] as const;

		for (const [provider, start] of starters) {
			fetchMock.mockClear();
			redirectCalls.mockClear();
			await expect(start(ACCESS_TOKEN)).rejects.toBeInstanceOf(
				OAuthInitiateError,
			);

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${SUPABASE_URL}/functions/v1/initiate-oauth`);
			expect(init.method).toBe("POST");
			expect(init.headers).toMatchObject({
				Authorization: `Bearer ${ACCESS_TOKEN}`,
				"Content-Type": "application/json",
			});
			expect(JSON.parse(String(init.body))).toEqual({ provider });
			expect(redirectCalls).not.toHaveBeenCalled();
		}
	});

	it("forwards a Fitbit provider_unavailable refusal and does not redirect (NF-46)", async () => {
		fetchMock.mockResolvedValue(jsonResponse(COMING_SOON, 400));

		await expect(initiateFitbitConnect(ACCESS_TOKEN)).rejects.toEqual(
			expect.objectContaining({
				name: "OAuthInitiateError",
				status: 400,
				message: COMING_SOON.message,
			}),
		);
		expect(redirectCalls).not.toHaveBeenCalled();
	});

	it("forwards a Garmin provider_unavailable refusal and does not redirect (NF-46)", async () => {
		fetchMock.mockResolvedValue(jsonResponse(COMING_SOON, 400));

		await expect(initiateGarminConnect(ACCESS_TOKEN)).rejects.toEqual(
			expect.objectContaining({
				name: "OAuthInitiateError",
				status: 400,
				message: COMING_SOON.message,
			}),
		);
		expect(redirectCalls).not.toHaveBeenCalled();
	});

	it("redirects Strava only to the validated authorize URL", async () => {
		const url =
			"https://www.strava.com/oauth/authorize?client_id=client&state=state";
		fetchMock.mockResolvedValue(jsonResponse({ url }));

		await initiateStravaConnect(ACCESS_TOKEN);

		expect(redirectCalls).toHaveBeenCalledTimes(1);
		expect(redirectCalls).toHaveBeenCalledWith("strava", url, undefined);
	});

	it("redirects Garmin only when the URL is this project's garmin-oauth function", async () => {
		const url = `${SUPABASE_URL}/functions/v1/garmin-oauth?state=state`;
		fetchMock.mockResolvedValue(jsonResponse({ url }));

		await initiateGarminConnect(ACCESS_TOKEN);

		expect(redirectCalls).toHaveBeenCalledTimes(1);
		expect(redirectCalls).toHaveBeenCalledWith("garmin", url, {
			supabaseUrl: SUPABASE_URL,
		});
	});

	it("rejects a Garmin redirect outside the configured Supabase origin", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				url: "https://attacker.example/functions/v1/garmin-oauth?state=state",
			}),
		);

		await expect(initiateGarminConnect(ACCESS_TOKEN)).rejects.toThrow(
			/requested provider/,
		);
		expect(redirectCalls).not.toHaveBeenCalled();
	});

	it("refuses to start when Supabase is not configured", async () => {
		vi.stubEnv("VITE_SUPABASE_URL", "");

		await expect(initiateStravaConnect(ACCESS_TOKEN)).rejects.toThrow(
			/not configured/,
		);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(redirectCalls).not.toHaveBeenCalled();
	});
});
