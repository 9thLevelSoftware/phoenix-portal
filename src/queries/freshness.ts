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
			const baseQuery = () => {
				let q = supabase
					.from("workout_sessions")
					.select("updated_at, started_at")
					.eq("user_id", userId);
				if (profileId) {
					q = q.eq("local_profile_id", profileId);
				}
				return q;
			};

			// The most-recently *synced* row (for "last synced") and the most-recent
			// *workout* row (for "last started") are not necessarily the same: editing
			// or resyncing an older session bumps updated_at but not started_at.
			const [updatedRes, startedRes] = await Promise.all([
				baseQuery().order("updated_at", { ascending: false }).limit(1),
				baseQuery().order("started_at", { ascending: false }).limit(1),
			]);
			if (updatedRes.error) throw updatedRes.error;
			if (startedRes.error) throw startedRes.error;

			const latestUpdated = updatedRes.data?.[0];
			const latestStarted = startedRes.data?.[0];
			return {
				lastWorkoutUpdatedAt: latestUpdated?.updated_at ?? null,
				lastWorkoutStartedAt: latestStarted?.started_at ?? null,
				hasSyncedWorkouts: latestUpdated != null,
			};
		},
		staleTime: 60 * 1000,
	});
}
