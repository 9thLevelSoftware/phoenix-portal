import { queryOptions } from "@tanstack/react-query";
import { classifyMuscleGroup } from "@/lib/exercise-muscles";
import { supabase } from "@/lib/supabase";
import { fetchAllKeysetPages } from "@/lib/supabasePaging";
import { exerciseFrequencySchema } from "./exercise-frequency";
import { queryKeys } from "./keys";
import {
	resolvePersonalRecordDisplayNames,
	STRENGTH_PROGRESS_WITH_CATALOG_SELECT,
} from "./personal-record-normalization";

/**
 * The browser's IANA zone, used by the SQL aggregates that bucket by calendar
 * day/week so they keep the local-calendar semantics the charts used to get
 * from `new Date(...).getDay()`.
 */
export function browserTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

/**
 * True when a zone-bucketing RPC refused the browser's zone. The SQL
 * aggregates validate `p_tz` against pg_timezone_names and raise 22023; an
 * older or unusual browser can report a zone the server does not know (NF-20).
 * "unknown period" also raises 22023, so match the zone message too.
 */
export function isUnknownTimeZoneError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const { code, message } = error as { code?: unknown; message?: unknown };
	return (
		code === "22023" &&
		typeof message === "string" &&
		message.includes("unknown time zone")
	);
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
 * Weekly volume buckets (for area/bar chart).
 *
 * Aggregated in SQL by `session_volume_buckets`: one row per week instead of
 * one row per session, so the "all" period can no longer lose its newest
 * months to PostgREST's silent 1,000-row cap (F-034/F-012). `week_start` is
 * the Monday of the week in the caller's zone, which is the rule the chart
 * used to apply client-side.
 */
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
			const read = (tz: string) =>
				supabase.rpc("session_volume_buckets", {
					p_period: period,
					p_tz: tz,
					...(profileId ? { p_profile_id: profileId } : {}),
				});
			const zone = browserTimeZone();
			let { data, error } = await read(zone);
			// Buckets in UTC rather than failing the chart when the server does
			// not recognise the browser's zone.
			if (error && zone !== "UTC" && isUnknownTimeZoneError(error)) {
				({ data, error } = await read("UTC"));
			}
			if (error) throw error;
			return data ?? [];
		},
	});
}

/** Muscle group distribution (for pie/donut chart) */
export function muscleGroupOptions(userId: string, profileId?: string | null) {
	return queryOptions({
		queryKey: queryKeys.analytics.summary(userId, "muscle-groups", profileId),
		queryFn: async () => {
			// One RPC, grouped in SQL. The previous "select every session id, then
			// .in(session_id, ids)" round trip put every UUID in the GET URL and
			// started failing at ~200 sessions (F-035), and the exercise rows it
			// fetched were themselves capped at 1,000 rows.
			// `sessions` counts an exercise once per session it appears in.
			const { data: exercises, error } = await supabase.rpc(
				"exercise_frequency",
				profileId ? { p_profile_id: profileId } : {},
			);
			if (error) throw error;
			const exerciseFrequency = exerciseFrequencySchema.parse(exercises ?? []);

			// Classify by exercise NAME (canonical 6 groups), falling back to a
			// real muscle_group hint only when the name is unclassifiable. The DB
			// muscle_group column is unreliable — historically it was hardcoded to
			// "General" on every row by the mobile sync push, so trusting it
			// collapsed the entire distribution into a single "General" bucket.
			// Genuinely unclassifiable rows are dropped from the distribution.
			const counts: Record<string, number> = {};
			for (const ex of exerciseFrequency) {
				const group = classifyMuscleGroup(
					ex.exercise_name ?? "",
					ex.muscle_group,
				);
				if (group === "General") continue;
				counts[group] = (counts[group] ?? 0) + (ex.sessions ?? 0);
			}

			const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
			return Object.entries(counts).map(([name, count]) => ({
				name,
				value: total > 0 ? Math.round((count / total) * 100) : 0,
			}));
		},
	});
}

/**
 * How many personal-record events the phase-aware strength chart reads.
 *
 * `personal_record_history` clamps its own limit to 1,000, so this is "the
 * newest 1,000 PR events" — an explicit, documented bound. The previous
 * implementation selected every record ASCENDING with no limit, so PostgREST's
 * `max_rows` silently dropped the NEWEST ones — the chart stopped moving once
 * a user passed about 1,000 PR events (F-034).
 */
const STRENGTH_PROGRESS_RECORD_LIMIT = 1000;

/**
 * Strength progress (phase-aware personal-record trends for the line chart).
 *
 * Read through `personal_record_history`, which is newest-first and excludes
 * tombstones in SQL. `exercise_progress` cannot serve this chart: it has no
 * `workout_phase`, which is the dimension the chart is built on.
 */
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
			const { data, error } = await supabase
				.rpc("personal_record_history", {
					p_limit: STRENGTH_PROGRESS_RECORD_LIMIT,
					// Generated types mark defaulted arguments optional: omit them
					// rather than passing null.
					...(profileId ? { p_profile_id: profileId } : {}),
				})
				.select(STRENGTH_PROGRESS_WITH_CATALOG_SELECT);
			if (error) throw error;

			// The RPC orders achieved_at DESC; the chart plots time ascending.
			const ascending = [...(data ?? [])].reverse();
			return resolvePersonalRecordDisplayNames(ascending, userId);
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

			// Keyset-paged: one select per window was silently capped at 1,000
			// rows, so a long "all" window lost its newest sessions (NF-19).
			const readWindow = (start: Date, end: Date | null) =>
				fetchAllKeysetPages((after: SessionCursor | null, limit) => {
					let query = supabase
						.from("workout_sessions")
						.select(
							"id, started_at, total_volume, duration_seconds, set_count, exercise_count",
						)
						.eq("user_id", userId)
						.gte("started_at", after?.started_at ?? start.toISOString());
					if (end) query = query.lt("started_at", end.toISOString());
					if (profileId) query = query.eq("local_profile_id", profileId);
					if (after) query = query.or(afterSessionFilter(after));
					return query
						.order("started_at", { ascending: true })
						.order("id", { ascending: true })
						.limit(limit);
				}, sessionCursorOf);

			const [current, previous] = await Promise.all([
				readWindow(currentStart, null),
				readWindow(previousStart, currentStart),
			]);
			return { current, previous };
		},
	});
}

/**
 * Days in a period. Accepts the chart's week-based periods ("4w" = 28 days)
 * and the insight periods generate-insights uses ("30d" = 30 days, PERIOD_DAYS
 * in supabase/functions/generate-insights/index.ts), which must not be
 * confused: the local insight fallback has to use the server's windows.
 */
export function periodToDays(period: string): number {
	if (period === "all") return 3650;
	if (period === "1y") return 365;
	if (period === "90d") return 90;
	if (period === "30d") return 30;
	if (period === "7d") return 7;
	if (period === "52w") return 365;
	if (period === "12w") return 84;
	if (period === "4w") return 28;
	return 7;
}

/**
 * Returns the ISO cutoff for a period, or null for "all" (no date filter).
 * Use to keep "all" truly unbounded instead of silently capping at 10 years.
 */
function periodCutoffISO(period: string): string | null {
	if (period === "all") return null;
	const since = new Date();
	since.setDate(since.getDate() - periodToDays(period));
	return since.toISOString();
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
			const cutoff = periodCutoffISO(period);

			return fetchAllKeysetPages((after: SessionCursor | null, limit) => {
				let query = supabase
					.from("workout_sessions")
					.select("id, started_at, form_score")
					.eq("user_id", userId)
					.not("form_score", "is", null);
				if (profileId) query = query.eq("local_profile_id", profileId);
				const since = after?.started_at ?? cutoff;
				if (since) query = query.gte("started_at", since);
				if (after) query = query.or(afterSessionFilter(after));
				return query
					.order("started_at", { ascending: true })
					.order("id", { ascending: true })
					.limit(limit);
			}, sessionCursorOf);
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
			const cutoff = periodCutoffISO(period);

			const rows = await fetchAllKeysetPages(
				(after: SessionCursor | null, limit) => {
					let query = supabase
						.from("workout_sessions")
						.select(
							"id, started_at, deload_warnings, rom_violations, spotter_activations",
						)
						.eq("user_id", userId);
					if (profileId) query = query.eq("local_profile_id", profileId);
					const since = after?.started_at ?? cutoff;
					if (since) query = query.gte("started_at", since);
					if (after) query = query.or(afterSessionFilter(after));
					return query
						.order("started_at", { ascending: true })
						.order("id", { ascending: true })
						.limit(limit);
				},
				sessionCursorOf,
			);
			return rows.filter(
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
			const cutoff = periodCutoffISO(period);

			return fetchAllKeysetPages((after: SessionCursor | null, limit) => {
				let query = supabase
					.from("workout_sessions")
					.select("id, started_at, estimated_calories")
					.eq("user_id", userId)
					.not("estimated_calories", "is", null);
				if (profileId) query = query.eq("local_profile_id", profileId);
				const since = after?.started_at ?? cutoff;
				if (since) query = query.gte("started_at", since);
				if (after) query = query.or(afterSessionFilter(after));
				return query
					.order("started_at", { ascending: true })
					.order("id", { ascending: true })
					.limit(limit);
			}, sessionCursorOf);
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
			const cutoff = periodCutoffISO(period);

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
				.order("created_at", { ascending: true });

			if (cutoff) {
				query = query.gte("workout_sessions.started_at", cutoff);
			}

			if (profileId) {
				query = query.eq("workout_sessions.local_profile_id", profileId);
			}

			const { data, error } = await query;
			if (error) throw error;
			return data ?? [];
		},
	});
}
