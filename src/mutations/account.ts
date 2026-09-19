import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

const DELETION_REQUEST_KEY = "deletion-request";

/**
 * Query options for fetching the current user's pending deletion request.
 */
export function deletionRequestOptions(userId: string) {
	return {
		queryKey: [DELETION_REQUEST_KEY, userId],
		queryFn: async () => {
			const { data, error } = await supabase
				.from("deletion_requests")
				.select("id, user_id, requested_at, scheduled_for, status")
				.eq("user_id", userId)
				.eq("status", "pending")
				.maybeSingle();
			if (error) throw error;
			return data;
		},
		enabled: !!userId,
	};
}

/**
 * Error codes raised by public.request_account_deletion() (SQLSTATE P0001,
 * code in `error.message`).
 */
const REQUEST_DELETION_ERROR_MESSAGES: Record<string, string> = {
	already_pending: "Your account is already scheduled for deletion.",
	already_executing: "Your account deletion is already in progress.",
};

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
			const known = REQUEST_DELETION_ERROR_MESSAGES[error?.message ?? ""];
			if (known) {
				// A request already exists that this screen has not loaded yet.
				toast.error(known);
				invalidate();
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
