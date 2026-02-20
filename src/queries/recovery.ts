import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
	activeCycleSchema,
	recoverySessionListSchema,
	wearableRecoveryListSchema,
} from "@/schemas/recovery";
import { queryKeys } from "./keys";

/**
 * Fetch workout sessions from the last 42 days for ACWR computation.
 * Uses raw per-cable volume (no Zod weight doubling) since ACWR
 * only cares about relative ratios.
 */
export function recoverySessionsOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.recovery.score(userId),
		queryFn: async () => {
			const cutoff = new Date();
			cutoff.setDate(cutoff.getDate() - 42);

			const { data, error } = await supabase
				.from("workout_sessions")
				.select("started_at, total_volume")
				.eq("user_id", userId)
				.gte("started_at", cutoff.toISOString())
				.order("started_at", { ascending: false });
			if (error) throw error;
			return recoverySessionListSchema.parse(data);
		},
		enabled: !!userId,
	});
}

/**
 * Fetch wearable recovery data from external_activities
 * where provider is Garmin or Fitbit.
 */
export function wearableRecoveryOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.recovery.wearable(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("external_activities")
				.select("provider, raw_data, synced_at")
				.eq("user_id", userId)
				.in("provider", ["garmin", "fitbit"])
				.order("synced_at", { ascending: false })
				.limit(5);
			if (error) throw error;
			if (!data || data.length === 0) return null;
			return wearableRecoveryListSchema.parse(data);
		},
		enabled: !!userId,
	});
}

/**
 * Fetch the user's active training cycle position.
 * Returns null if no active cycle exists.
 */
export function activeCyclePositionOptions(userId: string) {
	return queryOptions({
		queryKey: [...queryKeys.cycles.all, "active-position", userId] as const,
		queryFn: async () => {
			const { data, error } = await supabase
				.from("training_cycles")
				.select("current_week, duration_weeks, status")
				.eq("user_id", userId)
				.eq("status", "active")
				.maybeSingle();
			if (error) throw error;
			if (!data) return null;
			return activeCycleSchema.parse(data);
		},
		enabled: !!userId,
	});
}
