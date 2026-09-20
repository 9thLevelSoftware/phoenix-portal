import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { goalListSchema } from "@/schemas/goals";
import { queryKeys } from "./keys";

const goalPrBestSchema = z.object({
	exercise_id: z.string().nullable(),
	exercise_name: z.string(),
	record_type: z.string(),
	value: z.number(),
});

/**
 * Fetch active, completed, and archived goals for a user.
 * Returns Zod-transformed Goal[] with Date objects for timestamps.
 */
export function goalsOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.goals.byUser(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("user_goals")
				.select("*")
				.eq("user_id", userId)
				.in("status", ["active", "completed", "archived"])
				.order("created_at", { ascending: false });
			if (error) throw error;
			return goalListSchema.parse(data);
		},
		enabled: !!userId,
	});
}

/** Best strength PRs for goal progress, aggregated across the full history. */
export function goalPrBestsOptions(userId: string, profileId?: string | null) {
	return queryOptions({
		queryKey: [
			...queryKeys.goals.progress(userId),
			"pr-bests",
			profileId ?? "all",
		] as const,
		queryFn: async () => {
			const { data, error } = await supabase.rpc(
				"personal_record_bests",
				profileId ? { p_profile_id: profileId } : {},
			);
			if (error) throw error;
			return z.array(goalPrBestSchema).parse(data ?? []);
		},
		enabled: !!userId,
	});
}
