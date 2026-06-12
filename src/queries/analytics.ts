import { queryOptions } from "@tanstack/react-query";
import { classifyMuscleGroup } from "@/lib/exercise-muscles";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "./keys";
import {
	resolvePersonalRecordDisplayNames,
	STRENGTH_PROGRESS_WITH_CATALOG_SELECT,
} from "./personal-record-normalization";

/** Volume trend over time (for area/bar chart) */
export function volumeTrendOptions(
	userId: string,
	period: string = "4w",
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: queryKeys.analytics.summary(
			userId,
			`volume-${period}`,
			profileId,
		),
		queryFn: async () => {
			let query = supabase
				.from("workout_sessions")
				.select("started_at, total_volume")
				.eq("user_id", userId);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			query = query.order("started_at", { ascending: true });

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
export function muscleGroupOptions(userId: string, profileId?: string | null) {
	return queryOptions({
		queryKey: queryKeys.analytics.summary(userId, "muscle-groups", profileId),
		queryFn: async () => {
			// Two-step approach: get user's session IDs, then get exercises grouped by muscle_group
			let sessionQuery = supabase
				.from("workout_sessions")
				.select("id")
				.eq("user_id", userId);

			if (profileId) {
				sessionQuery = sessionQuery.eq("local_profile_id", profileId);
			}

			const { data: sessions, error: sessionError } = await sessionQuery;
			if (sessionError) throw sessionError;

			if (!sessions || sessions.length === 0) return [];

			const sessionIds = sessions.map((s) => s.id);
			const { data: exercises, error: exerciseError } = await supabase
				.from("exercises")
				.select("name, muscle_group")
				.in("session_id", sessionIds);
			if (exerciseError) throw exerciseError;

			// Classify by exercise NAME (canonical 6 groups), falling back to a
			// real muscle_group hint only when the name is unclassifiable. The DB
			// muscle_group column is unreliable — historically it was hardcoded to
			// "General" on every row by the mobile sync push, so trusting it
			// collapsed the entire distribution into a single "General" bucket.
			// Genuinely unclassifiable rows are dropped from the distribution.
			const counts: Record<string, number> = {};
			for (const ex of exercises ?? []) {
				const group = classifyMuscleGroup(ex.name ?? "", ex.muscle_group);
				if (group === "General") continue;
				counts[group] = (counts[group] ?? 0) + 1;
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
export function strengthProgressOptions(
	userId: string,
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: queryKeys.analytics.summary(
			userId,
			"strength-progress",
			profileId,
		),
		queryFn: async () => {
			let query = supabase
				.from("personal_records")
				.select(STRENGTH_PROGRESS_WITH_CATALOG_SELECT)
				.eq("user_id", userId);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query.order("achieved_at", {
				ascending: true,
			});
			if (error) throw error;
			return resolvePersonalRecordDisplayNames(data);
		},
	});
}

/** Volume trend with previous period comparison */
export function volumeComparisonOptions(
	userId: string,
	period: string = "4w",
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: queryKeys.analytics.summary(
			userId,
			`volume-comparison-${period}`,
			profileId,
		),
		queryFn: async () => {
			const daysBack = periodToDays(period);
			const currentStart = new Date();
			currentStart.setDate(currentStart.getDate() - daysBack);
			const previousStart = new Date();
			previousStart.setDate(previousStart.getDate() - daysBack * 2);

			let currentQuery = supabase
				.from("workout_sessions")
				.select(
					"started_at, total_volume, duration_seconds, set_count, exercise_count",
				)
				.eq("user_id", userId);
			let previousQuery = supabase
				.from("workout_sessions")
				.select(
					"started_at, total_volume, duration_seconds, set_count, exercise_count",
				)
				.eq("user_id", userId);

			if (profileId) {
				currentQuery = currentQuery.eq("local_profile_id", profileId);
				previousQuery = previousQuery.eq("local_profile_id", profileId);
			}

			const [currentData, previousData] = await Promise.all([
				currentQuery
					.gte("started_at", currentStart.toISOString())
					.order("started_at", { ascending: true }),
				previousQuery
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
export function formScoreTrendOptions(
	userId: string,
	period: string = "4w",
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: queryKeys.analytics.summary(
			userId,
			`form-score-${period}`,
			profileId,
		),
		queryFn: async () => {
			const daysBack = periodToDays(period);
			const since = new Date();
			since.setDate(since.getDate() - daysBack);

			let query = supabase
				.from("workout_sessions")
				.select("started_at, form_score")
				.eq("user_id", userId);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query
				.not("form_score", "is", null)
				.gte("started_at", since.toISOString())
				.order("started_at", { ascending: true });
			if (error) throw error;
			return data;
		},
	});
}

/** Safety events trend (deload warnings, ROM violations, spotter activations) (GAP 4) */
export function safetyTrendOptions(
	userId: string,
	period: string = "4w",
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: queryKeys.analytics.summary(
			userId,
			`safety-${period}`,
			profileId,
		),
		queryFn: async () => {
			const daysBack = periodToDays(period);
			const since = new Date();
			since.setDate(since.getDate() - daysBack);

			let query = supabase
				.from("workout_sessions")
				.select(
					"started_at, deload_warnings, rom_violations, spotter_activations",
				)
				.eq("user_id", userId);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query
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
export function calorieHistoryOptions(
	userId: string,
	period: string = "4w",
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: queryKeys.analytics.summary(
			userId,
			`calories-${period}`,
			profileId,
		),
		queryFn: async () => {
			const daysBack = periodToDays(period);
			const since = new Date();
			since.setDate(since.getDate() - daysBack);

			let query = supabase
				.from("workout_sessions")
				.select("started_at, estimated_calories")
				.eq("user_id", userId);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query
				.not("estimated_calories", "is", null)
				.gte("started_at", since.toISOString())
				.order("started_at", { ascending: true });
			if (error) throw error;
			return data;
		},
	});
}

/** Phase statistics over time for concentric/eccentric analytics */
export function phaseStatisticsTrendOptions(
	userId: string,
	period: string = "4w",
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: queryKeys.analytics.phaseStats(userId, period, profileId),
		queryFn: async () => {
			const daysBack = periodToDays(period);
			const since = new Date();
			since.setDate(since.getDate() - daysBack);

			let query = supabase
				.from("session_phase_statistics")
				.select(
					[
						"session_id",
						"concentric_kg_avg",
						"concentric_kg_max",
						"concentric_vel_avg",
						"concentric_vel_max",
						"concentric_watt_avg",
						"concentric_watt_max",
						"eccentric_kg_avg",
						"eccentric_kg_max",
						"eccentric_vel_avg",
						"eccentric_vel_max",
						"eccentric_watt_avg",
						"eccentric_watt_max",
						"workout_sessions!inner(started_at, local_profile_id, name)",
					].join(", "),
				)
				.eq("user_id", userId)
				.gte("workout_sessions.started_at", since.toISOString())
				.order("created_at", { ascending: true });

			if (profileId) {
				query = query.eq("workout_sessions.local_profile_id", profileId);
			}

			const { data, error } = await query;
			if (error) throw error;
			return data ?? [];
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
