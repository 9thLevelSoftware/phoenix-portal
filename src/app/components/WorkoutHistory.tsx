import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import {
  Calendar,
  List,
  ChevronLeft,
  ChevronRight,
  Flame,
  Dumbbell,
  Clock,
  TrendingUp,
  Award,
  X,
} from 'lucide-react';

interface WorkoutHistoryProps {
  onViewSession: (sessionId: string) => void;
}

interface WorkoutSession {
  id: string;
  name: string;
  date: Date;
  duration: number;
  volume: number;
  sets: number;
  exercises: number;
  prCount: number;
  routine?: string;
}

// Mock data
const mockWorkouts: WorkoutSession[] = [
  {
    id: '1',
    name: 'Upper Body Power',
    date: new Date(2026, 0, 18),
    duration: 65,
    volume: 4250,
    sets: 16,
    exercises: 5,
    prCount: 2,
    routine: 'Push/Pull/Legs',
  },
  {
    id: '2',
    name: 'Lower Body Strength',
    date: new Date(2026, 0, 17),
    duration: 75,
    volume: 5680,
    sets: 18,
    exercises: 6,
    prCount: 1,
    routine: 'Push/Pull/Legs',
  },
  {
    id: '3',
    name: 'Pull Focus',
    date: new Date(2026, 0, 16),
    duration: 60,
    volume: 3890,
    sets: 14,
    exercises: 4,
    prCount: 0,
  },
  {
    id: '4',
    name: 'Full Body',
    date: new Date(2026, 0, 15),
    duration: 55,
    volume: 3200,
    sets: 12,
    exercises: 6,
    prCount: 1,
  },
  {
    id: '5',
    name: 'Upper Body Hypertrophy',
    date: new Date(2026, 0, 14),
    duration: 70,
    volume: 4100,
    sets: 20,
    exercises: 5,
    prCount: 3,
    routine: 'Push/Pull/Legs',
  },
  {
    id: '6',
    name: 'Leg Day',
    date: new Date(2026, 0, 12),
    duration: 80,
    volume: 6200,
    sets: 16,
    exercises: 5,
    prCount: 2,
  },
  {
    id: '7',
    name: 'Push Focus',
    date: new Date(2026, 0, 11),
    duration: 58,
    volume: 3750,
    sets: 15,
    exercises: 4,
    prCount: 0,
  },
];

export function WorkoutHistory({ onViewSession }: WorkoutHistoryProps) {
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [dateRange, setDateRange] = useState('Last 30 days');
  const [currentMonth, setCurrentMonth] = useState(new Date(2026, 0, 1));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    return { daysInMonth, startingDayOfWeek, year, month };
  };

  const { daysInMonth, startingDayOfWeek, year, month } = getDaysInMonth(currentMonth);

  const getWorkoutsForDay = (day: number) => {
    return mockWorkouts.filter((workout) => {
      const workoutDate = workout.date;
      return (
        workoutDate.getDate() === day &&
        workoutDate.getMonth() === month &&
        workoutDate.getFullYear() === year
      );
    });
  };

  const hasWorkout = (day: number) => getWorkoutsForDay(day).length > 0;
  const hasPR = (day: number) => getWorkoutsForDay(day).some((w) => w.prCount > 0);

  const getVolumeIntensity = (day: number) => {
    const workouts = getWorkoutsForDay(day);
    if (workouts.length === 0) return 0;
    const totalVolume = workouts.reduce((sum, w) => sum + w.volume, 0);
    return Math.min(totalVolume / 5000, 1); // Normalize to 0-1
  };

  const isToday = (day: number) => {
    const today = new Date();
    return (
      day === today.getDate() &&
      month === today.getMonth() &&
      year === today.getFullYear()
    );
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    const newMonth = new Date(currentMonth);
    if (direction === 'prev') {
      newMonth.setMonth(newMonth.getMonth() - 1);
    } else {
      newMonth.setMonth(newMonth.getMonth() + 1);
    }
    setCurrentMonth(newMonth);
  };

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const streak = 7;

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-24 md:pb-8">
      {/* Header */}
      <div className="bg-gradient-to-b from-[#1a1a1a] to-[#0D0D0D] border-b border-[#374151] sticky top-0 z-40 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          >
            <div>
              <h1 className="text-3xl sm:text-4xl mb-2">
                <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                  Workout History
                </span>
              </h1>
              <p className="text-[#9CA3AF]">Your training journey, documented</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              {/* View Toggle */}
              <div className="flex bg-[#1a1a1a] rounded-lg p-1 border border-[#374151]">
                <Button
                  size="sm"
                  onClick={() => setViewMode('calendar')}
                  className={
                    viewMode === 'calendar'
                      ? 'bg-gradient-to-r from-[#FF6B35] to-[#DC2626] border-0 text-white'
                      : 'bg-transparent border-0 text-[#9CA3AF] hover:text-white'
                  }
                >
                  <Calendar className="w-4 h-4 mr-2" />
                  Calendar
                </Button>
                <Button
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className={
                    viewMode === 'list'
                      ? 'bg-gradient-to-r from-[#FF6B35] to-[#DC2626] border-0 text-white'
                      : 'bg-transparent border-0 text-[#9CA3AF] hover:text-white'
                  }
                >
                  <List className="w-4 h-4 mr-2" />
                  List
                </Button>
              </div>

              {/* Date Range Selector */}
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                className="px-4 py-2 rounded-lg bg-[#1a1a1a] border border-[#374151] text-white text-sm focus:border-[#FF6B35] focus:outline-none"
              >
                <option>Last 30 days</option>
                <option>Last 90 days</option>
                <option>This Year</option>
                <option>All Time</option>
              </select>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AnimatePresence mode="wait">
          {viewMode === 'calendar' ? (
            <motion.div
              key="calendar"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              {/* Calendar Navigation */}
              <div className="flex items-center justify-between mb-6">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateMonth('prev')}
                  className="border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-[#FF6B35]"
                >
                  <ChevronLeft className="w-4 h-4 mr-2" />
                  Previous
                </Button>
                <h2 className="text-2xl text-white">
                  {monthNames[month]} {year}
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateMonth('next')}
                  className="border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-[#FF6B35]"
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>

              {/* Calendar Grid */}
              <Card className="bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] p-4 sm:p-6 mb-6">
                {/* Week Day Headers */}
                <div className="grid grid-cols-7 gap-2 sm:gap-4 mb-4">
                  {weekDays.map((day) => (
                    <div
                      key={day}
                      className="text-center text-sm text-[#9CA3AF] font-semibold"
                    >
                      {day}
                    </div>
                  ))}
                </div>

                {/* Calendar Days */}
                <div className="grid grid-cols-7 gap-2 sm:gap-4">
                  {/* Empty cells before month starts */}
                  {Array.from({ length: startingDayOfWeek }).map((_, index) => (
                    <div key={`empty-${index}`} className="aspect-square" />
                  ))}

                  {/* Days of the month */}
                  {Array.from({ length: daysInMonth }).map((_, index) => {
                    const day = index + 1;
                    const intensity = getVolumeIntensity(day);
                    const hasWorkoutDay = hasWorkout(day);
                    const hasPRDay = hasPR(day);
                    const isTodayDay = isToday(day);

                    return (
                      <motion.button
                        key={day}
                        onClick={() => {
                          if (hasWorkoutDay) {
                            setSelectedDay(new Date(year, month, day));
                          }
                        }}
                        whileHover={hasWorkoutDay ? { scale: 1.05 } : {}}
                        className={`
                          aspect-square rounded-lg border-2 relative p-2 transition-all
                          ${
                            hasWorkoutDay
                              ? 'cursor-pointer bg-gradient-to-br hover:border-[#FF6B35]'
                              : 'bg-[#1a1a1a] border-[#374151] cursor-default'
                          }
                          ${
                            isTodayDay
                              ? 'ring-2 ring-[#FF6B35] ring-offset-2 ring-offset-[#0D0D0D]'
                              : 'border-[#374151]'
                          }
                        `}
                        style={
                          hasWorkoutDay
                            ? {
                                backgroundColor: `rgba(255, 107, 53, ${intensity * 0.3})`,
                                borderColor: `rgba(255, 107, 53, ${intensity})`,
                              }
                            : {}
                        }
                      >
                        <span
                          className={`text-sm sm:text-base ${
                            hasWorkoutDay ? 'text-white font-semibold' : 'text-[#6B7280]'
                          }`}
                        >
                          {day}
                        </span>
                        {hasPRDay && (
                          <Flame className="w-3 h-3 sm:w-4 sm:h-4 text-[#F59E0B] absolute top-1 right-1" />
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </Card>

              {/* Streak Counter */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 }}
                className="text-center"
              >
                <Card className="inline-block bg-gradient-to-br from-[#FF6B35]/20 to-[#DC2626]/20 border-2 border-[#FF6B35]/30 px-8 py-4">
                  <div className="flex items-center gap-3">
                    <Flame className="w-6 h-6 text-[#FF6B35]" />
                    <span className="text-2xl font-semibold text-white">{streak} Day Streak</span>
                    <Flame className="w-6 h-6 text-[#FF6B35]" />
                  </div>
                </Card>
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              {mockWorkouts.map((workout, index) => (
                <motion.div
                  key={workout.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card
                    onClick={() => onViewSession(workout.id)}
                    className="p-4 sm:p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] hover:border-[#FF6B35]/50 transition-all cursor-pointer group"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      {/* Left: Icon & Date */}
                      <div className="flex items-center gap-4">
                        <div className="relative">
                          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-gradient-to-br from-[#FF6B35] to-[#DC2626] flex items-center justify-center group-hover:scale-110 transition-transform">
                            <Dumbbell className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
                          </div>
                          <div className="absolute -bottom-1 -right-1 bg-[#0D0D0D] rounded px-1.5 py-0.5 text-xs text-[#9CA3AF] border border-[#374151]">
                            {workout.date.getDate()}
                          </div>
                        </div>

                        <div>
                          <h3 className="text-lg font-semibold text-white mb-1">
                            {workout.name}
                          </h3>
                          <div className="flex items-center gap-2 text-sm text-[#9CA3AF]">
                            <span>
                              {workout.date.toLocaleDateString('en-US', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                            <span>•</span>
                            <span>
                              {workout.date.toLocaleTimeString('en-US', {
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          {workout.routine && (
                            <Badge
                              variant="outline"
                              className="mt-2 border-[#FF6B35]/30 text-[#FF6B35] text-xs"
                            >
                              {workout.routine}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Right: Stats */}
                      <div className="flex-1 grid grid-cols-2 sm:flex sm:items-center sm:justify-end gap-4 sm:gap-6">
                        <div className="text-center">
                          <div className="text-sm text-[#9CA3AF] mb-1">Volume</div>
                          <div className="text-lg font-semibold text-white">
                            {workout.volume.toLocaleString()} kg
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm text-[#9CA3AF] mb-1">Duration</div>
                          <div className="text-lg font-semibold text-white flex items-center justify-center gap-1">
                            <Clock className="w-4 h-4" />
                            {workout.duration}m
                          </div>
                        </div>
                        {workout.prCount > 0 && (
                          <div className="text-center col-span-2 sm:col-span-1">
                            <Badge className="bg-gradient-to-r from-[#F59E0B] to-[#FBBF24] text-white border-0">
                              <Award className="w-3 h-3 mr-1" />
                              {workout.prCount} PR{workout.prCount > 1 ? 's' : ''}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Day Detail Slide-Out Panel */}
      <AnimatePresence>
        {selectedDay && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedDay(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            />

            {/* Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 h-full w-full sm:w-96 bg-[#0D0D0D] border-l border-[#374151] z-50 overflow-y-auto"
            >
              {/* Panel Header */}
              <div className="sticky top-0 bg-gradient-to-b from-[#1a1a1a] to-[#0D0D0D] border-b border-[#374151] p-6 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-white mb-1">
                    {selectedDay.toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </h3>
                  <p className="text-sm text-[#9CA3AF]">
                    {getWorkoutsForDay(selectedDay.getDate()).length} workout
                    {getWorkoutsForDay(selectedDay.getDate()).length !== 1 ? 's' : ''}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedDay(null)}
                  className="border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-[#FF6B35]"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Panel Content */}
              <div className="p-6 space-y-4">
                {getWorkoutsForDay(selectedDay.getDate()).map((workout) => (
                  <Card
                    key={workout.id}
                    onClick={() => {
                      setSelectedDay(null);
                      onViewSession(workout.id);
                    }}
                    className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] hover:border-[#FF6B35]/50 cursor-pointer transition-all"
                  >
                    <h4 className="text-lg font-semibold text-white mb-2">{workout.name}</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between text-[#E5E7EB]">
                        <span className="text-[#9CA3AF]">Time</span>
                        <span>
                          {workout.date.toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[#E5E7EB]">
                        <span className="text-[#9CA3AF]">Duration</span>
                        <span>{workout.duration} min</span>
                      </div>
                      <div className="flex items-center justify-between text-[#E5E7EB]">
                        <span className="text-[#9CA3AF]">Volume</span>
                        <span>{workout.volume.toLocaleString()} kg</span>
                      </div>
                      {workout.prCount > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-[#9CA3AF]">PRs</span>
                          <Badge className="bg-gradient-to-r from-[#F59E0B] to-[#FBBF24] text-white border-0">
                            {workout.prCount}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
