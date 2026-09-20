import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
	earnedBadgeListSchema,
	gamificationStatsSchema,
	rpgAttributesSchema,
} from "@/schemas/transforms";
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
 * Profile stats, aggregated in SQL by `profile_workout_stats`:
 * - Total workouts (COUNT)
 * - Total volume (SUM of the STORED per-cable volume — KD-8: never doubled
 *   here; the display layer owns per-cable vs total presentation)
 * - Personal records count (live rows only)
 * - Best streak (longest run of consecutive workout days)
 *
 * The previous implementation fetched every session row ascending, so from
 * 1,000 sessions on it reported exactly 1,000 workouts and computed volume and
 * the best streak from the OLDEST 1,000 sessions (F-034).
 *
 * `p_tz` is deliberately 'UTC': `best_streak` is account-wide, and the current
 * streak the Profile page shows next to it (`useStreak` / `utcDateKey`) is
 * computed in UTC. Passing the browser zone here would let the current streak
 * exceed the best one.
 */
export function profileStatsOptions(userId: string, profileId?: string | null) {
	return queryOptions({
		queryKey: queryKeys.profile.stats(userId, profileId),
		queryFn: async () => {
			const { data, error } = await supabase.rpc("profile_workout_stats", {
				p_tz: "UTC",
				...(profileId ? { p_profile_id: profileId } : {}),
			});
			if (error) throw error;

			const stats = data?.[0];
			return {
				totalWorkouts: stats?.total_workouts ?? 0,
				totalVolume: Number(stats?.total_volume ?? 0),
				bestStreak: stats?.best_streak ?? 0,
				prCount: stats?.pr_count ?? 0,
			};
		},
	});
}

/**
 * Top 5 exercises by the number of sessions they appear in.
 *
 * Counted in SQL by `exercise_frequency` (already ordered by sessions DESC,
 * name ASC). The previous two-step "every session id, then .in(session_id,
 * ids)" read put every UUID in the GET URL and failed at ~200 sessions
 * (F-035). An exercise repeated within one session now counts once.
 */
export function topExercisesOptions(userId: string, profileId?: string | null) {
	return queryOptions({
		queryKey: queryKeys.profile.topExercises(userId, profileId),
		queryFn: async () => {
			const { data, error } = await supabase.rpc(
				"exercise_frequency",
				profileId ? { p_profile_id: profileId } : {},
			);
			if (error) throw error;

			return (data ?? []).slice(0, 5).map((row) => ({
				name: row.exercise_name,
				count: row.sessions,
			}));
		},
	});
}

export function earnedBadgesOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.profile.badges(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("earned_badges")
				.select(
					"user_id, badge_id, badge_name, badge_description, badge_tier, earned_at",
				)
				.eq("user_id", userId)
				.order("earned_at", { ascending: false });
			if (error) throw error;
			return earnedBadgeListSchema.parse(data ?? []);
		},
	});
}

export function rpgAttributesOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.profile.rpg(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("rpg_attributes")
				.select(
					"user_id, strength, power, stamina, consistency, mastery, character_class, level, experience_points, updated_at",
				)
				.eq("user_id", userId)
				.maybeSingle();
			if (error) throw error;
			return data ? rpgAttributesSchema.parse(data) : null;
		},
	});
}

export function gamificationStatsOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.profile.gamification(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("gamification_stats")
				.select(
					"user_id, total_workouts, total_reps, total_volume_kg, longest_streak, current_streak, total_time_seconds, updated_at",
				)
				.eq("user_id", userId)
				.maybeSingle();
			if (error) throw error;
			return data ? gamificationStatsSchema.parse(data) : null;
		},
	});
}
