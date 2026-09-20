import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const _mockInsertResult = vi.fn();
const mockUpdateResult = vi.fn();
const mockDeleteResult = vi.fn();
const mockSelectSingle = vi.fn();

const mockChain = {
	insert: vi.fn(() => ({
		select: vi.fn(() => ({ single: mockSelectSingle })),
	})),
	update: vi.fn(() => ({
		eq: vi.fn((key: string, _val: string) => {
			// For useToggleFavorite, there's a second .eq() call
			if (key === "id") {
				return { eq: vi.fn(() => mockUpdateResult()) };
			}
			return mockUpdateResult();
		}),
	})),
	delete: vi.fn(() => ({
		eq: vi.fn(() => mockDeleteResult()),
	})),
};

const from = vi.fn(() => mockChain);
const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
	supabase: { from, rpc },
}));

vi.mock("@/providers/AuthProvider", () => ({
	useAuth: () => ({
		user: { id: "test-user-id", email: "test@example.com" },
		session: { user: { id: "test-user-id" }, access_token: "test-token" },
		loading: false,
	}),
}));

const mockToast = {
	success: vi.fn(),
	error: vi.fn(),
	loading: vi.fn(),
	dismiss: vi.fn(),
};
vi.mock("sonner", () => ({ toast: mockToast }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: 0 },
			mutations: { retry: false },
		},
	});
	return {
		queryClient,
		wrapper: ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		),
	};
}

const baseExercise = {
	name: "Bench Press",
	muscle_group: "Chest",
	sets: 3,
	reps: 10,
	weight: 100,
	rest_seconds: 90,
	mode: "ECCENTRIC_ONLY",
	order_index: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSaveRoutine", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("inserts routine and exercises into Supabase on success", async () => {
		const { useSaveRoutine } = await import("../routines");

		mockSelectSingle.mockResolvedValue({
			data: { id: "routine-1" },
			error: null,
		});
		mockChain.insert.mockImplementation((rows: unknown) => {
			// Second insert call is for exercises — no .select().single() chain
			if (Array.isArray(rows)) {
				return Promise.resolve({ error: null });
			}
			return { select: vi.fn(() => ({ single: mockSelectSingle })) };
		});

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useSaveRoutine(), { wrapper });

		result.current.mutate({
			name: "Test Routine",
			description: "A test routine",
			exercises: [baseExercise],
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		// Should insert into "routines" table first
		expect(from).toHaveBeenCalledWith("routines");
		// Should insert into "routine_exercises" table
		expect(from).toHaveBeenCalledWith("routine_exercises");
		// Should show success toast
		expect(mockToast.success).toHaveBeenCalledWith("Routine saved");
		// Should invalidate routines cache
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.routines.all,
		});
	});

	it("shows user-friendly error message on failure (not raw backend error)", async () => {
		const { useSaveRoutine } = await import("../routines");

		mockSelectSingle.mockResolvedValue({
			data: null,
			error: {
				message: "duplicate key value violates unique constraint",
				code: "23505",
			},
		});
		mockChain.insert.mockImplementation(() => ({
			select: vi.fn(() => ({ single: mockSelectSingle })),
		}));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useSaveRoutine(), { wrapper });

		result.current.mutate({
			name: "Test Routine",
			exercises: [baseExercise],
		});

		await waitFor(() => expect(result.current.isError).toBe(true));

		// Must show sanitized message, not raw Supabase error
		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to save routine. Please try again.",
		);
		expect(mockToast.error).not.toHaveBeenCalledWith(
			expect.stringContaining("duplicate key"),
		);
	});

	it("stores display-name modes as wire names", async () => {
		const { useSaveRoutine } = await import("../routines");
		let exerciseRows: Array<Record<string, unknown>> = [];

		mockSelectSingle.mockResolvedValue({
			data: { id: "routine-1" },
			error: null,
		});
		mockChain.insert.mockImplementation((rows: unknown) => {
			if (Array.isArray(rows)) {
				exerciseRows = rows as Array<Record<string, unknown>>;
				return Promise.resolve({ error: null });
			}
			return { select: vi.fn(() => ({ single: mockSelectSingle })) };
		});

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useSaveRoutine(), { wrapper });

		result.current.mutate({
			name: "Test Routine",
			exercises: [
				{ ...baseExercise, mode: "TUT Beast" },
				{ ...baseExercise, mode: "CLASSIC", order_index: 1 },
			],
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(exerciseRows.map((row) => row.mode)).toEqual([
			"TUT_BEAST",
			"OLD_SCHOOL",
		]);
	});

	it("rejects an unknown mode before inserting the routine", async () => {
		const { useSaveRoutine } = await import("../routines");

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useSaveRoutine(), { wrapper });

		result.current.mutate({
			name: "Test Routine",
			exercises: [{ ...baseExercise, mode: "eccentric" }],
		});

		await waitFor(() => expect(result.current.isError).toBe(true));
		expect(from).not.toHaveBeenCalled();
		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to save routine. Please try again.",
		);
	});

	it("throws when user is not authenticated", async () => {
		// Temporarily mock useAuth to return null user
		const authMock = await import("@/providers/AuthProvider");
		const originalUseAuth = authMock.useAuth;
		vi.spyOn(authMock, "useAuth").mockReturnValue({
			user: null,
			session: null,
			loading: false,
			signOut: () => Promise.resolve(),
		} as ReturnType<typeof originalUseAuth>);

		const { useSaveRoutine } = await import("../routines");
		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useSaveRoutine(), { wrapper });

		result.current.mutate({
			name: "Test Routine",
			exercises: [baseExercise],
		});

		await waitFor(() => expect(result.current.isError).toBe(true));

		// Restore auth mock
		vi.mocked(authMock.useAuth).mockReturnValue({
			user: { id: "test-user-id", email: "test@example.com" },
			session: { user: { id: "test-user-id" }, access_token: "test-token" },
			loading: false,
		} as ReturnType<typeof originalUseAuth>);
	});
});

describe("useUpdateRoutine", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("updates the routine and its exercises atomically via RPC", async () => {
		const { useUpdateRoutine } = await import("../routines");

		// Update now runs through the atomic update_routine_with_exercises RPC.
		rpc.mockResolvedValue({ data: "routine-1", error: null });

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useUpdateRoutine(), { wrapper });

		result.current.mutate({
			routineId: "routine-1",
			name: "Updated Routine",
			description: "Updated desc",
			exercises: [{ ...baseExercise, name: "Squat", muscle_group: "Legs" }],
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		// One atomic RPC call instead of separate update/delete/insert requests.
		expect(rpc).toHaveBeenCalledWith(
			"update_routine_with_exercises",
			expect.objectContaining({
				p_routine_id: "routine-1",
				p_name: "Updated Routine",
				p_exercise_count: 1,
			}),
		);
		expect(mockToast.success).toHaveBeenCalledWith("Routine updated");
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.routines.all,
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.routines.detail("routine-1"),
		});
	});

	it("preserves per-set weights when updating an existing routine", async () => {
		const { useUpdateRoutine } = await import("../routines");
		let exerciseRows: Array<Record<string, unknown>> = [];

		rpc.mockImplementation(
			(_fn: string, args: { p_exercises: Array<Record<string, unknown>> }) => {
				exerciseRows = args.p_exercises;
				return Promise.resolve({ data: "routine-1", error: null });
			},
		);

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useUpdateRoutine(), { wrapper });

		result.current.mutate({
			routineId: "routine-1",
			name: "Updated Routine",
			exercises: [
				{
					...baseExercise,
					per_set_weights: [50, 55, 60],
				},
			],
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(exerciseRows).toHaveLength(1);
		expect(exerciseRows[0]?.weight).toBe(baseExercise.weight / 2);
		// per_set_weights must follow the same per-cable halving as `weight` so
		// the stored and displayed values round-trip consistently.
		expect(exerciseRows[0]?.per_set_weights).toEqual([25, 27.5, 30]);
	});

	it("sends wire-name modes through the update RPC and keeps preserved unknown modes", async () => {
		const { useUpdateRoutine } = await import("../routines");
		let exerciseRows: Array<Record<string, unknown>> = [];

		rpc.mockImplementation(
			(_fn: string, args: { p_exercises: Array<Record<string, unknown>> }) => {
				exerciseRows = args.p_exercises;
				return Promise.resolve({ data: "routine-1", error: null });
			},
		);

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useUpdateRoutine(), { wrapper });

		result.current.mutate({
			routineId: "routine-1",
			name: "Updated Routine",
			exercises: [
				{ ...baseExercise, mode: "Echo" },
				{ ...baseExercise, mode: "FUTURE_MODE", order_index: 1 },
			],
			preservedModes: ["FUTURE_MODE"],
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(exerciseRows.map((row) => row.mode)).toEqual([
			"ECHO",
			"FUTURE_MODE",
		]);
	});

	it("rejects an unknown, non-preserved mode before calling the update RPC", async () => {
		const { useUpdateRoutine } = await import("../routines");

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useUpdateRoutine(), { wrapper });

		result.current.mutate({
			routineId: "routine-1",
			name: "Updated Routine",
			exercises: [{ ...baseExercise, mode: "eccentric" }],
		});

		await waitFor(() => expect(result.current.isError).toBe(true));
		expect(rpc).not.toHaveBeenCalled();
	});

	it("shows user-friendly error on update failure", async () => {
		const { useUpdateRoutine } = await import("../routines");

		rpc.mockResolvedValue({
			data: null,
			error: { message: "new row violates check constraint", code: "23514" },
		});

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useUpdateRoutine(), { wrapper });

		result.current.mutate({
			routineId: "routine-1",
			name: "Updated",
			exercises: [baseExercise],
		});

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to update routine. Please try again.",
		);
	});
});

describe("useToggleFavorite", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	/** `.update().eq("id").eq("user_id").select("id").maybeSingle()`. */
	function mockFavoriteChain(outcome: {
		data: { id: string } | null;
		error: { message: string; code?: string } | null;
	}) {
		const maybeSingle = vi.fn(() => Promise.resolve(outcome));
		const select = vi.fn(() => ({ maybeSingle }));
		const eqSecond = vi.fn(() => ({ select }));
		const eqFirst = vi.fn(() => ({ eq: eqSecond }));
		mockChain.update.mockImplementation(() => ({ eq: eqFirst }));
		return { select };
	}

	it("calls Supabase update with is_favorite and invalidates user-specific cache", async () => {
		const { useToggleFavorite } = await import("../routines");

		const chain = mockFavoriteChain({ data: { id: "routine-1" }, error: null });

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useToggleFavorite(), { wrapper });

		result.current.mutate({ routineId: "routine-1", isFavorite: true });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("routines");
		expect(chain.select).toHaveBeenCalledWith("id");
		// Should invalidate all routines cache (prefix invalidation for profile filtering)
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.routines.all,
		});
	});

	it("fails instead of silently doing nothing when the update matches no row", async () => {
		// The routines UPDATE policy is owner AND FLAME. If the plan lapsed
		// while the page was open, PostgREST answers success with an empty
		// body and the UI would keep the star it just drew.
		const { useToggleFavorite } = await import("../routines");

		mockFavoriteChain({ data: null, error: null });

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useToggleFavorite(), { wrapper });

		result.current.mutate({ routineId: "routine-1", isFavorite: true });

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Routine not found, or you can no longer edit it.",
		);
	});

	it("explains a server-side tier denial instead of failing silently", async () => {
		const { useToggleFavorite } = await import("../routines");
		const { TIER_DENIED_MESSAGE } = await import("@/lib/tierErrors");

		mockFavoriteChain({
			data: null,
			error: {
				code: "42501",
				message: "new row violates row-level security policy",
			},
		});

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useToggleFavorite(), { wrapper });

		result.current.mutate({ routineId: "routine-1", isFavorite: true });

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(TIER_DENIED_MESSAGE);
		// The route gate must re-evaluate, so billing status is refetched.
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.subscription.all,
		});
	});
});
