import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "./keys";

export function insightsOptions(userId: string, period: string = "30d") {
	return queryOptions({
		queryKey: queryKeys.insights.byUser(userId, period),
		queryFn: async () => {
			const { data, error } = await supabase
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
