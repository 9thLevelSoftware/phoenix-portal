import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Database, Json } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { isTierDenied, TIER_DENIED_MESSAGE } from "@/lib/tierErrors";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";
import {
	normalizeEccentricLoad,
	toEchoLevel,
	toRepCountTiming,
	toStopAtPosition,
	toSupersetColorName,
	toWireMode,
} from "../../supabase/functions/_shared/workoutModes.ts";
import { toWireMode } from "../../supabase/functions/_shared/workoutModes.ts";

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
	// The builder collects per_set_weights per cable, like `weight`, which is
	// exactly what is stored (KD-8). No conversion.
	if (per == null) return null;
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
	drop_set_enabled?: boolean;
	drop_set_min_weight_kg?: number | null;
}

type RoutineExerciseInsert =
	Database["public"]["Tables"]["routine_exercises"]["Insert"];

/**
 * Mobile only understands wire mode names (OLD_SCHOOL, ECHO, ...). Normalize
 * display names / legacy aliases and refuse anything else rather than storing
 * a value mobile would silently turn into Old School.
 *
 * `preservedModes` are unrecognized values that were already stored on the
 * routine being edited (e.g. a mode from a newer mobile build). They are
 * written back verbatim so a portal edit never downgrades them; the DB
 * trigger likewise passes unknown values through.
 */
function requireWireMode(
	mode: string,
	preservedModes: readonly string[] = [],
): string {
	const wire = toWireMode(mode);
	if (wire) return wire;
	if (preservedModes.includes(mode)) return mode;
	throw new Error(`Unknown workout mode: ${mode}`);
}

export function toRoutineExerciseRows(
	routineId: string,
	exercises: RoutineExerciseInput[],
	preservedModes: readonly string[] = [],
): RoutineExerciseInsert[] {
	return exercises.map((ex, i) => ({
		routine_id: routineId,
		name: ex.name,
		muscle_group: ex.muscle_group,
		exercise_id: ex.exercise_id ?? null,
		sets: ex.sets,
		reps: ex.reps,
		weight: ex.weight, // per cable, stored as entered (KD-8)
		rest_seconds: ex.rest_seconds,
		duration_seconds: ex.duration_seconds ?? null,
		mode: requireWireMode(ex.mode, preservedModes),
		order_index: i,
		superset_id: ex.superset_id ?? null,
		// Settings are stored in mobile's vocabulary. Anything outside it is
		// stored as null, which is the default mobile would parse it to.
		superset_color: toSupersetColorName(ex.superset_color),
		superset_order: ex.superset_order ?? null,
		per_set_weights: normalizePerSetWeights(ex.per_set_weights),
		per_set_rest: (ex.per_set_rest ?? null) as Json,
		per_set_reps: (ex.per_set_reps ?? null) as Json,
		is_amrap: ex.is_amrap ?? false,
		is_bodyweight: ex.is_bodyweight ?? false,
		pr_percentage: ex.pr_percentage ?? null,
		rep_count_timing: toRepCountTiming(ex.rep_count_timing),
		stop_at_position: toStopAtPosition(ex.stop_at_position),
		stall_detection: ex.stall_detection ?? true,
		eccentric_load: normalizeEccentricLoad(ex.eccentric_load),
		echo_level: toEchoLevel(ex.echo_level),
		drop_set_enabled: ex.drop_set_enabled ?? false,
		drop_set_min_weight_kg: ex.drop_set_min_weight_kg ?? null,
	}));
}

interface SaveRoutineInput {
	name: string;
	description?: string;
	exercises: RoutineExerciseInput[];
}

interface UpdateRoutineInput extends SaveRoutineInput {
	routineId: string;
	/** Unrecognized modes already stored on this routine; saved verbatim. */
	preservedModes?: readonly string[];
}

export function useSaveRoutine() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: SaveRoutineInput) => {
			if (!user) throw new Error("Must be logged in to save routines");
			// Validate modes before the parent insert so an unknown mode can't
			// leave an orphaned routine row behind.
			for (const ex of input.exercises) requireWireMode(ex.mode);

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

/** Sentinel for "the favourite UPDATE matched no row". */
const ROUTINE_NOT_UPDATED = "Routine was not updated";

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
			// `.select("id")` so a 0-row UPDATE is observable. The routines
			// UPDATE policy is owner AND FLAME, so a user whose plan lapsed
			// while this page was open matches no row and PostgREST returns
			// success with an empty body — silently doing nothing.
			const { data: updated, error } = await supabase
				.from("routines")
				.update({ is_favorite: isFavorite })
				.eq("id", routineId)
				.eq("user_id", user.id)
				.select("id")
				.maybeSingle();
			if (error) throw error;
			if (!updated) throw new Error(ROUTINE_NOT_UPDATED);
			return { routineId, isFavorite };
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.routines.all,
			});
		},
		onError: (error: Error) => {
			console.error("[useToggleFavorite] failed:", error);
			if (isTierDenied(error)) {
				toast.error(TIER_DENIED_MESSAGE);
				queryClient.invalidateQueries({
					queryKey: queryKeys.subscription.all,
				});
				return;
			}
			toast.error(
				error.message === ROUTINE_NOT_UPDATED
					? "Routine not found, or you can no longer edit it."
					: "Failed to update this routine. Please try again.",
			);
		},
	});
}

export function useUpdateRoutine() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: UpdateRoutineInput) => {
			if (!user) throw new Error("Must be logged in to update routines");

			// Atomic update via RPC: the parent update + exercise delete/replace
			// run in one transaction (server-side), scoped to auth.uid(), so a
			// failed insert can no longer leave the routine with zero exercises.
			const { data: updatedId, error } = await supabase.rpc(
				"update_routine_with_exercises",
				{
					p_routine_id: input.routineId,
					p_name: input.name,
					p_description: input.description ?? "",
					p_exercise_count: input.exercises.length,
					p_estimated_duration: estimatedRoutineDurationSeconds(
						input.exercises,
					),
					p_exercises: toRoutineExerciseRows(
						input.routineId,
						input.exercises,
						input.preservedModes,
					) as unknown as Json,
				},
			);

			if (error) throw error;
			if (!updatedId)
				throw new Error(
					"Routine not found or you don't have permission to update it",
				);

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
