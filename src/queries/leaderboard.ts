import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/queries/keys";

export interface LeaderboardEntry {
	userId: string;
	displayName: string;
	avatarUrl: string | null;
	rank: number;
	value: number;
	percentile: number;
}

export interface UserRanking {
	metric: string;
	rank: number;
	value: number;
	percentile: number;
	totalUsers: number;
}

export interface GlobalLeaderboard {
	totalVolume: LeaderboardEntry[];
	workoutCount: LeaderboardEntry[];
	longestStreak: LeaderboardEntry[];
	currentStreak: LeaderboardEntry[];
	prCount: LeaderboardEntry[];
	exerciseMastery: LeaderboardEntry[];
}

export interface WeeklyCompetition {
	id: string;
	metric: string;
	metricLabel: string;
	startDate: string;
	endDate: string;
	entries: LeaderboardEntry[];
	isSpecialEvent: boolean;
	eventName?: string;
}

export const globalLeaderboardOptions = () =>
	queryOptions({
		queryKey: queryKeys.leaderboard.global(),
		queryFn: async (): Promise<GlobalLeaderboard> => {
			const { data, error } = await supabase.functions.invoke(
				"compute-rankings",
				{
					body: { type: "global" },
				},
			);

			if (error) throw error;
			if (!data) throw new Error("No data returned from compute-rankings");
			return data as GlobalLeaderboard;
		},
		staleTime: 5 * 60 * 1000, // 5 minutes
	});

export const weeklyCompetitionOptions = (weekStart?: string) => {
	// Normalize to ensure query key and request body use same value
	const normalizedWeekStart = weekStart ?? getCurrentWeekStart();

	return queryOptions({
		queryKey: queryKeys.leaderboard.weekly(normalizedWeekStart),
		queryFn: async (): Promise<WeeklyCompetition> => {
			const { data, error } = await supabase.functions.invoke(
				"compute-rankings",
				{
					body: { type: "weekly", weekStart: normalizedWeekStart },
				},
			);

			if (error) throw error;
			if (!data) throw new Error("No data returned from compute-rankings");
			return data as WeeklyCompetition;
		},
		staleTime: 2 * 60 * 1000, // 2 minutes
	});
};

export const userRankingOptions = (userId: string) =>
	queryOptions({
		queryKey: queryKeys.leaderboard.userRank(userId),
		queryFn: async (): Promise<UserRanking[]> => {
			const { data, error } = await supabase.functions.invoke(
				"compute-rankings",
				{
					body: { type: "user", userId },
				},
			);

			if (error) throw error;
			if (!data) throw new Error("No data returned from compute-rankings");
			return data as UserRanking[];
		},
		staleTime: 5 * 60 * 1000,
		enabled: !!userId,
	});

function getCurrentWeekStart(): string {
	const now = new Date();
	const day = now.getDay();
	const diff = now.getDate() - day + (day === 0 ? -6 : 1);
	const monday = new Date(now.setDate(diff));
	return monday.toISOString().split("T")[0];
}
