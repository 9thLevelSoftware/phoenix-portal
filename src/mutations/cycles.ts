import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";

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

			// Insert cycle days
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
				if (daysError) throw daysError;
			}

			return cycle;
		},

		onSuccess: () => {
			toast.success("Training cycle saved");
			queryClient.invalidateQueries({ queryKey: queryKeys.cycles.all });
		},

		onError: (error: Error) => {
			console.error('[useSaveCycle] failed:', error);
			toast.error('Failed to save training cycle. Please try again.');
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

			const { error: cycleError } = await supabase
				.from("training_cycles")
				.update({
					name: input.name,
					description: input.description ?? "",
					duration_weeks: input.duration_weeks,
					workout_days: workoutDays,
					rest_days: restDays,
					started_at: input.started_at || null,
					progression_settings: input.progression_settings ?? null,
					deload_settings: input.deload_settings ?? null,
				})
				.eq("id", input.cycleId)
				.eq("user_id", user.id);

			if (cycleError) throw cycleError;

			const { error: deleteError } = await supabase
				.from("cycle_days")
				.delete()
				.eq("cycle_id", input.cycleId);

			if (deleteError) throw deleteError;

			if (input.days.length > 0) {
				const { error: daysError } = await supabase.from("cycle_days").insert(
					input.days.map((day) => ({
						cycle_id: input.cycleId,
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
				if (daysError) throw daysError;
			}

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
			console.error('[useUpdateCycle] failed:', error);
			toast.error('Failed to update training cycle. Please try again.');
		},
	});
}

export function useActivateCycle() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (cycleId: string) => {
			if (!user) throw new Error("Must be logged in to activate cycles");

			// Deactivate any currently active cycle for this user
			const { error: deactivateError } = await supabase
				.from("training_cycles")
				.update({ status: "draft" as const })
				.eq("user_id", user.id)
				.eq("status", "active");

			if (deactivateError) throw deactivateError;

			// Activate the selected cycle and set last_used_at
			const { error: activateError } = await supabase
				.from("training_cycles")
				.update({
					status: "active" as const,
					started_at: new Date().toISOString(),
					last_used_at: new Date().toISOString(),
				})
				.eq("id", cycleId);

			if (activateError) throw activateError;

			return { id: cycleId };
		},

		onSuccess: () => {
			toast.success("Training cycle activated");
			queryClient.invalidateQueries({ queryKey: queryKeys.cycles.all });
		},

		onError: (error: Error) => {
			console.error('[useActivateCycle] failed:', error);
			toast.error('Failed to activate training cycle. Please try again.');
		},
	});
}
