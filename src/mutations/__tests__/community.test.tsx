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
	select: vi.fn(),
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

// ---------------------------------------------------------------------------
// useVote
// ---------------------------------------------------------------------------

describe("useVote", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("adds a vote when none exists and invalidates community caches", async () => {
		const { useVote } = await import("../community");

		// select chain: no existing vote
		const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
		const eqItemType = vi.fn(() => ({ maybeSingle }));
		const eqItemId = vi.fn(() => ({ eq: eqItemType }));
		const eqUserId = vi.fn(() => ({ eq: eqItemId }));
		mockChain.select.mockReturnValue({ eq: eqUserId });
		// insert for new vote
		mockChain.insert.mockResolvedValue({ error: null });

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useVote(), { wrapper });

		result.current.mutate({ itemId: "item-1", itemType: "routine" });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("community_votes");
		expect(mockChain.insert).toHaveBeenCalled();
		expect(result.current.data).toEqual({ action: "added" });
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.community.all,
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.community.votes("test-user-id"),
		});
	});

	it("removes a vote when one already exists", async () => {
		const { useVote } = await import("../community");

		// select chain: existing vote found
		const maybeSingle = vi.fn().mockResolvedValue({
			data: { id: "vote-1" },
			error: null,
		});
		const eqItemType = vi.fn(() => ({ maybeSingle }));
		const eqItemId = vi.fn(() => ({ eq: eqItemType }));
		const eqUserId = vi.fn(() => ({ eq: eqItemId }));
		mockChain.select.mockReturnValue({ eq: eqUserId });
		// delete for removing vote
		mockChain.delete.mockImplementation(() => ({
			eq: vi.fn(() => Promise.resolve({ error: null })),
		}));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useVote(), { wrapper });

		result.current.mutate({ itemId: "item-1", itemType: "routine" });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(result.current.data).toEqual({ action: "removed" });
	});
});

// ---------------------------------------------------------------------------
// useShareContent
// ---------------------------------------------------------------------------

describe("useShareContent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("inserts into shared_routines for routine type and invalidates feed", async () => {
		const { useShareContent } = await import("../community");

		const single = vi.fn().mockResolvedValue({
			data: {
				id: "routine-1",
				user_id: "test-user-id",
				name: "Source Routine",
				description: "Source description",
				exercise_count: 1,
				estimated_duration: 2700,
				tags: ["Chest"],
				routine_exercises: [
					{
						name: "Bench Press",
						muscle_group: "Chest",
						exercise_id: null,
						sets: 3,
						reps: 8,
						weight: 40,
						rest_seconds: 90,
						duration_seconds: null,
						mode: "OLD_SCHOOL",
						order_index: 0,
						superset_id: null,
						superset_color: null,
						superset_order: null,
						per_set_weights: null,
						per_set_rest: null,
						per_set_reps: null,
						per_set_echo_levels: null,
						is_amrap: false,
						is_bodyweight: false,
						pr_percentage: null,
						rep_count_timing: null,
						stop_at_position: null,
						stall_detection: true,
						eccentric_load: null,
						echo_level: null,
						warmup_sets: null,
						drop_set_enabled: true,
						drop_set_min_weight_kg: 12.5,
					},
				],
			},
			error: null,
		});
		const order = vi.fn(() => ({ single }));
		const eqUserId = vi.fn(() => ({ order }));
		const eqRoutineId = vi.fn(() => ({ eq: eqUserId }));
		mockChain.select.mockReturnValue({ eq: eqRoutineId });
		mockChain.insert.mockResolvedValue({ error: null });

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useShareContent(), { wrapper });

		result.current.mutate({
			type: "routine",
			sourceId: "routine-1",
			name: "My Routine",
			description: "Shared routine",
			tags: ["Chest"],
			difficulty: "Intermediate",
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("shared_routines");
		expect(mockChain.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				exercise_count: 1,
				estimated_duration: 45,
				exercises_snapshot: [
					expect.objectContaining({
						name: "Bench Press",
						weight: 40,
						drop_set_enabled: true,
						drop_set_min_weight_kg: 12.5,
					}),
				],
			}),
		);
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.community.all,
		});
	});

	it("converts short raw routine durations from seconds to shared minutes", async () => {
		const { useShareContent } = await import("../community");

		const single = vi.fn().mockResolvedValue({
			data: {
				id: "routine-1",
				user_id: "test-user-id",
				name: "Short Routine",
				description: "Source description",
				exercise_count: 1,
				estimated_duration: 150,
				tags: [],
				routine_exercises: [],
			},
			error: null,
		});
		const order = vi.fn(() => ({ single }));
		const eqUserId = vi.fn(() => ({ order }));
		const eqRoutineId = vi.fn(() => ({ eq: eqUserId }));
		mockChain.select.mockReturnValue({ eq: eqRoutineId });
		mockChain.insert.mockResolvedValue({ error: null });

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useShareContent(), { wrapper });

		result.current.mutate({
			type: "routine",
			sourceId: "routine-1",
			name: "Short Routine",
			description: "Shared routine",
			tags: [],
			difficulty: "Beginner",
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mockChain.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				estimated_duration: 3,
			}),
		);
	});

	it("inserts into shared_cycles for cycle type", async () => {
		const { useShareContent } = await import("../community");

		const cycleSingle = vi.fn().mockResolvedValue({
			data: {
				id: "cycle-1",
				user_id: "test-user-id",
				name: "Source Cycle",
				description: "Cycle source",
				duration_weeks: 7,
				workout_days: 1,
				rest_days: 1,
				progression_settings: { type: "percentage" },
				deload_settings: null,
				cycle_days: [
					{
						day_number: 1,
						day_type: "workout",
						routine_id: "routine-1",
						weight_adjustment: 5,
						rep_modifier: 0,
						rest_override: null,
						notes: "Push day",
						rest_type: null,
					},
					{
						day_number: 2,
						day_type: "rest",
						routine_id: null,
						weight_adjustment: 0,
						rep_modifier: 0,
						rest_override: null,
						notes: null,
						rest_type: "complete",
					},
				],
			},
			error: null,
		});
		const cycleOrder = vi.fn(() => ({ single: cycleSingle }));
		const cycleEqUserId = vi.fn(() => ({ order: cycleOrder }));
		const cycleEqId = vi.fn(() => ({ eq: cycleEqUserId }));
		const routinesOrder = vi.fn().mockResolvedValue({
			data: [
				{
					id: "routine-1",
					user_id: "test-user-id",
					name: "Push Routine",
					description: "Push",
					exercise_count: 1,
					estimated_duration: 2700,
					tags: ["Chest"],
					routine_exercises: [],
				},
			],
			error: null,
		});
		const routinesIn = vi.fn(() => ({ order: routinesOrder }));
		const routinesEqUserId = vi.fn(() => ({ in: routinesIn }));
		mockChain.select
			.mockReturnValueOnce({ eq: cycleEqId })
			.mockReturnValueOnce({ eq: routinesEqUserId });
		mockChain.insert.mockResolvedValue({ error: null });

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useShareContent(), { wrapper });

		result.current.mutate({
			type: "cycle",
			sourceId: "cycle-1",
			name: "My Cycle",
			description: "Shared cycle",
			tags: ["Strength"],
			difficulty: "Advanced",
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("shared_cycles");
		expect(mockChain.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				duration_weeks: 7,
				cycle_snapshot: expect.objectContaining({
					duration_weeks: 7,
					days: expect.arrayContaining([
						expect.objectContaining({
							day_number: 1,
							routine: expect.objectContaining({ name: "Push Routine" }),
						}),
					]),
				}),
			}),
		);
	});

	it("shows user-friendly error on share failure", async () => {
		const { useShareContent } = await import("../community");

		const single = vi.fn().mockResolvedValue({
			data: {
				id: "routine-1",
				user_id: "test-user-id",
				name: "Source Routine",
				description: "",
				exercise_count: 0,
				estimated_duration: 0,
				tags: [],
				routine_exercises: [],
			},
			error: null,
		});
		const order = vi.fn(() => ({ single }));
		const eqUserId = vi.fn(() => ({ order }));
		const eqRoutineId = vi.fn(() => ({ eq: eqUserId }));
		mockChain.select.mockReturnValue({ eq: eqRoutineId });
		mockChain.insert.mockResolvedValue({
			error: { message: "already shared this routine", code: "23505" },
		});

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useShareContent(), { wrapper });

		result.current.mutate({
			type: "routine",
			sourceId: "routine-1",
			name: "Dup",
			description: "",
			tags: [],
			difficulty: "Beginner",
		});

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to share content. Please try again.",
		);
	});
});

// ---------------------------------------------------------------------------
// useReportContent
// ---------------------------------------------------------------------------

describe("useReportContent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("submits a report and shows success toast", async () => {
		const { useReportContent } = await import("../community");

		mockChain.insert.mockResolvedValue({ error: null });

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useReportContent(), { wrapper });

		result.current.mutate({
			contentId: "content-1",
			contentType: "routine",
			category: "spam",
			description: "This is spam",
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("content_reports");
		expect(mockToast.success).toHaveBeenCalledWith(
			"Report submitted. Thank you for keeping the community safe.",
		);
	});

	it("shows 'already reported' error for duplicate report (23505)", async () => {
		const { useReportContent } = await import("../community");

		mockChain.insert.mockResolvedValue({
			error: {
				message: "duplicate key value violates unique constraint",
				code: "23505",
			},
		});

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useReportContent(), { wrapper });

		result.current.mutate({
			contentId: "content-1",
			contentType: "routine",
			category: "spam",
		});

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"You have already reported this content.",
		);
	});

	it("shows generic error for non-duplicate failures", async () => {
		const { useReportContent } = await import("../community");

		mockChain.insert.mockResolvedValue({
			error: { message: "network timeout", code: "PGRST301" },
		});

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useReportContent(), { wrapper });

		result.current.mutate({
			contentId: "content-1",
			contentType: "comment",
			category: "harmful_content",
		});

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to submit report. Please try again.",
		);
	});
});

// ---------------------------------------------------------------------------
// useBlockUser
// ---------------------------------------------------------------------------

describe("useBlockUser", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("inserts block record and invalidates community, comments, and blocks caches", async () => {
		const { useBlockUser } = await import("../community");

		mockChain.insert.mockResolvedValue({ error: null });

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useBlockUser(), { wrapper });

		result.current.mutate({ blockedId: "other-user-id" });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("user_blocks");
		expect(mockToast.success).toHaveBeenCalledWith("User blocked");
		// Should invalidate three cache families
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.community.all,
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.comments.all,
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.community.blocks("test-user-id"),
		});
	});

	it("prevents blocking yourself", async () => {
		const { useBlockUser } = await import("../community");

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useBlockUser(), { wrapper });

		result.current.mutate({ blockedId: "test-user-id" }); // same as current user

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to block user. Please try again.",
		);
	});

	it("shows user-friendly error on block failure", async () => {
		const { useBlockUser } = await import("../community");

		mockChain.insert.mockResolvedValue({
			error: { message: "duplicate key value violates unique constraint" },
		});

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useBlockUser(), { wrapper });

		result.current.mutate({ blockedId: "other-user-id" });

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to block user. Please try again.",
		);
	});
});

// ---------------------------------------------------------------------------
// useUnblockUser
// ---------------------------------------------------------------------------

describe("useUnblockUser", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("deletes block record and invalidates caches", async () => {
		const { useUnblockUser } = await import("../community");

		const eqBlocked = vi.fn(() => Promise.resolve({ error: null }));
		const eqBlocker = vi.fn(() => ({ eq: eqBlocked }));
		mockChain.delete.mockImplementation(() => ({ eq: eqBlocker }));

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useUnblockUser(), { wrapper });

		result.current.mutate({ blockedId: "other-user-id" });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("user_blocks");
		expect(mockToast.success).toHaveBeenCalledWith("User unblocked");
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.community.all,
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.comments.all,
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.community.blocks("test-user-id"),
		});
	});
});

// ---------------------------------------------------------------------------
// useDeleteSharedContent
// ---------------------------------------------------------------------------

describe("useDeleteSharedContent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("deletes shared routine and invalidates community feed", async () => {
		const { useDeleteSharedContent } = await import("../community");

		const maybeSingle = vi.fn(() =>
			Promise.resolve({ data: { id: "shared-x" }, error: null }),
		);
		const select = vi.fn(() => ({ maybeSingle }));
		const eqUserId = vi.fn(() => ({ select }));
		const eqId = vi.fn(() => ({ eq: eqUserId }));
		mockChain.delete.mockImplementation(() => ({ eq: eqId }));

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useDeleteSharedContent(), { wrapper });

		result.current.mutate({ contentId: "shared-1", contentType: "routine" });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("shared_routines");
		expect(mockToast.success).toHaveBeenCalledWith(
			"Content removed from community",
		);
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.community.all,
		});
	});

	it("deletes shared cycle when contentType is cycle", async () => {
		const { useDeleteSharedContent } = await import("../community");

		const maybeSingle = vi.fn(() =>
			Promise.resolve({ data: { id: "shared-x" }, error: null }),
		);
		const select = vi.fn(() => ({ maybeSingle }));
		const eqUserId = vi.fn(() => ({ select }));
		const eqId = vi.fn(() => ({ eq: eqUserId }));
		mockChain.delete.mockImplementation(() => ({ eq: eqId }));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useDeleteSharedContent(), { wrapper });

		result.current.mutate({ contentId: "shared-2", contentType: "cycle" });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("shared_cycles");
	});

	it("shows user-friendly error on delete failure", async () => {
		const { useDeleteSharedContent } = await import("../community");

		const maybeSingle = vi.fn(() =>
			Promise.resolve({
				data: null,
				error: { message: "RLS policy violation" },
			}),
		);
		const select = vi.fn(() => ({ maybeSingle }));
		const eqUserId = vi.fn(() => ({ select }));
		const eqId = vi.fn(() => ({ eq: eqUserId }));
		mockChain.delete.mockImplementation(() => ({ eq: eqId }));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useDeleteSharedContent(), { wrapper });

		result.current.mutate({ contentId: "shared-1", contentType: "routine" });

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to remove content. Please try again.",
		);
	});
});

// ---------------------------------------------------------------------------
// useSaveItem
// ---------------------------------------------------------------------------

describe("useSaveItem", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("imports a routine into the personal library and invalidates affected caches", async () => {
		const { useSaveItem } = await import("../community");

		rpc.mockResolvedValue({ data: "imported-routine-1", error: null });

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useSaveItem(), { wrapper });

		result.current.mutate({ sharedItemId: "shared-1", itemType: "routine" });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(rpc).toHaveBeenCalledWith("import_shared_routine", {
			p_shared_routine_id: "shared-1",
			p_local_profile_id: null,
		});
		expect(result.current.data).toEqual({
			action: "imported",
			importedId: "imported-routine-1",
			itemType: "routine",
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.community.saves("test-user-id"),
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.community.all,
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.routines.all,
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.cycles.all,
		});
	});

	it("imports a cycle through the cycle import RPC", async () => {
		const { useSaveItem } = await import("../community");

		rpc.mockResolvedValue({ data: "imported-cycle-1", error: null });

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useSaveItem(), { wrapper });

		result.current.mutate({ sharedItemId: "shared-2", itemType: "cycle" });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(rpc).toHaveBeenCalledWith("import_shared_cycle", {
			p_shared_cycle_id: "shared-2",
			p_local_profile_id: null,
		});
		expect(result.current.data).toEqual({
			action: "imported",
			importedId: "imported-cycle-1",
			itemType: "cycle",
		});
	});
});
