import { useMemo } from "react";
import type { WorkoutSession } from "@/schemas/transforms";

/**
 * Compute current consecutive workout day streak from workout sessions.
 * Counts backward from today; allows today to be missing (starts checking from yesterday).
 * Returns 0 if no workouts.
 */
export function useStreak(workouts: WorkoutSession[] | undefined): number {
	return useMemo(() => {
		if (!workouts || workouts.length === 0) return 0;

		const uniqueDays = new Set(
			workouts.map((w) => {
				const d = w.started_at;
				return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
			}),
		);

		let count = 0;
		const today = new Date();
		for (let i = 0; i < 365; i++) {
			const d = new Date(today);
			d.setDate(d.getDate() - i);
			const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
			if (uniqueDays.has(key)) {
				count++;
			} else if (i > 0) {
				break; // Allow today to be missing (haven't worked out yet)
			}
		}
		return count;
	}, [workouts]);
}
