import type { Session, User } from "@supabase/supabase-js";
import { act, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { AuthProvider, useAuth } from "@/providers/AuthProvider";

// Mock the supabase client
vi.mock("@/lib/supabase", () => ({
	supabase: {
		auth: {
			getSession: vi.fn(),
			onAuthStateChange: vi.fn(() => ({
				data: { subscription: { unsubscribe: vi.fn() } },
			})),
			signOut: vi.fn(),
		},
	},
}));

import { supabase } from "@/lib/supabase";

const mockSupabase = supabase as unknown as {
	auth: {
		getSession: ReturnType<typeof vi.fn>;
		onAuthStateChange: ReturnType<typeof vi.fn>;
		signOut: ReturnType<typeof vi.fn>;
	};
};

function TestComponent() {
	const { user, session, loading, signOut } = useAuth();
	return (
		<div>
			<div data-testid="loading">{loading ? "loading" : "ready"}</div>
			<div data-testid="user">{user?.id ?? "no-user"}</div>
			<div data-testid="session">{session?.access_token ?? "no-session"}</div>
			<button type="button" onClick={signOut} data-testid="signout">
				Sign Out
			</button>
		</div>
	);
}

describe("AuthProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("initializes with loading state", async () => {
		// Never resolve getSession to keep loading state
		mockSupabase.auth.getSession.mockImplementation(
			() => new Promise(() => {}),
		);

		render(
			<AuthProvider>
				<TestComponent />
			</AuthProvider>,
		);

		expect(screen.getByTestId("loading")).toHaveTextContent("loading");
	});

	it("fetches initial session and updates state", async () => {
		const mockUser = { id: "test-user-123", email: "test@example.com" } as User;
		const mockSession = {
			user: mockUser,
			access_token: "test-token",
		} as Session;

		mockSupabase.auth.getSession.mockResolvedValue({
			data: { session: mockSession },
			error: null,
		});

		render(
			<AuthProvider>
				<TestComponent />
			</AuthProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("loading")).toHaveTextContent("ready");
		});

		expect(screen.getByTestId("user")).toHaveTextContent("test-user-123");
		expect(screen.getByTestId("session")).toHaveTextContent("test-token");
	});

	it("handles getSession rejection gracefully", async () => {
		mockSupabase.auth.getSession.mockRejectedValue(new Error("Network error"));

		render(
			<AuthProvider>
				<TestComponent />
			</AuthProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("loading")).toHaveTextContent("ready");
		});

		expect(screen.getByTestId("user")).toHaveTextContent("no-user");
		expect(screen.getByTestId("session")).toHaveTextContent("no-session");
	});

	it("handles null session from getSession", async () => {
		mockSupabase.auth.getSession.mockResolvedValue({
			data: { session: null },
			error: null,
		});

		render(
			<AuthProvider>
				<TestComponent />
			</AuthProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("loading")).toHaveTextContent("ready");
		});

		expect(screen.getByTestId("user")).toHaveTextContent("no-user");
		expect(screen.getByTestId("session")).toHaveTextContent("no-session");
	});

	it("subscribes to auth state changes", async () => {
		const mockUser = { id: "test-user-123" } as User;
		const mockSession = { user: mockUser, access_token: "token-1" } as Session;
		const newUser = { id: "new-user-456" } as User;
		const newSession = { user: newUser, access_token: "token-2" } as Session;

		// Store the callback to trigger it later
		let authStateCallback:
			| ((event: string, session: Session | null) => void)
			| null = null;

		mockSupabase.auth.getSession.mockResolvedValue({
			data: { session: mockSession },
			error: null,
		});

		mockSupabase.auth.onAuthStateChange.mockImplementation(
			(callback: (event: string, session: Session | null) => void) => {
				authStateCallback = callback;
				return {
					data: { subscription: { unsubscribe: vi.fn() } },
				};
			},
		);

		render(
			<AuthProvider>
				<TestComponent />
			</AuthProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("user")).toHaveTextContent("test-user-123");
		});

		// Trigger auth state change
		await act(async () => {
			authStateCallback?.("SIGNED_IN", newSession);
		});

		await waitFor(() => {
			expect(screen.getByTestId("user")).toHaveTextContent("new-user-456");
		});

		expect(screen.getByTestId("session")).toHaveTextContent("token-2");
	});

	it("unsubscribes from auth state changes on unmount", async () => {
		const unsubscribeMock = vi.fn();

		mockSupabase.auth.getSession.mockResolvedValue({
			data: { session: null },
			error: null,
		});

		mockSupabase.auth.onAuthStateChange.mockReturnValue({
			data: { subscription: { unsubscribe: unsubscribeMock } },
		});

		const { unmount } = render(
			<AuthProvider>
				<TestComponent />
			</AuthProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("loading")).toHaveTextContent("ready");
		});

		unmount();

		expect(unsubscribeMock).toHaveBeenCalled();
	});

	it("handles session expiration (SIGNED_OUT event)", async () => {
		const mockUser = { id: "test-user-123" } as User;
		const mockSession = { user: mockUser, access_token: "token-1" } as Session;

		let authStateCallback:
			| ((event: string, session: Session | null) => void)
			| null = null;

		mockSupabase.auth.getSession.mockResolvedValue({
			data: { session: mockSession },
			error: null,
		});

		mockSupabase.auth.onAuthStateChange.mockImplementation(
			(callback: (event: string, session: Session | null) => void) => {
				authStateCallback = callback;
				return {
					data: { subscription: { unsubscribe: vi.fn() } },
				};
			},
		);

		render(
			<AuthProvider>
				<TestComponent />
			</AuthProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("user")).toHaveTextContent("test-user-123");
		});

		// Simulate sign out
		await act(async () => {
			authStateCallback?.("SIGNED_OUT", null);
		});

		await waitFor(() => {
			expect(screen.getByTestId("user")).toHaveTextContent("no-user");
		});

		expect(screen.getByTestId("session")).toHaveTextContent("no-session");
	});

	it("calls supabase signOut when signOut is invoked", async () => {
		mockSupabase.auth.getSession.mockResolvedValue({
			data: { session: null },
			error: null,
		});

		mockSupabase.auth.signOut.mockResolvedValue({ error: null });

		render(
			<AuthProvider>
				<TestComponent />
			</AuthProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("loading")).toHaveTextContent("ready");
		});

		await screen.getByTestId("signout").click();

		expect(mockSupabase.auth.signOut).toHaveBeenCalled();
	});

	it("throws error when useAuth is used outside AuthProvider", () => {
		// Suppress console.error for this test
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(() => {
			render(<TestComponent />);
		}).toThrow("useAuth must be used within an AuthProvider");

		consoleSpy.mockRestore();
	});
});
