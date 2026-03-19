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

const mockToast = { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() };
vi.mock("sonner", () => ({ toast: mockToast }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
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
			exerciseCount: 5,
			estimatedDuration: 45,
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("shared_routines");
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.community.all });
	});

	it("inserts into shared_cycles for cycle type", async () => {
		const { useShareContent } = await import("../community");

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
			durationWeeks: 6,
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("shared_cycles");
	});

	it("shows user-friendly error on share failure", async () => {
		const { useShareContent } = await import("../community");

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
			error: { message: "duplicate key value violates unique constraint", code: "23505" },
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

		const eqUserId = vi.fn(() => Promise.resolve({ error: null }));
		const eqId = vi.fn(() => ({ eq: eqUserId }));
		mockChain.delete.mockImplementation(() => ({ eq: eqId }));

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useDeleteSharedContent(), { wrapper });

		result.current.mutate({ contentId: "shared-1", contentType: "routine" });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("shared_routines");
		expect(mockToast.success).toHaveBeenCalledWith("Content removed from community");
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.community.all });
	});

	it("deletes shared cycle when contentType is cycle", async () => {
		const { useDeleteSharedContent } = await import("../community");

		const eqUserId = vi.fn(() => Promise.resolve({ error: null }));
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

		const eqUserId = vi.fn(() =>
			Promise.resolve({ error: { message: "RLS policy violation" } }),
		);
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

	it("saves an item when not already saved and invalidates saves cache", async () => {
		const { useSaveItem } = await import("../community");

		// select chain: not saved yet
		const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
		const eqItemType = vi.fn(() => ({ maybeSingle }));
		const eqSharedItemId = vi.fn(() => ({ eq: eqItemType }));
		const eqUserId = vi.fn(() => ({ eq: eqSharedItemId }));
		mockChain.select.mockReturnValue({ eq: eqUserId });
		mockChain.insert.mockResolvedValue({ error: null });

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useSaveItem(), { wrapper });

		result.current.mutate({ sharedItemId: "shared-1", itemType: "routine" });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("saved_community_items");
		expect(result.current.data).toEqual({ action: "saved" });
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.community.saves("test-user-id"),
		});
	});

	it("unsaves an item when already saved", async () => {
		const { useSaveItem } = await import("../community");

		// select chain: already saved
		const maybeSingle = vi.fn().mockResolvedValue({
			data: { id: "save-1" },
			error: null,
		});
		const eqItemType = vi.fn(() => ({ maybeSingle }));
		const eqSharedItemId = vi.fn(() => ({ eq: eqItemType }));
		const eqUserId = vi.fn(() => ({ eq: eqSharedItemId }));
		mockChain.select.mockReturnValue({ eq: eqUserId });
		mockChain.delete.mockImplementation(() => ({
			eq: vi.fn(() => Promise.resolve({ error: null })),
		}));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useSaveItem(), { wrapper });

		result.current.mutate({ sharedItemId: "shared-1", itemType: "routine" });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(result.current.data).toEqual({ action: "unsaved" });
	});
});
