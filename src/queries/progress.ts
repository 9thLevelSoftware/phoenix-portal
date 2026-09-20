import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { exerciseProgressSchema } from "@/schemas/telemetry";
import { queryKeys } from "./keys";

/**
 * Newest rows requested per exercise.
 *
 * `exercise_progress_series` clamps at 1,000, which is also the deep dive's
 * whole history for a single exercise. The batched workbench form uses a
 * smaller per-exercise cap so the one response stays bounded across every
 * exercise; that cap drops the OLDEST points, which shifts the workbench's
 * "gain since the first point" for an exercise with more than
 * `WORKBENCH_ROWS_PER_EXERCISE` recorded sessions.
 */
export const EXERCISE_PROGRESS_SERIES_LIMIT = 1000;
export const WORKBENCH_ROWS_PER_EXERCISE = 200;

/** Fetch distinct exercise names for the user */
export function exerciseListOptions(userId: string, profileId?: string | null) {
	return queryOptions({
		queryKey: queryKeys.progress.exercises(userId, profileId),
		queryFn: async () => {
			// `exercise_names` de-duplicates in SQL. The old select read every
			// progress row just to build this list and was truncated at 1,000
			// (F-034), which made exercises late in the alphabet disappear.
			const { data, error } = await supabase.rpc(
				"exercise_names",
				profileId ? { p_profile_id: profileId } : {},
			);
			if (error) throw error;
			return (data ?? []).map((row) => row.exercise_name);
		},
	});
}

/** Exercise-specific progress over time (1RM, volume, weight trends) */
export function exerciseProgressOptions(
	userId: string,
	exerciseName: string,
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: queryKeys.progress.byExercise(userId, exerciseName, profileId),
		queryFn: async () => {
			// Newest-first in SQL with an explicit limit, so a long history loses
			// its OLDEST points instead of its newest ones (F-034). Callers chart
			// chronologically, so hand them back ascending.
			const { data, error } = await supabase.rpc("exercise_progress_series", {
				p_exercise: exerciseName,
				p_limit: EXERCISE_PROGRESS_SERIES_LIMIT,
				...(profileId ? { p_profile_id: profileId } : {}),
			});
			if (error) throw error;
			return z.array(exerciseProgressSchema).parse([...(data ?? [])].reverse());
		},
	});
}

/**
 * Progress rows for the customer progression workbench.
 *
 * ONE batched call to `exercise_progress_series_many`, which returns one row
 * per exercise carrying that exercise's newest rows as a jsonb array. A flat
 * SETOF would run into PostgREST's 1,000-row `max_rows` as soon as a user has
 * a handful of exercises and would be truncated silently — the F-034 defect
 * this replaces.
 *
 * Personal records are NOT fetched here any more: the workbench reads them
 * from the shared `personalRecordsOptions` query, so a page view fetches the
 * record list once instead of twice.
 */
export function progressionWorkbenchOptions(
	userId: string,
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: queryKeys.progress.summary(userId, "workbench", profileId),
		queryFn: async () => {
			const { data, error } = await supabase.rpc(
				"exercise_progress_series_many",
				{
					p_limit_per_exercise: WORKBENCH_ROWS_PER_EXERCISE,
					// Generated types mark defaulted arguments optional: omit
					// `p_exercises` (all exercises) rather than passing null.
					...(profileId ? { p_profile_id: profileId } : {}),
				},
			);
			if (error) throw error;

			const progressRows = (data ?? []).flatMap((group) =>
				z.array(exerciseProgressSchema).parse(group.rows ?? []),
			);
			return { progressRows };
		},
		staleTime: 5 * 60 * 1000,
	});
}

/**
 * Weekly/monthly summary: fetches raw exercise progress for client-side aggregation.
 * Consistent with existing patterns (volume bucketing in analytics).
 */
export function weeklySummaryOptions(
	userId: string,
	period: "week" | "month",
	profileId?: string | null,
) {
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
