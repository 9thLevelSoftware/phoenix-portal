import { useMemo } from "react";

interface CalendarState {
	daysInMonth: number;
	startingDayOfWeek: number;
	year: number;
	month: number;
}

export function useCalendarState(currentMonth: Date): CalendarState {
	return useMemo(() => {
		const y = currentMonth.getFullYear();
		const m = currentMonth.getMonth();
		const firstDay = new Date(y, m, 1);
		const lastDay = new Date(y, m + 1, 0);
		return {
			daysInMonth: lastDay.getDate(),
			startingDayOfWeek: firstDay.getDay(),
			year: y,
			month: m,
		};
	}, [currentMonth]);
}

/**
 * workoutDates uses the format "year-month-day" where month is 0-indexed,
 * matching the Set<string> stored in the parent components.
 */
export function createDayStateHelpers(
	selectedDate: Date | null,
	workoutDates: Set<string>,
	year: number,
	month: number,
) {
	const hasWorkout = (day: number) => {
		const key = `${year}-${month}-${day}`;
		return workoutDates.has(key);
	};

	const isSelected = (day: number) => {
		if (!selectedDate) return false;
		return (
			selectedDate.getFullYear() === year &&
			selectedDate.getMonth() === month &&
			selectedDate.getDate() === day
		);
	};

	const isToday = (day: number) => {
		const today = new Date();
		return (
			today.getFullYear() === year &&
			today.getMonth() === month &&
			today.getDate() === day
		);
	};

	return { hasWorkout, isSelected, isToday };
}

/** Sunday-first labels shared by the desktop and mobile calendar headers. */
export const CALENDAR_WEEKDAY_LABELS = [
	"Su",
	"Mo",
	"Tu",
	"We",
	"Th",
	"Fr",
	"Sa",
] as const;

/**
 * Shift one calendar month. The day is pinned to the 1st so a 31st cannot
 * overflow (Jan 31 + 1 month would otherwise land on Mar 3).
 */
export function navigateMonth(
	currentMonth: Date,
	direction: "prev" | "next",
): Date {
	const newDate = new Date(
		currentMonth.getFullYear(),
		currentMonth.getMonth(),
		1,
	);
	newDate.setMonth(newDate.getMonth() + (direction === "prev" ? -1 : 1));
	return newDate;
}
