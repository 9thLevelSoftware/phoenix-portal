import { useMemo } from "react";
import type { WorkoutSession } from "@/schemas/transforms";

/** UTC calendar key matching SQL `(started_at AT TIME ZONE 'UTC')::date`. */
export function utcDateKey(date: Date): string {
	return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

/**
 * Consecutive UTC workout-day streak matching `workout_current_streak`.
 * Walks back from today; if today is empty, starts from yesterday.
 * Caps at 365 days (SQL aggregate does not). Prefer the RPC for Dashboard.
 */
export function computeWorkoutStreak(
	workouts: { started_at: Date }[] | undefined,
	now: Date = new Date(),
): number {
	if (!workouts || workouts.length === 0) return 0;

	const uniqueDays = new Set(workouts.map((w) => utcDateKey(w.started_at)));

	let count = 0;
	for (let i = 0; i < 365; i++) {
		const d = new Date(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i),
		);
		if (uniqueDays.has(utcDateKey(d))) {
			count++;
		} else if (i > 0) {
			break; // Allow today to be missing (haven't worked out yet)
		}
	}
	return count;
}

/**
 * Compute current consecutive workout day streak from workout sessions.
 * Counts backward from today (UTC); allows today to be missing (starts checking from yesterday).
 * Returns 0 if no workouts.
 */
export function useStreak(workouts: WorkoutSession[] | undefined): number {
	return useMemo(() => computeWorkoutStreak(workouts), [workouts]);
}
