import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Progress } from '@/app/components/ui/progress';
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
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';

export function Dashboard() {
  const weeklyVolumeData = [
    { day: 'Mon', volume: 4200 },
    { day: 'Tue', volume: 3800 },
    { day: 'Wed', volume: 5100 },
    { day: 'Thu', volume: 0 },
    { day: 'Fri', volume: 4600 },
    { day: 'Sat', volume: 5800 },
    { day: 'Sun', volume: 3200 },
  ];

  const recentWorkouts = [
    { name: 'Push Day A', date: '2 hours ago', volume: '5,200 kg', duration: '58 min', prs: 2 },
    { name: 'Pull Day B', date: 'Yesterday', volume: '4,800 kg', duration: '52 min', prs: 0 },
    { name: 'Leg Day', date: '2 days ago', volume: '6,100 kg', duration: '65 min', prs: 1 },
    { name: 'Upper Power', date: '3 days ago', volume: '4,400 kg', duration: '48 min', prs: 0 },
    { name: 'Lower Hypertrophy', date: '4 days ago', volume: '5,800 kg', duration: '61 min', prs: 3 },
  ];

  const activeChallenges = [
    { name: 'January Volume Challenge', progress: 68, rank: 12, total: 150 },
    { name: 'PR Hunter', progress: 45, rank: 8, total: 50 },
    { name: '30-Day Streak', progress: 87, rank: 25, total: 100 },
  ];

  const recentPRs = [
    { exercise: 'Bench Press', weight: '120 kg', reps: 5, date: 'Today' },
    { exercise: 'Squat', weight: '160 kg', reps: 3, date: 'Yesterday' },
    { exercise: 'Deadlift', weight: '180 kg', reps: 1, date: '3 days ago' },
  ];

  const badges = [
    { name: 'Week Warrior', icon: '🔥', rarity: 'gold' },
    { name: 'PR Crusher', icon: '💪', rarity: 'platinum' },
    { name: 'Consistency King', icon: '👑', rarity: 'gold' },
    { name: '100 Workouts', icon: '💯', rarity: 'silver' },
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
            Welcome back, <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">John</span>
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
                      🔥
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
              <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
                <h3 className="text-xl text-white mb-6">Weekly Volume</h3>
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
                  <span className="text-[#FF6B35] font-semibold">26,700 kg</span>
                </div>
              </Card>
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
                <div className="space-y-3">
                  {recentWorkouts.map((workout, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 bg-[#0D0D0D] rounded-lg border border-[#374151] hover:border-[#FF6B35]/50 transition-all cursor-pointer"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="text-white">{workout.name}</h4>
                          {workout.prs > 0 && (
                            <Badge className="bg-[#F59E0B] text-[#0D0D0D] border-0 text-xs">
                              {workout.prs} PR{workout.prs > 1 ? 's' : ''}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-[#9CA3AF]">{workout.date}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-[#FF6B35] font-semibold">{workout.volume}</div>
                        <div className="text-sm text-[#9CA3AF]">{workout.duration}</div>
                      </div>
                    </div>
                  ))}
                </div>
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
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#9CA3AF]">
                      <Calendar className="w-4 h-4" />
                      <span>Total Workouts</span>
                    </div>
                    <span className="text-white text-lg">147</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#9CA3AF]">
                      <Trophy className="w-4 h-4" />
                      <span>Personal Records</span>
                    </div>
                    <span className="text-white text-lg">34</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#9CA3AF]">
                      <Award className="w-4 h-4" />
                      <span>Badges Earned</span>
                    </div>
                    <span className="text-white text-lg">12</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#9CA3AF]">
                      <TrendingUp className="w-4 h-4" />
                      <span>Total Volume</span>
                    </div>
                    <span className="text-[#FF6B35] text-lg">1.2M kg</span>
                  </div>
                </div>
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
                <div className="space-y-3">
                  {recentPRs.map((pr, index) => (
                    <div
                      key={index}
                      className="p-3 bg-gradient-to-br from-[#FF6B35]/10 to-[#DC2626]/10 border border-[#FF6B35]/30 rounded-lg"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-white">{pr.exercise}</h4>
                        <Badge className="bg-[#F59E0B] text-[#0D0D0D] border-0">NEW</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[#FF6B35]">
                          {pr.weight} × {pr.reps}
                        </span>
                        <span className="text-sm text-[#9CA3AF]">{pr.date}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </motion.div>

            {/* Active Challenges */}
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