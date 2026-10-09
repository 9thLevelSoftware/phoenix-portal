import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fetchAllSupabasePages } from "@/lib/supabasePaging";
import { routineDetailSchema, routineListSchema } from "@/schemas/transforms";
import { queryKeys } from "./keys";

export function routineListOptions(userId: string, profileId?: string | null) {
	return queryOptions({
		queryKey: queryKeys.routines.byUser(userId, profileId),
		queryFn: async () => {
			// PostgREST silently caps an unpaged select at max_rows (1,000).
			// Page inside this queryFn so callers still receive one array.
			// `id` is the unique tiebreak after last_used_at (nulls stay last)
			// so offset pages do not skip or repeat rows.
			const rows = await fetchAllSupabasePages((from, to) => {
				let query = supabase.from("routines").select("*").eq("user_id", userId);

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
			return routineListSchema.parse(rows);
		},
	});
}

export function routineDetailOptions(userId: string, routineId: string) {
	return queryOptions({
		queryKey: queryKeys.routines.detail(userId, routineId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("routines")
				.select("*, routine_exercises(*)")
				.eq("id", routineId)
				.order("order_index", {
					referencedTable: "routine_exercises",
					ascending: true,
				})
				.single();
			if (error) throw error;
			return routineDetailSchema.parse(data);
		},
		enabled: !!userId && !!routineId,
	});
}
