import { useState } from 'react';
import { motion } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { Download, TrendingUp, Target, Zap, Dumbbell, Clock } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from 'recharts';

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  trend?: string;
  trendUp?: boolean;
}

function StatCard({ label, value, icon, trend, trendUp }: StatCardProps) {
  return (
    <Card className="min-w-[120px] p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
      <div className="flex flex-col">
        <div className="text-[#9CA3AF] text-xs mb-1">{label}</div>
        <div className="flex items-center justify-between">
          <span className="text-2xl font-bold text-white">{value}</span>
          <div className="text-[#FF6B35]">{icon}</div>
        </div>
        {trend && (
          <div className={`text-xs mt-1 ${trendUp ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
            {trend}
          </div>
        )}
      </div>
    </Card>
  );
}

interface ChartCardProps {
  title: string;
  onTap?: () => void;
  children: React.ReactNode;
}

function ChartCard({ title, onTap, children }: ChartCardProps) {
  return (
    <Card 
      onClick={onTap}
      className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] active:scale-[0.98] transition-transform"
    >
      <h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
      {children}
      {onTap && (
        <p className="text-xs text-[#6B7280] text-center mt-2">Tap for details</p>
      )}
    </Card>
  );
}

export function AnalyticsMobile() {
  const [timePeriod, setTimePeriod] = useState('30D');
  const [activeTab, setActiveTab] = useState('overview');

  const stats = [
    { label: 'Volume', value: '186K', icon: <TrendingUp className="w-5 h-5" />, trend: '+12%', trendUp: true },
    { label: 'Workouts', value: '42', icon: <Dumbbell className="w-5 h-5" />, trend: '+5', trendUp: true },
    { label: 'PRs', value: '11', icon: <Target className="w-5 h-5" />, trend: '+3', trendUp: true },
    { label: 'Avg Time', value: '56m', icon: <Clock className="w-5 h-5" />, trend: '-4m', trendUp: false },
    { label: 'Intensity', value: '8.2', icon: <Zap className="w-5 h-5" />, trend: '+0.3', trendUp: true },
  ];

  const volumeData = [
    { date: 'W1', volume: 42000 },
    { date: 'W2', volume: 45000 },
    { date: 'W3', volume: 48000 },
    { date: 'W4', volume: 51000 },
  ];

  const muscleData = [
    { name: 'Chest', value: 22, color: '#FF6B35' },
    { name: 'Back', value: 20, color: '#F59E0B' },
    { name: 'Legs', value: 18, color: '#10B981' },
    { name: 'Shoulders', value: 15, color: '#6366F1' },
    { name: 'Arms', value: 13, color: '#EC4899' },
    { name: 'Core', value: 12, color: '#8B5CF6' },
  ];

  const strengthData = [
    { exercise: 'Bench', weight: 120 },
    { exercise: 'Squat', weight: 160 },
    { exercise: 'Deadlift', weight: 180 },
    { exercise: 'OHP', weight: 75 },
    { exercise: 'Row', weight: 95 },
  ];

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-20">
      {/* Compact Header */}
      <div className="sticky top-0 bg-[#0D0D0D]/95 backdrop-blur-lg z-10 px-4 py-3 border-b border-[#374151]">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">
            <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
              Analytics Hub
            </span>
          </h1>
          <div className="flex items-center gap-2">
            <Select value={timePeriod} onValueChange={setTimePeriod}>
              <SelectTrigger className="w-20 h-8 text-sm bg-[#1a1a1a] border-[#374151]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a1a] border-[#374151]">
                <SelectItem value="7D">7D</SelectItem>
                <SelectItem value="30D">30D</SelectItem>
                <SelectItem value="90D">90D</SelectItem>
                <SelectItem value="1Y">1Y</SelectItem>
                <SelectItem value="ALL">All</SelectItem>
              </SelectContent>
            </Select>
            <button className="w-8 h-8 flex items-center justify-center text-[#9CA3AF] hover:text-white transition-colors">
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Horizontal Scroll Stats */}
      <div className="flex overflow-x-auto gap-3 px-4 py-4 scrollbar-hide snap-x snap-mandatory">
        {stats.map((stat) => (
          <motion.div
            key={stat.label}
            whileTap={{ scale: 0.95 }}
            className="snap-start"
          >
            <StatCard {...stat} />
          </motion.div>
        ))}
      </div>

      {/* Scrollable Tabs */}
      <div className="overflow-x-auto scrollbar-hide border-b border-[#374151]">
        <div className="flex px-4 gap-1">
          {[
            { value: 'overview', label: 'Overview' },
            { value: 'strength', label: 'Strength' },
            { value: 'trends', label: 'Trends' },
            { value: 'body', label: 'Body' },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.value
                  ? 'text-white border-[#FF6B35]'
                  : 'text-[#9CA3AF] border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-4 space-y-4">
        {activeTab === 'overview' && (
          <>
            {/* Volume Chart */}
            <ChartCard title="VOLUME OVER TIME">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={volumeData}>
                  <defs>
                    <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#FF6B35" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#FF6B35" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    stroke="#6B7280"
                    style={{ fontSize: '12px' }}
                  />
                  <YAxis
                    stroke="#6B7280"
                    style={{ fontSize: '12px' }}
                    tickFormatter={(value) => `${value / 1000}k`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1a1a1a',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#fff',
                    }}
                    formatter={(value: number) => [`${value.toLocaleString()} kg`, 'Volume']}
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
            </ChartCard>

            {/* Muscle Distribution */}
            <ChartCard title="MUSCLE DISTRIBUTION">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={muscleData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {muscleData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1a1a1a',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#fff',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-3 justify-center">
                {muscleData.map((muscle) => (
                  <div key={muscle.name} className="flex items-center gap-1 text-xs">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: muscle.color }}
                    />
                    <span className="text-[#9CA3AF]">
                      {muscle.name} {muscle.value}%
                    </span>
                  </div>
                ))}
              </div>
            </ChartCard>
          </>
        )}

        {activeTab === 'strength' && (
          <ChartCard title="TOP LIFTS (1RM)">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={strengthData} layout="vertical">
                <XAxis type="number" stroke="#6B7280" style={{ fontSize: '12px' }} />
                <YAxis
                  type="category"
                  dataKey="exercise"
                  stroke="#6B7280"
                  style={{ fontSize: '12px' }}
                  width={70}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1a1a1a',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#fff',
                  }}
                  formatter={(value: number) => [`${value} kg`, '1RM']}
                />
                <Bar dataKey="weight" fill="#FF6B35" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        {activeTab === 'trends' && (
          <div className="text-center py-12 text-[#6B7280]">
            <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Trends analysis coming soon</p>
          </div>
        )}

        {activeTab === 'body' && (
          <div className="text-center py-12 text-[#6B7280]">
            <Target className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Body composition tracking coming soon</p>
          </div>
        )}
      </div>
    </div>
  );
}
