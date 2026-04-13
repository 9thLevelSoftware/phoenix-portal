import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import {
  createDayStateHelpers,
  useCalendarState,
} from "@/app/hooks/useCalendarState";

interface CalendarWidgetMobileProps {
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

export function CalendarWidgetMobile({
  currentMonth,
  onMonthChange,
  workoutDates,
  selectedDate,
  onDateSelect,
  isDateLocked,
}: CalendarWidgetMobileProps) {
  const { daysInMonth, startingDayOfWeek, year, month } =
    useCalendarState(currentMonth);

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
      {/* Header — tall touch targets for prev/next */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={() => navigateMonth("prev")}
          aria-label="Previous month"
          className="flex items-center justify-center h-11 w-11 rounded-lg text-muted-foreground hover:text-white hover:bg-secondary active:bg-secondary/70 transition-colors motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="text-base font-semibold text-white">{monthLabel}</span>
        <button
          type="button"
          onClick={() => navigateMonth("next")}
          aria-label="Next month"
          className="flex items-center justify-center h-11 w-11 rounded-lg text-muted-foreground hover:text-white hover:bg-secondary active:bg-secondary/70 transition-colors motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {DAYS.map((day) => (
          <div
            key={day}
            className="text-center text-xs text-muted-foreground font-medium py-1"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid — 44px minimum tap targets */}
      <div className="grid grid-cols-7 gap-1">
        {/* Empty cells for days before month start */}
        {Array.from({ length: startingDayOfWeek }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: stable positional placeholders
          <div key={`empty-${i}`} className="h-11" />
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
                // 44px minimum height for WCAG 2.5.5 touch target
                "h-11 w-full rounded-lg text-sm font-medium transition-colors motion-reduce:transition-none relative",
                "active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary",
                !selected && !today && "hover:bg-secondary text-white",
                selected && "bg-primary text-white",
                today && !selected && "ring-2 ring-primary/50 text-white",
                locked && "opacity-40 cursor-not-allowed",
              )}
            >
              {day}
              {workout && (
                <span
                  className={cn(
                    "absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full",
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
