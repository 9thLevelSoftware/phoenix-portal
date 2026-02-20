import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";

interface RoutineExerciseInput {
	name: string;
	muscle_group: string;
	sets: number;
	reps: number;
	weight: number;
	rest_seconds: number;
	mode: string;
	order_index: number;
}

interface SaveRoutineInput {
	name: string;
	description?: string;
	exercises: RoutineExerciseInput[];
}

interface UpdateRoutineInput extends SaveRoutineInput {
	routineId: string;
}

export function useSaveRoutine() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: SaveRoutineInput) => {
			if (!user) throw new Error("Must be logged in to save routines");

			// Create the routine row
			const { data: routine, error: routineError } = await supabase
				.from("routines")
				.insert({
					user_id: user.id,
					name: input.name,
					description: input.description ?? "",
					exercise_count: input.exercises.length,
					estimated_duration: Math.round(
						input.exercises.reduce(
							(sum, ex) =>
								sum + ex.sets * 2.5 + ((ex.sets - 1) * ex.rest_seconds) / 60,
							0,
						),
					),
					times_completed: 0,
					is_favorite: false,
					tags: [],
				})
				.select("id")
				.single();

			if (routineError) throw routineError;

			// Insert exercises
			if (input.exercises.length > 0) {
				const { error: exError } = await supabase
					.from("routine_exercises")
					.insert(
						input.exercises.map((ex, i) => ({
							routine_id: routine.id,
							name: ex.name,
							muscle_group: ex.muscle_group,
							sets: ex.sets,
							reps: ex.reps,
							weight: ex.weight,
							rest_seconds: ex.rest_seconds,
							mode: ex.mode,
							order_index: i,
						})),
					);
				if (exError) throw exError;
			}

			return routine;
		},

		onSuccess: () => {
			toast.success("Routine saved");
			queryClient.invalidateQueries({ queryKey: queryKeys.routines.all });
		},

		onError: (error: Error) => {
			toast.error(error.message);
		},
	});
}

export function useUpdateRoutine() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: UpdateRoutineInput) => {
			if (!user) throw new Error("Must be logged in to update routines");

			// Update routine row
			const { error: routineError } = await supabase
				.from("routines")
				.update({
					name: input.name,
					description: input.description ?? "",
					exercise_count: input.exercises.length,
					estimated_duration: Math.round(
						input.exercises.reduce(
							(sum, ex) =>
								sum + ex.sets * 2.5 + ((ex.sets - 1) * ex.rest_seconds) / 60,
							0,
						),
					),
				})
				.eq("id", input.routineId);

			if (routineError) throw routineError;

			// Delete old exercises, insert new ones
			const { error: deleteError } = await supabase
				.from("routine_exercises")
				.delete()
				.eq("routine_id", input.routineId);

			if (deleteError) throw deleteError;

			if (input.exercises.length > 0) {
				const { error: exError } = await supabase
					.from("routine_exercises")
					.insert(
						input.exercises.map((ex, i) => ({
							routine_id: input.routineId,
							name: ex.name,
							muscle_group: ex.muscle_group,
							sets: ex.sets,
							reps: ex.reps,
							weight: ex.weight,
							rest_seconds: ex.rest_seconds,
							mode: ex.mode,
							order_index: i,
						})),
					);
				if (exError) throw exError;
			}

			return { id: input.routineId };
		},

		onSuccess: (_data, variables) => {
			toast.success("Routine updated");
			queryClient.invalidateQueries({ queryKey: queryKeys.routines.all });
			queryClient.invalidateQueries({
				queryKey: queryKeys.routines.detail(variables.routineId),
			});
		},

		onError: (error: Error) => {
			toast.error(error.message);
		},
	});
}
