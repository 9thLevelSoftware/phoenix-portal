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
	});
});
