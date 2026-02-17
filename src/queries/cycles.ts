import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { trainingCycleListSchema } from "@/schemas/transforms";
import { queryKeys } from "./keys";

export function cycleListOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.cycles.byUser(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("training_cycles")
				.select("*")
				.eq("user_id", userId)
				.order("last_used_at", { ascending: false, nullsFirst: false });
			if (error) throw error;
			return trainingCycleListSchema.parse(data);
		},
	});
}
