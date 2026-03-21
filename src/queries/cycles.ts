import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
	cycleDetailSchema,
	trainingCycleListSchema,
} from "@/schemas/transforms";
import { queryKeys } from "./keys";

export function cycleListOptions(userId: string, profileId?: string | null) {
	return queryOptions({
		queryKey: queryKeys.cycles.byUser(userId, profileId),
		queryFn: async () => {
			let query = supabase
				.from("training_cycles")
				.select("*")
				.eq("user_id", userId);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query
				.order("last_used_at", { ascending: false, nullsFirst: false });
			if (error) throw error;
			return trainingCycleListSchema.parse(data);
		},
	});
}

export function cycleDetailOptions(cycleId: string) {
	return queryOptions({
		queryKey: queryKeys.cycles.detail(cycleId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("training_cycles")
				.select("*, cycle_days(*)")
				.eq("id", cycleId)
				.order("day_number", {
					referencedTable: "cycle_days",
					ascending: true,
				})
				.single();
			if (error) throw error;
			return cycleDetailSchema.parse(data);
		},
	});
}
