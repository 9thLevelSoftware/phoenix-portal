import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockChain = {
	update: vi.fn(),
	delete: vi.fn(),
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

/** Ids of rows that already exist, as the builder loads them. */
const DAY_ID_A = "33333333-3333-4333-8333-333333333333";

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

	it("creates the cycle and its days in one atomic RPC call", async () => {
		const { useSaveCycle } = await import("../cycles");

		rpc.mockResolvedValue({ data: "cycle-1", error: null });

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useSaveCycle(), { wrapper });

		result.current.mutate(baseCycleInput);

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		// One transactional RPC, not a parent insert followed by a child insert
		// and a best-effort compensating delete.
		expect(rpc).toHaveBeenCalledTimes(1);
		expect(rpc).toHaveBeenCalledWith(
			"create_cycle_with_days",
			expect.objectContaining({
				p_name: "Strength Block",
				p_duration_weeks: 4,
				// NULL means the default profile. `local_profile_id` carries a
				// composite FK to local_profiles(user_id, id), so a "default"
				// sentinel string would be a foreign-key violation.
				p_local_profile_id: null,
			}),
		);
		expect(from).not.toHaveBeenCalled();
		expect(result.current.data).toEqual({ id: "cycle-1" });
		expect(mockToast.success).toHaveBeenCalledWith("Training cycle saved");
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.cycles.all,
		});
	});

	it("counts workout and rest days correctly", async () => {
		const { useSaveCycle } = await import("../cycles");

		let capturedArgs: Record<string, unknown> | null = null;

		rpc.mockImplementation((_fn: string, args: Record<string, unknown>) => {
			capturedArgs = args;
			return Promise.resolve({ data: "cycle-1", error: null });
		});

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useSaveCycle(), { wrapper });

		result.current.mutate(baseCycleInput);

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(capturedArgs).not.toBeNull();
		expect(capturedArgs?.p_workout_days).toBe(1);
		expect(capturedArgs?.p_rest_days).toBe(1);
	});

	it("never sends client-minted day ids on create", async () => {
		// The create RPC ignores payload ids (it has no parent that could own
		// them yet), so sending any would be misleading.
		const { useSaveCycle } = await import("../cycles");
		let dayRows: Array<Record<string, unknown>> = [];

		rpc.mockImplementation(
			(_fn: string, args: { p_days: Array<Record<string, unknown>> }) => {
				dayRows = args.p_days;
				return Promise.resolve({ data: "cycle-1", error: null });
			},
		);

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useSaveCycle(), { wrapper });

		result.current.mutate({
			...baseCycleInput,
			days: baseCycleInput.days.map((day) => ({ ...day, id: DAY_ID_A })),
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(dayRows).toHaveLength(2);
		for (const row of dayRows) {
			expect(row).not.toHaveProperty("id");
		}
	});

	it("shows user-friendly error on failure", async () => {
		const { useSaveCycle } = await import("../cycles");

		rpc.mockResolvedValue({
			data: null,
			error: {
				message: 'new row for relation "training_cycles" violates constraint',
				code: "23514",
			},
		});

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useSaveCycle(), { wrapper });

		result.current.mutate(baseCycleInput);

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to save training cycle. Please try again.",
		);
		expect(mockToast.error).not.toHaveBeenCalledWith(
			expect.stringContaining("violates constraint"),
		);
	});

	it("explains a server-side tier denial instead of saying 'try again'", async () => {
		// Cycle authoring is FLAME-only and enforced server-side, so a plan that
		// lapsed while the builder was open lands here. Retrying can't help.
		const { useSaveCycle } = await import("../cycles");
		const { TIER_DENIED_MESSAGE } = await import("@/lib/tierErrors");

		rpc.mockResolvedValue({
			data: null,
			error: {
				code: "42501",
				message: 'new row for relation "training_cycles" violates RLS policy',
			},
		});

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useSaveCycle(), { wrapper });

		result.current.mutate(baseCycleInput);

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(TIER_DENIED_MESSAGE);
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.subscription.all,
		});
	});
});

describe("useUpdateCycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("updates the cycle and its days atomically via RPC", async () => {
		const { useUpdateCycle } = await import("../cycles");

		rpc.mockResolvedValue({ data: "cycle-1", error: null });

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useUpdateCycle(), { wrapper });

		result.current.mutate({ ...baseCycleInput, cycleId: "cycle-1" });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(rpc).toHaveBeenCalledWith(
			"update_cycle_with_days",
			expect.objectContaining({ p_cycle_id: "cycle-1" }),
		);
		expect(mockToast.success).toHaveBeenCalledWith("Training cycle updated");
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.cycles.all,
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.cycles.detail("cycle-1"),
		});
	});

	it("sends existing day ids so the rows survive the edit", async () => {
		// Before this, every save deleted and re-inserted cycle_days with fresh
		// uuids, so any reference mobile held to a day was broken on every edit.
		const { useUpdateCycle } = await import("../cycles");
		let dayRows: Array<Record<string, unknown>> = [];

		rpc.mockImplementation(
			(_fn: string, args: { p_days: Array<Record<string, unknown>> }) => {
				dayRows = args.p_days;
				return Promise.resolve({ data: "cycle-1", error: null });
			},
		);

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useUpdateCycle(), { wrapper });

		result.current.mutate({
			...baseCycleInput,
			cycleId: "cycle-1",
			days: [
				// Loaded from the cycle.
				{ ...baseCycleInput.days[0], id: DAY_ID_A },
				// Added in this editing session: the server mints its id.
				baseCycleInput.days[1],
			],
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(dayRows).toHaveLength(2);
		expect(dayRows[0]?.id).toBe(DAY_ID_A);
		expect(dayRows[1]).not.toHaveProperty("id");
		// The RPC still needs to know which cycle the days belong to.
		expect(dayRows[0]?.cycle_id).toBe("cycle-1");
	});

	it("shows user-friendly error on update failure", async () => {
		const { useUpdateCycle } = await import("../cycles");

		rpc.mockResolvedValue({
			data: null,
			error: { message: "cycle_not_found_or_forbidden", code: "P0001" },
		});

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useUpdateCycle(), { wrapper });

		result.current.mutate({ ...baseCycleInput, cycleId: "cycle-1" });

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to update training cycle. Please try again.",
		);
	});

	it("explains a server-side tier denial instead of saying 'try again'", async () => {
		const { useUpdateCycle } = await import("../cycles");
		const { TIER_DENIED_MESSAGE } = await import("@/lib/tierErrors");

		rpc.mockResolvedValue({
			data: null,
			error: { message: "permission denied for table", code: "42501" },
		});

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useUpdateCycle(), { wrapper });

		result.current.mutate({ ...baseCycleInput, cycleId: "cycle-1" });

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(TIER_DENIED_MESSAGE);
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.subscription.all,
		});
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
				maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
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
				maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
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

		const maybeSingle = vi.fn(() =>
			Promise.resolve({
				data: null,
				error: { message: "permission denied for table", code: "42501" },
			}),
		);
		const select = vi.fn(() => ({ maybeSingle }));
		const eqSecond = vi.fn(() => ({ select }));
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
