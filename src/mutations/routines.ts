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
	superset_id?: string | null;
	superset_color?: string | null;
	superset_order?: number | null;
	per_set_weights?: unknown;
	per_set_rest?: unknown;
	is_amrap?: boolean;
	pr_percentage?: number | null;
	rep_count_timing?: string | null;
	stop_at_position?: string | null;
	stall_detection?: boolean;
	eccentric_load?: string | null;
	echo_level?: string | null;
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
							superset_id: ex.superset_id ?? null,
							superset_color: ex.superset_color ?? null,
							superset_order: ex.superset_order ?? null,
							per_set_weights: ex.per_set_weights ?? null,
							per_set_rest: ex.per_set_rest ?? null,
							is_amrap: ex.is_amrap ?? false,
							pr_percentage: ex.pr_percentage ?? null,
							rep_count_timing: ex.rep_count_timing ?? null,
							stop_at_position: ex.stop_at_position ?? null,
							stall_detection: ex.stall_detection ?? false,
							eccentric_load: ex.eccentric_load ?? null,
							echo_level: ex.echo_level ?? null,
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

export function useToggleFavorite() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			routineId,
			isFavorite,
		}: { routineId: string; isFavorite: boolean }) => {
			if (!user) throw new Error("Must be logged in");
			const { error } = await supabase
				.from("routines")
				.update({ is_favorite: isFavorite })
				.eq("id", routineId)
				.eq("user_id", user.id);
			if (error) throw error;
			return { routineId, isFavorite };
		},
		onSuccess: () => {
			if (user) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.routines.byUser(user.id),
				});
			}
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
							superset_id: ex.superset_id ?? null,
							superset_color: ex.superset_color ?? null,
							superset_order: ex.superset_order ?? null,
							per_set_weights: ex.per_set_weights ?? null,
							per_set_rest: ex.per_set_rest ?? null,
							is_amrap: ex.is_amrap ?? false,
							pr_percentage: ex.pr_percentage ?? null,
							rep_count_timing: ex.rep_count_timing ?? null,
							stop_at_position: ex.stop_at_position ?? null,
							stall_detection: ex.stall_detection ?? false,
							eccentric_load: ex.eccentric_load ?? null,
							echo_level: ex.echo_level ?? null,
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
