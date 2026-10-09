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

	it("maps access_denied to fixed copy and ignores the callback description", async () => {
		renderAuthCallback(
			"/auth/callback?provider=apple#error=access_denied&error_description=The+user+canceled+the+sign-in+and+should+visit+https://evil.example",
		);

		expect(
			await screen.findByText(/apple sign-in failed/i),
		).toBeInTheDocument();
		expect(
			screen.getByText(/sign-in was cancelled or access was denied/i),
		).toBeInTheDocument();
		expect(screen.queryByText(/evil\.example/i)).not.toBeInTheDocument();
		expect(
			screen.queryByText(/the user canceled the sign-in/i),
		).not.toBeInTheDocument();
		expect(mockNavigate).not.toHaveBeenCalled();
	});

	it("does not render a crafted error_description from the query string", async () => {
		const crafted =
			"Visit https://evil.example and paste your password to finish sign-in";

		renderAuthCallback(
			`/auth/callback?error_description=${encodeURIComponent(crafted)}`,
		);

		expect(
			await screen.findByRole("heading", { name: /sign-in failed/i }),
		).toBeInTheDocument();
		expect(screen.queryByText(crafted)).not.toBeInTheDocument();
		expect(screen.queryByText(/evil\.example/i)).not.toBeInTheDocument();
		expect(
			screen.getByText(
				/authentication could not be completed\. please try again\./i,
			),
		).toBeInTheDocument();
	});

	it("maps otp_expired to fixed invalid-link copy ahead of access_denied", async () => {
		renderAuthCallback(
			"/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired.+Open+https://evil.example",
		);

		expect(
			await screen.findByRole("heading", { name: /sign-in failed/i }),
		).toBeInTheDocument();
		expect(
			screen.getByText(/this sign-in link is invalid or has expired/i),
		).toBeInTheDocument();
		expect(
			screen.queryByText(/cancelled or access was denied/i),
		).not.toBeInTheDocument();
		expect(screen.queryByText(/evil\.example/i)).not.toBeInTheDocument();
	});

	it.each([
		"flow_state_expired",
		"flow_state_not_found",
		"bad_oauth_state",
	])("maps %s to fixed invalid-link copy and ignores error_description", async (code) => {
		renderAuthCallback(
			`/auth/callback?error_code=${code}&error_description=${encodeURIComponent("Continue at https://evil.example")}`,
		);

		expect(
			await screen.findByRole("heading", { name: /sign-in failed/i }),
		).toBeInTheDocument();
		expect(
			screen.getByText(/this sign-in link is invalid or has expired/i),
		).toBeInTheDocument();
		expect(screen.queryByText(/evil\.example/i)).not.toBeInTheDocument();
	});

	it("maps an unknown error code to the generic fallback", async () => {
		renderAuthCallback(
			"/auth/callback?error=server_error&error_description=Internal+details+from+the+provider",
		);

		expect(
			await screen.findByRole("heading", { name: /sign-in failed/i }),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				/authentication could not be completed\. please try again\./i,
			),
		).toBeInTheDocument();
		expect(
			screen.queryByText(/internal details from the provider/i),
		).not.toBeInTheDocument();
	});
});
