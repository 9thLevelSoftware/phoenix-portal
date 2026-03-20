import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "./keys";

/** Volume trend over time (for area/bar chart) */
export function volumeTrendOptions(userId: string, period: string = "4w") {
	return queryOptions({
		queryKey: queryKeys.analytics.summary(userId, `volume-${period}`),
		queryFn: async () => {
			let query = supabase
				.from("workout_sessions")
				.select("started_at, total_volume")
				.eq("user_id", userId)
				.order("started_at", { ascending: true });

			// Apply date filter unless "all" (fetch everything)
			if (period !== "all") {
				const daysBack =
					period === "52w"
						? 365
						: period === "12w"
							? 84
							: period === "4w"
								? 28
								: 7;
				const since = new Date();
				since.setDate(since.getDate() - daysBack);
				query = query.gte("started_at", since.toISOString());
			}

			const { data, error } = await query;
			if (error) throw error;
			return data;
		},
	});
}

/** Muscle group distribution (for pie/donut chart) */
export function muscleGroupOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.analytics.summary(userId, "muscle-groups"),
		queryFn: async () => {
			// Two-step approach: get user's session IDs, then get exercises grouped by muscle_group
			const { data: sessions, error: sessionError } = await supabase
				.from("workout_sessions")
				.select("id")
				.eq("user_id", userId);
			if (sessionError) throw sessionError;

			if (!sessions || sessions.length === 0) return [];

			const sessionIds = sessions.map((s) => s.id);
			const { data: exercises, error: exerciseError } = await supabase
				.from("exercises")
				.select("muscle_group")
				.in("session_id", sessionIds);
			if (exerciseError) throw exerciseError;

			// Group by muscle_group and count
			const counts: Record<string, number> = {};
			for (const ex of exercises ?? []) {
				counts[ex.muscle_group] = (counts[ex.muscle_group] ?? 0) + 1;
			}

			const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
			return Object.entries(counts).map(([name, count]) => ({
				name,
				value: total > 0 ? Math.round((count / total) * 100) : 0,
			}));
		},
	});
}

/** Strength progress (exercise-specific 1RM trends for line chart) */
export function strengthProgressOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.analytics.summary(userId, "strength-progress"),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("personal_records")
				.select("exercise_name, value, achieved_at")
				.eq("user_id", userId)
				.order("achieved_at", { ascending: true });
			if (error) throw error;
			return data;
		},
	});
}

/** Volume trend with previous period comparison */
export function volumeComparisonOptions(userId: string, period: string = "4w") {
	return queryOptions({
		queryKey: queryKeys.analytics.summary(
			userId,
			`volume-comparison-${period}`,
		),
		queryFn: async () => {
			const daysBack = periodToDays(period);
			const currentStart = new Date();
			currentStart.setDate(currentStart.getDate() - daysBack);
			const previousStart = new Date();
			previousStart.setDate(previousStart.getDate() - daysBack * 2);

			const [currentData, previousData] = await Promise.all([
				supabase
					.from("workout_sessions")
					.select(
						"started_at, total_volume, duration_seconds, set_count, exercise_count",
					)
					.eq("user_id", userId)
					.gte("started_at", currentStart.toISOString())
					.order("started_at", { ascending: true }),
				supabase
					.from("workout_sessions")
					.select(
						"started_at, total_volume, duration_seconds, set_count, exercise_count",
					)
					.eq("user_id", userId)
					.gte("started_at", previousStart.toISOString())
					.lt("started_at", currentStart.toISOString())
					.order("started_at", { ascending: true }),
			]);

			if (currentData.error) throw currentData.error;
			if (previousData.error) throw previousData.error;
			return { current: currentData.data, previous: previousData.data };
		},
	});
}

function periodToDays(period: string): number {
	if (period === "all") return 3650;
	if (period === "52w") return 365;
	if (period === "12w") return 84;
	if (period === "4w") return 28;
	return 7;
}

/** Form score trend over time (GAP 4) */
export function formScoreTrendOptions(userId: string, period: string = "4w") {
	return queryOptions({
		queryKey: queryKeys.analytics.summary(userId, `form-score-${period}`),
		queryFn: async () => {
			const daysBack = periodToDays(period);
			const since = new Date();
			since.setDate(since.getDate() - daysBack);

			const { data, error } = await supabase
				.from("workout_sessions")
				.select("started_at, form_score")
				.eq("user_id", userId)
				.not("form_score", "is", null)
				.gte("started_at", since.toISOString())
				.order("started_at", { ascending: true });
			if (error) throw error;
			return data;
		},
	});
}

/** Safety events trend (deload warnings, ROM violations, spotter activations) (GAP 4) */
export function safetyTrendOptions(userId: string, period: string = "4w") {
	return queryOptions({
		queryKey: queryKeys.analytics.summary(userId, `safety-${period}`),
		queryFn: async () => {
			const daysBack = periodToDays(period);
			const since = new Date();
			since.setDate(since.getDate() - daysBack);

			const { data, error } = await supabase
				.from("workout_sessions")
				.select(
					"started_at, deload_warnings, rom_violations, spotter_activations",
				)
				.eq("user_id", userId)
				.gte("started_at", since.toISOString())
				.order("started_at", { ascending: true });
			if (error) throw error;
			return (data ?? []).filter(
				(r) =>
					(r.deload_warnings ?? 0) > 0 ||
					(r.rom_violations ?? 0) > 0 ||
					(r.spotter_activations ?? 0) > 0,
			);
		},
	});
}

/** Calorie burn history (GAP 5) */
export function calorieHistoryOptions(userId: string, period: string = "4w") {
	return queryOptions({
		queryKey: queryKeys.analytics.summary(userId, `calories-${period}`),
		queryFn: async () => {
			const daysBack = periodToDays(period);
			const since = new Date();
			since.setDate(since.getDate() - daysBack);

			const { data, error } = await supabase
				.from("workout_sessions")
				.select("started_at, estimated_calories")
				.eq("user_id", userId)
				.not("estimated_calories", "is", null)
				.gte("started_at", since.toISOString())
				.order("started_at", { ascending: true });
			if (error) throw error;
			return data;
		},
	});
}

/** Phase statistics for a session (GAP 7) */
export function phaseStatisticsOptions(sessionId: string) {
	return queryOptions({
		queryKey: [...queryKeys.analytics.all, "phase-stats", sessionId] as const,
		queryFn: async () => {
			const { data, error } = await supabase
				.from("session_phase_statistics")
				.select("*")
				.eq("session_id", sessionId)
				.maybeSingle();
			if (error) throw error;
			return data;
		},
		enabled: !!sessionId,
	});
}

/** VBT assessments for an exercise (GAP 9) */
export function vbtAssessmentsOptions(userId: string, exerciseId: string) {
	return queryOptions({
		queryKey: [
			...queryKeys.analytics.all,
			"vbt-assessments",
			exerciseId,
		] as const,
		queryFn: async () => {
			const { data, error } = await supabase
				.from("vbt_assessments")
				.select("*")
				.eq("user_id", userId)
				.eq("exercise_id", exerciseId)
				.order("created_at", { ascending: false });
			if (error) throw error;
			return data;
		},
		enabled: !!exerciseId,
	});
}
