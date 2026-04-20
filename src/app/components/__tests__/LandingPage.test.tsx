import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { LandingPage } from "../LandingPage";

const mockAuth = vi.hoisted(() => ({
	useAuth: () => ({
		user: null,
		session: null,
		loading: false,
		signOut: () => Promise.resolve(),
	}),
}));

vi.mock("@/app/hooks/useAuth", () => mockAuth);
vi.mock("@/providers/AuthProvider", () => mockAuth);

const mockSignInWithOAuth = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", async () => {
	const actual = await vi.importActual<typeof import("@/lib/supabase")>(
		"@/lib/supabase",
	);

	return {
		...actual,
		supabase: {
			auth: {
				signInWithOAuth: mockSignInWithOAuth,
				signInWithPassword: vi.fn(),
				signUp: vi.fn(),
				resetPasswordForEmail: vi.fn(),
			},
		},
	};
});

const fetchMock = vi.fn();

function mockAuthSettings({
	apple = false,
	google = false,
}: {
	apple?: boolean;
	google?: boolean;
} = {}) {
	fetchMock.mockResolvedValue({
		ok: true,
		json: async () => ({
			external: {
				apple,
				google,
			},
		}),
	});
}

async function renderLandingPage({
	apple = false,
	google = false,
}: {
	apple?: boolean;
	google?: boolean;
} = {}) {
	mockAuthSettings({ apple, google });
	renderWithProviders(<LandingPage />);
	await waitFor(() => {
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
}

describe("LandingPage", () => {
	beforeEach(() => {
		fetchMock.mockReset();
		mockSignInWithOAuth.mockReset();
		mockSignInWithOAuth.mockResolvedValue({ error: null });
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("renders without crashing", async () => {
		await renderLandingPage();
		expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
			/your workouts, unlocked/i,
		);
	});

	it("renders proof row capabilities", async () => {
		await renderLandingPage();
		expect(screen.getByText("Force curves")).toBeInTheDocument();
		expect(screen.getByText("Recovery signals")).toBeInTheDocument();
		expect(screen.getByText("Records")).toBeInTheDocument();
		expect(screen.getByText("Replay")).toBeInTheDocument();
	});

	it("renders product-aligned CTAs", async () => {
		await renderLandingPage();
		const previewBtns = screen.getAllByRole("button", {
			name: /preview dashboard/i,
		});
		expect(previewBtns.length).toBeGreaterThanOrEqual(1);
		const appLinks = screen.getAllByRole("link", {
			name: /get the mobile app/i,
		});
		expect(appLinks.length).toBeGreaterThanOrEqual(1);
	});

	it("renders feature cards with correct tier badges", async () => {
		await renderLandingPage();
		const badges = screen.getAllByText(/^(EMBER|FLAME|INFERNO)$/);
		expect(badges.length).toBeGreaterThanOrEqual(6);
		expect(screen.getAllByText("EMBER")).toHaveLength(2);
		expect(screen.getAllByText("FLAME")).toHaveLength(2);
		expect(screen.getAllByText("INFERNO")).toHaveLength(2);
	});

	it("renders section eyebrow labels", async () => {
		await renderLandingPage();
		expect(screen.getByText("WHAT YOU GET")).toBeInTheDocument();
		expect(screen.getByText("PRICING")).toBeInTheDocument();
	});

	it("renders interactive demo section", async () => {
		await renderLandingPage();
		expect(screen.getByText("TRY IT")).toBeInTheDocument();
		expect(screen.getByText(/explore a real force curve/i)).toBeInTheDocument();
	});

	it("hides social sign-in buttons when providers are disabled", async () => {
		const user = userEvent.setup();
		await renderLandingPage({ apple: false, google: false });

		await user.click(screen.getByRole("button", { name: /^sign in$/i }));

		await waitFor(() => {
			expect(
				screen.queryByRole("button", { name: /sign in with google/i }),
			).not.toBeInTheDocument();
			expect(
				screen.queryByRole("button", { name: /sign in with apple/i }),
			).not.toBeInTheDocument();
			expect(screen.queryByText(/or continue with/i)).not.toBeInTheDocument();
		});
	});

	it("renders only enabled social sign-in providers", async () => {
		const user = userEvent.setup();
		await renderLandingPage({ apple: false, google: true });

		await user.click(screen.getByRole("button", { name: /^sign in$/i }));

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: /sign in with google/i }),
			).toBeInTheDocument();
			expect(
				screen.queryByRole("button", { name: /sign in with apple/i }),
			).not.toBeInTheDocument();
		});
	});

	it("starts Google OAuth with the callback route and explicit email scope", async () => {
		const user = userEvent.setup();
		await renderLandingPage({ apple: false, google: true });

		await user.click(screen.getByRole("button", { name: /^sign in$/i }));
		await user.click(screen.getByRole("button", { name: /sign in with google/i }));

		expect(mockSignInWithOAuth).toHaveBeenCalledWith({
			provider: "google",
			options: {
				redirectTo: `${window.location.origin}/auth/callback?provider=google`,
				scopes: "https://www.googleapis.com/auth/userinfo.email",
			},
		});
	});

	it("starts Apple OAuth with the callback route", async () => {
		const user = userEvent.setup();
		await renderLandingPage({ apple: true, google: false });

		await user.click(screen.getByRole("button", { name: /^sign in$/i }));
		await user.click(screen.getByRole("button", { name: /sign in with apple/i }));

		expect(mockSignInWithOAuth).toHaveBeenCalledWith({
			provider: "apple",
			options: {
				redirectTo: `${window.location.origin}/auth/callback?provider=apple`,
			},
		});
	});
});
