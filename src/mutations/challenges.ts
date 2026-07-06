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
			queryClient.invalidateQueries({
				queryKey: queryKeys.notifications.all,
			});
		},
		onError: (error: Error) => {
			console.error("[useJoinChallenge] failed:", error);
			toast.error("Failed to join challenge. Please try again.");
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

			const { data: left, error } = await supabase
				.from("challenge_participants")
				.delete()
				.eq("challenge_id", challengeId)
				.eq("user_id", user.id)
				.select("challenge_id")
				.maybeSingle();
			if (error) throw error;
			if (!left)
				throw new Error("You are not participating in this challenge.");
		},
		onSuccess: () => {
			toast.success("Challenge left");
			queryClient.invalidateQueries({
				queryKey: queryKeys.challenges.all,
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.notifications.all,
			});
		},
		onError: (error: Error) => {
			console.error("[useLeaveChallenge] failed:", error);
			toast.error("Failed to leave challenge. Please try again.");
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

			const { data: completed, error } = await supabase
				.from("challenge_participants")
				.update({ completed_at: new Date().toISOString() })
				.eq("challenge_id", challengeId)
				.eq("user_id", user.id)
				.select("challenge_id")
				.maybeSingle();
			if (error) throw error;
			if (!completed)
				throw new Error("You are not participating in this challenge.");
		},
		onSuccess: () => {
			toast.success("Challenge completed!");
			queryClient.invalidateQueries({
				queryKey: queryKeys.challenges.all,
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.notifications.all,
			});
		},
		onError: (error: Error) => {
			console.error("[useCompleteChallenge] failed:", error);
			toast.error("Failed to update challenge. Please try again.");
		},
	});
}
