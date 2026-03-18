import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "./keys";

export function benchmarkOptions(metricType: string, metricKey?: string) {
	return queryOptions({
		queryKey: queryKeys.benchmarks.distribution(metricType, metricKey),
		queryFn: async () => {
			// Table created in 20260318_insights_benchmarks migration; cast needed until types are regenerated
		let query = (supabase as any)
				.from("community_benchmarks")
				.select("*")
				.eq("metric_type", metricType);
			if (metricKey) query = query.eq("metric_key", metricKey);
			const { data, error } = await query.single();
			if (error) throw error;
			return data;
		},
	});
}
