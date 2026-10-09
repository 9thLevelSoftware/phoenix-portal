import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { goalListSchema } from "@/schemas/goals";
import { queryKeys } from "./keys";

export type GoalPeriod = "weekly" | "monthly";

/**
 * Local midnight at the start of the current goal period.
 * Weekly starts Monday; monthly starts the 1st.
 */
export function goalPeriodStart(now: Date, period: GoalPeriod): Date {
	const start = new Date(now);
	if (period === "monthly") {
		start.setDate(1);
		start.setHours(0, 0, 0, 0);
		return start;
	}
	const day = start.getDay();
	const diff = day === 0 ? 6 : day - 1;
	start.setDate(start.getDate() - diff);
	start.setHours(0, 0, 0, 0);
	return start;
}

/**
 * Earliest `started_at` bound that covers every active frequency or volume
 * goal. PR goals are not windowed here.
 */
export function earliestGoalPeriodStart(
	goals: readonly {
		status: string;
		goal_type: string;
		period: GoalPeriod;
	}[],
	now: Date,
): Date | null {
	let earliest: Date | null = null;
	for (const goal of goals) {
		if (goal.status !== "active") continue;
		if (goal.goal_type !== "frequency" && goal.goal_type !== "volume") {
			continue;
		}
		const start = goalPeriodStart(now, goal.period);
		if (earliest === null || start < earliest) earliest = start;
	}
	return earliest;
}

const goalPeriodSessionSchema = z.object({
	started_at: z.coerce.date(),
	// Per cable as stored (KD-8). Goal volume sums this figure directly.
	total_volume: z.number(),
});

const goalPrBestSchema = z.object({
	exercise_id: z.string().nullable(),
	exercise_name: z.string(),
	record_type: z.string(),
	// Per cable, as stored (KD-8). Same identity as
	// `personalRecordSchema.value`; any total is the display layer's job
	// (src/lib/units/loadDisplay.ts), and goal PRs carry no cable count.
	value: z.number(),
});

/**
 * Fetch active, completed, and archived goals for a user.
 * Returns Zod-transformed Goal[] with Date objects for timestamps.
 */
export function goalsOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.goals.byUser(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("user_goals")
				.select("*")
				.eq("user_id", userId)
				.in("status", ["active", "completed", "archived"])
				.order("created_at", { ascending: false });
			if (error) throw error;
			return goalListSchema.parse(data);
		},
		enabled: !!userId,
	});
}

/** Best strength PRs for goal progress, aggregated across the full history. */
export function goalPrBestsOptions(userId: string, profileId?: string | null) {
	return queryOptions({
		queryKey: [
			...queryKeys.records.byUser(userId, profileId),
			"goal-pr-bests",
		] as const,
		queryFn: async () => {
			const { data, error } = await supabase.rpc(
				"personal_record_bests",
				profileId ? { p_profile_id: profileId } : {},
			);
			if (error) throw error;
			return z.array(goalPrBestSchema).parse(data ?? []);
		},
		enabled: !!userId,
	});
}

/**
 * Sessions on or after the goal period, for frequency and volume progress.
 * Not the newest-50 workout list: a busy month must not drop the older rows
 * inside the window. The key sits under workouts so a sync invalidation
 * refreshes the ring.
 */
export function goalPeriodSessionsOptions(
	userId: string,
	profileId: string | null | undefined,
	periodStart: Date | null,
) {
	return queryOptions({
		queryKey: [
			...queryKeys.workouts.all,
			"goal-period",
			userId,
			profileId ?? "all",
			periodStart?.toISOString() ?? "none",
		] as const,
		queryFn: async () => {
			if (!periodStart) return [];
			let query = supabase
				.from("workout_sessions")
				.select("started_at, total_volume")
				.eq("user_id", userId);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query
				.gte("started_at", periodStart.toISOString())
				.order("started_at", { ascending: true });
			if (error) throw error;
			return z.array(goalPeriodSessionSchema).parse(data ?? []);
		},
		enabled: !!userId && periodStart != null,
	});
}
