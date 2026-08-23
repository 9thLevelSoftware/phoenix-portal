import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import type { SessionSummary } from "@/lib/comparison";
import { supabase } from "@/lib/supabase";
import {
	exerciseSchema,
	personalRecordListSchema,
	setSchema,
	workoutListSchema,
	workoutSessionSchema,
} from "@/schemas/transforms";
import { queryKeys } from "./keys";
import {
	PERSONAL_RECORD_WITH_CATALOG_SELECT,
	resolvePersonalRecordDisplayNames,
} from "./personal-record-normalization";

/**
 * Paginated workout session list for a user.
 * Returns Zod-transformed WorkoutSession[] (weights doubled, dates as Date, duration as minutes).
 */
export const WORKOUTS_PAGE_SIZE = 50;

export function workoutListOptions(userId: string, profileId?: string | null) {
	return queryOptions({
		queryKey: queryKeys.workouts.list(userId, profileId),
		queryFn: async () => {
			let query = supabase
				.from("workout_sessions")
				.select("*")
				.eq("user_id", userId);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query
				.order("started_at", { ascending: false })
				.limit(WORKOUTS_PAGE_SIZE);
			if (error) throw error;
			return workoutListSchema.parse(data);
		},
	});
}

/**
 * Fetch the next page of workout sessions, offset by the number already loaded.
 */
export function workoutListPageOptions(
	userId: string,
	offset: number,
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: [
			...queryKeys.workouts.list(userId, profileId),
			"page",
			offset,
		] as const,
		queryFn: async () => {
			let query = supabase
				.from("workout_sessions")
				.select("*")
				.eq("user_id", userId);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query
				.order("started_at", { ascending: false })
				.range(offset, offset + WORKOUTS_PAGE_SIZE - 1);
			if (error) throw error;
			return workoutListSchema.parse(data);
		},
	});
}

/**
 * Infinite workout history. Query key sits under `queryKeys.workouts.all` so
 * realtime invalidation drops extra pages instead of leaving a shadow list.
 */
export function workoutListInfiniteOptions(
	userId: string,
	profileId?: string | null,
) {
	return infiniteQueryOptions({
		queryKey: queryKeys.workouts.infinite(userId, profileId),
		queryFn: async ({ pageParam = 0 }) => {
			let query = supabase
				.from("workout_sessions")
				.select("*")
				.eq("user_id", userId);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query
				.order("started_at", { ascending: false })
				.range(pageParam, pageParam + WORKOUTS_PAGE_SIZE - 1);
			if (error) throw error;
			return workoutListSchema.parse(data);
		},
		initialPageParam: 0,
		getNextPageParam: (lastPage, allPages) => {
			if (lastPage.length < WORKOUTS_PAGE_SIZE) return undefined;
			return allPages.reduce((total, page) => total + page.length, 0);
		},
	});
}

/**
 * SQL streak matching `useStreak` UTC unique-date + today-skip semantics.
 * Invalidated with the rest of the workouts family on mobile sync.
 */
export function workoutStreakOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.workouts.streak(userId),
		queryFn: async () => {
			const { data, error } = await supabase.rpc("workout_current_streak", {
				p_user_id: userId,
			});
			if (error) throw error;
			return typeof data === "number" && Number.isFinite(data) ? data : 0;
		},
		enabled: !!userId,
	});
}

/**
 * Dashboard summary stats -- recent workouts for the past 7 days.
 * Returns raw rows so the Dashboard component can aggregate (weekly volume chart, totals).
 */
export function dashboardStatsOptions(
	userId: string,
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: [
			...queryKeys.workouts.all,
			"dashboard-stats",
			userId,
			profileId ?? "all",
		] as const,
		queryFn: async () => {
			const weekAgo = new Date();
			weekAgo.setDate(weekAgo.getDate() - 7);

			let query = supabase
				.from("workout_sessions")
				.select(
					"started_at, total_volume, duration_seconds, pr_count, estimated_calories, form_score",
				)
				.eq("user_id", userId);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query
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
export function recentPRsOptions(userId: string, profileId?: string | null) {
	return queryOptions({
		queryKey: [
			...queryKeys.records.all,
			"recent",
			userId,
			profileId ?? "all",
		] as const,
		queryFn: async () => {
			let query = supabase
				.from("personal_records")
				.select(PERSONAL_RECORD_WITH_CATALOG_SELECT)
				.eq("user_id", userId)
				.is("deleted_at", null);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query
				.order("achieved_at", { ascending: false })
				.limit(5);
			if (error) throw error;
			return personalRecordListSchema.parse(
				await resolvePersonalRecordDisplayNames(data),
			);
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

			// Fetch sets for all exercises in this session. Skip the query entirely
			// for sessions with zero exercises: `exercise_id` is a UUID column, so a
			// sentinel like `_none_` in an `in` filter is rejected as invalid UUID.
			const exerciseIds = exercises.map((e: { id: string }) => e.id);
			let sets: unknown[] = [];
			if (exerciseIds.length > 0) {
				const { data, error: setsError } = await supabase
					.from("sets")
					.select("*")
					.in("exercise_id", exerciseIds)
					.order("set_number", { ascending: true });
				if (setsError) throw setsError;
				sets = data ?? [];
			}

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

/**
 * Extended session detail that also fetches rep summaries for velocity data.
 * Returns a SessionSummary ready for the comparison engine.
 */
export function comparisonDetailOptions(sessionId: string) {
	return queryOptions({
		queryKey: queryKeys.workouts.comparison(sessionId, "detail"),
		queryFn: async (): Promise<SessionSummary> => {
			// Re-use sessionDetailOptions data structure
			const { data: session, error: sessionError } = await supabase
				.from("workout_sessions")
				.select("*")
				.eq("id", sessionId)
				.single();
			if (sessionError) throw sessionError;

			const { data: exercises, error: exercisesError } = await supabase
				.from("exercises")
				.select("*")
				.eq("session_id", sessionId)
				.order("order_index", { ascending: true });
			if (exercisesError) throw exercisesError;

			const exerciseIds = exercises.map((e: { id: string }) => e.id);

			// Skip the sets query for empty sessions: `exercise_id` is a UUID column,
			// so a `_none_` sentinel in an `in` filter is rejected as invalid UUID.
			let sets: { id: string; exercise_id: string }[] = [];
			if (exerciseIds.length > 0) {
				const { data, error: setsError } = await supabase
					.from("sets")
					.select("*")
					.in("exercise_id", exerciseIds)
					.order("set_number", { ascending: true });
				if (setsError) throw setsError;
				sets = (data ?? []) as { id: string; exercise_id: string }[];
			}

			// Fetch rep summaries for velocity data
			const setIds = sets.map((s: { id: string }) => s.id);
			let reps: { set_id: string; mean_velocity_mps: number | null }[] = [];
			if (setIds.length > 0) {
				const { data: repData, error: repError } = await supabase
					.from("rep_summaries")
					.select("set_id, mean_velocity_mps")
					.in("set_id", setIds);
				if (repError) throw repError;
				reps = repData ?? [];
			}

			// Parse with Zod
			const parsedSession = workoutSessionSchema.parse(session);
			const parsedExercises = z.array(exerciseSchema).parse(exercises);
			const parsedSets = z.array(setSchema).parse(sets);

			// Build set-to-exercise mapping
			const setToExercise = new Map(
				parsedSets.map((s) => [s.id, s.exercise_id]),
			);

			// Compute per-exercise avg velocity from rep summaries
			const velocityByExercise = new Map<string, number[]>();
			for (const rep of reps) {
				const exerciseId = setToExercise.get(rep.set_id);
				if (!exerciseId || rep.mean_velocity_mps == null) continue;
				const arr = velocityByExercise.get(exerciseId) ?? [];
				arr.push(rep.mean_velocity_mps);
				velocityByExercise.set(exerciseId, arr);
			}

			// Build exercise summaries
			const exerciseSummaries = parsedExercises.map((exercise) => {
				const exSets = parsedSets.filter((s) => s.exercise_id === exercise.id);
				const volume = exSets.reduce(
					(sum, s) => sum + s.weight_kg * s.actual_reps,
					0,
				);
				const maxWeight = exSets.reduce(
					(max, s) => Math.max(max, s.weight_kg),
					0,
				);
				const velocities = velocityByExercise.get(exercise.id) ?? [];
				const avgVelocity =
					velocities.length > 0
						? velocities.reduce((a, b) => a + b, 0) / velocities.length
						: 0;

				return {
					name: exercise.name,
					volume,
					maxWeight,
					sets: exSets.length,
					avgVelocity,
				};
			});

			return {
				id: parsedSession.id,
				name: parsedSession.name,
				startedAt: parsedSession.started_at,
				totalVolume: parsedSession.total_volume,
				duration: Math.round(parsedSession.duration_seconds / 60),
				exerciseCount: parsedSession.exercise_count,
				setCount: parsedSession.set_count,
				prCount: parsedSession.pr_count,
				exercises: exerciseSummaries,
			};
		},
		enabled: !!sessionId,
	});
}
