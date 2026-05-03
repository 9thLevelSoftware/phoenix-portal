import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";

// ---------- useCreateGoal (confirmed pattern) ----------

interface CreateGoalArgs {
	goal_type: "frequency" | "volume" | "pr";
	target_value: number;
	target_unit: string;
	exercise_name?: string | null;
	exercise_id?: string | null;
	deadline?: string | null;
	period?: "weekly" | "monthly";
}

export function useCreateGoal() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (args: CreateGoalArgs) => {
			if (!user) throw new Error("Must be logged in to create goals");

			const { data, error } = await supabase
				.from("user_goals")
				.insert({
					user_id: user.id,
					goal_type: args.goal_type,
					target_value: args.target_value,
					target_unit: args.target_unit,
					exercise_name: args.exercise_name ?? null,
					exercise_id: args.exercise_id ?? null,
					deadline: args.deadline ?? null,
					period: args.period ?? "weekly",
				})
				.select()
				.single();
			if (error) {
				if (error.code === "P0001") {
					throw new Error("Goal limit reached for your subscription tier");
				}
				throw error;
			}
			return data;
		},

		onSuccess: () => {
			toast.success("Goal created");
			queryClient.invalidateQueries({
				queryKey: queryKeys.goals.all,
			});
		},

		onError: (error: Error) => {
			console.error("[useCreateGoal] failed:", error);
			if (error.message === "Goal limit reached for your subscription tier") {
				toast.error("Goal limit reached for your subscription tier.");
			} else {
				toast.error("Failed to create goal. Please try again.");
			}
		},
	});
}

// ---------- useUpdateGoal (confirmed pattern) ----------

interface UpdateGoalArgs {
	goalId: string;
	updates: {
		target_value?: number;
		target_unit?: string;
		exercise_name?: string | null;
		exercise_id?: string | null;
		deadline?: string | null;
		period?: "weekly" | "monthly";
		status?: "active" | "completed" | "archived";
		completed_at?: string | null;
	};
}

export function useUpdateGoal() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ goalId, updates }: UpdateGoalArgs) => {
			if (!user) throw new Error("Must be logged in to update goals");

			const { data, error } = await supabase
				.from("user_goals")
				.update({ ...updates, updated_at: new Date().toISOString() })
				.eq("id", goalId)
				.eq("user_id", user.id)
				.select()
				.single();
			if (error) throw error;
			return data;
		},

		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.goals.all,
			});
		},

		onError: (error: Error) => {
			console.error("[useUpdateGoal] failed:", error);
			toast.error("Failed to update goal. Please try again.");
		},
	});
}

// ---------- useArchiveGoal (confirmed pattern) ----------

export function useArchiveGoal() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (goalId: string) => {
			if (!user) throw new Error("Must be logged in to archive goals");

			const { error } = await supabase
				.from("user_goals")
				.update({
					status: "archived" as const,
					updated_at: new Date().toISOString(),
				})
				.eq("id", goalId)
				.eq("user_id", user.id);
			if (error) throw error;
		},

		onSuccess: () => {
			toast.success("Goal archived");
			queryClient.invalidateQueries({
				queryKey: queryKeys.goals.all,
			});
		},

		onError: (error: Error) => {
			console.error("[useArchiveGoal] failed:", error);
			toast.error("Failed to archive goal. Please try again.");
		},
	});
}
