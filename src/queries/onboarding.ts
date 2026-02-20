import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { onboardingSchema } from "@/schemas/onboarding";
import { queryKeys } from "./keys";

/**
 * Fetch the user's onboarding row from user_onboarding.
 * Returns null if no row exists (brand-new user who hasn't completed onboarding).
 */
export function onboardingOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.onboarding.byUser(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("user_onboarding")
				.select(
					"id, user_id, completed_at, version_seen, dismissed_hints, dismissed_whats_new, created_at",
				)
				.eq("user_id", userId)
				.maybeSingle();
			if (error) throw error;
			if (!data) return null;
			return onboardingSchema.parse(data);
		},
		staleTime: 5 * 60 * 1000, // 5 minutes
	});
}

/**
 * Lightweight check for whether a user has any workout sessions.
 * Uses head: true + count: exact to avoid loading actual data.
 */
export function hasWorkoutsOptions(userId: string) {
	return queryOptions({
		queryKey: [...queryKeys.onboarding.byUser(userId), "has-workouts"],
		queryFn: async () => {
			const { count, error } = await supabase
				.from("workout_sessions")
				.select("id", { count: "exact", head: true })
				.eq("user_id", userId);
			if (error) throw error;
			return count ?? 0;
		},
		staleTime: 10 * 60 * 1000, // 10 minutes
	});
}
