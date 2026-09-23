import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "./keys";

/**
 * Fetches exercises with set details for sessions in the last N days.
 * Used by: Volume Landmarks, SRA Recovery, Exercise Deep-Dive.
 */
export function bodyIntelligenceOptions(
	userId: string,
	days: number = 7,
	profileId?: string | null,
) {
	// Clamp days to a sane positive range so invalid input cannot produce a
	// nonsensical (or future-dated) cutoff.
	const safeDays =
		Number.isFinite(days) && days > 0 ? Math.min(Math.floor(days), 365) : 7;
	return queryOptions({
		queryKey: queryKeys.analytics.bodyIntelligence(userId, safeDays, profileId),
		staleTime: 5 * 60 * 1000, // 5 minutes
		queryFn: async () => {
			const since = new Date();
			since.setDate(since.getDate() - safeDays);

			let query = supabase
				.from("exercises")
				.select(
					"id, exercise_id, name, muscle_group, session_id, sets(id, actual_reps, weight_kg), workout_sessions!inner(id, started_at, user_id)",
				)
				.eq("workout_sessions.user_id", userId)
				.gte("workout_sessions.started_at", since.toISOString());

			if (profileId) {
				query = query.eq("workout_sessions.local_profile_id", profileId);
			}

			const { data, error } = await query;
			if (error) throw error;
			return (data ?? []).map((row) => ({
				...row,
				setCount: Array.isArray(row.sets) ? row.sets.length : 0,
			}));
		},
		enabled: !!userId,
	});
}

/**
 * Fetches per-set weight data for a specific session.
 * Used by: SRA intensity calculation.
 */
export function sessionSetWeightsOptions(sessionId: string) {
	return queryOptions({
		queryKey: queryKeys.analytics.sessionSetWeights(sessionId),
		staleTime: 30 * 60 * 1000, // 30 minutes (session data doesn't change)
		queryFn: async () => {
			const { data, error } = await supabase
				.from("sets")
				.select(
					"id, exercise_id, weight_kg, actual_reps, exercises!inner(name, muscle_group, session_id)",
				)
				.eq("exercises.session_id", sessionId);

			if (error) throw error;
			return data ?? [];
		},
		enabled: !!sessionId,
	});
}
