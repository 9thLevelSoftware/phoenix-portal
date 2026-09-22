import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

const DELETION_REQUEST_KEY = "deletion-request";

/**
 * Statuses the Danger Zone can render. `pending` drives the countdown /
 * "Delete Now" states; `executing` (the claim PR 35's process_due takes) drives
 * a read-only "deletion in progress" card. `cancelled` and `executed` are
 * deliberately excluded so the card falls back to "no request" — a cancelled
 * request is gone, and an `executed` row only survives a crashed purge.
 *
 * A `pending` row can additionally carry `needs_support_reason` (KD-11): a
 * purge that could not proceed parked it back to `pending` with that reason set
 * and `process_due` skips it (`.is('needs_support_reason', null)`). The column
 * has to be selected or the Danger Zone cannot tell that state apart from a
 * normal expiry — which would offer a "Delete Now" that is guaranteed to fail
 * again.
 */
const ACTIVE_DELETION_STATUSES = ["pending", "executing"] as const;

/**
 * Query options for fetching the current user's active deletion request.
 */
export function deletionRequestOptions(userId: string) {
	return {
		queryKey: [DELETION_REQUEST_KEY, userId],
		queryFn: async () => {
			const { data, error } = await supabase
				.from("deletion_requests")
				.select(
					"id, user_id, requested_at, scheduled_for, status, needs_support_reason",
				)
				.eq("user_id", userId)
				// UNIQUE (user_id): at most one row can match either status.
				.in("status", [...ACTIVE_DELETION_STATUSES])
				.maybeSingle();
			if (error) throw error;
			return data;
		},
		enabled: !!userId,
	};
}

interface RequestDeletionFailure {
	/** Text shown to the user. Never a raw database message. */
	message: string;
	/**
	 * Whether the Danger Zone should refetch. Only worth doing when the failure
	 * means a request already exists that this screen has not loaded yet.
	 */
	refresh: boolean;
	/** Whether the failure is worth a console/Sentry diagnostic. */
	log: boolean;
}

/**
 * Failures of public.request_account_deletion() keyed by `SQLSTATE:message`.
 *
 * The RPC raises three codes (20260920003200): `already_pending` and
 * `already_executing` on SQLSTATE P0001, and `not_authenticated` on 28000.
 * A `Map` is used rather than an object literal so a database message that
 * happens to name an Object.prototype key ("constructor", "toString") cannot
 * be mistaken for a known code.
 */
const REQUEST_DELETION_RAISED_FAILURES = new Map<
	string,
	RequestDeletionFailure
>([
	[
		"P0001:already_pending",
		{
			message: "Your account is already scheduled for deletion.",
			refresh: true,
			log: false,
		},
	],
	[
		"P0001:already_executing",
		{
			message: "Your account deletion is already in progress.",
			refresh: true,
			log: false,
		},
	],
	[
		// Defence in depth: from the portal an expired JWT is rejected by
		// PostgREST (PGRST301) before the function body runs, so this is
		// near-unreachable — but the RPC does raise it and it must not read as
		// "please try again".
		"28000:not_authenticated",
		{
			message: "Your session has expired. Sign in again to request deletion.",
			refresh: false,
			log: false,
		},
	],
]);

/**
 * Failures that mean the deletion path itself is down rather than the request
 * being rejected — the deploy-order window documented in
 * 20260920003300_revoke_deletion_requests_direct_insert.sql. "Please try again"
 * is the one instruction that cannot work here, so each gets its own message.
 */
const REQUEST_DELETION_TRANSPORT_FAILURES = new Map<
	string,
	RequestDeletionFailure
>([
	[
		// The SPA shipped before migration 20260920003200 was applied: PostgREST
		// cannot find the function. Reloading cannot fix that.
		"PGRST202",
		{
			message:
				"Account deletion is temporarily unavailable. Please contact support.",
			refresh: false,
			log: true,
		},
	],
	[
		// permission denied: EXECUTE on the RPC was revoked (a replay of
		// 20260920000100's allow-list), or this tab is running a bundle that no
		// longer matches the database.
		"42501",
		{
			message:
				"Account deletion is unavailable. Reload the page and try again; if it keeps failing, contact support.",
			refresh: false,
			log: true,
		},
	],
	[
		// JWT missing or expired — PostgREST rejects before the RPC runs.
		"PGRST301",
		{
			message: "Your session has expired. Sign in again to request deletion.",
			refresh: false,
			log: false,
		},
	],
]);

/** Classify a request_account_deletion() failure, or null if unrecognised. */
function classifyRequestDeletionError(
	error: unknown,
): RequestDeletionFailure | null {
	const { code, message } = (error ?? {}) as {
		code?: unknown;
		message?: unknown;
	};
	const codeStr = typeof code === "string" ? code : "";
	const messageStr = typeof message === "string" ? message : "";
	return (
		REQUEST_DELETION_RAISED_FAILURES.get(`${codeStr}:${messageStr}`) ??
		REQUEST_DELETION_TRANSPORT_FAILURES.get(codeStr) ??
		null
	);
}

/**
 * Request account deletion through the request_account_deletion() RPC.
 * The server creates a pending row with a 30-day grace period, or replaces
 * a cancelled request with a fresh one. There is no direct INSERT path.
 */
export function useRequestDeletion(userId: string) {
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: [DELETION_REQUEST_KEY, userId],
		});

	return useMutation({
		mutationFn: async () => {
			const { data, error } = await supabase.rpc("request_account_deletion");
			if (error) throw error;
			return data;
		},
		onSuccess: () => {
			toast.success("Account deletion scheduled. You have 30 days to cancel.");
			invalidate();
		},
		onError: (error: Error) => {
			const known = classifyRequestDeletionError(error);
			if (known) {
				if (known.log) console.error("[useRequestDeletion] failed:", error);
				toast.error(known.message);
				// Only for "a request already exists that this screen has not
				// loaded yet" — a dead session or a missing RPC has nothing new
				// to refetch.
				if (known.refresh) invalidate();
				return;
			}
			console.error("[useRequestDeletion] failed:", error);
			toast.error("Failed to schedule account deletion. Please try again.");
		},
	});
}

/**
 * Cancel a pending account deletion request during the grace period.
 */
export function useCancelDeletion(userId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () => {
			const { data: cancelled, error } = await supabase
				.from("deletion_requests")
				.update({
					status: "cancelled",
					cancelled_at: new Date().toISOString(),
				})
				.eq("user_id", userId)
				.eq("status", "pending")
				.select("id")
				.maybeSingle();
			if (error) throw error;
			if (!cancelled) throw new Error("No pending deletion request to cancel.");
		},
		onSuccess: () => {
			toast.success("Account deletion cancelled. Your account is safe.");
			queryClient.invalidateQueries({
				queryKey: [DELETION_REQUEST_KEY, userId],
			});
		},
		onError: (error: Error) => {
			console.error("[useCancelDeletion] failed:", error);
			toast.error("Failed to cancel account deletion. Please try again.");
		},
	});
}

/**
 * Execute account deletion after the 30-day grace period has expired.
 * Invokes the delete-account Edge Function which:
 *   1. Removes avatar storage objects
 *   2. Marks the deletion request as executed
 *   3. Deletes the auth user (cascading to all private data)
 */
export function useExecuteDeletion() {
	return useMutation({
		mutationFn: async () => {
			const { data, error } = await supabase.functions.invoke("delete-account");
			if (error) throw error;
			return data;
		},
		onSuccess: async () => {
			toast.success("Account deleted. Signing out...");
			await supabase.auth.signOut();
		},
		onError: (error: Error) => {
			console.error("[useExecuteDeletion] failed:", error);
			toast.error("Failed to delete account. Please try again.");
		},
	});
}
