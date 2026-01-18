import { motion } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Dumbbell, X } from 'lucide-react';
import { CycleDay } from './types';

interface DayCardProps {
  day: CycleDay;
  onClick: () => void;
  onSetRest: () => void;
  onRemove?: () => void;
  isSelected: boolean;
}

export function DayCard({ day, onClick, onSetRest, onRemove, isSelected }: DayCardProps) {
  // Empty State
  if (day.type === 'workout' && !day.routineId) {
    return (
      <motion.div
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className={`relative min-w-[180px] cursor-pointer ${
          isSelected ? 'ring-2 ring-[#FF6B35]' : ''
        }`}
      >
        <Card
          onClick={onClick}
          className="p-4 border-2 border-dashed border-[#374151] hover:border-[#FF6B35] bg-gradient-to-br from-[#1a1a1a]/50 to-[#0D0D0D] transition-all"
        >
          <div className="text-center mb-3">
            <div className="text-sm font-semibold text-[#9CA3AF]">Day {day.dayNumber}</div>
          </div>

          <div className="text-center space-y-3 py-4">
            <div className="w-12 h-12 mx-auto rounded-full border-2 border-dashed border-[#374151] flex items-center justify-center text-2xl text-[#6B7280]">
              +
            </div>
            <div className="text-sm text-[#9CA3AF]">Add Routine</div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onSetRest();
            }}
            className="w-full text-xs text-[#6B7280] hover:text-[#9CA3AF] transition-colors mt-2"
          >
            Mark as Rest Day
          </button>
        </Card>

        {onRemove && day.dayNumber > 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="absolute -top-2 -right-2 p-1 bg-[#EF4444] hover:bg-[#DC2626] rounded-full transition-colors"
          >
            <X className="w-3 h-3 text-white" />
          </button>
        )}
      </motion.div>
    );
  }

  // Workout State
  if (day.type === 'workout' && day.routineId) {
    return (
      <motion.div
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className={`relative min-w-[180px] cursor-pointer ${
          isSelected ? 'ring-2 ring-[#FF6B35]' : ''
        }`}
      >
        <Card
          onClick={onClick}
          className="p-4 bg-gradient-to-br from-[#FF6B35]/10 to-[#DC2626]/5 border-l-4 border-l-[#FF6B35] border-r border-t border-b border-[#374151] hover:border-[#FF6B35]/50 transition-all"
        >
          <div className="text-center mb-3">
            <div className="text-sm font-semibold text-[#9CA3AF]">Day {day.dayNumber}</div>
          </div>

          <div className="text-center space-y-2">
            <div className="text-3xl">🏋️</div>
            <div className="font-semibold text-white text-sm line-clamp-2 min-h-[2.5rem]">
              {day.routineName}
            </div>
            <div className="text-xs text-[#9CA3AF] space-y-1">
              <div>{day.exerciseCount} exercises</div>
              <div>~{day.duration} min</div>
            </div>
          </div>

          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
              className="flex-1 text-xs text-[#9CA3AF] hover:text-white h-7"
            >
              Change
            </Button>
          </div>
        </Card>

        {onRemove && day.dayNumber > 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="absolute -top-2 -right-2 p-1 bg-[#EF4444] hover:bg-[#DC2626] rounded-full transition-colors"
          >
            <X className="w-3 h-3 text-white" />
          </button>
        )}
      </motion.div>
    );
  }

  // Rest State
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={`relative min-w-[180px] cursor-pointer ${
        isSelected ? 'ring-2 ring-[#FF6B35]' : ''
      }`}
    >
      <Card
        onClick={onClick}
        className="p-4 bg-gradient-to-br from-[#374151]/20 to-[#0D0D0D] border-[#374151] hover:border-[#9CA3AF] transition-all"
      >
        <div className="text-center mb-3">
          <div className="text-sm font-semibold text-[#9CA3AF]">Day {day.dayNumber}</div>
        </div>

        <div className="text-center space-y-2 py-4">
          <div className="text-4xl">🛋️</div>
          <div className="font-semibold text-[#9CA3AF]">REST</div>
          <div className="text-xs text-[#6B7280] capitalize">
            {day.restType || 'complete'} rest
          </div>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className="w-full text-xs text-[#6B7280] hover:text-[#9CA3AF] transition-colors mt-2"
        >
          Convert to Workout
        </button>
      </Card>

      {onRemove && day.dayNumber > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -top-2 -right-2 p-1 bg-[#EF4444] hover:bg-[#DC2626] rounded-full transition-colors"
        >
          <X className="w-3 h-3 text-white" />
        </button>
      )}
    </motion.div>
  );
}
