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

const mockToast = { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() };
vi.mock("sonner", () => ({ toast: mockToast }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DELETION_REQUEST_KEY = "deletion-request";
const TEST_USER_ID = "test-user-id";

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

		const { result } = renderHook(() => useRequestDeletion(TEST_USER_ID), { wrapper });

		result.current.mutate();

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(from).toHaveBeenCalledWith("deletion_requests");
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
		const { result } = renderHook(() => useRequestDeletion(TEST_USER_ID), { wrapper });

		result.current.mutate();

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to schedule account deletion. Please try again.",
		);
		expect(mockToast.error).not.toHaveBeenCalledWith(
			expect.stringContaining("duplicate key"),
		);
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

		const eqStatus = vi.fn(() => Promise.resolve({ error: null }));
		const eqUserId = vi.fn(() => ({ eq: eqStatus }));
		mockChain.update.mockImplementation(() => ({ eq: eqUserId }));

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useCancelDeletion(TEST_USER_ID), { wrapper });

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

		const eqStatus = vi.fn(() =>
			Promise.resolve({ error: { message: "no pending request found" } }),
		);
		const eqUserId = vi.fn(() => ({ eq: eqStatus }));
		mockChain.update.mockImplementation(() => ({ eq: eqUserId }));

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useCancelDeletion(TEST_USER_ID), { wrapper });

		result.current.mutate();

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to cancel account deletion. Please try again.",
		);
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
		const { result } = renderHook(() => useExecuteDeletion(), { wrapper });

		result.current.mutate();

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(mockInvoke).toHaveBeenCalledWith("delete-account");
		expect(mockToast.success).toHaveBeenCalledWith("Account deleted. Signing out...");
		// Must sign out after successful deletion
		expect(mockSignOut).toHaveBeenCalled();
	});

	it("shows user-friendly error when edge function fails", async () => {
		const { useExecuteDeletion } = await import("../account");

		mockInvoke.mockResolvedValue({
			data: null,
			error: { message: "Edge Function returned a non-2xx status code" },
		});

		const { wrapper } = createWrapper();
		const { result } = renderHook(() => useExecuteDeletion(), { wrapper });

		result.current.mutate();

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(
			"Failed to delete account. Please try again.",
		);
		// Must NOT sign out on failure
		expect(mockSignOut).not.toHaveBeenCalled();
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
});
