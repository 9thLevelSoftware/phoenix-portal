import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/queries/keys";

/**
 * Mutation to save/update session-level notes on a workout_session row.
 */
export function useSaveSessionNotes() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			sessionId,
			notes,
		}: {
			sessionId: string;
			notes: string;
		}) => {
			const { error } = await supabase
				.from("workout_sessions")
				.update({ notes: notes || null })
				.eq("id", sessionId);
			if (error) throw error;
		},

		onSuccess: (_data, variables) => {
			toast.success("Notes saved");
			queryClient.invalidateQueries({
				queryKey: queryKeys.workouts.detail(variables.sessionId),
			});
		},

		onError: (error: Error) => {
			toast.error(`Failed to save notes: ${error.message}`);
		},
	});
}
