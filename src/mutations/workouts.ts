import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";

type WorkoutDeletionScope = "COMPONENT" | "WORKOUT";

interface DeleteWorkoutInput {
	portalSessionId: string;
	componentSessionId?: string | null;
	profileId: string | null;
	scope: WorkoutDeletionScope;
}

/**
 * Delete a workout from the portal while creating the same permanent
 * account-level tombstone consumed by mobile sync. Internal refresh/discard
 * paths intentionally do not use this mutation.
 */
export function useDeleteWorkout() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: DeleteWorkoutInput) => {
			if (!user) throw new Error("Must be logged in to delete workouts");
			const mutationId = crypto.randomUUID();
			const { data, error } = await supabase.rpc(
				"delete_workout_with_tombstone",
				{
					p_mutation_id: mutationId,
					p_portal_session_id: input.portalSessionId,
					p_component_session_id:
						input.scope === "COMPONENT"
							? (input.componentSessionId ?? null)
							: null,
					p_scope: input.scope,
					p_profile_id: input.profileId,
					p_deleted_at: new Date().toISOString(),
				},
			);
			if (error) throw error;
			if (!Array.isArray(data) || data[0]?.mutation_id !== mutationId) {
				throw new Error("Workout deletion was not acknowledged");
			}
			return { mutationId };
		},
		onSuccess: () => {
			toast.success("Workout deleted");
			queryClient.invalidateQueries({ queryKey: queryKeys.workouts.all });
		},
		onError: (error: Error) => {
			console.error("[useDeleteWorkout] failed:", error);
			toast.error("Failed to delete workout. Please try again.");
		},
	});
}
