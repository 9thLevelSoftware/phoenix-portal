import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Progress } from '@/app/components/ui/progress';
import { CardSkeleton } from '@/app/components/ui/skeleton';
import {
  Plus,
  Flame,
  Eye,
  Edit,
  MoreVertical,
  Dumbbell,
  BedDouble,
} from 'lucide-react';
import { useAuth } from '@/app/hooks/useAuth';
import { cycleListOptions } from '@/queries/cycles';
import type { TrainingCycle } from '@/schemas/transforms';

export function TrainingCycles() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: cycles, isPending } = useQuery(cycleListOptions(user!.id));

  const allCycles = cycles ?? [];
  const activeCycle = allCycles.find((c) => c.status === 'active');

  if (isPending) {
    return (
      <div className="min-h-screen bg-[#0D0D0D] pb-24 md:pb-8">
        <div className="bg-gradient-to-b from-[#1a1a1a] to-[#0D0D0D] border-b border-[#374151] sticky top-0 z-40 backdrop-blur-xl">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h1 className="text-3xl sm:text-4xl mb-2">
                  <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                    Training Cycles
                  </span>
                </h1>
                <p className="text-[#9CA3AF]">Periodize your progress</p>
              </div>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
          <CardSkeleton />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (allCycles.length === 0) {
    return (
      <div className="min-h-screen bg-[#0D0D0D] pb-24 md:pb-8">
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
                    Training Cycles
                  </span>
                </h1>
                <p className="text-[#9CA3AF]">Periodize your progress</p>
              </div>
              <Button
                onClick={() => navigate('/cycles/new')}
                className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Cycle
              </Button>
            </motion.div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
          <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-[#FF6B35]/20 to-[#DC2626]/20 flex items-center justify-center">
            <Flame className="w-12 h-12 text-[#FF6B35]" />
          </div>
          <h3 className="text-2xl font-semibold text-white mb-2">No training cycles yet</h3>
          <p className="text-[#9CA3AF] mb-6 max-w-md mx-auto">
            Create your first training cycle to periodize your progress and track weekly goals.
          </p>
          <Button
            onClick={() => navigate('/cycles/new')}
            className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Cycle
          </Button>
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
                  Training Cycles
                </span>
              </h1>
              <p className="text-[#9CA3AF]">Periodize your progress</p>
            </div>

            <Button
              onClick={() => navigate('/cycles/new')}
              className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Cycle
            </Button>
          </motion.div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Active Cycle Card */}
        {activeCycle && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="p-6 sm:p-8 bg-gradient-to-br from-[#FF6B35]/10 to-[#DC2626]/10 border-2 border-[#FF6B35]/50 relative overflow-hidden">
              <div className="absolute top-4 right-4">
                <Badge className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] text-white border-0">
                  <Flame className="w-3 h-3 mr-1" />
                  ACTIVE CYCLE
                </Badge>
              </div>

              <div className="mb-6">
                <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
                  {activeCycle.name}
                </h2>
                <div className="flex items-center gap-2 text-sm text-[#9CA3AF]">
                  <span>
                    Week {activeCycle.current_week} of {activeCycle.duration_weeks}
                  </span>
                  <span>-</span>
                  <span>{Math.round((activeCycle.current_week / activeCycle.duration_weeks) * 100)}% complete</span>
                </div>
              </div>

              <div className="mb-6">
                <Progress
                  value={(activeCycle.current_week / activeCycle.duration_weeks) * 100}
                  className="h-3 bg-[#1a1a1a]"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="flex gap-6 text-sm text-[#9CA3AF]">
                  <div className="flex items-center gap-2">
                    <Dumbbell className="w-4 h-4 text-[#FF6B35]" />
                    <span>{activeCycle.workout_days} workout days/week</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BedDouble className="w-4 h-4 text-[#6B7280]" />
                    <span>{activeCycle.rest_days} rest days/week</span>
                  </div>
                </div>
                <div className="flex gap-3 w-full sm:w-auto">
                  <Button
                    variant="outline"
                    onClick={() => navigate(`/cycles/${activeCycle.id}`)}
                    className="border-[#FF6B35] text-[#FF6B35] hover:bg-[#FF6B35]/10"
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    View Full Cycle
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        )}

        {/* My Cycles */}
        <div>
          <h2 className="text-2xl font-semibold text-white mb-6">My Cycles</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {allCycles.map((cycle, index) => {
              const lastUsedText = cycle.last_used_at
                ? cycle.last_used_at.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })
                : undefined;

              return (
                <motion.div
                  key={cycle.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] hover:border-[#FF6B35]/50 transition-all">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-white mb-2">{cycle.name}</h3>
                        <Badge
                          className={
                            cycle.status === 'active'
                              ? 'bg-[#10B981] text-white border-0'
                              : cycle.status === 'completed'
                              ? 'bg-[#6B7280] text-white border-0'
                              : 'bg-[#F59E0B] text-white border-0'
                          }
                        >
                          {cycle.status.toUpperCase()}
                        </Badge>
                      </div>
                      <button className="text-[#9CA3AF] hover:text-white transition-colors">
                        <MoreVertical className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="space-y-3 mb-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[#9CA3AF]">Duration</span>
                        <span className="text-white font-medium">{cycle.duration_weeks} weeks</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[#9CA3AF]">Workout days</span>
                        <div className="flex items-center gap-2">
                          <Dumbbell className="w-4 h-4 text-[#FF6B35]" />
                          <span className="text-white font-medium">{cycle.workout_days}</span>
                          <span className="text-[#6B7280]">/</span>
                          <BedDouble className="w-4 h-4 text-[#6B7280]" />
                          <span className="text-[#9CA3AF]">{cycle.rest_days}</span>
                        </div>
                      </div>
                      {cycle.status !== 'draft' && lastUsedText && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-[#9CA3AF]">Last used</span>
                          <span className="text-white font-medium">{lastUsedText}</span>
                        </div>
                      )}
                    </div>

                    {cycle.status === 'active' && (
                      <div className="mb-4">
                        <Progress
                          value={(cycle.current_week / cycle.duration_weeks) * 100}
                          className="h-2 bg-[#0D0D0D]"
                        />
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/cycles/${cycle.id}`)}
                        className="flex-1 border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-[#FF6B35]"
                      >
                        <Edit className="w-4 h-4 mr-1" />
                        Edit
                      </Button>
                      {cycle.status !== 'active' && (
                        <Button
                          size="sm"
                          className="flex-1 bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
                        >
                          Activate
                        </Button>
                      )}
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
