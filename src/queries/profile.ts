import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "./keys";

/**
 * Fetch user profile data from the profiles table.
 * Returns display_name, avatar_url, created_at, weight_unit, and notification preferences.
 */
export function profileOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.profile.byUser(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("profiles")
				.select(
					"display_name, avatar_url, created_at, weight_unit, email_digests, push_notifications, streak_reminders, challenge_updates, profile_visible, leaderboard_participation",
				)
				.eq("user_id", userId)
				.maybeSingle();
			if (error) throw error;
			return data;
		},
	});
}

/**
 * Compute real profile stats from Supabase:
 * - Total workouts (COUNT)
 * - Total volume (SUM, with weight multiplier applied)
 * - Personal records count
 * - Best streak (max consecutive workout days)
 */
export function profileStatsOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.profile.stats(userId),
		queryFn: async () => {
			// Fetch all workout sessions for stats computation
			const { data: sessions, error: sessionsError } = await supabase
				.from("workout_sessions")
				.select("started_at, total_volume")
				.eq("user_id", userId)
				.order("started_at", { ascending: true });
			if (sessionsError) throw sessionsError;

			const totalWorkouts = sessions?.length ?? 0;
			// total_volume is per-cable in DB; multiply by 2 for total
			const totalVolume = (sessions ?? []).reduce(
				(sum, s) => sum + (s.total_volume ?? 0) * 2,
				0,
			);

			// Compute best streak from sessions
			const bestStreak = computeBestStreak(sessions ?? []);

			// Count personal records
			const { count: prCount, error: prError } = await supabase
				.from("personal_records")
				.select("id", { count: "exact", head: true })
				.eq("user_id", userId);
			if (prError) throw prError;

			return {
				totalWorkouts,
				totalVolume,
				bestStreak,
				prCount: prCount ?? 0,
			};
		},
	});
}

/**
 * Fetch top 5 exercises by frequency from the exercises table.
 */
export function topExercisesOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.profile.topExercises(userId),
		queryFn: async () => {
			// Get all session IDs for this user
			const { data: sessions, error: sessionsError } = await supabase
				.from("workout_sessions")
				.select("id")
				.eq("user_id", userId);
			if (sessionsError) throw sessionsError;

			if (!sessions || sessions.length === 0) return [];

			const sessionIds = sessions.map((s) => s.id);

			// Fetch all exercises for these sessions
			const { data: exercises, error: exercisesError } = await supabase
				.from("exercises")
				.select("name")
				.in("session_id", sessionIds);
			if (exercisesError) throw exercisesError;

			// Count frequency by exercise name
			const countMap = new Map<string, number>();
			for (const ex of exercises ?? []) {
				countMap.set(ex.name, (countMap.get(ex.name) ?? 0) + 1);
			}

			// Sort by frequency and take top 5
			return Array.from(countMap.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5)
				.map(([name, count]) => ({ name, count }));
		},
	});
}

/** Compute the best (max) consecutive workout day streak */
function computeBestStreak(
	sessions: { started_at: string; total_volume: number }[],
): number {
	if (sessions.length === 0) return 0;

	const uniqueDays = new Set(
		sessions.map((s) => {
			const d = new Date(s.started_at);
			return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
		}),
	);

	// Sort unique day strings by actual date
	const sortedDays = Array.from(uniqueDays)
		.map((key) => {
			const [y, m, d] = key.split("-").map(Number);
			return new Date(y, m, d);
		})
		.sort((a, b) => a.getTime() - b.getTime());

	let best = 1;
	let current = 1;

	for (let i = 1; i < sortedDays.length; i++) {
		const diffMs = sortedDays[i].getTime() - sortedDays[i - 1].getTime();
		const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
		if (diffDays === 1) {
			current++;
			if (current > best) best = current;
		} else {
			current = 1;
		}
	}

	return best;
}
