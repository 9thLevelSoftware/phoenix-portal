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
