import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/queries/keys";

interface ProfileUpdate {
	display_name?: string;
	avatar_url?: string;
	weight_unit?: "kg" | "lbs";
	email_digests?: boolean;
	push_notifications?: boolean;
	streak_reminders?: boolean;
	challenge_updates?: boolean;
	profile_visible?: boolean;
	leaderboard_participation?: boolean;
}

/**
 * Update user profile settings in the profiles table.
 * Confirmed pattern (not optimistic): mutate -> toast on success/error -> invalidate.
 */
export function useUpdateProfile(userId: string | undefined) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (fields: ProfileUpdate) => {
			if (!userId) throw new Error("Not authenticated");

			const { error } = await supabase
				.from("profiles")
				.update(fields)
				.eq("user_id", userId);
			if (error) throw error;
		},
		onSuccess: () => {
			toast.success("Settings saved");
			if (userId) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.profile.byUser(userId),
				});
			}
		},
		onError: (error: Error) => {
			console.error("[useUpdateProfile] failed:", error);
			toast.error("Failed to update profile. Please try again.");
		},
	});
}
