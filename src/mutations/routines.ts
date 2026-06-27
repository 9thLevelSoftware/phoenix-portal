import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Database, Json } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";
import { WEIGHT_MULTIPLIER } from "@/schemas/transforms";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";

function estimatedRoutineDurationSeconds(
	exercises: RoutineExerciseInput[],
): number {
	const minutes = exercises.reduce(
		(sum, ex) => sum + ex.sets * 2.5 + ((ex.sets - 1) * ex.rest_seconds) / 60,
		0,
	);
	return Math.round(minutes * 60);
}

function normalizePerSetWeights(per: unknown): Json | null {
	if (per == null) return null;
	// UI collects per_set_weights in the same "total weight" units as the
	// single `weight` field (which is divided by WEIGHT_MULTIPLIER before
	// storage). Divide array entries by the same multiplier so the stored
	// per-cable representation stays consistent.
	if (Array.isArray(per)) {
		return per.map((x) =>
			typeof x === "number" ? x / WEIGHT_MULTIPLIER : x,
		) as Json;
	}
	return per as Json;
}

interface RoutineExerciseInput {
	name: string;
	muscle_group: string;
	exercise_id?: string | null;
	sets: number;
	reps: number;
	weight: number;
	rest_seconds: number;
	duration_seconds?: number | null;
	mode: string;
	order_index: number;
	superset_id?: string | null;
	superset_color?: string | null;
	superset_order?: number | null;
	per_set_weights?: unknown;
	per_set_rest?: unknown;
	per_set_reps?: unknown;
	is_amrap?: boolean;
	is_bodyweight?: boolean;
	pr_percentage?: number | null;
	rep_count_timing?: string | null;
	stop_at_position?: string | null;
	stall_detection?: boolean;
	eccentric_load?: string | null;
	echo_level?: string | null;
}

type RoutineExerciseInsert =
	Database["public"]["Tables"]["routine_exercises"]["Insert"];

function toRoutineExerciseRows(
	routineId: string,
	exercises: RoutineExerciseInput[],
): RoutineExerciseInsert[] {
	return exercises.map((ex, i) => ({
		routine_id: routineId,
		name: ex.name,
		muscle_group: ex.muscle_group,
		exercise_id: ex.exercise_id ?? null,
		sets: ex.sets,
		reps: ex.reps,
		weight: ex.weight / WEIGHT_MULTIPLIER,
		rest_seconds: ex.rest_seconds,
		duration_seconds: ex.duration_seconds ?? null,
		mode: ex.mode,
		order_index: i,
		superset_id: ex.superset_id ?? null,
		superset_color: ex.superset_color ?? null,
		superset_order: ex.superset_order ?? null,
		per_set_weights: normalizePerSetWeights(ex.per_set_weights),
		per_set_rest: (ex.per_set_rest ?? null) as Json,
		per_set_reps: (ex.per_set_reps ?? null) as Json,
		is_amrap: ex.is_amrap ?? false,
		is_bodyweight: ex.is_bodyweight ?? false,
		pr_percentage: ex.pr_percentage ?? null,
		rep_count_timing: ex.rep_count_timing ?? null,
		stop_at_position: ex.stop_at_position ?? null,
		stall_detection: ex.stall_detection ?? true,
		eccentric_load: ex.eccentric_load ?? null,
		echo_level: ex.echo_level ?? null,
	}));
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
					local_profile_id: useProfileFilterStore.getState().activeProfileId,
					name: input.name,
					description: input.description ?? "",
					exercise_count: input.exercises.length,
					estimated_duration: estimatedRoutineDurationSeconds(input.exercises),
					times_completed: 0,
					is_favorite: false,
					tags: [],
				})
				.select("id")
				.single();

			if (routineError) throw routineError;

			// Insert exercises. If this fails, roll back the orphaned parent so we
			// don't leave a routine whose exercise_count has no matching children.
			if (input.exercises.length > 0) {
				const routineExercises = toRoutineExerciseRows(
					routine.id,
					input.exercises,
				);
				const { error: exError } = await supabase
					.from("routine_exercises")
					.insert(routineExercises);
				if (exError) {
					await supabase
						.from("routines")
						.delete()
						.eq("id", routine.id)
						.eq("user_id", user.id);
					throw exError;
				}
			}

			return routine;
		},

		onSuccess: () => {
			toast.success("Routine saved");
			queryClient.invalidateQueries({ queryKey: queryKeys.routines.all });
		},

		onError: (error: Error) => {
			console.error("[useSaveRoutine] failed:", error);
			toast.error("Failed to save routine. Please try again.");
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
		}: {
			routineId: string;
			isFavorite: boolean;
		}) => {
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
			queryClient.invalidateQueries({
				queryKey: queryKeys.routines.all,
			});
		},
	});
}

export function useUpdateRoutine() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: UpdateRoutineInput) => {
			if (!user) throw new Error("Must be logged in to update routines");

			// Update routine row. Scope by user_id (like delete/favorite) so a
			// user cannot update another user's routine by id, and confirm a row
			// actually matched before mutating its child exercises.
			const { data: updated, error: routineError } = await supabase
				.from("routines")
				.update({
					name: input.name,
					description: input.description ?? "",
					exercise_count: input.exercises.length,
					estimated_duration: estimatedRoutineDurationSeconds(input.exercises),
				})
				.eq("id", input.routineId)
				.eq("user_id", user.id)
				.select("id")
				.maybeSingle();

			if (routineError) throw routineError;
			if (!updated)
				throw new Error(
					"Routine not found or you don't have permission to update it",
				);

			// Delete old exercises, insert new ones
			const { error: deleteError } = await supabase
				.from("routine_exercises")
				.delete()
				.eq("routine_id", input.routineId);

			if (deleteError) throw deleteError;

			if (input.exercises.length > 0) {
				const routineExercises = toRoutineExerciseRows(
					input.routineId,
					input.exercises,
				);
				const { error: exError } = await supabase
					.from("routine_exercises")
					.insert(routineExercises);
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
			console.error("[useUpdateRoutine] failed:", error);
			toast.error("Failed to update routine. Please try again.");
		},
	});
}

export function useDeleteRoutine() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (routineId: string) => {
			if (!user) throw new Error("Must be logged in to delete routines");

			// Delete the routine (CASCADE handles routine_exercises)
			const { data: deleted, error: routineError } = await supabase
				.from("routines")
				.delete()
				.eq("id", routineId)
				.eq("user_id", user.id)
				.select("id")
				.maybeSingle();

			if (routineError) throw routineError;
			if (!deleted)
				throw new Error(
					"Routine not found or you don't have permission to delete it",
				);

			return { id: routineId };
		},

		onSuccess: () => {
			toast.success("Routine deleted");
			queryClient.invalidateQueries({ queryKey: queryKeys.routines.all });
		},

		onError: (error: Error) => {
			console.error("[useDeleteRoutine] failed:", error);
			toast.error("Failed to delete routine. Please try again.");
		},
	});
}
