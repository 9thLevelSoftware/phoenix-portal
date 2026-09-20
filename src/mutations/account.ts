import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

const DELETION_REQUEST_KEY = "deletion-request";

/** Sentinel for "the row is no longer pending", so the toast can say so. */
const ALREADY_STARTED = "deletion-already-started";

/**
 * Query options for fetching the current user's open deletion request.
 *
 * `executing` is included: while the hourly `process_due` job (or the user's
 * own "Delete now") holds the claim the request is in that status, and a
 * pending-only query would render Danger Zone as if nothing were scheduled —
 * a click would then hit `UNIQUE(user_id)` and a cancel would silently match
 * no row while the account was in fact being erased.
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
				.in("status", ["pending", "executing"])
				.maybeSingle();
			if (error) throw error;
			return data;
		},
		enabled: !!userId,
	};
}

/**
 * Request account deletion — creates a deletion_requests row with a 30-day grace period.
 * The scheduled_for column defaults to now() + 30 days via the database default.
 */
export function useRequestDeletion(userId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () => {
			const { error } = await supabase
				.from("deletion_requests")
				.insert({ user_id: userId });
			if (error) throw error;
		},
		onSuccess: () => {
			toast.success("Account deletion scheduled. You have 30 days to cancel.");
			queryClient.invalidateQueries({
				queryKey: [DELETION_REQUEST_KEY, userId],
			});
		},
		onError: (error: Error) => {
			console.error("[useRequestDeletion] failed:", error);
			// A request already exists (UNIQUE(user_id)) — typically one that is
			// being executed right now, so say so instead of "try again".
			if ((error as { code?: string }).code === "23505") {
				toast.error(
					"Your account already has a deletion request. Reload the page to see it.",
				);
				queryClient.invalidateQueries({
					queryKey: [DELETION_REQUEST_KEY, userId],
				});
				return;
			}
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
			// Matching no row means the request is no longer `pending` — the
			// deletion has been claimed and is running (RLS only lets a user
			// cancel a pending row).
			if (!cancelled) throw new Error(ALREADY_STARTED);
		},
		onSuccess: () => {
			toast.success("Account deletion cancelled. Your account is safe.");
			queryClient.invalidateQueries({
				queryKey: [DELETION_REQUEST_KEY, userId],
			});
		},
		onError: (error: Error) => {
			console.error("[useCancelDeletion] failed:", error);
			queryClient.invalidateQueries({
				queryKey: [DELETION_REQUEST_KEY, userId],
			});
			toast.error(
				error.message === ALREADY_STARTED
					? "Your account deletion has already started and can no longer be cancelled."
					: "Failed to cancel account deletion. Please try again.",
			);
		},
	});
}

/**
 * Execute account deletion after the 30-day grace period has expired.
 * Invokes the delete-account Edge Function which (see `_shared/accountPurge.ts`):
 *   1. Cancels any live Paddle subscription immediately (aborts on failure)
 *   2. Deletes the user rows that do not cascade
 *   3. Deletes the auth user (cascading to all private data)
 *   4. Removes avatar storage objects
 */
export function useExecuteDeletion(userId: string) {
	const queryClient = useQueryClient();

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
			// A failed purge releases the claim and may park the request for
			// support (billing_subscription_not_found, request_survived_purge).
			// Refetch so Danger Zone can say what actually happened instead of
			// leaving the pre-click copy on screen.
			queryClient.invalidateQueries({
				queryKey: [DELETION_REQUEST_KEY, userId],
			});
			toast.error(
				"We could not delete your account. Check the message on this page for what to do next.",
			);
		},
	});
}
