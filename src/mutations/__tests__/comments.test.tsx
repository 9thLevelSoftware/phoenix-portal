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
// useCreateComment
// ---------------------------------------------------------------------------

describe("useCreateComment", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("inserts a comment and invalidates the correct caches", async () => {
		const { useCreateComment } = await import("../comments");

		mockChain.insert.mockResolvedValue({ error: null });

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useCreateComment(), { wrapper });

		result.current.mutate({
			itemId: "item-1",
			itemType: "routine",
			body: "Great routine!",
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("community_comments");
		expect(mockToast.success).toHaveBeenCalledWith("Comment posted");
		// Should invalidate both item-specific comments and community feed
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.comments.byItem("item-1"),
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.community.all,
		});
	});

	it("shows rate-limit-specific error when rate limit hit", async () => {
		const { useCreateComment } = await import("../comments");

		mockChain.insert.mockResolvedValue({
			error: { message: "Rate limit exceeded: 5 comments per hour", code: "P0001" },
		});

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useCreateComment(), { wrapper });

		result.current.mutate({
			itemId: "item-1",
			itemType: "routine",
			body: "Spamming...",
		});

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"You can post up to 5 comments per hour. Please wait and try again.",
		);
	});

	it("shows generic user-friendly error for other failures", async () => {
		const { useCreateComment } = await import("../comments");

		mockChain.insert.mockResolvedValue({
			error: { message: "violates foreign key constraint", code: "23503" },
		});

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useCreateComment(), { wrapper });

		result.current.mutate({
			itemId: "nonexistent",
			itemType: "cycle",
			body: "Test",
		});

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to post comment. Please try again.",
		);
		// Raw error must NOT appear in toast
		expect(mockToast.error).not.toHaveBeenCalledWith(
			expect.stringContaining("foreign key"),
		);
	});
});

// ---------------------------------------------------------------------------
// useUpdateComment
// ---------------------------------------------------------------------------

describe("useUpdateComment", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("updates comment within edit window and invalidates cache", async () => {
		const { useUpdateComment } = await import("../comments");

		const eqGte = vi.fn(() => Promise.resolve({ error: null, count: 1 }));
		const eqUserId = vi.fn(() => ({ gte: eqGte }));
		const eqId = vi.fn(() => ({ eq: eqUserId }));
		mockChain.update.mockImplementation(() => ({ eq: eqId }));

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useUpdateComment(), { wrapper });

		result.current.mutate({
			commentId: "comment-1",
			itemId: "item-1",
			body: "Edited comment",
			createdAt: new Date(), // Just created, well within 5 minutes
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("community_comments");
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.comments.byItem("item-1"),
		});
	});

	it("rejects edits outside the 5-minute window with specific error", async () => {
		const { useUpdateComment } = await import("../comments");

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useUpdateComment(), { wrapper });

		result.current.mutate({
			commentId: "comment-1",
			itemId: "item-1",
			body: "Late edit",
			createdAt: new Date(Date.now() - 6 * 60 * 1000), // 6 minutes ago
		});

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Edit window has expired. Comments can only be edited within 5 minutes.",
		);
	});

	it("shows generic error when Supabase update fails", async () => {
		const { useUpdateComment } = await import("../comments");

		const eqGte = vi.fn(() =>
			Promise.resolve({ error: { message: "permission denied" }, count: null }),
		);
		const eqUserId = vi.fn(() => ({ gte: eqGte }));
		const eqId = vi.fn(() => ({ eq: eqUserId }));
		mockChain.update.mockImplementation(() => ({ eq: eqId }));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useUpdateComment(), { wrapper });

		result.current.mutate({
			commentId: "comment-1",
			itemId: "item-1",
			body: "Edited",
			createdAt: new Date(), // Within window
		});

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to update comment. Please try again.",
		);
	});
});

// ---------------------------------------------------------------------------
// useDeleteComment
// ---------------------------------------------------------------------------

describe("useDeleteComment", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("soft-deletes comment via update and invalidates caches", async () => {
		const { useDeleteComment } = await import("../comments");

		const eqUserId = vi.fn(() => Promise.resolve({ error: null }));
		const eqId = vi.fn(() => ({ eq: eqUserId }));
		mockChain.update.mockImplementation(() => ({ eq: eqId }));

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useDeleteComment(), { wrapper });

		result.current.mutate({ commentId: "comment-1", itemId: "item-1" });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		// Soft delete uses update, not delete
		expect(from).toHaveBeenCalledWith("community_comments");
		expect(mockChain.update).toHaveBeenCalled();
		expect(mockToast.success).toHaveBeenCalledWith("Comment deleted");
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.comments.byItem("item-1"),
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.community.all,
		});
	});

	it("shows user-friendly error on delete failure", async () => {
		const { useDeleteComment } = await import("../comments");

		const eqUserId = vi.fn(() =>
			Promise.resolve({ error: { message: "row-level security violation" } }),
		);
		const eqId = vi.fn(() => ({ eq: eqUserId }));
		mockChain.update.mockImplementation(() => ({ eq: eqId }));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useDeleteComment(), { wrapper });

		result.current.mutate({ commentId: "comment-1", itemId: "item-1" });

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to delete comment. Please try again.",
		);
	});
});
