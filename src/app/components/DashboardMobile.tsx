import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/app/hooks/useAuth';
import { workoutListOptions, dashboardStatsOptions, recentPRsOptions } from '@/queries/workouts';
import type { WorkoutSession } from '@/schemas/transforms';
import { useState } from 'react';
import { motion } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Progress } from '@/app/components/ui/progress';
import { Skeleton, WorkoutCardSkeleton } from '@/app/components/ui/skeleton';
import {
  Flame,
  Bell,
  Eye,
  Dumbbell,
  Clock,
  TrendingUp,
  Award,
  Target,
  Calendar,
  ChevronRight,
} from 'lucide-react';

/** Format a relative time string from a Date */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays} days ago`;
}

export function DashboardMobile() {
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: workouts, isPending: workoutsLoading } = useQuery(workoutListOptions(user!.id));
  const { data: weeklyStats, isPending: statsLoading } = useQuery(dashboardStatsOptions(user!.id));

  const recentWorkouts = workouts?.slice(0, 3) ?? [];

  // Derive weekly volume total from stats
  const weeklyTotal = (weeklyStats ?? []).reduce(
    (sum, row) => sum + row.total_volume * 2, // x2 for per-cable to total
    0
  );

  // Derive daily volumes for bar chart (percentages relative to max)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const volumeByDay: Record<string, number> = {};
  days.forEach((d) => (volumeByDay[d] = 0));
  (weeklyStats ?? []).forEach((row) => {
    const dayName = days[new Date(row.started_at).getDay()];
    volumeByDay[dayName] += row.total_volume * 2;
  });
  const orderedDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dailyVolumes = orderedDays.map((d) => volumeByDay[d]);
  const maxVolume = Math.max(...dailyVolumes, 1);
  const barHeights = dailyVolumes.map((v) => Math.round((v / maxVolume) * 100));

  const handleRefresh = async () => {
    setIsPullRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['workouts'] });
    setIsPullRefreshing(false);
  };

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-24">
      {/* Mobile Header */}
      <div className="sticky top-0 z-40 bg-[#0D0D0D]/95 backdrop-blur-lg border-b border-[#374151] px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Welcome back!</h1>
            <p className="text-sm text-[#9CA3AF]">Let's crush today</p>
          </div>
          <button className="relative p-2 hover:bg-[#1a1a1a] rounded-full transition-colors">
            <Bell className="w-6 h-6 text-[#E5E7EB]" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-[#FF6B35] rounded-full animate-pulse" />
          </button>
        </div>
      </div>

      {/* Pull to Refresh Indicator */}
      {isPullRefreshing && (
        <div className="flex justify-center py-4">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          >
            <Flame className="w-6 h-6 text-[#FF6B35]" fill="#FF6B35" />
          </motion.div>
        </div>
      )}

      {/* Content */}
      <div className="px-4 py-6 space-y-6">
        {/* Streak Card - Full Width */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="p-6 bg-gradient-to-br from-[#FF6B35]/20 to-[#DC2626]/20 border-2 border-[#FF6B35]/50">
            <div className="flex items-center gap-4">
              <motion.div
                animate={{
                  scale: [1, 1.1, 1],
                  filter: [
                    'drop-shadow(0 0 10px #FF6B35)',
                    'drop-shadow(0 0 20px #DC2626)',
                    'drop-shadow(0 0 10px #FF6B35)',
                  ],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              >
                <Flame className="w-16 h-16 text-[#FF6B35]" fill="#FF6B35" />
              </motion.div>
              <div className="flex-1">
                <div className="text-4xl font-bold text-white mb-1">7 Days</div>
                <div className="text-sm text-[#E5E7EB]">Keep the fire burning!</div>
                <Progress value={70} className="h-2 mt-2 bg-[#1a1a1a]" />
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Today's Workout */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <h2 className="text-lg font-semibold text-white mb-3">Today's Workout</h2>
          <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white mb-2">Push Day A</h3>
                <div className="flex flex-wrap gap-3 text-sm text-[#9CA3AF]">
                  <div className="flex items-center gap-1">
                    <Dumbbell className="w-4 h-4" />
                    <span>6 exercises</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    <span>~60 min</span>
                  </div>
                </div>
              </div>
              <Badge className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] text-white border-0">
                Ready
              </Badge>
            </div>

            <Button className="w-full bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0 h-12">
              <Eye className="w-5 h-5 mr-2" />
              View Routine Details
            </Button>
          </Card>
        </motion.div>

        {/* Quick Stats - Horizontal Scroll */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <h2 className="text-lg font-semibold text-white mb-3">Quick Stats</h2>
          {workoutsLoading ? (
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] min-w-[120px] flex-shrink-0">
                  <Skeleton className="w-10 h-10 rounded-lg mb-3" />
                  <Skeleton className="h-7 w-16 mb-1" />
                  <Skeleton className="h-3 w-12" />
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
              <QuickStatCard
                icon={<Dumbbell className="w-5 h-5" />}
                value={String(workouts?.length ?? 0)}
                label="Workouts"
                gradient="from-[#FF6B35] to-[#DC2626]"
              />
              <QuickStatCard
                icon={<Award className="w-5 h-5" />}
                value={String(workouts?.reduce((sum, w) => sum + w.pr_count, 0) ?? 0)}
                label="PRs"
                gradient="from-[#F59E0B] to-[#D97706]"
              />
              <QuickStatCard
                icon={<TrendingUp className="w-5 h-5" />}
                value={weeklyTotal > 0 ? `${(weeklyTotal / 1000).toFixed(0)}k` : '--'}
                label="Volume"
                gradient="from-[#10B981] to-[#059669]"
              />
              <QuickStatCard
                icon={<Target className="w-5 h-5" />}
                value="--"
                label="Goals"
                gradient="from-[#6366F1] to-[#4F46E5]"
              />
            </div>
          )}
        </motion.div>

        {/* Weekly Volume Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <h2 className="text-lg font-semibold text-white mb-3">This Week</h2>
          {statsLoading ? (
            <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              <Skeleton className="h-8 w-32 mb-1" />
              <Skeleton className="h-4 w-40 mb-4" />
              <Skeleton className="h-32 w-full" />
            </Card>
          ) : weeklyTotal === 0 ? (
            <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Dumbbell className="w-10 h-10 text-[#374151] mb-3" />
                <p className="text-[#9CA3AF] mb-1">No workouts this week</p>
                <p className="text-sm text-[#6B7280]">Complete a workout in the mobile app to see your stats here</p>
              </div>
            </Card>
          ) : (
            <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              <div className="mb-4">
                <div className="text-3xl font-bold text-white mb-1">{Math.round(weeklyTotal).toLocaleString()} kg</div>
                <div className="text-sm text-[#10B981] flex items-center gap-1">
                  <TrendingUp className="w-4 h-4" />
                  <span>This week's total</span>
                </div>
              </div>

              {/* Simple bar chart */}
              <div className="flex items-end justify-between h-32 gap-2">
                {barHeights.map((height, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2">
                    <motion.div
                      className="w-full bg-gradient-to-t from-[#FF6B35] to-[#F59E0B] rounded-t"
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max(height, 2)}%` }}
                      transition={{ delay: 0.5 + i * 0.1, duration: 0.5 }}
                    />
                    <span className="text-xs text-[#6B7280]">
                      {['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </motion.div>

        {/* Recent Activity */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">Recent Activity</h2>
            <button className="text-sm text-[#FF6B35] flex items-center gap-1">
              View All
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {workoutsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <WorkoutCardSkeleton key={i} />
              ))}
            </div>
          ) : recentWorkouts.length === 0 ? (
            <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Dumbbell className="w-10 h-10 text-[#374151] mb-3" />
                <p className="text-[#9CA3AF] mb-1">No workouts yet</p>
                <p className="text-sm text-[#6B7280]">Sync from the Vitruvian mobile app to see your activity</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-3">
              {recentWorkouts.map((workout: WorkoutSession) => (
                <RecentActivityCard
                  key={workout.id}
                  title={workout.name}
                  time={formatRelativeTime(workout.started_at)}
                  volume={`${workout.total_volume.toLocaleString()} kg`}
                  duration={`${workout.duration_seconds} min`}
                  prs={workout.pr_count}
                />
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

function QuickStatCard({
  icon,
  value,
  label,
  gradient,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  gradient: string;
}) {
  return (
    <Card className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] min-w-[120px] flex-shrink-0">
      <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center mb-3 text-white`}>
        {icon}
      </div>
      <div className="text-2xl font-bold text-white mb-1">{value}</div>
      <div className="text-xs text-[#9CA3AF]">{label}</div>
    </Card>
  );
}

function RecentActivityCard({
  title,
  time,
  volume,
  duration,
  prs,
}: {
  title: string;
  time: string;
  volume: string;
  duration: string;
  prs: number;
}) {
  return (
    <Card className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] active:scale-[0.98] transition-transform">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold text-white">{title}</h4>
        <span className="text-xs text-[#6B7280]">{time}</span>
      </div>
      <div className="flex items-center gap-4 text-sm text-[#9CA3AF]">
        <span>{volume}</span>
        <span>-</span>
        <span>{duration}</span>
        {prs > 0 && (
          <>
            <span>-</span>
            <Badge className="bg-[#F59E0B]/20 text-[#F59E0B] border-[#F59E0B]/30 text-xs">
              {prs} PR
            </Badge>
          </>
        )}
      </div>
    </Card>
  );
}
