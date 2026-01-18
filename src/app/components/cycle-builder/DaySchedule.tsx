import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Plus, Dumbbell } from 'lucide-react';
import { DayCard } from './DayCard';
import { CycleDay } from './types';

interface DayScheduleProps {
  days: CycleDay[];
  selectedDay: number | null;
  onDayClick: (dayNumber: number) => void;
  onSetRestDay: (dayNumber: number) => void;
  onAddDay: () => void;
  onRemoveDay: (dayNumber: number) => void;
}

export function DaySchedule({
  days,
  selectedDay,
  onDayClick,
  onSetRestDay,
  onAddDay,
  onRemoveDay,
}: DayScheduleProps) {
  return (
    <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <Dumbbell className="w-5 h-5 text-[#FF6B35]" />
          Workout Schedule
        </h2>
        <Button
          size="sm"
          onClick={onAddDay}
          className="bg-[#FF6B35] hover:bg-[#DC2626] border-0"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Day
        </Button>
      </div>

      {/* Horizontal Scrollable Day Cards */}
      <div className="relative">
        {/* Scroll Shadow Indicators */}
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[#0D0D0D] to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#0D0D0D] to-transparent z-10 pointer-events-none" />

        <div className="overflow-x-auto pb-4 -mx-2 px-2 scrollbar-thin scrollbar-thumb-[#374151] scrollbar-track-transparent">
          <div className="flex gap-4 min-w-max px-8">
            {days.map((day) => (
              <DayCard
                key={day.dayNumber}
                day={day}
                onClick={() => onDayClick(day.dayNumber)}
                onSetRest={() => onSetRestDay(day.dayNumber)}
                onRemove={days.length > 1 ? () => onRemoveDay(day.dayNumber) : undefined}
                isSelected={selectedDay === day.dayNumber}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="text-sm text-[#6B7280] mt-4 text-center">
        Click a day to configure • Scroll horizontally for more days
      </p>
    </Card>
  );
}
