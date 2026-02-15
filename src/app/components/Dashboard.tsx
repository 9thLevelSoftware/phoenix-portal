import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/app/hooks/useAuth';
import { workoutListOptions, dashboardStatsOptions, recentPRsOptions } from '@/queries/workouts';
import type { WorkoutSession, PersonalRecord } from '@/schemas/transforms';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Progress } from '@/app/components/ui/progress';
import { Skeleton, ChartSkeleton, WorkoutCardSkeleton } from '@/app/components/ui/skeleton';
import { SyncStatus } from './SyncStatus';
import { PortalBanner } from './PortalBanner';
import {
  Flame,
  TrendingUp,
  Trophy,
  Calendar,
  Clock,
  Dumbbell,
  Award,
  ArrowRight,
  Target,
  Eye,
} from 'lucide-react';
import { motion } from 'motion/react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

/** Derive weekly volume chart data from dashboard stats */
function deriveWeeklyVolume(
  stats: { started_at: string; total_volume: number }[] | undefined
): { day: string; volume: number }[] {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const volumeByDay: Record<string, number> = {};
  days.forEach((d) => (volumeByDay[d] = 0));

  if (stats) {
    for (const row of stats) {
      const dayName = days[new Date(row.started_at).getDay()];
      // total_volume is per-cable in DB; multiply by 2 for display
      volumeByDay[dayName] += row.total_volume * 2;
    }
  }

  // Return Mon-Sun order for chart
  const orderedDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return orderedDays.map((day) => ({ day, volume: Math.round(volumeByDay[day]) }));
}

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

export function Dashboard() {
  const { user } = useAuth();
  const { data: workouts, isPending: workoutsLoading } = useQuery(workoutListOptions(user!.id));
  const { data: weeklyStats, isPending: statsLoading } = useQuery(dashboardStatsOptions(user!.id));
  const { data: recentPRs, isPending: prsLoading } = useQuery(recentPRsOptions(user!.id));

  const recentWorkouts = workouts?.slice(0, 5) ?? [];
  const weeklyVolumeData = deriveWeeklyVolume(weeklyStats ?? undefined);
  const weeklyTotal = weeklyVolumeData.reduce((sum, d) => sum + d.volume, 0);

  // TODO(phase-5): Replace with real challenges data from community tables
  const activeChallenges = [
    { name: 'January Volume Challenge', progress: 68, rank: 12, total: 150 },
    { name: 'PR Hunter', progress: 45, rank: 8, total: 50 },
    { name: '30-Day Streak', progress: 87, rank: 25, total: 100 },
  ];

  // TODO(phase-3): Replace with real badges data from subscription/gamification tables
  const badges = [
    { name: 'Week Warrior', icon: '\u{1F525}', rarity: 'gold' },
    { name: 'PR Crusher', icon: '\u{1F4AA}', rarity: 'platinum' },
    { name: 'Consistency King', icon: '\u{1F451}', rarity: 'gold' },
    { name: '100 Workouts', icon: '\u{1F4AF}', rarity: 'silver' },
  ];

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-20 md:pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-3xl sm:text-4xl mb-2">
            Welcome back, <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">{user?.email?.split('@')[0] ?? 'Athlete'}</span>
          </h1>
          <p className="text-[#9CA3AF]">Let's make today count. Your strength awaits.</p>
        </motion.div>

        {/* Portal Banner */}
        <PortalBanner />

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Main Stats */}
          <div className="lg:col-span-2 space-y-6">
            {/* Vitruvian Sync Status */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
            >
              <SyncStatus lastSync="2 minutes ago" status="synced" />
            </motion.div>

            {/* Streak Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card className="p-6 bg-gradient-to-br from-[#FF6B35]/20 to-[#DC2626]/20 border-[#FF6B35] border-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <Flame className="w-8 h-8 text-[#F59E0B]" fill="#FF6B35" />
                      <div>
                        <h3 className="text-2xl text-white">7 Day Streak</h3>
                        <p className="text-[#E5E7EB] text-sm">Keep the fire burning!</p>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-4xl bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                      {'\u{1F525}'}
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>

            {/* Today's Workout Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] hover:border-[#FF6B35]/50 transition-all duration-300">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl text-white">Scheduled Workout</h3>
                  <Badge className="bg-[#10B981] text-white border-0">Scheduled</Badge>
                </div>
                <div className="space-y-4">
                  <div>
                    <h4 className="text-2xl text-[#FF6B35] mb-2">Push Day A</h4>
                    <p className="text-[#9CA3AF]">Part of: Upper/Lower 4-Day Split</p>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-[#9CA3AF]">
                    <div className="flex items-center gap-2">
                      <Dumbbell className="w-4 h-4" />
                      <span>6 exercises</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>~60 min</span>
                    </div>
                  </div>
                  <Button className="w-full bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0 shadow-lg shadow-[#FF6B35]/50">
                    <Eye className="w-4 h-4 mr-2" />
                    View Routine Details
                  </Button>
                </div>
              </Card>
            </motion.div>

            {/* Weekly Volume Chart */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              {statsLoading ? (
                <ChartSkeleton />
              ) : (
                <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
                  <h3 className="text-xl text-white mb-6">Weekly Volume</h3>
                  {weeklyTotal === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <Dumbbell className="w-12 h-12 text-[#374151] mb-4" />
                      <p className="text-[#9CA3AF] mb-2">No workouts this week yet</p>
                      <p className="text-sm text-[#6B7280]">Complete a workout in the mobile app to see your volume here</p>
                    </div>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={weeklyVolumeData}>
                          <defs>
                            <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#FF6B35" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="#DC2626" stopOpacity={0.1} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis dataKey="day" stroke="#9CA3AF" />
                          <YAxis stroke="#9CA3AF" />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#1a1a1a',
                              border: '1px solid #374151',
                              borderRadius: '8px',
                              color: '#E5E7EB',
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="volume"
                            stroke="#FF6B35"
                            strokeWidth={2}
                            fill="url(#volumeGradient)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                      <div className="mt-4 flex items-center justify-between text-sm">
                        <span className="text-[#9CA3AF]">Total this week</span>
                        <span className="text-[#FF6B35] font-semibold">{weeklyTotal.toLocaleString()} kg</span>
                      </div>
                    </>
                  )}
                </Card>
              )}
            </motion.div>

            {/* Recent Workouts */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl text-white">Recent Activity</h3>
                  <Button variant="ghost" className="text-[#FF6B35] hover:bg-[#FF6B35]/10">
                    View All
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
                {workoutsLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <WorkoutCardSkeleton key={i} />
                    ))}
                  </div>
                ) : recentWorkouts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Dumbbell className="w-10 h-10 text-[#374151] mb-3" />
                    <p className="text-[#9CA3AF] mb-1">No workouts yet</p>
                    <p className="text-sm text-[#6B7280]">Sync your first workout from the Vitruvian mobile app</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentWorkouts.map((workout: WorkoutSession) => (
                      <div
                        key={workout.id}
                        className="flex items-center justify-between p-3 bg-[#0D0D0D] rounded-lg border border-[#374151] hover:border-[#FF6B35]/50 transition-all cursor-pointer"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="text-white">{workout.name}</h4>
                            {workout.pr_count > 0 && (
                              <Badge className="bg-[#F59E0B] text-[#0D0D0D] border-0 text-xs">
                                {workout.pr_count} PR{workout.pr_count > 1 ? 's' : ''}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-[#9CA3AF]">{formatRelativeTime(workout.started_at)}</p>
                        </div>
                        <div className="text-right">
                          <div className="text-[#FF6B35] font-semibold">{workout.total_volume.toLocaleString()} kg</div>
                          <div className="text-sm text-[#9CA3AF]">{workout.duration_seconds} min</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </motion.div>
          </div>

          {/* Right Column - Quick Stats & Challenges */}
          <div className="space-y-6">
            {/* Quick Stats */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
                <h3 className="text-xl text-white mb-4">Quick Stats</h3>
                {workoutsLoading ? (
                  <div className="space-y-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-5 w-12" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[#9CA3AF]">
                        <Calendar className="w-4 h-4" />
                        <span>Total Workouts</span>
                      </div>
                      <span className="text-white text-lg">{workouts?.length ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[#9CA3AF]">
                        <Trophy className="w-4 h-4" />
                        <span>Personal Records</span>
                      </div>
                      <span className="text-white text-lg">{recentPRs?.length ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[#9CA3AF]">
                        <Award className="w-4 h-4" />
                        <span>Badges Earned</span>
                      </div>
                      <span className="text-white text-lg">--</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[#9CA3AF]">
                        <TrendingUp className="w-4 h-4" />
                        <span>Weekly Volume</span>
                      </div>
                      <span className="text-[#FF6B35] text-lg">{weeklyTotal > 0 ? `${(weeklyTotal / 1000).toFixed(1)}k kg` : '--'}</span>
                    </div>
                  </div>
                )}
              </Card>
            </motion.div>

            {/* Recent PRs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
                <h3 className="text-xl text-white mb-4 flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-[#F59E0B]" />
                  Recent PRs
                </h3>
                {prsLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="p-3 rounded-lg border border-[#374151]">
                        <Skeleton className="h-4 w-24 mb-2" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                    ))}
                  </div>
                ) : !recentPRs || recentPRs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <Trophy className="w-8 h-8 text-[#374151] mb-2" />
                    <p className="text-sm text-[#9CA3AF]">No personal records yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentPRs.map((pr: PersonalRecord) => (
                      <div
                        key={pr.id}
                        className="p-3 bg-gradient-to-br from-[#FF6B35]/10 to-[#DC2626]/10 border border-[#FF6B35]/30 rounded-lg"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <h4 className="text-white">{pr.exercise_name}</h4>
                          <Badge className="bg-[#F59E0B] text-[#0D0D0D] border-0">NEW</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[#FF6B35]">
                            {pr.value} {pr.unit}
                          </span>
                          <span className="text-sm text-[#9CA3AF]">{formatRelativeTime(pr.achieved_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </motion.div>

            {/* Active Challenges */}
            {/* TODO(phase-5): Replace with real challenges data */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
                <h3 className="text-xl text-white mb-4">Active Challenges</h3>
                <div className="space-y-4">
                  {activeChallenges.map((challenge, index) => (
                    <div key={index} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-white">{challenge.name}</span>
                        <span className="text-[#9CA3AF]">
                          Rank {challenge.rank}/{challenge.total}
                        </span>
                      </div>
                      <Progress value={challenge.progress} className="h-2" />
                      <div className="flex items-center justify-between text-xs text-[#9CA3AF]">
                        <span>{challenge.progress}% complete</span>
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  className="w-full mt-4 border-[#FF6B35] text-[#FF6B35] hover:bg-[#FF6B35]/10"
                >
                  View All Challenges
                </Button>
              </Card>
            </motion.div>

            {/* Badge Showcase */}
            {/* TODO(phase-3): Replace with real badges data */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
                <h3 className="text-xl text-white mb-4">Recent Badges</h3>
                <div className="grid grid-cols-2 gap-3">
                  {badges.map((badge, index) => (
                    <div
                      key={index}
                      className={`p-3 rounded-lg text-center border-2 cursor-pointer hover:scale-105 transition-transform ${
                        badge.rarity === 'platinum'
                          ? 'bg-gradient-to-br from-[#E5E7EB]/20 to-[#9CA3AF]/20 border-[#E5E7EB]'
                          : badge.rarity === 'gold'
                          ? 'bg-gradient-to-br from-[#F59E0B]/20 to-[#FBBF24]/20 border-[#F59E0B]'
                          : 'bg-gradient-to-br from-[#6B7280]/20 to-[#374151]/20 border-[#6B7280]'
                      }`}
                    >
                      <div className="text-3xl mb-1">{badge.icon}</div>
                      <div className="text-xs text-white">{badge.name}</div>
                    </div>
                  ))}
                </div>
              </Card>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
