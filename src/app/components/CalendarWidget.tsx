import { ChevronLeft, ChevronRight } from "lucide-react";
import { CalendarWidgetMobile } from "@/app/components/CalendarWidgetMobile";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/components/ui/utils";
import {
	createDayStateHelpers,
	useCalendarState,
} from "@/app/hooks/useCalendarState";
import { useIsMobile } from "@/app/hooks/useIsMobile";

interface CalendarWidgetProps {
	currentMonth: Date;
	onMonthChange: (date: Date) => void;
	/**
	 * Set of workout dates in format "year-month-day" where month is 0-indexed.
	 * Example: "2024-0-15" for January 15, 2024
	 */
	workoutDates: Set<string>;
	selectedDate: Date | null;
	onDateSelect: (date: Date) => void;
	isDateLocked?: (date: Date) => boolean;
}

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function CalendarWidget({
	currentMonth,
	onMonthChange,
	workoutDates,
	selectedDate,
	onDateSelect,
	isDateLocked,
}: CalendarWidgetProps) {
	const isMobile = useIsMobile();

	// useCalendarState must be called unconditionally (Rules of Hooks) before any early return
	const { daysInMonth, startingDayOfWeek, year, month } =
		useCalendarState(currentMonth);

	if (isMobile) {
		return (
			<CalendarWidgetMobile
				currentMonth={currentMonth}
				onMonthChange={onMonthChange}
				workoutDates={workoutDates}
				selectedDate={selectedDate}
				onDateSelect={onDateSelect}
				isDateLocked={isDateLocked}
			/>
		);
	}

	const navigateMonth = (direction: "prev" | "next") => {
		// Set day to 1 first to avoid month overflow (e.g., Jan 31 + 1 month = Mar 3)
		const newDate = new Date(
			currentMonth.getFullYear(),
			currentMonth.getMonth(),
			1,
		);
		newDate.setMonth(newDate.getMonth() + (direction === "prev" ? -1 : 1));
		onMonthChange(newDate);
	};

	const { hasWorkout, isSelected, isToday } = createDayStateHelpers(
		selectedDate,
		workoutDates,
		year,
		month,
	);

	const monthLabel = currentMonth.toLocaleDateString("en-US", {
		month: "long",
		year: "numeric",
	});

	return (
		<div className="bg-surface-2 rounded-lg border border-secondary p-4">
			{/* Header */}
			<div className="flex items-center justify-between mb-4">
				<Button
					variant="ghost"
					size="icon"
					onClick={() => navigateMonth("prev")}
					className="h-8 w-8"
					aria-label="Previous month"
				>
					<ChevronLeft className="h-4 w-4" />
				</Button>
				<span className="text-sm font-medium text-white">{monthLabel}</span>
				<Button
					variant="ghost"
					size="icon"
					onClick={() => navigateMonth("next")}
					className="h-8 w-8"
					aria-label="Next month"
				>
					<ChevronRight className="h-4 w-4" />
				</Button>
			</div>

			{/* Day headers */}
			<div className="grid grid-cols-7 gap-1 mb-2">
				{DAYS.map((day) => (
					<div
						key={day}
						className="text-center text-xs text-muted-foreground font-medium"
					>
						{day}
					</div>
				))}
			</div>

			{/* Calendar grid */}
			<div className="grid grid-cols-7 gap-1">
				{/* Empty cells for days before month start */}
				{Array.from({ length: startingDayOfWeek }).map((_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: Static calendar placeholders
					<div key={`empty-${i}`} className="h-8" />
				))}

				{/* Day cells */}
				{Array.from({ length: daysInMonth }).map((_, i) => {
					const day = i + 1;
					const date = new Date(year, month, day);
					const locked = isDateLocked?.(date) ?? false;
					const workout = hasWorkout(day);
					const selected = isSelected(day);
					const today = isToday(day);

					return (
						<button
							type="button"
							key={day}
							onClick={() => !locked && onDateSelect(date)}
							disabled={locked}
							aria-pressed={selected}
							aria-current={today ? "date" : undefined}
							className={cn(
								"h-8 w-full rounded text-xs font-medium transition-colors motion-reduce:transition-none relative",
								"hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-primary",
								selected && "bg-primary text-white",
								today && !selected && "ring-1 ring-primary/50",
								locked && "opacity-40 cursor-not-allowed",
							)}
						>
							{day}
							{workout && (
								<span
									className={cn(
										"absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full",
										selected ? "bg-white" : "bg-primary",
									)}
								/>
							)}
						</button>
					);
				})}
			</div>
		</div>
	);
}
