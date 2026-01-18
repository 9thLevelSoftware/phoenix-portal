import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import {
  Trophy,
  TrendingUp,
  Flame,
  Star,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowRight,
  AlertTriangle,
  Award,
  Calendar,
  Target,
  Crown,
} from 'lucide-react';

interface PR {
  id: string;
  exercise: string;
  muscleGroup: string;
  weight: number;
  reps: number;
  estimatedOneRM: number;
  date: Date;
  type: 'Weight PR' | 'Volume PR' | 'Rep PR';
  isNew: boolean;
}

interface ExercisePRHistory {
  exercise: string;
  muscleGroup: string;
  currentPR: { weight: number; reps: number };
  estimatedOneRM: number;
  lastPRDate: Date;
  trend: 'improving' | 'stable' | 'plateau';
  history: Array<{
    date: Date;
    weight: number;
    reps: number;
    estimatedOneRM: number;
    mode: string;
  }>;
}

// Mock data
const recentPRs: PR[] = [
  {
    id: '1',
    exercise: 'Bench Press',
    muscleGroup: 'Chest',
    weight: 120,
    reps: 5,
    estimatedOneRM: 135,
    date: new Date(2026, 0, 18),
    type: 'Weight PR',
    isNew: true,
  },
  {
    id: '2',
    exercise: 'Squat',
    muscleGroup: 'Legs',
    weight: 150,
    reps: 8,
    estimatedOneRM: 187.5,
    date: new Date(2026, 0, 17),
    type: 'Volume PR',
    isNew: true,
  },
  {
    id: '3',
    exercise: 'Deadlift',
    muscleGroup: 'Back',
    weight: 180,
    reps: 3,
    estimatedOneRM: 191,
    date: new Date(2026, 0, 15),
    type: 'Weight PR',
    isNew: false,
  },
];

const exercisePRs: ExercisePRHistory[] = [
  {
    exercise: 'Bench Press',
    muscleGroup: 'Chest',
    currentPR: { weight: 120, reps: 5 },
    estimatedOneRM: 135,
    lastPRDate: new Date(2026, 0, 18),
    trend: 'improving',
    history: [
      { date: new Date(2026, 0, 18), weight: 120, reps: 5, estimatedOneRM: 135, mode: 'Eccentric' },
      { date: new Date(2026, 0, 4), weight: 115, reps: 5, estimatedOneRM: 129, mode: 'Standard' },
      { date: new Date(2025, 11, 20), weight: 110, reps: 5, estimatedOneRM: 124, mode: 'Standard' },
    ],
  },
  {
    exercise: 'Squat',
    muscleGroup: 'Legs',
    currentPR: { weight: 150, reps: 8 },
    estimatedOneRM: 187.5,
    lastPRDate: new Date(2026, 0, 17),
    trend: 'improving',
    history: [
      { date: new Date(2026, 0, 17), weight: 150, reps: 8, estimatedOneRM: 187.5, mode: 'Chains' },
      { date: new Date(2026, 0, 3), weight: 145, reps: 8, estimatedOneRM: 181, mode: 'Standard' },
      { date: new Date(2025, 11, 15), weight: 140, reps: 8, estimatedOneRM: 175, mode: 'Standard' },
    ],
  },
  {
    exercise: 'Deadlift',
    muscleGroup: 'Back',
    currentPR: { weight: 180, reps: 3 },
    estimatedOneRM: 191,
    lastPRDate: new Date(2026, 0, 15),
    trend: 'stable',
    history: [
      { date: new Date(2026, 0, 15), weight: 180, reps: 3, estimatedOneRM: 191, mode: 'Standard' },
      { date: new Date(2025, 11, 28), weight: 175, reps: 3, estimatedOneRM: 186, mode: 'Standard' },
    ],
  },
  {
    exercise: 'Overhead Press',
    muscleGroup: 'Shoulders',
    currentPR: { weight: 65, reps: 6 },
    estimatedOneRM: 75,
    lastPRDate: new Date(2025, 10, 10),
    trend: 'plateau',
    history: [
      { date: new Date(2025, 10, 10), weight: 65, reps: 6, estimatedOneRM: 75, mode: 'Standard' },
      { date: new Date(2025, 9, 5), weight: 62.5, reps: 6, estimatedOneRM: 72, mode: 'Standard' },
    ],
  },
  {
    exercise: 'Barbell Row',
    muscleGroup: 'Back',
    currentPR: { weight: 95, reps: 8 },
    estimatedOneRM: 118.75,
    lastPRDate: new Date(2026, 0, 12),
    trend: 'improving',
    history: [
      { date: new Date(2026, 0, 12), weight: 95, reps: 8, estimatedOneRM: 118.75, mode: 'Standard' },
      { date: new Date(2025, 11, 25), weight: 90, reps: 8, estimatedOneRM: 112.5, mode: 'Standard' },
    ],
  },
  {
    exercise: 'Pull-ups',
    muscleGroup: 'Back',
    currentPR: { weight: 20, reps: 10 },
    estimatedOneRM: 26.7,
    lastPRDate: new Date(2026, 0, 16),
    trend: 'improving',
    history: [
      { date: new Date(2026, 0, 16), weight: 20, reps: 10, estimatedOneRM: 26.7, mode: 'Weighted' },
      { date: new Date(2025, 11, 30), weight: 15, reps: 10, estimatedOneRM: 20, mode: 'Weighted' },
    ],
  },
];

const milestones = [
  { id: '1', count: 100, name: '100th PR', icon: Crown, achieved: true, date: new Date(2026, 0, 15) },
  { id: '2', count: 50, name: '50th PR', icon: Trophy, achieved: true, date: new Date(2025, 11, 1) },
  { id: '3', count: 25, name: '25th PR', icon: Award, achieved: true, date: new Date(2025, 9, 10) },
  { id: '4', count: 10, name: '10th PR', icon: Flame, achieved: true, date: new Date(2025, 8, 5) },
];

export function PersonalRecords() {
  const [activeFilter, setActiveFilter] = useState('All');
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  const [expandedExercises, setExpandedExercises] = useState<string[]>([]);

  const filters = ['All', 'Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core'];

  const totalPRs = 103;
  const monthlyPRs = 12;
  const longestStreak = 14;
  const mostImproved = 'Bench Press';

  const toggleExercise = (exercise: string) => {
    setExpandedExercises((prev) =>
      prev.includes(exercise) ? prev.filter((e) => e !== exercise) : [...prev, exercise]
    );
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'improving':
        return <ArrowUp className="w-4 h-4 text-[#10B981]" />;
      case 'stable':
        return <ArrowRight className="w-4 h-4 text-[#9CA3AF]" />;
      case 'plateau':
        return <AlertTriangle className="w-4 h-4 text-[#FBBF24]" />;
      default:
        return null;
    }
  };

  const getTrendText = (trend: string) => {
    switch (trend) {
      case 'improving':
        return 'Improving';
      case 'stable':
        return 'Stable';
      case 'plateau':
        return 'Plateau';
      default:
        return '';
    }
  };

  const getMuscleGroupColor = (muscleGroup: string) => {
    const colors: Record<string, string> = {
      Chest: 'from-[#FF6B35] to-[#DC2626]',
      Shoulders: 'from-[#F59E0B] to-[#FBBF24]',
      Back: 'from-[#10B981] to-[#059669]',
      Legs: 'from-[#DC2626] to-[#991B1B]',
      Arms: 'from-[#FBBF24] to-[#F59E0B]',
      Core: 'from-[#8B5CF6] to-[#7C3AED]',
    };
    return colors[muscleGroup] || 'from-[#6B7280] to-[#4B5563]';
  };

  const filteredExercises =
    activeFilter === 'All'
      ? exercisePRs
      : exercisePRs.filter((ex) => ex.muscleGroup === activeFilter);

  const plateauExercises = exercisePRs.filter((ex) => ex.trend === 'plateau');

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-24 md:pb-8">
      {/* Header */}
      <div className="bg-gradient-to-b from-[#1a1a1a] to-[#0D0D0D] border-b border-[#374151]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center gap-3 mb-2">
              <Trophy className="w-8 h-8 text-[#F59E0B]" />
              <h1 className="text-3xl sm:text-4xl">
                <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                  Personal Records
                </span>
              </h1>
            </div>
            <p className="text-[#9CA3AF]">Celebrate every victory</p>
          </motion.div>

          {/* Stats Row */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6"
          >
            <Card className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              <div className="flex items-center gap-2 mb-2">
                <Trophy className="w-5 h-5 text-[#F59E0B]" />
                <div className="text-sm text-[#9CA3AF]">Total PRs</div>
              </div>
              <div className="text-2xl font-semibold text-white">{totalPRs}</div>
            </Card>
            <Card className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-5 h-5 text-[#10B981]" />
                <div className="text-sm text-[#9CA3AF]">This Month</div>
              </div>
              <div className="text-2xl font-semibold text-white">{monthlyPRs}</div>
            </Card>
            <Card className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              <div className="flex items-center gap-2 mb-2">
                <Flame className="w-5 h-5 text-[#FF6B35]" />
                <div className="text-sm text-[#9CA3AF]">Longest Streak</div>
              </div>
              <div className="text-2xl font-semibold text-white">{longestStreak} days</div>
            </Card>
            <Card className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              <div className="flex items-center gap-2 mb-2">
                <Star className="w-5 h-5 text-[#FBBF24]" />
                <div className="text-sm text-[#9CA3AF]">Most Improved</div>
              </div>
              <div className="text-lg font-semibold text-white truncate">{mostImproved}</div>
            </Card>
          </motion.div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Recent PRs Spotlight */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-8"
        >
          <h2 className="text-2xl font-semibold text-white mb-4">Recent PRs</h2>
          <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory">
            {recentPRs.map((pr, index) => (
              <motion.div
                key={pr.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + index * 0.1 }}
                className="flex-shrink-0 w-80 snap-start"
              >
                <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-2 border-[#FF6B35] relative overflow-hidden group hover:scale-105 transition-transform">
                  {/* Glow Effect */}
                  <div className="absolute inset-0 bg-gradient-to-br from-[#FF6B35]/20 to-[#F59E0B]/20 opacity-50 group-hover:opacity-70 transition-opacity" />

                  <div className="relative z-10">
                    {pr.isNew && (
                      <Badge className="mb-3 bg-gradient-to-r from-[#F59E0B] to-[#FBBF24] text-white border-0 animate-pulse">
                        NEW
                      </Badge>
                    )}
                    <h3 className="text-xl font-semibold text-white mb-2">{pr.exercise}</h3>
                    <Badge className={`mb-3 bg-gradient-to-r ${getMuscleGroupColor(pr.muscleGroup)} text-white border-0`}>
                      {pr.muscleGroup}
                    </Badge>
                    <div className="text-3xl font-bold bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent mb-2">
                      {pr.weight} kg × {pr.reps} reps
                    </div>
                    <div className="text-sm text-[#9CA3AF] mb-3">
                      Estimated 1RM: ~{pr.estimatedOneRM} kg
                    </div>
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="border-[#FF6B35]/30 text-[#FF6B35]">
                        {pr.type}
                      </Badge>
                      <span className="text-xs text-[#9CA3AF]">
                        {pr.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Filter Bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mb-6"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-2 overflow-x-auto pb-2">
              {filters.map((filter) => (
                <Button
                  key={filter}
                  onClick={() => setActiveFilter(filter)}
                  size="sm"
                  className={
                    activeFilter === filter
                      ? 'bg-gradient-to-r from-[#FF6B35] to-[#DC2626] border-0 text-white flex-shrink-0'
                      : 'bg-[#374151] border-0 text-[#9CA3AF] hover:bg-[#4B5563] flex-shrink-0'
                  }
                >
                  {filter}
                </Button>
              ))}
            </div>

            <div className="flex gap-2 ml-4">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setViewMode('list')}
                className={
                  viewMode === 'list'
                    ? 'border-[#FF6B35] text-[#FF6B35]'
                    : 'border-[#374151] text-[#9CA3AF]'
                }
              >
                List
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setViewMode('timeline')}
                className={
                  viewMode === 'timeline'
                    ? 'border-[#FF6B35] text-[#FF6B35]'
                    : 'border-[#374151] text-[#9CA3AF]'
                }
              >
                Timeline
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Plateau Alerts */}
        {plateauExercises.length > 0 && viewMode === 'list' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mb-6"
          >
            {plateauExercises.map((exercise) => (
              <Card
                key={exercise.exercise}
                className="p-4 bg-gradient-to-br from-[#FBBF24]/10 to-[#F59E0B]/10 border-2 border-[#FBBF24]/50 mb-3"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-[#FBBF24] flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="text-white font-semibold mb-1">
                      Your {exercise.exercise} has plateaued
                    </h4>
                    <p className="text-sm text-[#E5E7EB] mb-2">
                      No PR in{' '}
                      {Math.floor(
                        (new Date().getTime() - exercise.lastPRDate.getTime()) /
                          (1000 * 60 * 60 * 24 * 7)
                      )}{' '}
                      weeks
                    </p>
                    <p className="text-sm text-[#9CA3AF]">
                      Try: Add variation or reduce weight, increase reps
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-[#FBBF24] text-[#FBBF24] hover:bg-[#FBBF24]/10"
                  >
                    Browse Routines
                  </Button>
                </div>
              </Card>
            ))}
          </motion.div>
        )}

        {/* Main Content Area */}
        <AnimatePresence mode="wait">
          {viewMode === 'list' ? (
            <motion.div
              key="list"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-3"
            >
              <h2 className="text-2xl font-semibold text-white mb-4">PR List by Exercise</h2>
              {filteredExercises.map((exercise, index) => (
                <motion.div
                  key={exercise.exercise}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card className="bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] overflow-hidden">
                    {/* Exercise Header */}
                    <button
                      onClick={() => toggleExercise(exercise.exercise)}
                      className="w-full p-4 flex items-center justify-between hover:bg-[#1a1a1a]/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div>
                          <h3 className="text-lg font-semibold text-white text-left">
                            {exercise.exercise}
                          </h3>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge className={`bg-gradient-to-r ${getMuscleGroupColor(exercise.muscleGroup)} text-white border-0 text-xs`}>
                              {exercise.muscleGroup}
                            </Badge>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right hidden sm:block">
                          <div className="text-lg font-semibold text-white">
                            {exercise.currentPR.weight} kg × {exercise.currentPR.reps}
                          </div>
                          <div className="text-sm text-[#9CA3AF]">
                            1RM: ~{exercise.estimatedOneRM} kg
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getTrendIcon(exercise.trend)}
                          <span className="text-sm text-[#9CA3AF] hidden sm:inline">
                            {getTrendText(exercise.trend)}
                          </span>
                        </div>
                        <span className="text-xs text-[#6B7280] hidden sm:inline">
                          {exercise.lastPRDate.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                        {expandedExercises.includes(exercise.exercise) ? (
                          <ChevronUp className="w-5 h-5 text-[#9CA3AF]" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-[#9CA3AF]" />
                        )}
                      </div>
                    </button>

                    {/* Expanded Content */}
                    {expandedExercises.includes(exercise.exercise) && (
                      <div className="border-t border-[#374151] p-4">
                        {/* Mini Chart Placeholder */}
                        <div className="mb-4 p-4 rounded-lg bg-[#0D0D0D] border border-[#374151]">
                          <div className="text-sm text-[#9CA3AF] mb-3">PR Progression</div>
                          <div className="h-32 flex items-end justify-between gap-2">
                            {exercise.history.map((entry, idx) => {
                              const maxRM = Math.max(...exercise.history.map((h) => h.estimatedOneRM));
                              const height = (entry.estimatedOneRM / maxRM) * 100;
                              return (
                                <div key={idx} className="flex-1 flex flex-col items-center gap-2">
                                  <div className="w-full bg-gradient-to-t from-[#FF6B35] to-[#F59E0B] rounded-t transition-all hover:opacity-80" style={{ height: `${height}%` }} />
                                  <div className="text-xs text-[#9CA3AF]">
                                    {entry.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* History Table */}
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-[#374151]">
                                <th className="text-left py-2 text-[#9CA3AF]">Date</th>
                                <th className="text-left py-2 text-[#9CA3AF]">Weight</th>
                                <th className="text-left py-2 text-[#9CA3AF]">Reps</th>
                                <th className="text-left py-2 text-[#9CA3AF]">Est. 1RM</th>
                                <th className="text-left py-2 text-[#9CA3AF]">Mode</th>
                              </tr>
                            </thead>
                            <tbody>
                              {exercise.history.map((entry, idx) => (
                                <tr key={idx} className="border-b border-[#374151]/50">
                                  <td className="py-3 text-[#E5E7EB]">
                                    {entry.date.toLocaleDateString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                      year: 'numeric',
                                    })}
                                  </td>
                                  <td className="py-3 text-[#E5E7EB]">{entry.weight} kg</td>
                                  <td className="py-3 text-[#E5E7EB]">{entry.reps}</td>
                                  <td className="py-3 text-white font-semibold">
                                    {entry.estimatedOneRM} kg
                                  </td>
                                  <td className="py-3">
                                    <Badge
                                      variant="outline"
                                      className="border-[#374151] text-[#9CA3AF]"
                                    >
                                      {entry.mode}
                                    </Badge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </Card>
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="timeline"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <h2 className="text-2xl font-semibold text-white mb-6">PR Timeline</h2>

              {/* Timeline */}
              <div className="relative">
                {/* Vertical Line */}
                <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-[#FF6B35] via-[#DC2626] to-[#F59E0B]" />

                <div className="space-y-8">
                  {/* Milestones */}
                  {milestones.map((milestone, index) => (
                    <motion.div
                      key={milestone.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="relative pl-20"
                    >
                      {/* Timeline Node */}
                      <div className="absolute left-4 w-8 h-8 rounded-full bg-gradient-to-br from-[#F59E0B] to-[#FBBF24] flex items-center justify-center border-4 border-[#0D0D0D]">
                        <milestone.icon className="w-4 h-4 text-white" />
                      </div>

                      {/* Milestone Card */}
                      <Card className="p-4 bg-gradient-to-br from-[#F59E0B]/20 to-[#FBBF24]/20 border-2 border-[#F59E0B]/50">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-lg font-semibold text-white mb-1">
                              {milestone.name}
                            </h3>
                            <p className="text-sm text-[#E5E7EB]">
                              Milestone achieved! {milestone.count} personal records
                            </p>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-[#9CA3AF]">
                              {milestone.date.toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </div>
                          </div>
                        </div>
                      </Card>
                    </motion.div>
                  ))}

                  {/* Recent PRs in Timeline */}
                  {recentPRs.map((pr, index) => (
                    <motion.div
                      key={pr.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: (milestones.length + index) * 0.1 }}
                      className="relative pl-20"
                    >
                      {/* Timeline Node */}
                      <div className="absolute left-5 w-6 h-6 rounded-full bg-gradient-to-br from-[#FF6B35] to-[#DC2626] border-4 border-[#0D0D0D]" />

                      {/* PR Card */}
                      <Card className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] hover:border-[#FF6B35]/50 transition-all">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-lg font-semibold text-white">{pr.exercise}</h3>
                              <Badge className={`bg-gradient-to-r ${getMuscleGroupColor(pr.muscleGroup)} text-white border-0 text-xs`}>
                                {pr.muscleGroup}
                              </Badge>
                            </div>
                            <p className="text-xl font-bold bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                              {pr.weight} kg × {pr.reps} reps
                            </p>
                            <p className="text-sm text-[#9CA3AF] mt-1">
                              Est. 1RM: ~{pr.estimatedOneRM} kg
                            </p>
                          </div>
                          <div className="text-right">
                            <Badge
                              variant="outline"
                              className="border-[#FF6B35]/30 text-[#FF6B35] mb-2"
                            >
                              {pr.type}
                            </Badge>
                            <div className="text-xs text-[#9CA3AF]">
                              {pr.date.toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </div>
                          </div>
                        </div>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
