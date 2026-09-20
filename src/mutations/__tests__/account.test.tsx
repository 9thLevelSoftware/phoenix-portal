import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockChain = {
	insert: vi.fn(),
	update: vi.fn(),
	select: vi.fn(),
};

const from = vi.fn(() => mockChain);
const mockInvoke = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/supabase", () => ({
	supabase: {
		from,
		functions: { invoke: mockInvoke },
		auth: { signOut: mockSignOut },
	},
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

const DELETION_REQUEST_KEY = "deletion-request";
const TEST_USER_ID = "test-user-id";

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
// useRequestDeletion
// ---------------------------------------------------------------------------

describe("useRequestDeletion", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("inserts a deletion request and invalidates the deletion-request cache", async () => {
		const { useRequestDeletion } = await import("../account");

		mockChain.insert.mockResolvedValue({ error: null });

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useRequestDeletion(TEST_USER_ID), {
			wrapper,
		});

		result.current.mutate();

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("deletion_requests");
		expect(mockChain.insert).toHaveBeenCalledWith({ user_id: TEST_USER_ID });
		expect(mockToast.success).toHaveBeenCalledWith(
			"Account deletion scheduled. You have 30 days to cancel.",
		);
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: [DELETION_REQUEST_KEY, TEST_USER_ID],
		});
	});

	it("shows user-friendly error on request failure", async () => {
		const { useRequestDeletion } = await import("../account");

		mockChain.insert.mockResolvedValue({
			error: { message: "duplicate key value violates unique constraint" },
		});

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useRequestDeletion(TEST_USER_ID), {
			wrapper,
		});

		result.current.mutate();

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to schedule account deletion. Please try again.",
		);
		expect(mockToast.error).not.toHaveBeenCalledWith(
			expect.stringContaining("duplicate key"),
		);
	});

	it("says a request already exists when the unique constraint refuses it", async () => {
		const { useRequestDeletion } = await import("../account");

		// UNIQUE(user_id): typically a request that is being executed right now.
		mockChain.insert.mockResolvedValue({
			error: Object.assign(new Error("duplicate key"), { code: "23505" }),
		});

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useRequestDeletion(TEST_USER_ID), {
			wrapper,
		});

		result.current.mutate();

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Your account already has a deletion request. Reload the page to see it.",
		);
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: [DELETION_REQUEST_KEY, TEST_USER_ID],
		});
	});
});

// ---------------------------------------------------------------------------
// useCancelDeletion
// ---------------------------------------------------------------------------

describe("useCancelDeletion", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("cancels a pending deletion and invalidates cache", async () => {
		const { useCancelDeletion } = await import("../account");

		const maybeSingle = vi.fn(() =>
			Promise.resolve({ data: { id: "del-1" }, error: null }),
		);
		const select = vi.fn(() => ({ maybeSingle }));
		const eqStatus = vi.fn(() => ({ select }));
		const eqUserId = vi.fn(() => ({ eq: eqStatus }));
		mockChain.update.mockImplementation(() => ({ eq: eqUserId }));

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useCancelDeletion(TEST_USER_ID), {
			wrapper,
		});

		result.current.mutate();

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("deletion_requests");
		expect(mockToast.success).toHaveBeenCalledWith(
			"Account deletion cancelled. Your account is safe.",
		);
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: [DELETION_REQUEST_KEY, TEST_USER_ID],
		});
	});

	it("shows user-friendly error on cancel failure", async () => {
		const { useCancelDeletion } = await import("../account");

		const maybeSingle = vi.fn(() =>
			Promise.resolve({
				data: null,
				error: { message: "no pending request found" },
			}),
		);
		const select = vi.fn(() => ({ maybeSingle }));
		const eqStatus = vi.fn(() => ({ select }));
		const eqUserId = vi.fn(() => ({ eq: eqStatus }));
		mockChain.update.mockImplementation(() => ({ eq: eqUserId }));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useCancelDeletion(TEST_USER_ID), {
			wrapper,
		});

		result.current.mutate();

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to cancel account deletion. Please try again.",
		);
	});

	it("says the deletion has already started when the row is no longer pending", async () => {
		const { useCancelDeletion } = await import("../account");

		// RLS only lets a user cancel a `pending` row, so a claimed (executing)
		// request matches nothing — that is not "try again", it has started.
		const maybeSingle = vi.fn(() =>
			Promise.resolve({ data: null, error: null }),
		);
		const select = vi.fn(() => ({ maybeSingle }));
		const eqStatus = vi.fn(() => ({ select }));
		const eqUserId = vi.fn(() => ({ eq: eqStatus }));
		mockChain.update.mockImplementation(() => ({ eq: eqUserId }));

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useCancelDeletion(TEST_USER_ID), {
			wrapper,
		});

		result.current.mutate();

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Your account deletion has already started and can no longer be cancelled.",
		);
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: [DELETION_REQUEST_KEY, TEST_USER_ID],
		});
	});
});

// ---------------------------------------------------------------------------
// useExecuteDeletion
// ---------------------------------------------------------------------------

describe("useExecuteDeletion", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("invokes delete-account edge function and signs out on success", async () => {
		const { useExecuteDeletion } = await import("../account");

		mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useExecuteDeletion(TEST_USER_ID), {
			wrapper,
		});

		result.current.mutate();

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mockInvoke).toHaveBeenCalledWith("delete-account");
		expect(mockToast.success).toHaveBeenCalledWith(
			"Account deleted. Signing out...",
		);
		// Must sign out after successful deletion
		expect(mockSignOut).toHaveBeenCalled();
	});

	it("shows user-friendly error when edge function fails", async () => {
		const { useExecuteDeletion } = await import("../account");

		mockInvoke.mockResolvedValue({
			data: null,
			error: { message: "Edge Function returned a non-2xx status code" },
		});

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useExecuteDeletion(TEST_USER_ID), {
			wrapper,
		});

		result.current.mutate();

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"We could not delete your account. Check the message on this page for what to do next.",
		);
		// Must NOT sign out on failure
		expect(mockSignOut).not.toHaveBeenCalled();
		// A failed purge may park the request for support; refetch so Danger
		// Zone can say so instead of leaving the pre-click copy on screen.
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: [DELETION_REQUEST_KEY, TEST_USER_ID],
		});
	});
});

// ---------------------------------------------------------------------------
// deletionRequestOptions (query helper, not a mutation)
// ---------------------------------------------------------------------------

describe("deletionRequestOptions", () => {
	it("generates correct query key and enabled flag", async () => {
		const { deletionRequestOptions } = await import("../account");

		const options = deletionRequestOptions(TEST_USER_ID);

		expect(options.queryKey).toEqual([DELETION_REQUEST_KEY, TEST_USER_ID]);
		expect(options.enabled).toBe(true);
	});

	it("is disabled when userId is empty", async () => {
		const { deletionRequestOptions } = await import("../account");

		const options = deletionRequestOptions("");

		expect(options.enabled).toBe(false);
	});

	it("reads executing requests too, and the support reason", async () => {
		const { deletionRequestOptions } = await import("../account");

		// A purge in flight leaves the row `executing`. A pending-only query
		// renders Danger Zone as "no request", so a click hits UNIQUE(user_id)
		// and a cancel silently matches nothing while the account is erased.
		const maybeSingle = vi.fn(() =>
			Promise.resolve({ data: null, error: null }),
		);
		const inFilter = vi.fn(() => ({ maybeSingle }));
		const eqUserId = vi.fn(() => ({ in: inFilter }));
		const select = vi.fn(() => ({ eq: eqUserId }));
		mockChain.select.mockImplementation(select);

		await deletionRequestOptions(TEST_USER_ID).queryFn();

		expect(from).toHaveBeenCalledWith("deletion_requests");
		expect(select.mock.calls[0][0]).toContain("needs_support_reason");
		expect(eqUserId).toHaveBeenCalledWith("user_id", TEST_USER_ID);
		expect(inFilter).toHaveBeenCalledWith("status", ["pending", "executing"]);
	});
});
