import { useState } from 'react';
import { motion } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Progress } from '@/app/components/ui/progress';
import {
  Plus,
  Flame,
  Calendar,
  Eye,
  Edit,
  MoreVertical,
  Dumbbell,
  BedDouble,
} from 'lucide-react';

interface Cycle {
  id: string;
  name: string;
  duration: number;
  currentWeek: number;
  status: 'active' | 'completed' | 'draft';
  workoutDays: number;
  restDays: number;
  lastUsed?: string;
}

interface TrainingCyclesProps {
  onCreateCycle: () => void;
  onEditCycle: (id: string) => void;
}

const mockCycles: Cycle[] = [
  {
    id: '1',
    name: '12-Week Strength Builder',
    duration: 12,
    currentWeek: 4,
    status: 'active',
    workoutDays: 4,
    restDays: 3,
    lastUsed: 'Today',
  },
  {
    id: '2',
    name: 'Summer Cut Program',
    duration: 8,
    currentWeek: 8,
    status: 'completed',
    workoutDays: 5,
    restDays: 2,
    lastUsed: '2 weeks ago',
  },
  {
    id: '3',
    name: 'New Program',
    duration: 6,
    currentWeek: 0,
    status: 'draft',
    workoutDays: 6,
    restDays: 1,
  },
];

export function TrainingCycles({ onCreateCycle, onEditCycle }: TrainingCyclesProps) {
  const [cycles, setCycles] = useState(mockCycles);
  const activeCycle = cycles.find((c) => c.status === 'active');

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
              onClick={onCreateCycle}
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
                    Week {activeCycle.currentWeek} of {activeCycle.duration}
                  </span>
                  <span>•</span>
                  <span>{Math.round((activeCycle.currentWeek / activeCycle.duration) * 100)}% complete</span>
                </div>
              </div>

              <div className="mb-6">
                <Progress
                  value={(activeCycle.currentWeek / activeCycle.duration) * 100}
                  className="h-3 bg-[#1a1a1a]"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div>
                  <div className="text-sm text-[#9CA3AF] mb-1">Today</div>
                  <div className="text-lg font-semibold text-white">Day 3 - Push Day A</div>
                </div>
                <div className="flex gap-3 w-full sm:w-auto">
                  <Button
                    className="flex-1 sm:flex-initial bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    View Today's Workout
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => onEditCycle(activeCycle.id)}
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
            {cycles.map((cycle, index) => (
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
                      <span className="text-white font-medium">{cycle.duration} weeks</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#9CA3AF]">Workout days</span>
                      <div className="flex items-center gap-2">
                        <Dumbbell className="w-4 h-4 text-[#FF6B35]" />
                        <span className="text-white font-medium">{cycle.workoutDays}</span>
                        <span className="text-[#6B7280]">/</span>
                        <BedDouble className="w-4 h-4 text-[#6B7280]" />
                        <span className="text-[#9CA3AF]">{cycle.restDays}</span>
                      </div>
                    </div>
                    {cycle.status !== 'draft' && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[#9CA3AF]">Last used</span>
                        <span className="text-white font-medium">{cycle.lastUsed}</span>
                      </div>
                    )}
                  </div>

                  {cycle.status === 'active' && (
                    <div className="mb-4">
                      <Progress
                        value={(cycle.currentWeek / cycle.duration) * 100}
                        className="h-2 bg-[#0D0D0D]"
                      />
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onEditCycle(cycle.id)}
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
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
