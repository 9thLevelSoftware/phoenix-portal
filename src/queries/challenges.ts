import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
	fetchAllKeysetPages,
	fetchAllSupabasePagesForChunks,
	SUPABASE_FILTER_CHUNK_SIZE,
} from "@/lib/supabasePaging";
import { totalLoadVolumeKg } from "@/lib/units/loadDisplay";
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
			// Progress depends on the challenge metadata too — include it so cached
			// results are invalidated when the challenge definition changes.
			challengeType,
			targetValue,
			startDate,
			endDate,
		] as const,
		queryFn: async () => {
			let current = 0;

			switch (challengeType) {
				case "volume": {
					// Volume challenges count TOTAL load (KD-8): each session's
					// per-cable total_volume x the cables actually used, per cable
					// only where the cable count is unknown (never assume 2).
					// Sessions are keyset-paged; exercise and set reads are chunked
					// and range-paged so neither stops at PostgREST's max_rows.
					const sessions = await fetchVolumeSessions(
						userId,
						startDate,
						endDate,
					);
					const exercises = await fetchAllSupabasePagesForChunks(
						sessions.map((s) => s.id),
						(chunk, from, to) =>
							supabase
								.from("exercises")
								.select("id, session_id, cable_count")
								.in("session_id", chunk)
								.order("id", { ascending: true })
								.range(from, to),
						{ chunkSize: SUPABASE_FILTER_CHUNK_SIZE },
					);
					const sets = await fetchAllSupabasePagesForChunks(
						exercises.map((e) => e.id),
						(chunk, from, to) =>
							supabase
								.from("sets")
								.select("exercise_id, weight_kg, actual_reps")
								.in("exercise_id", chunk)
								.order("id", { ascending: true })
								.range(from, to),
						{ chunkSize: SUPABASE_FILTER_CHUNK_SIZE },
					);
					current = Math.round(totalLoadVolumeKg(sessions, exercises, sets));
					break;
				}
				case "frequency": {
					const { count, error } = await supabase
						.from("workout_sessions")
						.select("id", { count: "exact", head: true })
						.eq("user_id", userId)
						.gte("started_at", startDate)
						.lte("started_at", endDate);
					if (error) throw error;
					current = count ?? 0;
					break;
				}
				case "streak": {
					const sessions = await fetchStreakSessions(
						userId,
						startDate,
						endDate,
					);
					current = computeStreak(sessions);
					break;
				}
				case "pr_count": {
					// Phase-specific records are distinct rows in personal_records and
					// intentionally count separately for PR-count challenges.
					const { count, error } = await supabase
						.from("personal_records")
						.select("id", { count: "exact", head: true })
						.eq("user_id", userId)
						.is("deleted_at", null)
						.gte("achieved_at", startDate)
						.lte("achieved_at", endDate);
					if (error) throw error;
					current = count ?? 0;
					break;
				}
				default:
					throw new Error(`Unsupported challenge type: ${challengeType}`);
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

/** Position of the last session row a keyset page returned. */
interface SessionCursor {
	started_at: string;
	id: string;
}

function sessionCursorOf(row: {
	started_at: string;
	id: string;
}): SessionCursor {
	return { started_at: row.started_at, id: row.id };
}

/**
 * PostgREST `or` filter for "strictly after this (started_at, id)". The
 * timestamp is quoted because an ISO value carries `.` and `:`, which the
 * filter grammar reserves.
 */
function afterSessionFilter(after: SessionCursor): string {
	return `started_at.gt."${after.started_at}",and(started_at.eq."${after.started_at}",id.gt.${after.id})`;
}

/**
 * Sessions in the challenge window, keyset-paged on (started_at, id).
 * One select is silently capped at PostgREST's max_rows. The leading
 * `gte` keeps each page index-sargable; `or` drops the cursor row itself.
 */
function fetchVolumeSessions(
	userId: string,
	startDate: string,
	endDate: string,
) {
	return fetchAllKeysetPages((after: SessionCursor | null, limit) => {
		let query = supabase
			.from("workout_sessions")
			.select("id, started_at, total_volume")
			.eq("user_id", userId)
			.gte("started_at", after?.started_at ?? startDate)
			.lte("started_at", endDate);
		if (after) query = query.or(afterSessionFilter(after));
		return query
			.order("started_at", { ascending: true })
			.order("id", { ascending: true })
			.limit(limit);
	}, sessionCursorOf);
}

function fetchStreakSessions(
	userId: string,
	startDate: string,
	endDate: string,
) {
	return fetchAllKeysetPages((after: SessionCursor | null, limit) => {
		let query = supabase
			.from("workout_sessions")
			.select("id, started_at")
			.eq("user_id", userId)
			.gte("started_at", after?.started_at ?? startDate)
			.lte("started_at", endDate);
		if (after) query = query.or(afterSessionFilter(after));
		return query
			.order("started_at", { ascending: true })
			.order("id", { ascending: true })
			.limit(limit);
	}, sessionCursorOf);
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
