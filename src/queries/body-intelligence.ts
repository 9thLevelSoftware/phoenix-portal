import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fetchAllSupabasePages } from "@/lib/supabasePaging";
import { queryKeys } from "./keys";

/**
 * Exercises per page for the body-intelligence window.
 *
 * Below PostgREST `max_rows` (1,000) so a short page is the end of the
 * window. The only caller asks for 7 days.
 */
export const BODY_INTELLIGENCE_PAGE_SIZE = 500;

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

			const rows = await fetchAllSupabasePages((from, to) => {
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

				// `id` is unique, so offset pages neither skip nor repeat rows.
				return query.order("id", { ascending: true }).range(from, to);
			}, BODY_INTELLIGENCE_PAGE_SIZE);

			return rows.map((row) => ({
				...row,
				setCount: Array.isArray(row.sets) ? row.sets.length : 0,
			}));
		},
		enabled: !!userId,
	});
}
