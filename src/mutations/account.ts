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
			toast.error(error.message);
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
			const { error } = await supabase
				.from("deletion_requests")
				.update({
					status: "cancelled",
					cancelled_at: new Date().toISOString(),
				})
				.eq("user_id", userId)
				.eq("status", "pending");
			if (error) throw error;
		},
		onSuccess: () => {
			toast.success("Account deletion cancelled. Your account is safe.");
			queryClient.invalidateQueries({
				queryKey: [DELETION_REQUEST_KEY, userId],
			});
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});
}

/**
 * Execute account deletion after the 30-day grace period has expired.
 * Invokes the delete-account Edge Function which:
 *   1. Cancels Stripe subscription
 *   2. Removes avatar storage objects
 *   3. Marks the deletion request as executed
 *   4. Deletes the auth user (cascading to all private data)
 */
export function useExecuteDeletion() {
	return useMutation({
		mutationFn: async () => {
			const { data, error } = await supabase.functions.invoke(
				"delete-account",
			);
			if (error) throw error;
			return data;
		},
		onSuccess: async () => {
			toast.success("Account deleted. Signing out...");
			await supabase.auth.signOut();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Failed to delete account. Please try again.");
		},
	});
}
