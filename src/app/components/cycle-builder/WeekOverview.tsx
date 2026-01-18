import { Card } from '@/app/components/ui/card';
import { BarChart3 } from 'lucide-react';
import { CycleDay } from './types';

interface WeekOverviewProps {
  days: CycleDay[];
}

export function WeekOverview({ days }: WeekOverviewProps) {
  const workoutDays = days.filter((d) => d.type === 'workout').length;
  const restDays = days.filter((d) => d.type === 'rest').length;

  // Calculate muscle distribution (mock calculation)
  const muscleDistribution = [
    { name: 'Chest', percentage: 22, color: '#FF6B35' },
    { name: 'Back', percentage: 20, color: '#DC2626' },
    { name: 'Legs', percentage: 18, color: '#F59E0B' },
    { name: 'Shoulders', percentage: 15, color: '#10B981' },
    { name: 'Arms', percentage: 15, color: '#6366F1' },
    { name: 'Core', percentage: 10, color: '#EC4899' },
  ];

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
      <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-[#FF6B35]" />
        Week at a Glance
      </h2>

      {/* Week Grid */}
      <div className="grid grid-cols-7 gap-2 mb-6">
        {dayNames.slice(0, days.length).map((dayName, i) => {
          const day = days[i];
          return (
            <div key={dayName} className="text-center">
              <div className="text-xs text-[#9CA3AF] mb-2">{dayName}</div>
              <div
                className={`h-20 rounded-lg flex flex-col items-center justify-center text-2xl transition-all ${
                  day?.type === 'workout'
                    ? 'bg-gradient-to-br from-[#FF6B35]/20 to-[#DC2626]/10 border-2 border-[#FF6B35]/30'
                    : 'bg-[#374151]/20 border-2 border-[#374151]'
                }`}
              >
                {day?.type === 'workout' ? '🏋️' : '🛋️'}
              </div>
              <div className="text-xs text-[#6B7280] mt-1 truncate">
                {day?.routineName || (day?.type === 'rest' ? 'REST' : '-')}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div className="text-sm text-[#E5E7EB] mb-6">
        📊 {workoutDays} workout days • {restDays} rest days
      </div>

      {/* Muscle Distribution */}
      <div className="border-t border-[#374151] pt-6">
        <h3 className="font-semibold text-white mb-4">Muscle Group Distribution</h3>
        <p className="text-sm text-[#9CA3AF] mb-4">Based on assigned routines:</p>

        <div className="space-y-3">
          {muscleDistribution.map((muscle) => (
            <div key={muscle.name}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-[#E5E7EB]">{muscle.name}</span>
                <span className="text-sm text-[#9CA3AF]">{muscle.percentage}%</span>
              </div>
              <div className="w-full h-2 bg-[#0D0D0D] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${muscle.percentage}%`,
                    backgroundColor: muscle.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Balance Warning (example) */}
        {muscleDistribution[0].percentage - muscleDistribution[1].percentage > 10 && (
          <div className="mt-4 p-4 bg-[#FBBF24]/10 border border-[#FBBF24]/30 rounded-lg">
            <div className="text-sm text-[#FBBF24]">
              ⚠️ Note: {muscleDistribution[0].name} is receiving more volume than {muscleDistribution[1].name}.
              Consider adding more pulling exercises for balance.
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
