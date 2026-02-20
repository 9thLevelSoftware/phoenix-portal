import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { exerciseProgressSchema } from "@/schemas/telemetry";
import { queryKeys } from "./keys";

/** Exercise-specific progress over time (1RM, volume, weight trends) */
export function exerciseProgressOptions(userId: string, exerciseName: string) {
	return queryOptions({
		queryKey: queryKeys.progress.byExercise(userId, exerciseName),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("exercise_progress")
				.select("*")
				.eq("user_id", userId)
				.eq("exercise_name", exerciseName)
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
export function weeklySummaryOptions(userId: string, period: "week" | "month") {
	return queryOptions({
		queryKey: queryKeys.progress.summary(userId, period),
		queryFn: async () => {
			const daysBack = period === "week" ? 7 : 30;
			const since = new Date();
			since.setDate(since.getDate() - daysBack);

			const { data, error } = await supabase
				.from("exercise_progress")
				.select("*")
				.eq("user_id", userId)
				.gte("recorded_at", since.toISOString())
				.order("recorded_at", { ascending: true });
			if (error) throw error;
			return z.array(exerciseProgressSchema).parse(data);
		},
	});
}
