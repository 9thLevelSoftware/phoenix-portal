import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";

/** Join a challenge -- confirmed pattern */
export function useJoinChallenge() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (challengeId: string) => {
			if (!user) throw new Error("Must be logged in to join a challenge");

			const { error } = await supabase
				.from("challenge_participants")
				.insert({ challenge_id: challengeId, user_id: user.id });
			if (error) throw error;
		},
		onSuccess: () => {
			toast.success("Challenge joined! Let's go!");
			queryClient.invalidateQueries({
				queryKey: queryKeys.challenges.all,
			});
		},
		onError: (error) => {
			toast.error(`Failed to join challenge: ${error.message}`);
		},
	});
}

/** Leave a challenge -- confirmed pattern */
export function useLeaveChallenge() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (challengeId: string) => {
			if (!user) throw new Error("Must be logged in to leave a challenge");

			const { error } = await supabase
				.from("challenge_participants")
				.delete()
				.eq("challenge_id", challengeId)
				.eq("user_id", user.id);
			if (error) throw error;
		},
		onSuccess: () => {
			toast.success("Challenge left");
			queryClient.invalidateQueries({
				queryKey: queryKeys.challenges.all,
			});
		},
		onError: (error) => {
			toast.error(`Failed to leave challenge: ${error.message}`);
		},
	});
}

/** Complete a challenge -- sets completed_at on participant row */
export function useCompleteChallenge() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (challengeId: string) => {
			if (!user) throw new Error("Must be logged in to complete a challenge");

			const { error } = await supabase
				.from("challenge_participants")
				.update({ completed_at: new Date().toISOString() })
				.eq("challenge_id", challengeId)
				.eq("user_id", user.id);
			if (error) throw error;
		},
		onSuccess: () => {
			toast.success("Challenge completed!");
			queryClient.invalidateQueries({
				queryKey: queryKeys.challenges.all,
			});
		},
		onError: (error) => {
			toast.error(`Failed to complete challenge: ${error.message}`);
		},
	});
}
