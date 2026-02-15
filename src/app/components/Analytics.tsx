import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { Skeleton, StatCardSkeleton, ChartSkeleton } from '@/app/components/ui/skeleton';
import {
  TrendingUp,
  TrendingDown,
  Download,
  Activity,
  Target,
  AlertCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { AnalyticsMobile } from '@/app/components/mobile/AnalyticsMobile';
import { useAuth } from '@/app/hooks/useAuth';
import { volumeTrendOptions, muscleGroupOptions, strengthProgressOptions } from '@/queries/analytics';

const MUSCLE_GROUP_COLORS: Record<string, string> = {
  Chest: '#FF6B35',
  Back: '#DC2626',
  Legs: '#F59E0B',
  Shoulders: '#10B981',
  Arms: '#6B7280',
  Core: '#FBBF24',
};

// Time period to query period mapping
function periodToDays(timePeriod: string): string {
  switch (timePeriod) {
    case '7D': return '1w';
    case '30D': return '4w';
    case '90D': return '12w';
    default: return '4w';
  }
}

// Bucket volume data into weekly aggregates for chart display
function bucketByWeek(data: Array<{ started_at: string; total_volume: number }>) {
  if (!data || data.length === 0) return [];
  const weeks = new Map<string, { volume: number; workouts: number }>();
  for (const item of data) {
    const date = new Date(item.started_at);
    // Get ISO week start (Monday)
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(date);
    weekStart.setDate(diff);
    const key = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const existing = weeks.get(key) ?? { volume: 0, workouts: 0 };
    existing.volume += item.total_volume;
    existing.workouts += 1;
    weeks.set(key, existing);
  }
  return Array.from(weeks.entries()).map(([date, { volume, workouts }]) => ({
    date,
    volume: Math.round(volume),
    workouts,
  }));
}

// Group strength progress data by exercise for line chart
function groupStrengthByExercise(data: Array<{ exercise_name: string; value: number; achieved_at: string }>) {
  if (!data || data.length === 0) return [];
  // Get all unique dates and exercises
  const dateSet = new Set<string>();
  const exerciseMap = new Map<string, Map<string, number>>();

  for (const item of data) {
    const date = new Date(item.achieved_at).toLocaleDateString('en-US', { month: 'short' });
    dateSet.add(date);
    if (!exerciseMap.has(item.exercise_name)) {
      exerciseMap.set(item.exercise_name, new Map());
    }
    // Keep highest value per exercise per month
    const existing = exerciseMap.get(item.exercise_name)!.get(date) ?? 0;
    if (item.value > existing) {
      exerciseMap.get(item.exercise_name)!.set(date, item.value);
    }
  }

  const dates = Array.from(dateSet);
  // Pick top 3 exercises by latest value
  const exercises = Array.from(exerciseMap.entries())
    .map(([name, values]) => ({ name, latestValue: Array.from(values.values()).pop() ?? 0 }))
    .sort((a, b) => b.latestValue - a.latestValue)
    .slice(0, 3)
    .map((e) => e.name);

  return dates.map((date) => {
    const point: Record<string, string | number> = { date };
    for (const exercise of exercises) {
      point[exercise] = exerciseMap.get(exercise)?.get(date) ?? 0;
    }
    return point;
  });
}

const EXERCISE_COLORS = ['#FF6B35', '#DC2626', '#F59E0B'];

export function Analytics() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [timePeriod, setTimePeriod] = useState('30D');

  const queryPeriod = periodToDays(timePeriod);
  const { data: volumeRaw, isPending: volumePending } = useQuery(volumeTrendOptions(user!.id, queryPeriod));
  const { data: muscleGroupRaw, isPending: musclePending } = useQuery(muscleGroupOptions(user!.id));
  const { data: strengthRaw, isPending: strengthPending } = useQuery(strengthProgressOptions(user!.id));

  if (isMobile) {
    return <AnalyticsMobile />;
  }

  const isPending = volumePending || musclePending || strengthPending;
  const volumeData = bucketByWeek(volumeRaw ?? []);
  const muscleGroupData = (muscleGroupRaw ?? []).map((m) => ({
    ...m,
    color: MUSCLE_GROUP_COLORS[m.name] ?? '#6B7280',
  }));
  const strengthProgressData = groupStrengthByExercise(strengthRaw ?? []);
  const strengthExercises = strengthProgressData.length > 0
    ? Object.keys(strengthProgressData[0]).filter((k) => k !== 'date')
    : [];

  // Derive summary stats from real data
  const totalVolume = volumeData.reduce((sum, d) => sum + d.volume, 0);
  const totalWorkouts = volumeData.reduce((sum, d) => sum + d.workouts, 0);
  const avgDuration = totalWorkouts > 0 ? Math.round(totalVolume / totalWorkouts / 100) : 0; // rough estimate

  // TODO: Generate insights from real analytics data
  const insights = [
    {
      type: 'positive' as const,
      title: 'Volume Tracking Active',
      description: `${totalWorkouts} workouts tracked in the selected period`,
      icon: TrendingUp,
    },
    {
      type: muscleGroupData.length >= 3 ? ('positive' as const) : ('warning' as const),
      title: muscleGroupData.length >= 3 ? 'Good Variety' : 'Limited Variety',
      description: `Training ${muscleGroupData.length} different muscle groups`,
      icon: muscleGroupData.length >= 3 ? Target : AlertCircle,
    },
    {
      type: strengthExercises.length > 0 ? ('positive' as const) : ('neutral' as const),
      title: 'Strength Tracking',
      description: strengthExercises.length > 0
        ? `Tracking progress on ${strengthExercises.join(', ')}`
        : 'Complete more workouts to see strength trends',
      icon: Activity,
    },
  ];

  if (isPending) {
    return (
      <div className="min-h-screen bg-[#0D0D0D] pb-20 md:pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Skeleton className="h-10 w-48 mb-2" />
          <Skeleton className="h-4 w-64 mb-8" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <StatCardSkeleton key={i} />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartSkeleton />
            <ChartSkeleton />
          </div>
        </div>
      </div>
    );
  }

  const hasData = volumeData.length > 0 || muscleGroupData.length > 0;

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-20 md:pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl mb-2">
              <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                Analytics Hub
              </span>
            </h1>
            <p className="text-[#9CA3AF]">Comprehensive insights into your training</p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={timePeriod} onValueChange={setTimePeriod}>
              <SelectTrigger className="w-32 bg-[#1a1a1a] border-[#374151] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7D">7 Days</SelectItem>
                <SelectItem value="30D">30 Days</SelectItem>
                <SelectItem value="90D">90 Days</SelectItem>
                <SelectItem value="1Y">1 Year</SelectItem>
                <SelectItem value="ALL">All Time</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" className="border-[#FF6B35] text-[#FF6B35] hover:bg-[#FF6B35]/10">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {!hasData ? (
          <div className="text-center py-16">
            <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-[#FF6B35]/20 to-[#F59E0B]/20 flex items-center justify-center">
              <TrendingUp className="w-12 h-12 text-[#FF6B35]" />
            </div>
            <h3 className="text-2xl font-semibold text-white mb-2">No analytics data yet</h3>
            <p className="text-[#9CA3AF] max-w-md mx-auto">
              Complete workouts to start seeing your training analytics. Charts and insights will populate automatically.
            </p>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { label: 'Total Volume', value: totalVolume > 1000 ? `${(totalVolume / 1000).toFixed(1)}K kg` : `${totalVolume} kg`, change: '', positive: true },
                { label: 'Workouts', value: `${totalWorkouts}`, change: '', positive: true },
                { label: 'Muscle Groups', value: `${muscleGroupData.length}`, change: '', positive: true },
                { label: 'Exercises Tracked', value: `${strengthExercises.length}`, change: '', positive: true },
              ].map((stat, index) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <Card className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
                    <div className="text-sm text-[#9CA3AF] mb-1">{stat.label}</div>
                    <div className="text-2xl text-white mb-1">{stat.value}</div>
                    {stat.change && (
                      <div
                        className={`text-xs flex items-center gap-1 ${
                          stat.positive ? 'text-[#10B981]' : 'text-[#6B7280]'
                        }`}
                      >
                        {stat.positive ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        {stat.change}
                      </div>
                    )}
                  </Card>
                </motion.div>
              ))}
            </div>

            {/* Main Content Tabs */}
            <Tabs defaultValue="overview" className="space-y-6">
              <TabsList className="bg-[#1a1a1a] border border-[#374151] p-1">
                <TabsTrigger value="overview" className="data-[state=active]:bg-[#FF6B35]">
                  Overview
                </TabsTrigger>
                <TabsTrigger value="strength" className="data-[state=active]:bg-[#FF6B35]">
                  Strength Progress
                </TabsTrigger>
                <TabsTrigger value="insights" className="data-[state=active]:bg-[#FF6B35]">
                  Trends & Insights
                </TabsTrigger>
                <TabsTrigger value="body" className="data-[state=active]:bg-[#FF6B35]">
                  Body Part Analysis
                </TabsTrigger>
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Volume Over Time */}
                  <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
                    <h3 className="text-xl text-white mb-6">Volume Over Time</h3>
                    {volumeData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={volumeData}>
                          <defs>
                            <linearGradient id="volumeGradientAnalytics" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#FF6B35" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="#DC2626" stopOpacity={0.1} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis dataKey="date" stroke="#9CA3AF" />
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
                            fill="url(#volumeGradientAnalytics)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-[300px] flex items-center justify-center text-[#6B7280]">
                        No volume data for this period
                      </div>
                    )}
                  </Card>

                  {/* Muscle Group Distribution */}
                  <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
                    <h3 className="text-xl text-white mb-6">Muscle Group Distribution</h3>
                    {muscleGroupData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={muscleGroupData}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={({ name, value }) => `${name} ${value}%`}
                            outerRadius={100}
                            fill="#8884d8"
                            dataKey="value"
                          >
                            {muscleGroupData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#1a1a1a',
                              border: '1px solid #374151',
                              borderRadius: '8px',
                              color: '#E5E7EB',
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-[300px] flex items-center justify-center text-[#6B7280]">
                        No muscle group data yet
                      </div>
                    )}
                  </Card>
                </div>
              </TabsContent>

              {/* Strength Progress Tab */}
              <TabsContent value="strength" className="space-y-6">
                <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
                  <h3 className="text-xl text-white mb-6">1RM Progression</h3>
                  {strengthProgressData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={400}>
                      <LineChart data={strengthProgressData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="date" stroke="#9CA3AF" />
                        <YAxis stroke="#9CA3AF" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#1a1a1a',
                            border: '1px solid #374151',
                            borderRadius: '8px',
                            color: '#E5E7EB',
                          }}
                        />
                        <Legend />
                        {strengthExercises.map((exercise, i) => (
                          <Line
                            key={exercise}
                            type="monotone"
                            dataKey={exercise}
                            name={exercise}
                            stroke={EXERCISE_COLORS[i % EXERCISE_COLORS.length]}
                            strokeWidth={2}
                            dot={{ fill: EXERCISE_COLORS[i % EXERCISE_COLORS.length], r: 4 }}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[400px] flex items-center justify-center text-[#6B7280]">
                      No strength progress data yet. Set some PRs to see your progression!
                    </div>
                  )}
                </Card>
              </TabsContent>

              {/* Trends & Insights Tab */}
              <TabsContent value="insights" className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {insights.map((insight, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                    >
                      <Card
                        className={`p-6 border-2 ${
                          insight.type === 'positive'
                            ? 'bg-gradient-to-br from-[#10B981]/10 to-[#0D0D0D] border-[#10B981]'
                            : insight.type === 'warning'
                            ? 'bg-gradient-to-br from-[#FBBF24]/10 to-[#0D0D0D] border-[#FBBF24]'
                            : 'bg-gradient-to-br from-[#6B7280]/10 to-[#0D0D0D] border-[#6B7280]'
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          <div
                            className={`p-3 rounded-lg ${
                              insight.type === 'positive'
                                ? 'bg-[#10B981]/20'
                                : insight.type === 'warning'
                                ? 'bg-[#FBBF24]/20'
                                : 'bg-[#6B7280]/20'
                            }`}
                          >
                            <insight.icon
                              className={`w-6 h-6 ${
                                insight.type === 'positive'
                                  ? 'text-[#10B981]'
                                  : insight.type === 'warning'
                                  ? 'text-[#FBBF24]'
                                  : 'text-[#6B7280]'
                              }`}
                            />
                          </div>
                          <div className="flex-1">
                            <h4 className="text-white text-lg mb-1">{insight.title}</h4>
                            <p className="text-[#9CA3AF]">{insight.description}</p>
                          </div>
                        </div>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </TabsContent>

              {/* Body Part Analysis Tab */}
              <TabsContent value="body" className="space-y-6">
                <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
                  <h3 className="text-xl text-white mb-6">Muscle Group Frequency</h3>
                  {muscleGroupData.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {muscleGroupData.map((muscle) => (
                        <div
                          key={muscle.name}
                          className="p-4 rounded-lg border-2 cursor-pointer hover:scale-105 transition-transform"
                          style={{
                            backgroundColor: `${muscle.color}20`,
                            borderColor: muscle.color,
                          }}
                        >
                          <div className="text-white mb-2">{muscle.name}</div>
                          <div className="text-2xl mb-1" style={{ color: muscle.color }}>
                            {muscle.value}%
                          </div>
                          <div className="text-xs text-[#9CA3AF]">of total volume</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-[#6B7280]">
                      No body part data yet
                    </div>
                  )}
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}
