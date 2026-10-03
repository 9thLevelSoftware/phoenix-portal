import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fetchAllSupabasePages } from "@/lib/supabasePaging";
import {
	cycleDetailSchema,
	trainingCycleListSchema,
} from "@/schemas/transforms";
import { queryKeys } from "./keys";

export function cycleListOptions(userId: string, profileId?: string | null) {
	return queryOptions({
		queryKey: queryKeys.cycles.byUser(userId, profileId),
		queryFn: async () => {
			// PostgREST silently caps an unpaged select at max_rows (1,000).
			// Page inside this queryFn so callers still receive one array.
			// `id` is the unique tiebreak after last_used_at (nulls stay last)
			// so offset pages do not skip or repeat rows.
			const rows = await fetchAllSupabasePages((from, to) => {
				let query = supabase
					.from("training_cycles")
					.select("*")
					.eq("user_id", userId);

				if (profileId) {
					query = query.eq("local_profile_id", profileId);
				}

				return query
					.order("last_used_at", {
						ascending: false,
						nullsFirst: false,
					})
					.order("id", { ascending: true })
					.range(from, to);
			});
			return trainingCycleListSchema.parse(rows);
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
		enabled: !!cycleId,
	});
}
