import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { goalListSchema } from "@/schemas/goals";
import { queryKeys } from "./keys";

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
