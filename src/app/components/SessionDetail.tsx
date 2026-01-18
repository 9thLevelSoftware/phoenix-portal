import { useState } from 'react';
import { motion } from 'motion/react';
import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import {
  ArrowLeft,
  Clock,
  TrendingUp,
  Award,
  Dumbbell,
  ChevronDown,
  ChevronUp,
  Share2,
  BarChart3,
  Flame,
  Zap,
} from 'lucide-react';

interface SessionDetailProps {
  sessionId: string;
  onBack: () => void;
}

interface SetData {
  setNumber: number;
  target: number;
  actual: number;
  weight: number;
  rpe: number;
  notes?: string;
  isPR?: boolean;
}

interface Exercise {
  id: string;
  name: string;
  muscleGroup: string;
  sets: SetData[];
  hasPR: boolean;
}

// Mock session data
const mockSession = {
  id: '1',
  name: 'Upper Body Power',
  date: new Date(2026, 0, 18),
  startTime: '6:30 AM',
  duration: 65,
  totalVolume: 4250,
  totalSets: 16,
  prCount: 2,
  routine: 'Push/Pull/Legs',
  exercises: [
    {
      id: 'ex1',
      name: 'Bench Press',
      muscleGroup: 'Chest',
      hasPR: true,
      sets: [
        { setNumber: 1, target: 8, actual: 8, weight: 100, rpe: 7, notes: 'Warmup' },
        { setNumber: 2, target: 6, actual: 6, weight: 110, rpe: 8 },
        { setNumber: 3, target: 4, actual: 5, weight: 120, rpe: 9, isPR: true, notes: '🔥 NEW PR!' },
      ],
    },
    {
      id: 'ex2',
      name: 'Overhead Press',
      muscleGroup: 'Shoulders',
      hasPR: false,
      sets: [
        { setNumber: 1, target: 8, actual: 8, weight: 60, rpe: 7 },
        { setNumber: 2, target: 8, actual: 7, weight: 65, rpe: 8.5 },
        { setNumber: 3, target: 8, actual: 6, weight: 65, rpe: 9 },
      ],
    },
    {
      id: 'ex3',
      name: 'Incline Dumbbell Press',
      muscleGroup: 'Chest',
      hasPR: true,
      sets: [
        { setNumber: 1, target: 10, actual: 10, weight: 40, rpe: 7 },
        { setNumber: 2, target: 10, actual: 10, weight: 45, rpe: 8 },
        { setNumber: 3, target: 10, actual: 10, weight: 45, rpe: 8.5, isPR: true, notes: '🔥 Volume PR!' },
        { setNumber: 4, target: 10, actual: 8, weight: 45, rpe: 9 },
      ],
    },
    {
      id: 'ex4',
      name: 'Lateral Raises',
      muscleGroup: 'Shoulders',
      hasPR: false,
      sets: [
        { setNumber: 1, target: 12, actual: 12, weight: 15, rpe: 7 },
        { setNumber: 2, target: 12, actual: 12, weight: 15, rpe: 8 },
        { setNumber: 3, target: 12, actual: 10, weight: 15, rpe: 9 },
      ],
    },
    {
      id: 'ex5',
      name: 'Tricep Pushdowns',
      muscleGroup: 'Arms',
      hasPR: false,
      sets: [
        { setNumber: 1, target: 12, actual: 12, weight: 35, rpe: 7 },
        { setNumber: 2, target: 12, actual: 12, weight: 40, rpe: 8 },
        { setNumber: 3, target: 12, actual: 10, weight: 40, rpe: 8.5 },
      ],
    },
  ] as Exercise[],
  metrics: {
    peakPower: 1250,
    avgPower: 890,
    timeUnderTension: 245,
    estimatedCalories: 385,
    concentricForce: 65,
    eccentricForce: 78,
  },
};

export function SessionDetail({ sessionId, onBack }: SessionDetailProps) {
  const [expandedExercises, setExpandedExercises] = useState<string[]>(['ex1']);
  const [showMetrics, setShowMetrics] = useState(false);
  const [notes, setNotes] = useState('');

  const toggleExercise = (exerciseId: string) => {
    setExpandedExercises((prev) =>
      prev.includes(exerciseId)
        ? prev.filter((id) => id !== exerciseId)
        : [...prev, exerciseId]
    );
  };

  const getMuscleGroupColor = (muscleGroup: string) => {
    const colors: Record<string, string> = {
      Chest: 'bg-[#FF6B35]',
      Shoulders: 'bg-[#F59E0B]',
      Back: 'bg-[#10B981]',
      Legs: 'bg-[#DC2626]',
      Arms: 'bg-[#FBBF24]',
      Core: 'bg-[#8B5CF6]',
    };
    return colors[muscleGroup] || 'bg-[#6B7280]';
  };

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-24 md:pb-8">
      {/* Header */}
      <div className="bg-gradient-to-b from-[#1a1a1a] to-[#0D0D0D] border-b border-[#374151] sticky top-0 z-40 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Button
              variant="outline"
              size="sm"
              onClick={onBack}
              className="mb-4 border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-[#FF6B35]"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to History
            </Button>

            <h1 className="text-3xl sm:text-4xl mb-2">
              <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                {mockSession.name}
              </span>
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-[#9CA3AF]">
              <span>
                {mockSession.date.toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
              <span>•</span>
              <span>{mockSession.startTime}</span>
              {mockSession.routine && (
                <>
                  <span>•</span>
                  <Badge
                    variant="outline"
                    className="border-[#FF6B35]/30 text-[#FF6B35]"
                  >
                    {mockSession.routine}
                  </Badge>
                </>
              )}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Stats Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] p-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Clock className="w-5 h-5 text-[#FF6B35]" />
                  <div className="text-sm text-[#9CA3AF]">Duration</div>
                </div>
                <div className="text-2xl font-semibold text-white">
                  {mockSession.duration}m
                </div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <TrendingUp className="w-5 h-5 text-[#10B981]" />
                  <div className="text-sm text-[#9CA3AF]">Volume</div>
                </div>
                <div className="text-2xl font-semibold text-white">
                  {mockSession.totalVolume.toLocaleString()} kg
                </div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Dumbbell className="w-5 h-5 text-[#F59E0B]" />
                  <div className="text-sm text-[#9CA3AF]">Sets</div>
                </div>
                <div className="text-2xl font-semibold text-white">
                  {mockSession.totalSets}
                </div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Award className="w-5 h-5 text-[#FBBF24]" />
                  <div className="text-sm text-[#9CA3AF]">PRs</div>
                </div>
                <div className="text-2xl font-semibold bg-gradient-to-r from-[#F59E0B] to-[#FBBF24] bg-clip-text text-transparent">
                  {mockSession.prCount}
                </div>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Exercise Breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <h2 className="text-2xl font-semibold text-white mb-4">Exercise Breakdown</h2>
          <div className="space-y-3">
            {mockSession.exercises.map((exercise, index) => (
              <motion.div
                key={exercise.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + index * 0.05 }}
              >
                <Card className="bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] overflow-hidden">
                  {/* Exercise Header */}
                  <button
                    onClick={() => toggleExercise(exercise.id)}
                    className="w-full p-4 flex items-center justify-between hover:bg-[#1a1a1a]/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#FF6B35] to-[#DC2626] flex items-center justify-center">
                        <Dumbbell className="w-5 h-5 text-white" />
                      </div>
                      <div className="text-left">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-white">
                            {exercise.name}
                          </h3>
                          {exercise.hasPR && (
                            <Flame className="w-4 h-4 text-[#F59E0B]" />
                          )}
                        </div>
                        <Badge
                          className={`${getMuscleGroupColor(
                            exercise.muscleGroup
                          )} text-white border-0 mt-1`}
                        >
                          {exercise.muscleGroup}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-[#9CA3AF]">
                        {exercise.sets.length} sets
                      </span>
                      {expandedExercises.includes(exercise.id) ? (
                        <ChevronUp className="w-5 h-5 text-[#9CA3AF]" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-[#9CA3AF]" />
                      )}
                    </div>
                  </button>

                  {/* Exercise Sets Table */}
                  {expandedExercises.includes(exercise.id) && (
                    <div className="border-t border-[#374151] p-4">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[#374151]">
                              <th className="text-left py-2 text-[#9CA3AF]">Set</th>
                              <th className="text-left py-2 text-[#9CA3AF]">Target</th>
                              <th className="text-left py-2 text-[#9CA3AF]">Actual</th>
                              <th className="text-left py-2 text-[#9CA3AF]">Weight</th>
                              <th className="text-left py-2 text-[#9CA3AF]">RPE</th>
                              <th className="text-left py-2 text-[#9CA3AF]">Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {exercise.sets.map((set) => (
                              <tr
                                key={set.setNumber}
                                className={`border-b border-[#374151]/50 ${
                                  set.isPR ? 'border-l-4 border-l-[#F59E0B]' : ''
                                }`}
                              >
                                <td className="py-3 text-white font-semibold">
                                  {set.setNumber}
                                </td>
                                <td className="py-3 text-[#E5E7EB]">{set.target}</td>
                                <td className="py-3 text-[#E5E7EB]">{set.actual}</td>
                                <td className="py-3 text-[#E5E7EB]">{set.weight} kg</td>
                                <td className="py-3 text-[#E5E7EB]">{set.rpe}</td>
                                <td className="py-3">
                                  {set.isPR && (
                                    <Badge className="bg-gradient-to-r from-[#F59E0B] to-[#FBBF24] text-white border-0">
                                      NEW PR
                                    </Badge>
                                  )}
                                  {set.notes && !set.isPR && (
                                    <span className="text-[#9CA3AF]">{set.notes}</span>
                                  )}
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
          </div>
        </motion.div>

        {/* Metrics Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card className="bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
            <button
              onClick={() => setShowMetrics(!showMetrics)}
              className="w-full p-4 flex items-center justify-between hover:bg-[#1a1a1a]/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <BarChart3 className="w-5 h-5 text-[#FF6B35]" />
                <h2 className="text-xl font-semibold text-white">
                  Performance Metrics
                </h2>
              </div>
              {showMetrics ? (
                <ChevronUp className="w-5 h-5 text-[#9CA3AF]" />
              ) : (
                <ChevronDown className="w-5 h-5 text-[#9CA3AF]" />
              )}
            </button>

            {showMetrics && (
              <div className="border-t border-[#374151] p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-[#0D0D0D] border border-[#374151]">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="w-4 h-4 text-[#FBBF24]" />
                      <div className="text-sm text-[#9CA3AF]">Peak Power</div>
                    </div>
                    <div className="text-2xl font-semibold text-white">
                      {mockSession.metrics.peakPower} W
                    </div>
                  </div>
                  <div className="p-4 rounded-lg bg-[#0D0D0D] border border-[#374151]">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="w-4 h-4 text-[#10B981]" />
                      <div className="text-sm text-[#9CA3AF]">Avg Power</div>
                    </div>
                    <div className="text-2xl font-semibold text-white">
                      {mockSession.metrics.avgPower} W
                    </div>
                  </div>
                  <div className="p-4 rounded-lg bg-[#0D0D0D] border border-[#374151]">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-4 h-4 text-[#FF6B35]" />
                      <div className="text-sm text-[#9CA3AF]">Time Under Tension</div>
                    </div>
                    <div className="text-2xl font-semibold text-white">
                      {mockSession.metrics.timeUnderTension}s
                    </div>
                  </div>
                  <div className="p-4 rounded-lg bg-[#0D0D0D] border border-[#374151]">
                    <div className="flex items-center gap-2 mb-2">
                      <Flame className="w-4 h-4 text-[#DC2626]" />
                      <div className="text-sm text-[#9CA3AF]">Est. Calories</div>
                    </div>
                    <div className="text-2xl font-semibold text-white">
                      {mockSession.metrics.estimatedCalories} kcal
                    </div>
                  </div>
                </div>

                {/* Force Breakdown */}
                <div className="mt-4 p-4 rounded-lg bg-[#0D0D0D] border border-[#374151]">
                  <h3 className="text-sm text-[#9CA3AF] mb-3">Force Distribution</h3>
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-[#E5E7EB]">Concentric</span>
                        <span className="text-sm text-[#E5E7EB]">
                          {mockSession.metrics.concentricForce}%
                        </span>
                      </div>
                      <div className="h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#FF6B35] to-[#DC2626]"
                          style={{ width: `${mockSession.metrics.concentricForce}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-[#E5E7EB]">Eccentric</span>
                        <span className="text-sm text-[#E5E7EB]">
                          {mockSession.metrics.eccentricForce}%
                        </span>
                      </div>
                      <div className="h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#10B981] to-[#059669]"
                          style={{ width: `${mockSession.metrics.eccentricForce}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </motion.div>

        {/* Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <Button
            className="flex-1 bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            Compare to Previous
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-[#FF6B35]"
          >
            <Share2 className="w-4 h-4 mr-2" />
            Share Summary
          </Button>
        </motion.div>

        {/* Notes Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <Card className="bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] p-4">
            <h3 className="text-lg font-semibold text-white mb-3">Workout Notes</h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about this workout..."
              className="w-full bg-[#0D0D0D] border border-[#374151] rounded-lg p-3 text-white placeholder:text-[#6B7280] focus:border-[#FF6B35] focus:outline-none resize-none"
              rows={4}
            />
            <Button
              size="sm"
              className="mt-3 bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
            >
              Save Notes
            </Button>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
