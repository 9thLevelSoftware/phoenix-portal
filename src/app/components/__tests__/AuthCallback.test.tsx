import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCallback } from "../AuthCallback";

const mockNavigate = vi.fn();

vi.mock("react-router", async () => {
	const actual = await vi.importActual("react-router");
	return {
		...actual,
		useNavigate: () => mockNavigate,
	};
});

const mockGetSession = vi.hoisted(() => vi.fn());
const mockOnAuthStateChange = vi.hoisted(() =>
	vi.fn(() => ({
		data: { subscription: { unsubscribe: vi.fn() } },
	})),
);

vi.mock("@/lib/supabase", () => ({
	supabase: {
		auth: {
			getSession: mockGetSession,
			onAuthStateChange: mockOnAuthStateChange,
		},
	},
}));

function renderAuthCallback(entry: string) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: 0 },
		},
	});

	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[entry]}>
				<AuthCallback />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("AuthCallback", () => {
	beforeEach(() => {
		mockNavigate.mockReset();
		mockGetSession.mockReset();
		mockGetSession.mockResolvedValue({
			data: { session: null },
			error: null,
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("navigates to the dashboard when a session is available", async () => {
		mockGetSession.mockResolvedValue({
			data: { session: { user: { id: "user-123" } } },
			error: null,
		});

		renderAuthCallback("/auth/callback?provider=google#access_token=test");

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith("/dashboard", {
				replace: true,
			});
		});
	});

	it("shows a provider-specific error from the OAuth callback fragment", async () => {
		renderAuthCallback(
			"/auth/callback?provider=apple#error=access_denied&error_description=The+user+canceled+the+sign-in",
		);

		expect(
			await screen.findByText(/apple sign-in failed/i),
		).toBeInTheDocument();
		expect(
			screen.getByText(/the user canceled the sign-in/i),
		).toBeInTheDocument();
		expect(mockNavigate).not.toHaveBeenCalled();
	});
});
