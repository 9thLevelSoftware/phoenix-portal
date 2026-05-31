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
