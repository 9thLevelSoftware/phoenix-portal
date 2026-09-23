import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Json } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { isTierDenied, TIER_DENIED_MESSAGE } from "@/lib/tierErrors";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";
import type { CycleProgressionSettings } from "@/schemas/transforms";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";

interface CycleDayInput {
	/**
	 * The `cycle_days.id` this day already has, when the cycle is being edited.
	 * Sent back on update so the row keeps its identity instead of being
	 * regenerated on every portal save. Ignored on create - the create RPC
	 * mints its own ids.
	 */
	id?: string | null;
	day_number: number;
	day_type: string;
	routine_id?: string | null;
	weight_adjustment: number;
	rep_modifier: number;
	rest_override?: number | null;
	notes?: string | null;
	rest_type?: string | null;
}

// String-valued so mobile can decode it as Map<String, String>; built by
// buildCycleProgressionSettings.
type ProgressionSettings = CycleProgressionSettings;

interface DeloadSettings {
	frequency: number;
	intensity: number;
	volume: number;
}

/**
 * A child element of a create/update RPC payload. `cycle_id` is omitted: both
 * RPCs set it themselves from the parent they just created or matched.
 */
function toCycleDayRows(
	days: CycleDayInput[],
	{ withIds = false }: { withIds?: boolean } = {},
) {
	return days.map((day) => ({
		// Only on update, and only for a day that already has a row: the create
		// RPC ignores payload ids, so sending them there would be misleading
		// noise.
		...(withIds && day.id ? { id: day.id } : {}),
		day_number: day.day_number,
		day_type: day.day_type,
		routine_id: day.routine_id || null,
		weight_adjustment: day.weight_adjustment,
		rep_modifier: day.rep_modifier,
		rest_override: day.rest_override ?? null,
		notes: day.notes ?? null,
		rest_type: day.rest_type ?? null,
	}));
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

			// Atomic create via RPC: the cycle row and its days are inserted in
			// one transaction, so a rejected day can no longer leave a draft
			// cycle with no schedule, and there is no best-effort compensating
			// delete left to fail silently.
			const { data: cycleId, error } = await supabase.rpc(
				"create_cycle_with_days",
				{
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
					p_days: toCycleDayRows(input.days) as unknown as Json,
					// NULL = the default profile. `training_cycles.local_profile_id`
					// carries a composite FK to local_profiles(user_id, id), so the
					// only non-null value that can be stored is one of this user's
					// own profile ids, which is what the filter store holds.
					p_local_profile_id: useProfileFilterStore.getState().activeProfileId,
				},
			);

			if (error) throw error;
			if (!cycleId) throw new Error("Cycle was not created");

			return { id: cycleId };
		},

		onSuccess: () => {
			toast.success("Training cycle saved");
			queryClient.invalidateQueries({ queryKey: queryKeys.cycles.all });
		},

		onError: (error: Error) => {
			console.error("[useSaveCycle] failed:", error);
			// Cycle authoring is FLAME-only and enforced server-side, so a plan
			// that lapsed while the builder was open fails here. "Try again"
			// would be a lie; say what actually has to change.
			if (isTierDenied(error)) {
				toast.error(TIER_DENIED_MESSAGE);
				queryClient.invalidateQueries({
					queryKey: queryKeys.subscription.all,
				});
				return;
			}
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

			// `withIds`: a day that already has a row sends its id back, so the
			// row survives the save instead of being regenerated.
			const days = toCycleDayRows(input.days, { withIds: true }).map((day) => ({
				...day,
				cycle_id: input.cycleId,
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
			if (isTierDenied(error)) {
				toast.error(TIER_DENIED_MESSAGE);
				queryClient.invalidateQueries({
					queryKey: queryKeys.subscription.all,
				});
				return;
			}
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

			const { data, error } = await supabase.rpc("delete_training_cycle_lww", {
				p_cycle_id: cycleId,
				p_updated_at: new Date().toISOString(),
			});

			if (error) throw error;
			const result = data?.[0];
			if (!result?.accepted) {
				throw new Error(
					"Cycle changed on another device; refresh and try again",
				);
			}

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
