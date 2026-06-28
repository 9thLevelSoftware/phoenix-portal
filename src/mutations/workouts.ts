import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";

/**
 * Mutation to save/update session-level notes on a workout_session row.
 */
export function useSaveSessionNotes() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			sessionId,
			notes,
		}: {
			sessionId: string;
			notes: string;
		}) => {
			if (!user) throw new Error("Must be logged in to save notes");
			// Scope by user_id (defense-in-depth beyond RLS) and confirm the
			// update actually matched a row owned by the current user.
			const { data: updated, error } = await supabase
				.from("workout_sessions")
				.update({ notes: notes || null })
				.eq("id", sessionId)
				.eq("user_id", user.id)
				.select("id")
				.maybeSingle();
			if (error) throw error;
			if (!updated)
				throw new Error(
					"Session not found or you don't have permission to edit it",
				);
		},

		onSuccess: (_data, variables) => {
			toast.success("Notes saved");
			queryClient.invalidateQueries({
				queryKey: queryKeys.workouts.detail(variables.sessionId),
			});
		},

		onError: (error: Error) => {
			console.error("[useSaveSessionNotes] failed:", error);
			toast.error("Failed to save notes. Please try again.");
		},
	});
}
