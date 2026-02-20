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
	trigger: "all-sets" | "target-rpe" | "cycle-complete";
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
			toast.error(error.message);
		},
	});
}
