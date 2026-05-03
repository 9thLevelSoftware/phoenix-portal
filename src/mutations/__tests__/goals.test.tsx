import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const _mockSelectSingle = vi.fn();

const mockChain = {
	insert: vi.fn(),
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

// ---------------------------------------------------------------------------
// useCreateGoal
// ---------------------------------------------------------------------------

describe("useCreateGoal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("inserts a goal and invalidates goals cache", async () => {
		const { useCreateGoal } = await import("../goals");

		mockChain.insert.mockImplementation(() => ({
			select: vi.fn(() => ({
				single: vi.fn().mockResolvedValue({
					data: { id: "goal-1", goal_type: "frequency", target_value: 4 },
					error: null,
				}),
			})),
		}));

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useCreateGoal(), { wrapper });

		result.current.mutate({
			goal_type: "frequency",
			target_value: 4,
			target_unit: "sessions",
			period: "weekly",
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("user_goals");
		expect(mockToast.success).toHaveBeenCalledWith("Goal created");
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.goals.all,
		});
	});

	it("shows tier-specific error for goal limit exceeded (P0001)", async () => {
		const { useCreateGoal } = await import("../goals");

		mockChain.insert.mockImplementation(() => ({
			select: vi.fn(() => ({
				single: vi.fn().mockResolvedValue({
					data: null,
					error: { message: "raise_exception: goal limit", code: "P0001" },
				}),
			})),
		}));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useCreateGoal(), { wrapper });

		result.current.mutate({
			goal_type: "volume",
			target_value: 10000,
			target_unit: "kg",
			period: "monthly",
		});

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Goal limit reached for your subscription tier.",
		);
	});

	it("shows generic error for non-limit failures", async () => {
		const { useCreateGoal } = await import("../goals");

		mockChain.insert.mockImplementation(() => ({
			select: vi.fn(() => ({
				single: vi.fn().mockResolvedValue({
					data: null,
					error: {
						message: "violates check constraint on target_value",
						code: "23514",
					},
				}),
			})),
		}));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useCreateGoal(), { wrapper });

		result.current.mutate({
			goal_type: "pr",
			target_value: -1,
			target_unit: "kg",
			exercise_name: "Bench Press",
		});

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to create goal. Please try again.",
		);
		expect(mockToast.error).not.toHaveBeenCalledWith(
			expect.stringContaining("check constraint"),
		);
	});

	it("includes optional fields in the insert payload", async () => {
		const { useCreateGoal } = await import("../goals");

		let capturedPayload: Record<string, unknown> | null = null;

		mockChain.insert.mockImplementation((payload: Record<string, unknown>) => {
			capturedPayload = payload;
			return {
				select: vi.fn(() => ({
					single: vi.fn().mockResolvedValue({
						data: { id: "goal-2" },
						error: null,
					}),
				})),
			};
		});

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useCreateGoal(), { wrapper });

		result.current.mutate({
			goal_type: "pr",
			target_value: 150,
			target_unit: "kg",
			exercise_name: "Squat",
			exercise_id: "catalog-squat",
			deadline: "2026-06-01",
			period: "monthly",
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(capturedPayload).not.toBeNull();
		expect(capturedPayload?.exercise_name).toBe("Squat");
		expect(capturedPayload?.exercise_id).toBe("catalog-squat");
		expect(capturedPayload?.deadline).toBe("2026-06-01");
		expect(capturedPayload?.period).toBe("monthly");
	});
});

// ---------------------------------------------------------------------------
// useUpdateGoal
// ---------------------------------------------------------------------------

describe("useUpdateGoal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("updates a goal and invalidates goals cache", async () => {
		const { useUpdateGoal } = await import("../goals");

		const selectSingle = vi.fn().mockResolvedValue({
			data: { id: "goal-1", target_value: 5 },
			error: null,
		});
		const selectFn = vi.fn(() => ({ single: selectSingle }));
		const eqUser = vi.fn(() => ({ select: selectFn }));
		const eqId = vi.fn(() => ({ eq: eqUser }));
		mockChain.update.mockImplementation(() => ({ eq: eqId }));

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useUpdateGoal(), { wrapper });

		result.current.mutate({
			goalId: "goal-1",
			updates: {
				target_value: 5,
				status: "completed",
				completed_at: "2026-03-18T00:00:00Z",
			},
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("user_goals");
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.goals.all,
		});
	});

	it("clears stale exercise_id when only exercise_name changes", async () => {
		const { useUpdateGoal } = await import("../goals");

		let capturedPayload: Record<string, unknown> | null = null;
		const selectSingle = vi.fn().mockResolvedValue({
			data: { id: "goal-1", exercise_name: "Deadlift" },
			error: null,
		});
		const selectFn = vi.fn(() => ({ single: selectSingle }));
		const eqUser = vi.fn(() => ({ select: selectFn }));
		const eqId = vi.fn(() => ({ eq: eqUser }));
		mockChain.update.mockImplementation((payload: Record<string, unknown>) => {
			capturedPayload = payload;
			return { eq: eqId };
		});

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useUpdateGoal(), { wrapper });

		result.current.mutate({
			goalId: "goal-1",
			updates: { exercise_name: "Deadlift" },
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(capturedPayload?.exercise_name).toBe("Deadlift");
		expect(capturedPayload?.exercise_id).toBeNull();
	});

	it("shows user-friendly error on update failure", async () => {
		const { useUpdateGoal } = await import("../goals");

		const selectSingle = vi.fn().mockResolvedValue({
			data: null,
			error: { message: "PGRST116: no rows found" },
		});
		const selectFn = vi.fn(() => ({ single: selectSingle }));
		const eqUser = vi.fn(() => ({ select: selectFn }));
		const eqId = vi.fn(() => ({ eq: eqUser }));
		mockChain.update.mockImplementation(() => ({ eq: eqId }));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useUpdateGoal(), { wrapper });

		result.current.mutate({
			goalId: "nonexistent",
			updates: { target_value: 10 },
		});

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to update goal. Please try again.",
		);
	});
});

// ---------------------------------------------------------------------------
// useArchiveGoal
// ---------------------------------------------------------------------------

describe("useArchiveGoal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("archives a goal by setting status to 'archived' and invalidates cache", async () => {
		const { useArchiveGoal } = await import("../goals");

		const eqUser = vi.fn(() => Promise.resolve({ error: null }));
		const eqId = vi.fn(() => ({ eq: eqUser }));
		mockChain.update.mockImplementation(() => ({ eq: eqId }));

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useArchiveGoal(), { wrapper });

		result.current.mutate("goal-1");

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("user_goals");
		expect(mockToast.success).toHaveBeenCalledWith("Goal archived");
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.goals.all,
		});
	});

	it("shows user-friendly error on archive failure", async () => {
		const { useArchiveGoal } = await import("../goals");

		const eqUser = vi.fn(() =>
			Promise.resolve({ error: { message: "permission denied for relation" } }),
		);
		const eqId = vi.fn(() => ({ eq: eqUser }));
		mockChain.update.mockImplementation(() => ({ eq: eqId }));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useArchiveGoal(), { wrapper });

		result.current.mutate("goal-1");

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to archive goal. Please try again.",
		);
	});
});
