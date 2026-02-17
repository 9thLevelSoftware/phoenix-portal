import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import {
	exerciseSchema,
	personalRecordListSchema,
	setSchema,
	workoutListSchema,
	workoutSessionSchema,
} from "@/schemas/transforms";
import { queryKeys } from "./keys";

/**
 * Paginated workout session list for a user.
 * Returns Zod-transformed WorkoutSession[] (weights doubled, dates as Date, duration as minutes).
 */
export function workoutListOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.workouts.list(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("workout_sessions")
				.select("*")
				.eq("user_id", userId)
				.order("started_at", { ascending: false })
				.limit(50);
			if (error) throw error;
			return workoutListSchema.parse(data);
		},
	});
}

/**
 * Dashboard summary stats -- recent workouts for the past 7 days.
 * Returns raw rows so the Dashboard component can aggregate (weekly volume chart, totals).
 */
export function dashboardStatsOptions(userId: string) {
	return queryOptions({
		queryKey: [...queryKeys.workouts.all, "dashboard-stats", userId] as const,
		queryFn: async () => {
			const weekAgo = new Date();
			weekAgo.setDate(weekAgo.getDate() - 7);

			const { data, error } = await supabase
				.from("workout_sessions")
				.select("started_at, total_volume, duration_seconds, pr_count")
				.eq("user_id", userId)
				.gte("started_at", weekAgo.toISOString())
				.order("started_at", { ascending: true });
			if (error) throw error;
			return data;
		},
	});
}

/**
 * Most recent personal records for the dashboard PR widget.
 * Returns Zod-transformed PersonalRecord[] (weights doubled, dates as Date).
 */
export function recentPRsOptions(userId: string) {
	return queryOptions({
		queryKey: [...queryKeys.records.all, "recent", userId] as const,
		queryFn: async () => {
			const { data, error } = await supabase
				.from("personal_records")
				.select("*")
				.eq("user_id", userId)
				.order("achieved_at", { ascending: false })
				.limit(5);
			if (error) throw error;
			return personalRecordListSchema.parse(data);
		},
	});
}

/**
 * Full session detail with exercises and sets.
 * Fetches session metadata, exercises, and sets in three queries,
 * then assembles them into a nested structure.
 */
export function sessionDetailOptions(sessionId: string) {
	return queryOptions({
		queryKey: queryKeys.workouts.detail(sessionId),
		queryFn: async () => {
			// Fetch session metadata
			const { data: session, error: sessionError } = await supabase
				.from("workout_sessions")
				.select("*")
				.eq("id", sessionId)
				.single();
			if (sessionError) throw sessionError;

			// Fetch exercises for this session
			const { data: exercises, error: exercisesError } = await supabase
				.from("exercises")
				.select("*")
				.eq("session_id", sessionId)
				.order("order_index", { ascending: true });
			if (exercisesError) throw exercisesError;

			// Fetch sets for all exercises in this session
			const exerciseIds = exercises.map((e: { id: string }) => e.id);
			const { data: sets, error: setsError } = await supabase
				.from("sets")
				.select("*")
				.in("exercise_id", exerciseIds)
				.order("set_number", { ascending: true });
			if (setsError) throw setsError;

			// Parse with Zod and assemble
			const parsedSession = workoutSessionSchema.parse(session);
			const parsedExercises = z.array(exerciseSchema).parse(exercises);
			const parsedSets = z.array(setSchema).parse(sets);

			// Group sets by exercise
			const exercisesWithSets = parsedExercises.map((exercise) => ({
				...exercise,
				sets: parsedSets.filter((s) => s.exercise_id === exercise.id),
				hasPR: parsedSets.some((s) => s.exercise_id === exercise.id && s.is_pr),
			}));

			return {
				...parsedSession,
				exercises: exercisesWithSets,
			};
		},
		enabled: !!sessionId,
	});
}
