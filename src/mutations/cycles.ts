import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Json } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";

interface CycleDayInput {
	day_number: number;
	day_type: string;
	routine_id?: string | null;
	weight_adjustment: number;
	rep_modifier: number;
	rest_override?: number | null;
	notes?: string | null;
	rest_type?: string | null;
}

interface ProgressionSettings {
	type: "percentage" | "fixed" | "manual";
	amount: number;
	frequency: number;
	trigger: "all_sets" | "target_rpe" | "cycle_complete";
	upperIncrement: number;
	lowerIncrement: number;
}

interface DeloadSettings {
	frequency: number;
	intensity: number;
	volume: number;
}

interface SaveCycleInput {
	name: string;
	description?: string;
	duration_weeks: number;
	started_at?: string | null;
	days: CycleDayInput[];
	progression_settings?: ProgressionSettings | null;
	deload_settings?: DeloadSettings | null;
}

interface UpdateCycleInput extends SaveCycleInput {
	cycleId: string;
}

export function useSaveCycle() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: SaveCycleInput) => {
			if (!user) throw new Error("Must be logged in to save cycles");

			const workoutDays = input.days.filter(
				(d) => d.day_type === "workout",
			).length;
			const restDays = input.days.filter((d) => d.day_type === "rest").length;

			// Create the cycle row
			const { data: cycle, error: cycleError } = await supabase
				.from("training_cycles")
				.insert({
					user_id: user.id,
					local_profile_id: useProfileFilterStore.getState().activeProfileId,
					name: input.name,
					description: input.description ?? "",
					duration_weeks: input.duration_weeks,
					current_week: 1,
					status: "draft" as const,
					workout_days: workoutDays,
					rest_days: restDays,
					started_at: input.started_at || null,
					progression_settings: input.progression_settings ?? null,
					deload_settings: input.deload_settings ?? null,
				})
				.select("id")
				.single();

			if (cycleError) throw cycleError;

			// Insert cycle days. If this fails, roll back the orphaned parent so we
			// don't leave a draft cycle with no schedule.
			if (input.days.length > 0) {
				const { error: daysError } = await supabase.from("cycle_days").insert(
					input.days.map((day) => ({
						cycle_id: cycle.id,
						day_number: day.day_number,
						day_type: day.day_type,
						routine_id: day.routine_id || null,
						weight_adjustment: day.weight_adjustment,
						rep_modifier: day.rep_modifier,
						rest_override: day.rest_override ?? null,
						notes: day.notes ?? null,
						rest_type: day.rest_type ?? null,
					})),
				);
				if (daysError) {
					await supabase
						.from("training_cycles")
						.delete()
						.eq("id", cycle.id)
						.eq("user_id", user.id);
					throw daysError;
				}
			}

			return cycle;
		},

		onSuccess: () => {
			toast.success("Training cycle saved");
			queryClient.invalidateQueries({ queryKey: queryKeys.cycles.all });
		},

		onError: (error: Error) => {
			console.error("[useSaveCycle] failed:", error);
			toast.error("Failed to save training cycle. Please try again.");
		},
	});
}

export function useUpdateCycle() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: UpdateCycleInput) => {
			if (!user) throw new Error("Must be logged in to update cycles");

			const workoutDays = input.days.filter(
				(d) => d.day_type === "workout",
			).length;
			const restDays = input.days.filter((d) => d.day_type === "rest").length;

			const days = input.days.map((day) => ({
				cycle_id: input.cycleId,
				day_number: day.day_number,
				day_type: day.day_type,
				routine_id: day.routine_id || null,
				weight_adjustment: day.weight_adjustment,
				rep_modifier: day.rep_modifier,
				rest_override: day.rest_override ?? null,
				notes: day.notes ?? null,
				rest_type: day.rest_type ?? null,
			}));

			// Atomic update via RPC: the parent update + cycle_days delete/replace
			// run in one transaction (server-side), scoped to auth.uid(), so a
			// failed insert can no longer leave the cycle with no schedule.
			const { data: updatedId, error } = await supabase.rpc(
				"update_cycle_with_days",
				{
					p_cycle_id: input.cycleId,
					p_name: input.name,
					p_description: input.description ?? "",
					p_duration_weeks: input.duration_weeks,
					p_workout_days: workoutDays,
					p_rest_days: restDays,
					p_started_at: input.started_at || null,
					p_progression_settings: (input.progression_settings ??
						null) as unknown as Json | null,
					p_deload_settings: (input.deload_settings ??
						null) as unknown as Json | null,
					p_days: days as unknown as Json,
				},
			);

			if (error) throw error;
			if (!updatedId)
				throw new Error(
					"Cycle not found or you don't have permission to update it",
				);

			return { id: input.cycleId };
		},

		onSuccess: (_data, variables) => {
			toast.success("Training cycle updated");
			queryClient.invalidateQueries({ queryKey: queryKeys.cycles.all });
			queryClient.invalidateQueries({
				queryKey: queryKeys.cycles.detail(variables.cycleId),
			});
		},

		onError: (error: Error) => {
			console.error("[useUpdateCycle] failed:", error);
			toast.error("Failed to update training cycle. Please try again.");
		},
	});
}

export function useDeleteCycle() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (cycleId: string) => {
			if (!user) throw new Error("Must be logged in to delete cycles");

			// Delete the cycle (CASCADE handles cycle_days)
			const { data: deleted, error: cycleError } = await supabase
				.from("training_cycles")
				.delete()
				.eq("id", cycleId)
				.eq("user_id", user.id)
				.select("id")
				.maybeSingle();

			if (cycleError) throw cycleError;
			if (!deleted)
				throw new Error(
					"Cycle not found or you don't have permission to delete it",
				);

			return { id: cycleId };
		},

		onSuccess: () => {
			toast.success("Training cycle deleted");
			queryClient.invalidateQueries({ queryKey: queryKeys.cycles.all });
		},

		onError: (error: Error) => {
			console.error("[useDeleteCycle] failed:", error);
			toast.error("Failed to delete training cycle. Please try again.");
		},
	});
}
