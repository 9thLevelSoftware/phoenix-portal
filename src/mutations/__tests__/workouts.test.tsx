import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockChain = {
	update: vi.fn(),
};

const from = vi.fn(() => mockChain);

vi.mock("@/lib/supabase", () => ({
	supabase: { from },
}));

vi.mock("@/providers/AuthProvider", () => ({
	useAuth: () => ({
		user: { id: "test-user-id", email: "test@example.com" },
		session: { user: { id: "test-user-id" }, access_token: "test-token" },
		loading: false,
	}),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: 0 },
			mutations: { retry: false },
		},
	});
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

// ---------------------------------------------------------------------------
// useSaveSessionNotes
// ---------------------------------------------------------------------------

describe("useSaveSessionNotes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("sends only { notes } (the one column authenticated may UPDATE)", async () => {
		const { useSaveSessionNotes } = await import("../workouts");

		const maybeSingle = vi.fn(() =>
			Promise.resolve({ data: { id: "session-1" }, error: null }),
		);
		const select = vi.fn(() => ({ maybeSingle }));
		const eqUser = vi.fn(() => ({ select }));
		const eqId = vi.fn(() => ({ eq: eqUser }));
		mockChain.update.mockImplementation(() => ({ eq: eqId }));

		const { result } = renderHook(() => useSaveSessionNotes(), {
			wrapper: createWrapper(),
		});

		result.current.mutate({ sessionId: "session-1", notes: "Felt strong" });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("workout_sessions");
		expect(mockChain.update).toHaveBeenCalledTimes(1);
		expect(mockChain.update).toHaveBeenCalledWith({ notes: "Felt strong" });
		expect(eqId).toHaveBeenCalledWith("id", "session-1");
		expect(eqUser).toHaveBeenCalledWith("user_id", "test-user-id");
		expect(select).toHaveBeenCalledWith("id");
	});

	it("sends { notes: null } when notes are cleared", async () => {
		const { useSaveSessionNotes } = await import("../workouts");

		const maybeSingle = vi.fn(() =>
			Promise.resolve({ data: { id: "session-1" }, error: null }),
		);
		const select = vi.fn(() => ({ maybeSingle }));
		const eqUser = vi.fn(() => ({ select }));
		const eqId = vi.fn(() => ({ eq: eqUser }));
		mockChain.update.mockImplementation(() => ({ eq: eqId }));

		const { result } = renderHook(() => useSaveSessionNotes(), {
			wrapper: createWrapper(),
		});

		result.current.mutate({ sessionId: "session-1", notes: "" });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mockChain.update).toHaveBeenCalledWith({ notes: null });
const rpc = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/providers/AuthProvider", () => ({
	useAuth: () => ({ user: { id: "user-1" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function wrapper({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { mutations: { retry: false } } })
			}
		>
			{children}
		</QueryClientProvider>
	);
}

describe("useDeleteWorkout", () => {
	beforeEach(() => vi.clearAllMocks());

	it("routes portal workout deletion through the tombstone RPC", async () => {
		const mutationId = "60000000-0000-4000-8000-000000000001";
		vi.spyOn(crypto, "randomUUID").mockReturnValue(mutationId);
		rpc.mockResolvedValue({ data: [{ mutation_id: mutationId }], error: null });
		const { useDeleteWorkout } = await import("../workouts");
		const { result } = renderHook(() => useDeleteWorkout(), { wrapper });

		result.current.mutate({
			portalSessionId: "60000000-0000-4000-8000-000000000002",
			profileId: "default",
			scope: "WORKOUT",
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(rpc).toHaveBeenCalledWith("delete_workout_with_tombstone", {
			p_mutation_id: mutationId,
			p_portal_session_id: "60000000-0000-4000-8000-000000000002",
			p_component_session_id: null,
			p_scope: "WORKOUT",
			p_profile_id: "default",
			p_deleted_at: expect.any(String),
		});
	});
});
