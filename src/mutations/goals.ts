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
					// KD-8: this client enters PR targets per cable. The column has
					// no default, and a NULL basis is taken to mean a pre-PR-30
					// client (its PR target is a doubled total and is halved by the
					// user_goals_default_target_basis trigger). Say so explicitly. The
					// supported deploy order is migration first: before
					// 20260920003000 the column does not exist and PostgREST rejects
					// this insert (PGRST204), so the SPA must not ship ahead of it.
					target_basis: "per_cable",
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
		target_basis?: string;
	};
}

export function useUpdateGoal() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ goalId, updates }: UpdateGoalArgs) => {
			if (!user) throw new Error("Must be logged in to update goals");

			const payload: UpdateGoalArgs["updates"] & { updated_at: string } = {
				...updates,
				updated_at: new Date().toISOString(),
			};
			if ("exercise_name" in updates && !("exercise_id" in updates)) {
				payload.exercise_id = null;
			}
			// KD-8: any target this client writes is per cable. Restate the basis
			// with the value so the write is self-describing (and so a target
			// written here can never be mistaken for a pre-PR-30 doubled total).
			if ("target_value" in updates) {
				payload.target_basis = "per_cable";
			}

			const { data, error } = await supabase
				.from("user_goals")
				.update(payload)
				.eq("id", goalId)
				.eq("user_id", user.id)
				.select()
				.single();
			if (error) {
				// check_goal_limit also fires when a goal becomes active again
				// (e.g. Restore of an archived goal at the tier cap).
				if (error.code === "P0001") {
					throw new Error("Goal limit reached for your subscription tier");
				}
				throw error;
			}
			return data;
		},

		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.goals.all,
			});
		},

		onError: (error: Error) => {
			console.error("[useUpdateGoal] failed:", error);
			if (error.message === "Goal limit reached for your subscription tier") {
				toast.error("Goal limit reached for your subscription tier.");
			} else {
				toast.error("Failed to update goal. Please try again.");
			}
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

			const { data: archived, error } = await supabase
				.from("user_goals")
				.update({
					status: "archived" as const,
					updated_at: new Date().toISOString(),
				})
				.eq("id", goalId)
				.eq("user_id", user.id)
				.select("id")
				.maybeSingle();
			if (error) throw error;
			if (!archived)
				throw new Error(
					"Goal not found or you don't have permission to archive it.",
				);
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
