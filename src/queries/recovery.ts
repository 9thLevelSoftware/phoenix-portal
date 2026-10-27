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
 * Uses stored per-cable volume; ACWR only cares about relative ratios.
 */
export function recoverySessionsOptions(
	userId: string,
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: queryKeys.recovery.score(userId, profileId),
		queryFn: async () => {
			const cutoff = new Date();
			cutoff.setDate(cutoff.getDate() - 42);

			let query = supabase
				.from("workout_sessions")
				.select("started_at, total_volume")
				.eq("user_id", userId)
				.gte("started_at", cutoff.toISOString());

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query.order("started_at", {
				ascending: false,
			});
			if (error) throw error;
			return recoverySessionListSchema.parse(data ?? []);
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
			// DESC sorts NULLS FIRST, so an unsynced row would win "latest".
			// Drop those rows; do not substitute an epoch or other fake time.
			const { data, error } = await supabase
				.from("external_activities")
				.select("id, provider, raw_data, synced_at")
				.eq("user_id", userId)
				.in("provider", ["garmin", "fitbit"])
				.not("synced_at", "is", null)
				.order("synced_at", { ascending: false, nullsFirst: false })
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
 *
 * `idx_training_cycles_one_active` is unique per profile, so the default
 * All-profiles filter can return more than one row. A non-singleton has no
 * single cycle position and is treated as null. A selected profile still
 * uses `maybeSingle`, which matches that per-profile uniqueness.
 */
export function activeCyclePositionOptions(
	userId: string,
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: [
			...queryKeys.cycles.all,
			"active-position",
			userId,
			profileId ?? "all",
		] as const,
		queryFn: async () => {
			const query = supabase
				.from("training_cycles")
				.select("current_week, duration_weeks, status")
				.eq("user_id", userId)
				.eq("status", "active");

			if (profileId) {
				const { data, error } = await query
					.eq("local_profile_id", profileId)
					.maybeSingle();
				if (error) throw error;
				if (!data) return null;
				return activeCycleSchema.parse(data);
			}

			const { data, error } = await query.limit(2);
			if (error) throw error;
			if (!data || data.length !== 1) return null;
			return activeCycleSchema.parse(data[0]);
		},
		enabled: !!userId,
	});
}
