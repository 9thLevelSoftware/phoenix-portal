import type { CycleDay } from "@/schemas/transforms";

export interface NextWorkoutResult {
	dayNumber: number;
	routineId: string | null;
	dayType: "workout" | "rest";
	cycleWeek: number;
	isRestDay: boolean;
}

/**
 * Compute which workout day the user should do today based on their
 * active training cycle's start date and day schedule.
 *
 * Returns null when:
 * - cycleDays is empty
 * - today is before the cycle started
 * - the cycle has ended (daysSinceStart >= durationWeeks * 7)
 */
export function computeNextWorkout(
	cycleDays: CycleDay[],
	startedAt: Date,
	durationWeeks: number,
	today: Date = new Date(),
): NextWorkoutResult | null {
	if (cycleDays.length === 0) return null;

	// Normalize both dates to midnight local to avoid timezone drift
	const startDay = new Date(
		startedAt.getFullYear(),
		startedAt.getMonth(),
		startedAt.getDate(),
	);
	const todayDay = new Date(
		today.getFullYear(),
		today.getMonth(),
		today.getDate(),
	);

	const daysSinceStart = Math.floor(
		(todayDay.getTime() - startDay.getTime()) / (1000 * 60 * 60 * 24),
	);

	// Before cycle started or cycle ended
	if (daysSinceStart < 0) return null;
	if (daysSinceStart >= durationWeeks * 7) return null;

	const currentDayIndex = daysSinceStart % cycleDays.length;
	const currentWeek = Math.floor(daysSinceStart / 7) + 1;

	const day = cycleDays[currentDayIndex];
	if (!day) return null;

	return {
		dayNumber: day.day_number,
		routineId: day.routine_id,
		dayType: day.day_type as "workout" | "rest",
		cycleWeek: currentWeek,
		isRestDay: day.day_type === "rest",
	};
}
