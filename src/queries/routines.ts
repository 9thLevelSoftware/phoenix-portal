import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
	routineDetailSchema,
	routineListSchema,
} from "@/schemas/transforms";
import { queryKeys } from "./keys";

export function routineListOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.routines.byUser(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("routines")
				.select("*")
				.eq("user_id", userId)
				.order("last_used_at", { ascending: false, nullsFirst: false });
			if (error) throw error;
			return routineListSchema.parse(data);
		},
	});
}

export function routineDetailOptions(routineId: string) {
	return queryOptions({
		queryKey: queryKeys.routines.detail(routineId),
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
	});
}
