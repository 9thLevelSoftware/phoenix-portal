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
const rpc = vi.fn();
const mockInvoke = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/supabase", () => ({
	supabase: {
		from,
		rpc,
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
// deletionRequestOptions — the query itself (key/enabled are covered further
// down, next to the other query-helper assertions)
// ---------------------------------------------------------------------------

describe("deletionRequestOptions status filter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("fetches the executing row too, so the purge is visible in the UI", async () => {
		const { deletionRequestOptions } = await import("../account");

		const executingRow = {
			id: "del-3",
			user_id: TEST_USER_ID,
			status: "executing",
			requested_at: "2026-08-19T00:00:00Z",
			scheduled_for: "2026-09-18T00:00:00Z",
		};
		const maybeSingle = vi.fn(() =>
			Promise.resolve({ data: executingRow, error: null }),
		);
		const inFilter = vi.fn(() => ({ maybeSingle }));
		const eq = vi.fn(() => ({ in: inFilter }));
		const select = vi.fn(() => ({ eq }));
		// Once: the shared `from` mock must keep returning mockChain afterwards.
		from.mockImplementationOnce(
			() => ({ select }) as unknown as typeof mockChain,
		);

		const data = await deletionRequestOptions(TEST_USER_ID).queryFn();

		expect(from).toHaveBeenCalledWith("deletion_requests");
		expect(eq).toHaveBeenCalledWith("user_id", TEST_USER_ID);
		// Not .eq("status", "pending"): an executing row must reach the card, or
		// the Danger Zone claims the account is safe while it is being purged
		// and the already_executing invalidate() is a no-op by construction.
		expect(inFilter).toHaveBeenCalledWith("status", ["pending", "executing"]);
		expect(data).toEqual(executingRow);
	});
});

// ---------------------------------------------------------------------------
// useRequestDeletion
// ---------------------------------------------------------------------------

describe("useRequestDeletion", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const pendingRow = {
		id: "del-2",
		user_id: TEST_USER_ID,
		status: "pending",
		requested_at: "2026-09-19T00:00:00Z",
		scheduled_for: "2026-10-19T00:00:00Z",
	};

	it("calls request_account_deletion and invalidates the deletion-request cache", async () => {
		const { useRequestDeletion } = await import("../account");

		rpc.mockResolvedValue({ data: pendingRow, error: null });

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		const { result } = renderHook(() => useRequestDeletion(TEST_USER_ID), {
			wrapper,
		});

		result.current.mutate();

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(rpc).toHaveBeenCalledWith("request_account_deletion");
		// No direct table write: the RPC is the only request path.
		expect(from).not.toHaveBeenCalled();
		expect(mockChain.insert).not.toHaveBeenCalled();
		expect(result.current.data).toEqual(pendingRow);
		expect(mockToast.success).toHaveBeenCalledWith(
			"Account deletion scheduled. You have 30 days to cancel.",
		);
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: [DELETION_REQUEST_KEY, TEST_USER_ID],
		});
	});

	it("re-requests deletion after a cancel", async () => {
		const { useCancelDeletion, useRequestDeletion } = await import(
			"../account"
		);

		const maybeSingle = vi.fn(() =>
			Promise.resolve({ data: { id: "del-1" }, error: null }),
		);
		const select = vi.fn(() => ({ maybeSingle }));
		const eqStatus = vi.fn(() => ({ select }));
		const eqUserId = vi.fn(() => ({ eq: eqStatus }));
		mockChain.update.mockImplementation(() => ({ eq: eqUserId }));
		rpc.mockResolvedValue({ data: pendingRow, error: null });

		const { wrapper } = createWrapper();
		const { result } = renderHook(
			() => ({
				cancel: useCancelDeletion(TEST_USER_ID),
				request: useRequestDeletion(TEST_USER_ID),
			}),
			{ wrapper },
		);

		result.current.cancel.mutate();
		await waitFor(() => expect(result.current.cancel.isSuccess).toBe(true));

		result.current.request.mutate();
		await waitFor(() => expect(result.current.request.isSuccess).toBe(true));

		expect(mockChain.update).toHaveBeenCalledWith(
			expect.objectContaining({ status: "cancelled" }),
		);
		expect(rpc).toHaveBeenCalledTimes(1);
		expect(rpc).toHaveBeenCalledWith("request_account_deletion");
		expect(mockChain.insert).not.toHaveBeenCalled();
		expect(result.current.request.data).toEqual(pendingRow);
		expect(mockToast.success).toHaveBeenCalledWith(
			"Account deletion cancelled. Your account is safe.",
		);
		expect(mockToast.success).toHaveBeenLastCalledWith(
			"Account deletion scheduled. You have 30 days to cancel.",
		);
		expect(mockToast.error).not.toHaveBeenCalled();
	});

	// Every failure the RPC or PostgREST can produce on this path, with the
	// message the user sees, whether the Danger Zone refetches, and whether the
	// failure reaches console/Sentry. "Please try again" must never be the
	// answer to a failure that retrying cannot fix.
	it.each([
		{
			name: "already_pending (P0001)",
			code: "P0001",
			message: "already_pending",
			toastMessage: "Your account is already scheduled for deletion.",
			invalidates: true,
			logs: false,
		},
		{
			name: "already_executing (P0001)",
			code: "P0001",
			message: "already_executing",
			toastMessage: "Your account deletion is already in progress.",
			invalidates: true,
			logs: false,
		},
		{
			// SQLSTATE 28000, not P0001 — see 20260920003200:112.
			name: "not_authenticated (28000)",
			code: "28000",
			message: "not_authenticated",
			toastMessage:
				"Your session has expired. Sign in again to request deletion.",
			invalidates: false,
			logs: false,
		},
		{
			// SPA deployed before migration 20260920003200 was applied.
			name: "missing RPC (PGRST202)",
			code: "PGRST202",
			message:
				"Could not find the function public.request_account_deletion without parameters in the schema cache",
			toastMessage:
				"Account deletion is temporarily unavailable. Please contact support.",
			invalidates: false,
			logs: true,
		},
		{
			// EXECUTE revoked (a replay of 20260920000100's allow-list), or a
			// bundle that no longer matches the database.
			name: "permission denied (42501)",
			code: "42501",
			message: "permission denied for function request_account_deletion",
			toastMessage:
				"Account deletion is unavailable. Reload the page and try again; if it keeps failing, contact support.",
			invalidates: false,
			logs: true,
		},
		{
			name: "expired JWT (PGRST301)",
			code: "PGRST301",
			message: "JWT expired",
			toastMessage:
				"Your session has expired. Sign in again to request deletion.",
			invalidates: false,
			logs: false,
		},
	])("$name gets its own message (refresh=$invalidates, log=$logs)", async ({
		code,
		message,
		toastMessage,
		invalidates,
		logs,
	}) => {
		const { useRequestDeletion } = await import("../account");

		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		rpc.mockResolvedValue({ data: null, error: { code, message } });

		const { queryClient, wrapper } = createWrapper();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useRequestDeletion(TEST_USER_ID), {
			wrapper,
		});

		result.current.mutate();

		await waitFor(() => expect(result.current.isError).toBe(true));

		expect(mockToast.error).toHaveBeenCalledWith(toastMessage);
		expect(mockToast.error).toHaveBeenCalledTimes(1);
		// The generic retry toast must not be one of them.
		expect(mockToast.error).not.toHaveBeenCalledWith(
			"Failed to schedule account deletion. Please try again.",
		);
		// The raw database text never reaches the user.
		expect(mockToast.error).not.toHaveBeenCalledWith(
			expect.stringContaining(message),
		);

		const invalidateCalls = invalidateSpy.mock.calls.filter(
			([arg]) =>
				JSON.stringify(arg) ===
				JSON.stringify({ queryKey: [DELETION_REQUEST_KEY, TEST_USER_ID] }),
		);
		expect(invalidateCalls.length > 0).toBe(invalidates);

		// An outage must still reach the console (and so Sentry); a rejected
		// request is expected and stays quiet.
		expect(consoleSpy).toHaveBeenCalledTimes(logs ? 1 : 0);
		consoleSpy.mockRestore();
	});

	it("does not mistake an Object.prototype key for a known error code", async () => {
		const { useRequestDeletion } = await import("../account");

		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		// A message colliding with an inherited object key used to resolve to a
		// truthy function and be handed to toast.error.
		rpc.mockResolvedValue({
			data: null,
			error: { code: "P0001", message: "constructor" },
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
		expect(mockToast.error).toHaveBeenCalledTimes(1);
		expect(mockToast.error).not.toHaveBeenCalledWith(expect.any(Function));
		consoleSpy.mockRestore();
	});

	it("shows user-friendly error on request failure", async () => {
		const { useRequestDeletion } = await import("../account");

		rpc.mockResolvedValue({
			data: null,
			error: { code: "XX000", message: "internal error: relation locked" },
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
			expect.stringContaining("internal error"),
		);
	});

	it("says a request already exists when the unique constraint refuses it", async () => {
		const { useRequestDeletion } = await import("../account");

		// UNIQUE(user_id): typically a request that is being executed right now.
		// Was `mockChain.insert.mockResolvedValue({ error: … code: "23505" })`
		// — that models a direct INSERT the schema no longer permits.
		// `request_account_deletion()` is the only write transport since
		// 20260920003300 revoked `insert` on deletion_requests, so a raw 23505
		// that leaks past its already_pending / already_executing raises comes
		// back on `rpc`. Same code, same user-facing copy, the real transport.
		rpc.mockResolvedValue({
			data: null,
			error: Object.assign(
				new Error("duplicate key value violates unique constraint"),
				{ code: "23505" },
			),
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
		// Typed so `select.mock.calls[0][0]` is a column list, not `[]`.
		const select = vi.fn((_columns: string) => ({ eq: eqUserId }));
		mockChain.select.mockImplementation(select);

		await deletionRequestOptions(TEST_USER_ID).queryFn();

		expect(from).toHaveBeenCalledWith("deletion_requests");
		expect(select.mock.calls[0][0]).toContain("needs_support_reason");
		expect(eqUserId).toHaveBeenCalledWith("user_id", TEST_USER_ID);
		expect(inFilter).toHaveBeenCalledWith("status", ["pending", "executing"]);
	});
});
