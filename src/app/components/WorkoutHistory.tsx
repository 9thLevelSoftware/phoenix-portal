import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/app/hooks/useAuth';
import { workoutListOptions } from '@/queries/workouts';
import type { WorkoutSession } from '@/schemas/transforms';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { Skeleton, WorkoutCardSkeleton } from '@/app/components/ui/skeleton';
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

export function WorkoutHistory() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: workouts, isPending } = useQuery(workoutListOptions(user!.id));

  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [dateRange, setDateRange] = useState('Last 30 days');
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
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

  // Index workouts by date string for fast calendar lookups
  const workoutsByDate = useMemo(() => {
    const map = new Map<string, WorkoutSession[]>();
    if (!workouts) return map;
    for (const w of workouts) {
      const key = `${w.started_at.getFullYear()}-${w.started_at.getMonth()}-${w.started_at.getDate()}`;
      const arr = map.get(key) ?? [];
      arr.push(w);
      map.set(key, arr);
    }
    return map;
  }, [workouts]);

  const getWorkoutsForDay = (day: number) => {
    const key = `${year}-${month}-${day}`;
    return workoutsByDate.get(key) ?? [];
  };

  const hasWorkout = (day: number) => getWorkoutsForDay(day).length > 0;
  const hasPR = (day: number) => getWorkoutsForDay(day).some((w) => w.pr_count > 0);

  const getVolumeIntensity = (day: number) => {
    const dayWorkouts = getWorkoutsForDay(day);
    if (dayWorkouts.length === 0) return 0;
    const totalVolume = dayWorkouts.reduce((sum, w) => sum + w.total_volume, 0);
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
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Calculate streak from workout data
  const streak = useMemo(() => {
    if (!workouts || workouts.length === 0) return 0;
    const uniqueDays = new Set(
      workouts.map((w) => {
        const d = w.started_at;
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      })
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

  // Loading state
  if (isPending) {
    return (
      <div className="min-h-screen bg-[#0D0D0D] pb-24 md:pb-8">
        <div className="bg-gradient-to-b from-[#1a1a1a] to-[#0D0D0D] border-b border-[#374151] px-4 sm:px-6 lg:px-8 py-6">
          <div className="max-w-7xl mx-auto">
            <Skeleton className="h-10 w-64 mb-2" />
            <Skeleton className="h-5 w-48" />
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <WorkoutCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  // Empty state
  if (!workouts || workouts.length === 0) {
    return (
      <div className="min-h-screen bg-[#0D0D0D] pb-24 md:pb-8">
        <div className="bg-gradient-to-b from-[#1a1a1a] to-[#0D0D0D] border-b border-[#374151] px-4 sm:px-6 lg:px-8 py-6">
          <div className="max-w-7xl mx-auto">
            <h1 className="text-3xl sm:text-4xl mb-2">
              <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                Workout History
              </span>
            </h1>
            <p className="text-[#9CA3AF]">Your training journey, documented</p>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="flex flex-col items-center justify-center text-center">
            <Dumbbell className="w-16 h-16 text-[#374151] mb-6" />
            <h2 className="text-2xl text-white mb-2">No workouts found</h2>
            <p className="text-[#9CA3AF] max-w-md">
              Complete a workout in the Vitruvian mobile app and it will appear here automatically after syncing.
            </p>
          </div>
        </div>
      </div>
    );
  }

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
              {workouts.map((workout, index) => (
                <motion.div
                  key={workout.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card
                    onClick={() => navigate(`/history/${workout.id}`)}
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
                            {workout.started_at.getDate()}
                          </div>
                        </div>

                        <div>
                          <h3 className="text-lg font-semibold text-white mb-1">
                            {workout.name}
                          </h3>
                          <div className="flex items-center gap-2 text-sm text-[#9CA3AF]">
                            <span>
                              {workout.started_at.toLocaleDateString('en-US', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                            <span>-</span>
                            <span>
                              {workout.started_at.toLocaleTimeString('en-US', {
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          {workout.routine_name && (
                            <Badge
                              variant="outline"
                              className="mt-2 border-[#FF6B35]/30 text-[#FF6B35] text-xs"
                            >
                              {workout.routine_name}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Right: Stats */}
                      <div className="flex-1 grid grid-cols-2 sm:flex sm:items-center sm:justify-end gap-4 sm:gap-6">
                        <div className="text-center">
                          <div className="text-sm text-[#9CA3AF] mb-1">Volume</div>
                          <div className="text-lg font-semibold text-white">
                            {workout.total_volume.toLocaleString()} kg
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm text-[#9CA3AF] mb-1">Duration</div>
                          <div className="text-lg font-semibold text-white flex items-center justify-center gap-1">
                            <Clock className="w-4 h-4" />
                            {workout.duration_seconds}m
                          </div>
                        </div>
                        {workout.pr_count > 0 && (
                          <div className="text-center col-span-2 sm:col-span-1">
                            <Badge className="bg-gradient-to-r from-[#F59E0B] to-[#FBBF24] text-white border-0">
                              <Award className="w-3 h-3 mr-1" />
                              {workout.pr_count} PR{workout.pr_count > 1 ? 's' : ''}
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
                      navigate(`/history/${workout.id}`);
                    }}
                    className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] hover:border-[#FF6B35]/50 cursor-pointer transition-all"
                  >
                    <h4 className="text-lg font-semibold text-white mb-2">{workout.name}</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between text-[#E5E7EB]">
                        <span className="text-[#9CA3AF]">Time</span>
                        <span>
                          {workout.started_at.toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[#E5E7EB]">
                        <span className="text-[#9CA3AF]">Duration</span>
                        <span>{workout.duration_seconds} min</span>
                      </div>
                      <div className="flex items-center justify-between text-[#E5E7EB]">
                        <span className="text-[#9CA3AF]">Volume</span>
                        <span>{workout.total_volume.toLocaleString()} kg</span>
                      </div>
                      {workout.pr_count > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-[#9CA3AF]">PRs</span>
                          <Badge className="bg-gradient-to-r from-[#F59E0B] to-[#FBBF24] text-white border-0">
                            {workout.pr_count}
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
