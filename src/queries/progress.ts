import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { exerciseProgressSchema } from "@/schemas/telemetry";
import { queryKeys } from "./keys";

/** Fetch distinct exercise names for the user */
export function exerciseListOptions(userId: string, profileId?: string | null) {
	return queryOptions({
		queryKey: queryKeys.progress.exercises(userId, profileId),
		queryFn: async () => {
			let query = supabase
				.from("exercise_progress")
				.select("exercise_name")
				.eq("user_id", userId);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query.order("exercise_name");
			if (error) throw error;
			const names = [...new Set((data ?? []).map((d) => d.exercise_name))];
			return names as string[];
		},
	});
}

/** Exercise-specific progress over time (1RM, volume, weight trends) */
export function exerciseProgressOptions(userId: string, exerciseName: string, profileId?: string | null) {
	return queryOptions({
		queryKey: queryKeys.progress.byExercise(userId, exerciseName, profileId),
		queryFn: async () => {
			let query = supabase
				.from("exercise_progress")
				.select("*")
				.eq("user_id", userId)
				.eq("exercise_name", exerciseName);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query
				.order("recorded_at", { ascending: true });
			if (error) throw error;
			return z.array(exerciseProgressSchema).parse(data);
		},
	});
}

/**
 * Weekly/monthly summary: fetches raw exercise progress for client-side aggregation.
 * Consistent with existing patterns (volume bucketing in analytics).
 */
export function weeklySummaryOptions(userId: string, period: "week" | "month", profileId?: string | null) {
	return queryOptions({
		queryKey: queryKeys.progress.summary(userId, period, profileId),
		queryFn: async () => {
			const daysBack = period === "week" ? 7 : 30;
			const since = new Date();
			since.setDate(since.getDate() - daysBack);

			let query = supabase
				.from("exercise_progress")
				.select("*")
				.eq("user_id", userId);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query
				.gte("recorded_at", since.toISOString())
				.order("recorded_at", { ascending: true });
			if (error) throw error;
			return z.array(exerciseProgressSchema).parse(data);
		},
	});
}
