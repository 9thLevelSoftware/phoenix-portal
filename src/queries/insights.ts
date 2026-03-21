import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "./keys";

export function insightsOptions(userId: string, period: string = "30d") {
	return queryOptions({
		queryKey: queryKeys.insights.byUser(userId, period),
		queryFn: async () => {
			// Table created in 20260318_insights_benchmarks migration; cast needed until types are regenerated
			const { data, error } = await (supabase as any)
				.from("user_insights")
				.select("*")
				.eq("user_id", userId)
				.eq("period", period)
				.order("created_at", { ascending: false })
				.limit(10);
			if (error) throw error;
			return data;
		},
	});
}
