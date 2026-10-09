import type { Session, User } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";

function wrap(ui: ReactNode) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

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

	it.each([
		"SIGNED_IN",
		"PASSWORD_RECOVERY",
		"USER_UPDATED",
		"INITIAL_SESSION",
	])("evicts old principal data before replacement renders for %s", async (event) => {
		const qc = new QueryClient();
		let callback: (event: string, session: Session | null) => void = () => {};
		const sessionFor = (id: string) =>
			({ user: { id }, access_token: id }) as Session;
		mockSupabase.auth.getSession.mockResolvedValue({
			data: { session: sessionFor("account-a") },
		});
		mockSupabase.auth.onAuthStateChange.mockImplementation((fn) => {
			callback = fn;
			return { data: { subscription: { unsubscribe: vi.fn() } } };
		});
		const detailKey = queryKeys.workouts.detail("account-a", "session-1");
		const replayKey = queryKeys.replay.telemetry("account-a", "set-1");
		function CacheConsumer() {
			const { user } = useAuth();
			if (user?.id === "account-b") {
				expect(qc.getQueryData(detailKey)).toBeUndefined();
				expect(qc.getQueryData(replayKey)).toBeUndefined();
			}
			return <div data-testid="principal">{user?.id}</div>;
		}
		render(
			<QueryClientProvider client={qc}>
				<AuthProvider>
					<CacheConsumer />
				</AuthProvider>
			</QueryClientProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("principal")).toHaveTextContent("account-a"),
		);
		qc.setQueryData(detailKey, { private: "workout" });
		qc.setQueryData(replayKey, { private: "telemetry" });
		const cancel = vi.spyOn(qc, "cancelQueries");
		await act(async () => callback(event, sessionFor("account-b")));
		expect(cancel).toHaveBeenCalledOnce();
		expect(screen.getByTestId("principal")).toHaveTextContent("account-b");
	});

	it("preserves cached data when the same principal refreshes its token", async () => {
		const qc = new QueryClient();
		let callback: (event: string, session: Session | null) => void = () => {};
		const initial = {
			user: { id: "account-a" },
			access_token: "old",
		} as Session;
		mockSupabase.auth.getSession.mockResolvedValue({
			data: { session: initial },
		});
		mockSupabase.auth.onAuthStateChange.mockImplementation((fn) => {
			callback = fn;
			return { data: { subscription: { unsubscribe: vi.fn() } } };
		});
		render(
			<QueryClientProvider client={qc}>
				<AuthProvider>
					<TestComponent />
				</AuthProvider>
			</QueryClientProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("user")).toHaveTextContent("account-a"),
		);
		const key = queryKeys.workouts.detail("account-a", "session-1");
		qc.setQueryData(key, "cached");
		await act(async () =>
			callback("TOKEN_REFRESHED", { ...initial, access_token: "new" }),
		);
		expect(qc.getQueryData(key)).toBe("cached");
		expect(screen.getByTestId("session")).toHaveTextContent("new");
	});

	it("ignores stale hydration and late private query completion after replacement", async () => {
		const qc = new QueryClient();
		let callback: (event: string, session: Session | null) => void = () => {};
		let finishHydration: (value: { data: { session: Session } }) => void =
			() => {};
		let finishQuery: (value: string) => void = () => {};
		mockSupabase.auth.getSession.mockReturnValue(
			new Promise((resolve) => {
				finishHydration = resolve;
			}),
		);
		mockSupabase.auth.onAuthStateChange.mockImplementation((fn) => {
			callback = fn;
			return { data: { subscription: { unsubscribe: vi.fn() } } };
		});
		render(
			<QueryClientProvider client={qc}>
				<AuthProvider>
					<TestComponent />
				</AuthProvider>
			</QueryClientProvider>,
		);
		const sessionFor = (id: string) =>
			({ user: { id }, access_token: id }) as Session;
		await act(async () => callback("SIGNED_IN", sessionFor("account-a")));
		const key = queryKeys.replay.telemetry("account-a", "set-1");
		const pending = qc
			.fetchQuery({
				queryKey: key,
				queryFn: () =>
					new Promise<string>((resolve) => {
						finishQuery = resolve;
					}),
			})
			.catch(() => undefined);
		await act(async () =>
			callback("PASSWORD_RECOVERY", sessionFor("account-b")),
		);
		await act(async () => {
			finishHydration({ data: { session: sessionFor("account-a") } });
			finishQuery("old private data");
			await pending;
		});
		expect(screen.getByTestId("user")).toHaveTextContent("account-b");
		expect(qc.getQueryData(key)).toBeUndefined();
	});

	it("initializes with loading state", async () => {
		// Never resolve getSession to keep loading state
		mockSupabase.auth.getSession.mockImplementation(
			() => new Promise(() => {}),
		);

		render(
			wrap(
				<AuthProvider>
					<TestComponent />
				</AuthProvider>,
			),
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
			wrap(
				<AuthProvider>
					<TestComponent />
				</AuthProvider>,
			),
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
			wrap(
				<AuthProvider>
					<TestComponent />
				</AuthProvider>,
			),
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
			wrap(
				<AuthProvider>
					<TestComponent />
				</AuthProvider>,
			),
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
			wrap(
				<AuthProvider>
					<TestComponent />
				</AuthProvider>,
			),
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
			wrap(
				<AuthProvider>
					<TestComponent />
				</AuthProvider>,
			),
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
			wrap(
				<AuthProvider>
					<TestComponent />
				</AuthProvider>,
			),
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
			wrap(
				<AuthProvider>
					<TestComponent />
				</AuthProvider>,
			),
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
