import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { WEIGHT_MULTIPLIER } from "@/schemas/transforms";
import { queryKeys } from "./keys";

/** Fetch all active challenges */
export function challengeListOptions() {
	return queryOptions({
		queryKey: queryKeys.challenges.list(),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("challenges")
				.select("*")
				.eq("is_active", true)
				.order("start_date", { ascending: false });
			if (error) throw error;
			return (data ?? []) as Challenge[];
		},
	});
}

/** Fetch challenges the user has joined */
export function userChallengesOptions(userId: string) {
	return queryOptions({
		queryKey: [...queryKeys.challenges.all, "user", userId] as const,
		queryFn: async () => {
			const { data, error } = await supabase
				.from("challenge_participants")
				.select("*, challenges(*)")
				.eq("user_id", userId);
			if (error) throw error;
			return (data ?? []) as UserChallenge[];
		},
		enabled: !!userId,
	});
}

/** Compute challenge progress from workout_sessions or phase-aware PR rows */
export function challengeProgressOptions(
	userId: string,
	challengeId: string,
	challengeType: string,
	targetValue: number,
	startDate: string,
	endDate: string,
) {
	return queryOptions({
		queryKey: [
			...queryKeys.challenges.detail(challengeId),
			"progress",
			userId,
		] as const,
		queryFn: async () => {
			let current = 0;

			switch (challengeType) {
				case "volume": {
					const { data, error } = await supabase
						.from("workout_sessions")
						.select("total_volume")
						.eq("user_id", userId)
						.gte("started_at", startDate)
						.lte("started_at", endDate);
					if (error) throw error;
					current = (data ?? []).reduce(
						(sum, w) => sum + (w.total_volume ?? 0) * WEIGHT_MULTIPLIER,
						0,
					);
					break;
				}
				case "frequency": {
					const { data, error } = await supabase
						.from("workout_sessions")
						.select("id")
						.eq("user_id", userId)
						.gte("started_at", startDate)
						.lte("started_at", endDate);
					if (error) throw error;
					current = (data ?? []).length;
					break;
				}
				case "streak": {
					const { data, error } = await supabase
						.from("workout_sessions")
						.select("started_at")
						.eq("user_id", userId)
						.gte("started_at", startDate)
						.lte("started_at", endDate)
						.order("started_at", { ascending: false });
					if (error) throw error;
					current = computeStreak(data ?? []);
					break;
				}
				case "pr_count": {
					// Phase-specific records are distinct rows in personal_records and
					// intentionally count separately for PR-count challenges.
					const { data, error } = await supabase
						.from("personal_records")
						.select("id")
						.eq("user_id", userId)
						.gte("achieved_at", startDate)
						.lte("achieved_at", endDate);
					if (error) throw error;
					current = (data ?? []).length;
					break;
				}
			}

			const percentage = Math.min(
				100,
				targetValue > 0 ? Math.round((current / targetValue) * 100) : 0,
			);
			return { current, target: targetValue, percentage };
		},
		enabled: !!userId && !!challengeId,
	});
}

function computeStreak(sessions: Array<{ started_at: string }>): number {
	if (sessions.length === 0) return 0;

	const dates = [
		...new Set(sessions.map((s) => new Date(s.started_at).toDateString())),
	].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

	let streak = 1;
	for (let i = 0; i < dates.length - 1; i++) {
		const current = new Date(dates[i]);
		const previous = new Date(dates[i + 1]);
		const diffDays =
			(current.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24);
		if (diffDays <= 1) {
			streak++;
		} else {
			break;
		}
	}
	return streak;
}

// Types for challenges data
export interface Challenge {
	id: string;
	name: string;
	description: string;
	challenge_type: string;
	target_value: number;
	target_unit: string;
	start_date: string;
	end_date: string;
	difficulty: string;
	prize: string | null;
	created_at: string;
	is_active: boolean;
}

export interface UserChallenge {
	id: string;
	challenge_id: string;
	user_id: string;
	joined_at: string;
	completed_at: string | null;
	challenges: Challenge;
}
