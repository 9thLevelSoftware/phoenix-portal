import { useState } from 'react';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import {
  TrendingUp,
  TrendingDown,
  Calendar,
  Download,
  BarChart3,
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

export function Analytics() {
  const isMobile = useIsMobile();
  
  if (isMobile) {
    return <AnalyticsMobile />;
  }
  
  const [timePeriod, setTimePeriod] = useState('30D');

  const volumeData = [
    { date: 'Week 1', volume: 18500, workouts: 4 },
    { date: 'Week 2', volume: 21200, workouts: 5 },
    { date: 'Week 3', volume: 19800, workouts: 4 },
    { date: 'Week 4', volume: 23100, workouts: 6 },
    { date: 'Week 5', volume: 24500, workouts: 5 },
    { date: 'Week 6', volume: 22900, workouts: 5 },
    { date: 'Week 7', volume: 26700, workouts: 6 },
    { date: 'Week 8', volume: 28200, workouts: 6 },
  ];

  const muscleGroupData = [
    { name: 'Chest', value: 22, color: '#FF6B35' },
    { name: 'Back', value: 20, color: '#DC2626' },
    { name: 'Legs', value: 18, color: '#F59E0B' },
    { name: 'Shoulders', value: 15, color: '#10B981' },
    { name: 'Arms', value: 15, color: '#6B7280' },
    { name: 'Core', value: 10, color: '#FBBF24' },
  ];

  const exerciseBreakdown = [
    { exercise: 'Bench Press', sets: 48 },
    { exercise: 'Squat', sets: 42 },
    { exercise: 'Deadlift', sets: 36 },
    { exercise: 'Rows', sets: 40 },
    { exercise: 'Shoulder Press', sets: 32 },
    { exercise: 'Pull-ups', sets: 28 },
  ];

  const strengthProgressData = [
    { date: 'Jan', benchPress: 100, squat: 140, deadlift: 160 },
    { date: 'Feb', benchPress: 105, squat: 145, deadlift: 165 },
    { date: 'Mar', benchPress: 107, squat: 150, deadlift: 170 },
    { date: 'Apr', benchPress: 112, squat: 155, deadlift: 175 },
    { date: 'May', benchPress: 115, squat: 157, deadlift: 178 },
    { date: 'Jun', benchPress: 120, squat: 160, deadlift: 180 },
  ];

  const insights = [
    {
      type: 'positive',
      title: 'Volume Trending Up',
      description: 'Your total training volume increased by 12% this month',
      icon: TrendingUp,
    },
    {
      type: 'warning',
      title: 'Push/Pull Imbalance',
      description: 'You\'ve trained chest 40% more than back. Consider balancing.',
      icon: AlertCircle,
    },
    {
      type: 'positive',
      title: 'Consistency Score: 87%',
      description: 'Great work! You\'re maintaining excellent workout frequency.',
      icon: Target,
    },
    {
      type: 'neutral',
      title: 'Squat Plateau Detected',
      description: 'No PR in squat for 3 weeks. Consider a deload or variation.',
      icon: Activity,
    },
  ];

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

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Volume', value: '186.5K kg', change: '+12%', positive: true },
            { label: 'Workouts', value: '42', change: '+8%', positive: true },
            { label: 'Personal Records', value: '11', change: '+3', positive: true },
            { label: 'Avg Duration', value: '56 min', change: '-2 min', positive: false },
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
              </Card>

              {/* Muscle Group Distribution */}
              <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
                <h3 className="text-xl text-white mb-6">Muscle Group Distribution</h3>
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
              </Card>

              {/* Exercise Breakdown */}
              <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] lg:col-span-2">
                <h3 className="text-xl text-white mb-6">Exercise Breakdown (by sets)</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={exerciseBreakdown} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis type="number" stroke="#9CA3AF" />
                    <YAxis type="category" dataKey="exercise" stroke="#9CA3AF" width={120} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1a1a1a',
                        border: '1px solid #374151',
                        borderRadius: '8px',
                        color: '#E5E7EB',
                      }}
                    />
                    <Bar dataKey="sets" fill="#FF6B35" radius={[0, 8, 8, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>
          </TabsContent>

          {/* Strength Progress Tab */}
          <TabsContent value="strength" className="space-y-6">
            <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              <h3 className="text-xl text-white mb-6">1RM Progression</h3>
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
                  <Line
                    type="monotone"
                    dataKey="benchPress"
                    name="Bench Press"
                    stroke="#FF6B35"
                    strokeWidth={2}
                    dot={{ fill: '#FF6B35', r: 4 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="squat"
                    name="Squat"
                    stroke="#DC2626"
                    strokeWidth={2}
                    dot={{ fill: '#DC2626', r: 4 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="deadlift"
                    name="Deadlift"
                    stroke="#F59E0B"
                    strokeWidth={2}
                    dot={{ fill: '#F59E0B', r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { exercise: 'Bench Press', current: '120 kg', predicted: '125 kg', weeks: 4 },
                { exercise: 'Squat', current: '160 kg', predicted: '165 kg', weeks: 3 },
                { exercise: 'Deadlift', current: '180 kg', predicted: '185 kg', weeks: 2 },
              ].map((pred, index) => (
                <Card
                  key={pred.exercise}
                  className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]"
                >
                  <h4 className="text-white mb-4">{pred.exercise}</h4>
                  <div className="space-y-3">
                    <div>
                      <div className="text-sm text-[#9CA3AF] mb-1">Current 1RM</div>
                      <div className="text-2xl text-[#FF6B35]">{pred.current}</div>
                    </div>
                    <div>
                      <div className="text-sm text-[#9CA3AF] mb-1">Predicted PR</div>
                      <div className="text-xl text-[#10B981]">{pred.predicted}</div>
                    </div>
                    <div className="text-sm text-[#6B7280]">In ~{pred.weeks} weeks</div>
                  </div>
                </Card>
              ))}
            </div>
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

            {/* Comparative Analysis */}
            <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              <h3 className="text-xl text-white mb-6">This Week vs Last Week</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { metric: 'Volume', thisWeek: '26.7K kg', lastWeek: '22.9K kg', change: '+17%' },
                  { metric: 'Workouts', thisWeek: '6', lastWeek: '5', change: '+20%' },
                  { metric: 'Avg Duration', thisWeek: '58 min', lastWeek: '54 min', change: '+7%' },
                  { metric: 'PRs', thisWeek: '3', lastWeek: '1', change: '+200%' },
                ].map((comp) => (
                  <div key={comp.metric} className="text-center">
                    <div className="text-sm text-[#9CA3AF] mb-2">{comp.metric}</div>
                    <div className="text-xl text-[#FF6B35] mb-1">{comp.thisWeek}</div>
                    <div className="text-xs text-[#6B7280] mb-1">{comp.lastWeek}</div>
                    <div className="text-xs text-[#10B981]">{comp.change}</div>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* Body Part Analysis Tab */}
          <TabsContent value="body" className="space-y-6">
            <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              <h3 className="text-xl text-white mb-6">Muscle Group Frequency Heat Map</h3>
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
            </Card>

            <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              <h3 className="text-xl text-white mb-6">Balance Score</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[#9CA3AF]">Push vs Pull</span>
                    <span className="text-white">52% / 48%</span>
                  </div>
                  <div className="h-3 bg-[#374151] rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#FF6B35] to-[#DC2626] rounded-full" style={{ width: '52%' }} />
                  </div>
                  <p className="text-sm text-[#FBBF24] mt-2">Slightly imbalanced - Add more pulling</p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[#9CA3AF]">Upper vs Lower</span>
                    <span className="text-white">55% / 45%</span>
                  </div>
                  <div className="h-3 bg-[#374151] rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#F59E0B] to-[#FBBF24] rounded-full" style={{ width: '55%' }} />
                  </div>
                  <p className="text-sm text-[#10B981] mt-2">Good balance!</p>
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}