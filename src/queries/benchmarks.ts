import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "./keys";

export function communityBenchmarksOptions() {
	return queryOptions({
		queryKey: queryKeys.benchmarks.all,
		queryFn: async () => {
			const { data, error } = await supabase
				.from("community_benchmarks")
				.select("*")
				.order("metric_type");
			if (error) throw error;
			return data ?? [];
		},
		staleTime: 10 * 60 * 1000,
	});
}

export function benchmarkOptions(metricType: string, metricKey?: string) {
	return queryOptions({
		queryKey: queryKeys.benchmarks.distribution(metricType, metricKey),
		queryFn: async () => {
			let query = supabase
				.from("community_benchmarks")
				.select("*")
				.eq("metric_type", metricType);
			if (metricKey) query = query.eq("metric_key", metricKey);
			// Without a metric_key the (metric_type, metric_key) unique key is not
			// fully specified, so multiple rows can match. Limit to one and use
			// maybeSingle so the query degrades gracefully instead of throwing.
			const { data, error } = await query.limit(1).maybeSingle();
			if (error) throw error;
			return data;
		},
	});
}
