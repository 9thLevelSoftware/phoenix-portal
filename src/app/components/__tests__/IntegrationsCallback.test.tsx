import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationsCallback } from "../IntegrationsCallback";

const mockNavigate = vi.fn();

vi.mock("react-router", async () => {
	const actual = await vi.importActual("react-router");
	return {
		...actual,
		useNavigate: () => mockNavigate,
	};
});

const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock("@/app/hooks/useAuth", () => ({
	useAuth: mockUseAuth,
}));

const ACCESS_TOKEN = "portal-jwt";
const CODE = "provider-auth-code";
const STATE = "state-token-1";

function setCallbackUrl(search: string): void {
	window.history.replaceState(
		null,
		"",
		`/integrations/callback${search ? `?${search}` : ""}`,
	);
}

function renderCallback() {
	return render(
		<StrictMode>
			<MemoryRouter initialEntries={["/integrations/callback"]}>
				<IntegrationsCallback />
			</MemoryRouter>
		</StrictMode>,
	);
}

function okResponse(): Response {
	return new Response(JSON.stringify({ connected: "strava" }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function errorResponse(status: number, error: string): Response {
	return new Response(JSON.stringify({ error, message: "nope" }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("IntegrationsCallback", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockNavigate.mockReset();
		mockUseAuth.mockReturnValue({
			session: { access_token: ACCESS_TOKEN },
			user: { id: "user-1" },
			loading: false,
		});
		fetchMock = vi.fn().mockResolvedValue(okResponse());
		vi.stubGlobal("fetch", fetchMock);
		document.querySelector('meta[name="referrer"]')?.remove();
		setCallbackUrl(`provider=strava&code=${CODE}&state=${STATE}`);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it("strips code and state from the URL before anything else can read them", async () => {
		renderCallback();

		// R-38: synchronous on mount, so the params never survive a repaint.
		expect(window.location.search).toBe("");
		expect(window.location.href).not.toContain(CODE);
		expect(window.location.href).not.toContain(STATE);
		expect(window.location.pathname).toBe("/integrations/callback");

		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
	});

	it("posts the code and state in the body and never in the URL", async () => {
		renderCallback();

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/functions/v1/complete-oauth");
		expect(url).not.toContain(CODE);
		expect(url).not.toContain(STATE);
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>).Authorization).toBe(
			`Bearer ${ACCESS_TOKEN}`,
		);
		expect(JSON.parse(init.body as string)).toEqual({
			provider: "strava",
			code: CODE,
			state: STATE,
		});
	});

	it("posts exactly once under StrictMode's double mount", async () => {
		renderCallback();

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		// The state token is single-use; a second POST would be refused (403).
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("sets a no-referrer meta tag", async () => {
		renderCallback();

		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(
			document.querySelector('meta[name="referrer"]')?.getAttribute("content"),
		).toBe("no-referrer");
	});

	it("redirects to the integrations page on success, exactly once", async () => {
		renderCallback();

		await waitFor(() =>
			expect(mockNavigate).toHaveBeenCalledWith(
				"/integrations?connected=strava",
				{
					replace: true,
				},
			),
		);
		// Exactly one navigation: without the run-once ref, StrictMode's second
		// effect finds an already-stripped URL and fires a spurious
		// `error=missing_params` redirect alongside the real result.
		expect(mockNavigate).toHaveBeenCalledTimes(1);
	});

	it("reflects the whitelisted provider, not the raw URL value", async () => {
		setCallbackUrl(`provider=%3Cimg%20src%3Dx%3E&code=${CODE}&state=${STATE}`);

		renderCallback();

		await waitFor(() =>
			expect(mockNavigate).toHaveBeenCalledWith(
				"/integrations?error=missing_params",
				{
					replace: true,
				},
			),
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("passes the server's refusal slug through to the integrations page", async () => {
		fetchMock.mockResolvedValue(errorResponse(403, "state_mismatch"));

		renderCallback();

		await waitFor(() =>
			expect(mockNavigate).toHaveBeenCalledWith(
				"/integrations?error=state_mismatch",
				{
					replace: true,
				},
			),
		);
	});

	it("maps a 402 to the shared tier-denied slug", async () => {
		fetchMock.mockResolvedValue(errorResponse(402, "subscription_required"));

		renderCallback();

		await waitFor(() =>
			expect(mockNavigate).toHaveBeenCalledWith(
				"/integrations?error=subscription_required",
				{ replace: true },
			),
		);
	});

	it("reports a provider-side denial without posting", async () => {
		setCallbackUrl("provider=strava&error=access_denied");

		renderCallback();

		await waitFor(() =>
			expect(mockNavigate).toHaveBeenCalledWith(
				"/integrations?error=access_denied",
				{
					replace: true,
				},
			),
		);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(window.location.search).toBe("");
	});

	it("waits for the session instead of posting without a JWT", async () => {
		mockUseAuth.mockReturnValue({ session: null, user: null, loading: true });

		renderCallback();

		await screen.findByText("Finishing the connection");
		expect(fetchMock).not.toHaveBeenCalled();
		// The params survive until a token exists, so the flow can still finish.
		expect(window.location.search).toContain(`state=${STATE}`);
	});
});
