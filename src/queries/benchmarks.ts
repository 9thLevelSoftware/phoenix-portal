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
			const { data, error } = await query.single();
			if (error) throw error;
			return data;
		},
	});
}
