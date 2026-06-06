import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "./keys";

export interface DashboardFreshness {
	lastWorkoutUpdatedAt: string | null;
	lastWorkoutStartedAt: string | null;
	hasSyncedWorkouts: boolean;
}

export function dashboardFreshnessOptions(
	userId: string,
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: queryKeys.analytics.summary(userId, "freshness", profileId),
		queryFn: async (): Promise<DashboardFreshness> => {
			let query = supabase
				.from("workout_sessions")
				.select("updated_at, started_at")
				.eq("user_id", userId);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query
				.order("updated_at", { ascending: false })
				.limit(1);
			if (error) throw error;

			const latest = data?.[0];
			return {
				lastWorkoutUpdatedAt: latest?.updated_at ?? null,
				lastWorkoutStartedAt: latest?.started_at ?? null,
				hasSyncedWorkouts: latest != null,
			};
		},
		staleTime: 60 * 1000,
	});
}
