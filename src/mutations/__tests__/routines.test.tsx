import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInsertResult = vi.fn();
const mockUpdateResult = vi.fn();
const mockDeleteResult = vi.fn();
const mockSelectSingle = vi.fn();

const mockChain = {
	insert: vi.fn(() => ({
		select: vi.fn(() => ({ single: mockSelectSingle })),
	})),
	update: vi.fn(() => ({
		eq: vi.fn((key: string, val: string) => {
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
	mode: "eccentric",
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

	it("updates routine, deletes old exercises, and inserts new ones", async () => {
		const { useUpdateRoutine } = await import("../routines");

		mockChain.update.mockImplementation(() => ({
			eq: vi.fn(() => Promise.resolve({ error: null })),
		}));
		mockChain.delete.mockImplementation(() => ({
			eq: vi.fn(() => Promise.resolve({ error: null })),
		}));
		mockChain.insert.mockImplementation(() => Promise.resolve({ error: null }));

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

		// Should touch "routines" for update, "routine_exercises" for delete + insert
		expect(from).toHaveBeenCalledWith("routines");
		expect(from).toHaveBeenCalledWith("routine_exercises");
		// Toast
		expect(mockToast.success).toHaveBeenCalledWith("Routine updated");
		// Cache invalidation: both all and detail
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.routines.all,
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.routines.detail("routine-1"),
		});
	});

	it("preserves per-set weights when updating an existing routine", async () => {
		const { useUpdateRoutine } = await import("../routines");
		let insertedExerciseRows: Array<Record<string, unknown>> = [];

		mockChain.update.mockImplementation(() => ({
			eq: vi.fn(() => Promise.resolve({ error: null })),
		}));
		mockChain.delete.mockImplementation(() => ({
			eq: vi.fn(() => Promise.resolve({ error: null })),
		}));
		mockChain.insert.mockImplementation((rows: unknown) => {
			insertedExerciseRows = rows as Array<Record<string, unknown>>;
			return Promise.resolve({ error: null });
		});

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

		expect(insertedExerciseRows).toHaveLength(1);
		expect(insertedExerciseRows[0]?.weight).toBe(baseExercise.weight / 2);
		expect(insertedExerciseRows[0]?.per_set_weights).toEqual([50, 55, 60]);
	});

	it("shows user-friendly error on update failure", async () => {
		const { useUpdateRoutine } = await import("../routines");

		mockChain.update.mockImplementation(() => ({
			eq: vi.fn(() =>
				Promise.resolve({
					error: {
						message: "new row violates check constraint",
						code: "23514",
					},
				}),
			),
		}));

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

	it("calls Supabase update with is_favorite and invalidates user-specific cache", async () => {
		const { useToggleFavorite } = await import("../routines");

		const eqSecond = vi.fn(() => Promise.resolve({ error: null }));
		const eqFirst = vi.fn(() => ({ eq: eqSecond }));
		mockChain.update.mockImplementation(() => ({ eq: eqFirst }));

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useToggleFavorite(), { wrapper });

		result.current.mutate({ routineId: "routine-1", isFavorite: true });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("routines");
		// Should invalidate all routines cache (prefix invalidation for profile filtering)
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.routines.all,
		});
	});
});
