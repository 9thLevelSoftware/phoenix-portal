import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockChain = {
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn(),
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

const baseCycleInput = {
	name: "Strength Block",
	description: "4-week strength block",
	duration_weeks: 4,
	days: [
		{
			day_number: 1,
			day_type: "workout",
			routine_id: "routine-1",
			weight_adjustment: 0,
			rep_modifier: 0,
		},
		{
			day_number: 2,
			day_type: "rest",
			weight_adjustment: 0,
			rep_modifier: 0,
		},
	],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSaveCycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("inserts cycle and cycle_days into Supabase on success", async () => {
		const { useSaveCycle } = await import("../cycles");

		mockChain.insert.mockImplementation((rows: unknown) => {
			if (Array.isArray(rows)) {
				// cycle_days insert
				return Promise.resolve({ error: null });
			}
			// training_cycles insert with .select().single()
			return {
				select: vi.fn(() => ({
					single: vi
						.fn()
						.mockResolvedValue({ data: { id: "cycle-1" }, error: null }),
				})),
			};
		});

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useSaveCycle(), { wrapper });

		result.current.mutate(baseCycleInput);

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("training_cycles");
		expect(from).toHaveBeenCalledWith("cycle_days");
		expect(mockToast.success).toHaveBeenCalledWith("Training cycle saved");
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.cycles.all,
		});
	});

	it("counts workout and rest days correctly", async () => {
		const { useSaveCycle } = await import("../cycles");

		let capturedInsertPayload: Record<string, unknown> | null = null;

		mockChain.insert.mockImplementation((rows: unknown) => {
			if (!Array.isArray(rows)) {
				capturedInsertPayload = rows as Record<string, unknown>;
				return {
					select: vi.fn(() => ({
						single: vi
							.fn()
							.mockResolvedValue({ data: { id: "cycle-1" }, error: null }),
					})),
				};
			}
			return Promise.resolve({ error: null });
		});

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useSaveCycle(), { wrapper });

		result.current.mutate(baseCycleInput);

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(capturedInsertPayload).not.toBeNull();
		expect(capturedInsertPayload!.workout_days).toBe(1);
		expect(capturedInsertPayload!.rest_days).toBe(1);
	});

	it("shows user-friendly error on failure", async () => {
		const { useSaveCycle } = await import("../cycles");

		mockChain.insert.mockImplementation(() => ({
			select: vi.fn(() => ({
				single: vi.fn().mockResolvedValue({
					data: null,
					error: {
						message: 'relation "training_cycles" violates RLS policy',
						code: "42501",
					},
				}),
			})),
		}));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useSaveCycle(), { wrapper });

		result.current.mutate(baseCycleInput);

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to save training cycle. Please try again.",
		);
		expect(mockToast.error).not.toHaveBeenCalledWith(
			expect.stringContaining("RLS policy"),
		);
	});
});

describe("useUpdateCycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("updates cycle, deletes old days, and inserts new days", async () => {
		const { useUpdateCycle } = await import("../cycles");

		const eqSecond = vi.fn(() => Promise.resolve({ error: null }));
		const eqFirst = vi.fn(() => ({ eq: eqSecond }));
		mockChain.update.mockImplementation(() => ({ eq: eqFirst }));
		mockChain.delete.mockImplementation(() => ({
			eq: vi.fn(() => Promise.resolve({ error: null })),
		}));
		mockChain.insert.mockImplementation(() => Promise.resolve({ error: null }));

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useUpdateCycle(), { wrapper });

		result.current.mutate({ ...baseCycleInput, cycleId: "cycle-1" });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("training_cycles");
		expect(from).toHaveBeenCalledWith("cycle_days");
		expect(mockToast.success).toHaveBeenCalledWith("Training cycle updated");
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.cycles.all,
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.cycles.detail("cycle-1"),
		});
	});

	it("shows user-friendly error on update failure", async () => {
		const { useUpdateCycle } = await import("../cycles");

		const eqSecond = vi.fn(() =>
			Promise.resolve({
				error: { message: "permission denied for table", code: "42501" },
			}),
		);
		const eqFirst = vi.fn(() => ({ eq: eqSecond }));
		mockChain.update.mockImplementation(() => ({ eq: eqFirst }));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useUpdateCycle(), { wrapper });

		result.current.mutate({ ...baseCycleInput, cycleId: "cycle-1" });

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to update training cycle. Please try again.",
		);
	});
});

describe("useDeleteCycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("deletes cycle successfully when cycle exists", async () => {
		const { useDeleteCycle } = await import("../cycles");

		const eqSecond = vi.fn(() => ({
			select: vi.fn(() => ({
				maybeSingle: vi
					.fn()
					.mockResolvedValue({ data: { id: "cycle-1" }, error: null }),
			})),
		}));
		const eqFirst = vi.fn(() => ({ eq: eqSecond }));
		mockChain.delete.mockImplementation(() => ({ eq: eqFirst }));

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useDeleteCycle(), { wrapper });

		result.current.mutate("cycle-1");

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("training_cycles");
		expect(mockToast.success).toHaveBeenCalledWith("Training cycle deleted");
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.cycles.all,
		});
	});

	it("throws error when cycle does not exist (no-op delete)", async () => {
		const { useDeleteCycle } = await import("../cycles");

		const eqSecond = vi.fn(() => ({
			select: vi.fn(() => ({
				maybeSingle: vi
					.fn()
					.mockResolvedValue({ data: null, error: null }),
			})),
		}));
		const eqFirst = vi.fn(() => ({ eq: eqSecond }));
		mockChain.delete.mockImplementation(() => ({ eq: eqFirst }));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useDeleteCycle(), { wrapper });

		result.current.mutate("nonexistent-cycle");

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to delete training cycle. Please try again.",
		);
		expect(result.current.error?.message).toContain(
			"Cycle not found or you don't have permission",
		);
	});

	it("throws error when user lacks permission to delete cycle", async () => {
		const { useDeleteCycle } = await import("../cycles");

		const eqSecond = vi.fn(() => ({
			select: vi.fn(() => ({
				maybeSingle: vi
					.fn()
					.mockResolvedValue({ data: null, error: null }),
			})),
		}));
		const eqFirst = vi.fn(() => ({ eq: eqSecond }));
		mockChain.delete.mockImplementation(() => ({ eq: eqFirst }));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useDeleteCycle(), { wrapper });

		result.current.mutate("other-users-cycle");

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to delete training cycle. Please try again.",
		);
	});

	it("shows user-friendly error on database error", async () => {
		const { useDeleteCycle } = await import("../cycles");

		const eqSecond = vi.fn(() =>
			Promise.resolve({
				error: { message: "permission denied for table", code: "42501" },
			}),
		);
		const eqFirst = vi.fn(() => ({ eq: eqSecond }));
		mockChain.delete.mockImplementation(() => ({ eq: eqFirst }));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useDeleteCycle(), { wrapper });

		result.current.mutate("cycle-1");

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to delete training cycle. Please try again.",
		);
	});
});
