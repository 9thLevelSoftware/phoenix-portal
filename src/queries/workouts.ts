import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import type { SessionSummary } from "@/lib/comparison";
import { supabase } from "@/lib/supabase";
import { fetchAllSupabasePages } from "@/lib/supabasePaging";
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
 * Returns Zod-transformed WorkoutSession[] (per-cable weights, dates as Date, duration as minutes).
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

			// `id` is the unique tiebreak after started_at so equal timestamps
			// cannot skip or repeat rows across offset pages.
			const { data, error } = await query
				.order("started_at", { ascending: false })
				.order("id", { ascending: false })
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
 * Every session for the profile "Export Workout History" CSV.
 *
 * Pages until a short page so a history longer than PostgREST `max_rows` is
 * not silently truncated. The dashboard list stays on `workoutListOptions`,
 * which is capped at `WORKOUTS_PAGE_SIZE`. `id` breaks `started_at` ties so
 * offset pages neither skip nor repeat a session.
 */
export async function fetchWorkoutHistoryForExport(userId: string) {
	const rows = await fetchAllSupabasePages((from, to) =>
		supabase
			.from("workout_sessions")
			.select("*")
			.eq("user_id", userId)
			.order("started_at", { ascending: false })
			.order("id")
			.range(from, to),
	);
	return workoutListSchema.parse(rows);
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
 * Returns Zod-transformed PersonalRecord[] (per-cable weights, dates as Date).
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
				await resolvePersonalRecordDisplayNames(data, userId),
			);
		},
	});
}

type RawSessionTree = {
	exercises?: (Record<string, unknown> & {
		sets?: (Record<string, unknown> & {
			rep_summaries?: { set_id: string; mean_velocity_mps: number | null }[];
		})[];
	})[];
};

/** Session detail: session row plus nested exercises and sets. */
const SESSION_DETAIL_EMBED = "*, exercises(*, sets(*))" as const;

/**
 * Comparison: the same tree, plus the rep-summary columns the velocity
 * average needs. Whitespace matches the request the existing tests pin.
 */
const SESSION_COMPARISON_EMBED =
	"*, exercises(*, sets(*, rep_summaries(set_id, mean_velocity_mps)))" as const;

type SessionEmbedSelect =
	| typeof SESSION_DETAIL_EMBED
	| typeof SESSION_COMPARISON_EMBED;

/**
 * Split an embedded `workout_sessions -> exercises -> sets` row into flat
 * raw arrays so each level can be parsed with its existing Zod schema.
 */
function flattenSessionTree(row: unknown) {
	const tree = (row ?? {}) as RawSessionTree;
	const exercises = tree.exercises ?? [];
	const sets = exercises.flatMap((exercise) => exercise.sets ?? []);
	const reps = sets.flatMap((set) => set.rep_summaries ?? []);
	return { exercises, sets, reps };
}

/**
 * One embedded read of a workout session. Session detail and comparison
 * share the filter, the exercise/set ordering, and the per-level Zod parse.
 * The select string is the only difference between the two callers.
 */
async function loadSessionEmbed(sessionId: string, select: SessionEmbedSelect) {
	const { data: session, error } = await supabase
		.from("workout_sessions")
		.select(select)
		.eq("id", sessionId)
		.order("order_index", { ascending: true, referencedTable: "exercises" })
		.order("set_number", {
			ascending: true,
			referencedTable: "exercises.sets",
		})
		.single();
	if (error) throw error;

	const { exercises, sets, reps } = flattenSessionTree(session);
	return {
		session: workoutSessionSchema.parse(session),
		exercises: z.array(exerciseSchema).parse(exercises),
		sets: z.array(setSchema).parse(sets),
		reps,
	};
}

/**
 * Full session detail with exercises and sets.
 * Fetches the session, its exercises and their sets in one embedded select,
 * then parses each level with Zod and assembles the nested structure.
 */
export function sessionDetailOptions(sessionId: string) {
	return queryOptions({
		queryKey: queryKeys.workouts.detail(sessionId),
		queryFn: async () => {
			const { session, exercises, sets } = await loadSessionEmbed(
				sessionId,
				SESSION_DETAIL_EMBED,
			);

			const exercisesWithSets = exercises.map((exercise) => ({
				...exercise,
				sets: sets.filter((s) => s.exercise_id === exercise.id),
				hasPR: sets.some((s) => s.exercise_id === exercise.id && s.is_pr),
			}));

			return {
				...session,
				exercises: exercisesWithSets,
			};
		},
		enabled: !!sessionId,
	});
}

/**
 * Extended session detail that also includes rep summaries for velocity data.
 * Returns a SessionSummary ready for the comparison engine.
 */
export function comparisonDetailOptions(sessionId: string) {
	return queryOptions({
		queryKey: queryKeys.workouts.comparison(sessionId, "detail"),
		queryFn: async (): Promise<SessionSummary> => {
			const { session, exercises, sets, reps } = await loadSessionEmbed(
				sessionId,
				SESSION_COMPARISON_EMBED,
			);

			// Build set-to-exercise mapping
			const setToExercise = new Map(sets.map((s) => [s.id, s.exercise_id]));

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
			const exerciseSummaries = exercises.map((exercise) => {
				const exSets = sets.filter((s) => s.exercise_id === exercise.id);
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
				id: session.id,
				name: session.name,
				startedAt: session.started_at,
				totalVolume: session.total_volume,
				duration: Math.round(session.duration_seconds / 60),
				exerciseCount: session.exercise_count,
				setCount: session.set_count,
				prCount: session.pr_count,
				exercises: exerciseSummaries,
			};
		},
		enabled: !!sessionId,
	});
}
