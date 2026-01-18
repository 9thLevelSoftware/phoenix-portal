import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/app/components/ui/avatar';
import { Switch } from '@/app/components/ui/switch';
import { Label } from '@/app/components/ui/label';
import { Input } from '@/app/components/ui/input';
import {
  Trophy,
  Calendar,
  TrendingUp,
  Award,
  Settings,
  Bell,
  Shield,
  Globe,
  Smartphone,
  Download,
  Flame,
} from 'lucide-react';
import { motion } from 'motion/react';

export function Profile() {
  const userStats = [
    { label: 'Level', value: '24', icon: TrendingUp },
    { label: 'Total Workouts', value: '147', icon: Calendar },
    { label: 'Personal Records', value: '34', icon: Trophy },
    { label: 'Badges Earned', value: '12', icon: Award },
  ];

  const badges = [
    { name: 'Week Warrior', icon: '🔥', rarity: 'gold', earned: 'Jan 15, 2026' },
    { name: 'PR Crusher', icon: '💪', rarity: 'platinum', earned: 'Jan 12, 2026' },
    { name: 'Consistency King', icon: '👑', rarity: 'gold', earned: 'Jan 10, 2026' },
    { name: '100 Workouts', icon: '💯', rarity: 'silver', earned: 'Jan 5, 2026' },
    { name: 'Streak Master', icon: '⚡', rarity: 'gold', earned: 'Jan 1, 2026' },
    { name: 'Early Bird', icon: '🌅', rarity: 'bronze', earned: 'Dec 28, 2025' },
    { name: 'Volume Beast', icon: '🏋️', rarity: 'silver', earned: 'Dec 20, 2025' },
    { name: 'First PR', icon: '🎯', rarity: 'bronze', earned: 'Dec 15, 2025' },
  ];

  const topExercises = [
    { name: 'Bench Press', sets: 248, volume: '29,760 kg' },
    { name: 'Squat', sets: 236, volume: '37,680 kg' },
    { name: 'Deadlift', sets: 198, volume: '35,640 kg' },
    { name: 'Rows', sets: 212, volume: '21,200 kg' },
    { name: 'Shoulder Press', sets: 184, volume: '14,720 kg' },
  ];

  const connectedApps = [
    { name: 'Strava', status: 'Connected', lastSync: '2 hours ago', logo: '🏃' },
    { name: 'Apple Health', status: 'Connected', lastSync: '1 hour ago', logo: '🍎' },
    { name: 'MyFitnessPal', status: 'Not Connected', lastSync: '-', logo: '🍽️' },
    { name: 'Garmin Connect', status: 'Not Connected', lastSync: '-', logo: '⌚' },
  ];

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-20 md:pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Profile Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <Card className="p-8 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] relative overflow-hidden">
            {/* Background Effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-[#FF6B35]/10 to-[#DC2626]/10 opacity-50" />
            
            <div className="relative z-10 flex flex-col md:flex-row items-center gap-6">
              {/* Avatar */}
              <Avatar className="w-24 h-24 ring-4 ring-[#FF6B35] ring-offset-4 ring-offset-[#0D0D0D]">
                <AvatarFallback className="bg-gradient-to-br from-[#FF6B35] to-[#DC2626] text-white text-3xl">
                  JD
                </AvatarFallback>
              </Avatar>

              {/* Info */}
              <div className="flex-1 text-center md:text-left">
                <h1 className="text-3xl text-white mb-2">John Doe</h1>
                <p className="text-[#9CA3AF] mb-4">Member since December 2025</p>
                <div className="flex items-center justify-center md:justify-start gap-2 mb-4">
                  <Flame className="w-5 h-5 text-[#F59E0B]" fill="#FF6B35" />
                  <span className="text-white">7 day streak</span>
                </div>
                <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                  <Badge className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] text-white border-0">
                    Phoenix Member
                  </Badge>
                  <Badge className="bg-[#F59E0B] text-[#0D0D0D] border-0">
                    Level 24
                  </Badge>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-4">
                {userStats.map((stat) => (
                  <div key={stat.label} className="text-center p-4 bg-[#0D0D0D] rounded-lg border border-[#374151]">
                    <stat.icon className="w-5 h-5 text-[#FF6B35] mx-auto mb-2" />
                    <div className="text-2xl text-white mb-1">{stat.value}</div>
                    <div className="text-xs text-[#9CA3AF]">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Main Content */}
        <Tabs defaultValue="stats" className="space-y-6">
          <TabsList className="bg-[#1a1a1a] border border-[#374151] p-1">
            <TabsTrigger value="stats" className="data-[state=active]:bg-[#FF6B35]">
              Public Stats
            </TabsTrigger>
            <TabsTrigger value="badges" className="data-[state=active]:bg-[#FF6B35]">
              Badges
            </TabsTrigger>
            <TabsTrigger value="integrations" className="data-[state=active]:bg-[#FF6B35]">
              Integrations
            </TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-[#FF6B35]">
              Settings
            </TabsTrigger>
          </TabsList>

          {/* Stats Tab */}
          <TabsContent value="stats" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top Exercises */}
              <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
                <h3 className="text-xl text-white mb-6">Top Exercises</h3>
                <div className="space-y-4">
                  {topExercises.map((exercise, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-[#0D0D0D] rounded-lg border border-[#374151]">
                      <div>
                        <div className="text-white">{exercise.name}</div>
                        <div className="text-sm text-[#9CA3AF]">{exercise.sets} sets</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[#FF6B35]">{exercise.volume}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Achievement Summary */}
              <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
                <h3 className="text-xl text-white mb-6">Achievement Summary</h3>
                <div className="space-y-4">
                  <div className="p-4 bg-gradient-to-br from-[#FF6B35]/10 to-[#DC2626]/10 border border-[#FF6B35]/30 rounded-lg">
                    <div className="text-sm text-[#9CA3AF] mb-1">Total Volume Lifted</div>
                    <div className="text-3xl bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                      1.2M kg
                    </div>
                  </div>
                  <div className="p-4 bg-gradient-to-br from-[#10B981]/10 to-[#059669]/10 border border-[#10B981]/30 rounded-lg">
                    <div className="text-sm text-[#9CA3AF] mb-1">Best Streak</div>
                    <div className="text-3xl text-[#10B981]">23 days</div>
                  </div>
                  <div className="p-4 bg-gradient-to-br from-[#F59E0B]/10 to-[#FBBF24]/10 border border-[#F59E0B]/30 rounded-lg">
                    <div className="text-sm text-[#9CA3AF] mb-1">Challenges Won</div>
                    <div className="text-3xl text-[#F59E0B]">7</div>
                  </div>
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* Badges Tab */}
          <TabsContent value="badges" className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {badges.map((badge, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card
                    className={`p-4 text-center cursor-pointer hover:scale-105 transition-transform border-2 ${
                      badge.rarity === 'platinum'
                        ? 'bg-gradient-to-br from-[#E5E7EB]/20 to-[#9CA3AF]/20 border-[#E5E7EB]'
                        : badge.rarity === 'gold'
                        ? 'bg-gradient-to-br from-[#F59E0B]/20 to-[#FBBF24]/20 border-[#F59E0B]'
                        : badge.rarity === 'silver'
                        ? 'bg-gradient-to-br from-[#9CA3AF]/20 to-[#6B7280]/20 border-[#9CA3AF]'
                        : 'bg-gradient-to-br from-[#D97706]/20 to-[#92400E]/20 border-[#D97706]'
                    }`}
                  >
                    <div className="text-5xl mb-2">{badge.icon}</div>
                    <div className="text-white mb-1">{badge.name}</div>
                    <div className="text-xs text-[#9CA3AF]">{badge.earned}</div>
                    <Badge
                      className={`mt-2 text-xs ${
                        badge.rarity === 'platinum'
                          ? 'bg-[#E5E7EB] text-[#0D0D0D]'
                          : badge.rarity === 'gold'
                          ? 'bg-[#F59E0B] text-[#0D0D0D]'
                          : badge.rarity === 'silver'
                          ? 'bg-[#9CA3AF] text-[#0D0D0D]'
                          : 'bg-[#D97706] text-[#0D0D0D]'
                      } border-0`}
                    >
                      {badge.rarity.toUpperCase()}
                    </Badge>
                  </Card>
                </motion.div>
              ))}
            </div>
          </TabsContent>

          {/* Integrations Tab */}
          <TabsContent value="integrations" className="space-y-6">
            <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              <h3 className="text-xl text-white mb-6">Connected Apps</h3>
              <div className="space-y-4">
                {connectedApps.map((app, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-4 bg-[#0D0D0D] rounded-lg border border-[#374151]"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-[#374151] rounded-lg flex items-center justify-center text-2xl">
                        {app.logo}
                      </div>
                      <div>
                        <div className="text-white">{app.name}</div>
                        <div className="text-sm text-[#9CA3AF]">
                          {app.status === 'Connected' ? `Last sync: ${app.lastSync}` : 'Not connected'}
                        </div>
                      </div>
                    </div>
                    {app.status === 'Connected' ? (
                      <Button variant="outline" className="border-[#EF4444] text-[#EF4444] hover:bg-[#EF4444]/10">
                        Disconnect
                      </Button>
                    ) : (
                      <Button className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0">
                        Connect
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-6">
            <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              <h3 className="text-xl text-white mb-6 flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Notification Settings
              </h3>
              <div className="space-y-4">
                {[
                  { label: 'Email digests', description: 'Weekly summary of your progress' },
                  { label: 'Push notifications', description: 'Get notified of challenges and PRs' },
                  { label: 'Streak reminders', description: 'Don\'t break your streak!' },
                  { label: 'Challenge updates', description: 'Updates on active challenges' },
                ].map((setting, index) => (
                  <div key={index} className="flex items-center justify-between py-3 border-b border-[#374151]">
                    <div>
                      <div className="text-white">{setting.label}</div>
                      <div className="text-sm text-[#9CA3AF]">{setting.description}</div>
                    </div>
                    <Switch defaultChecked />
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              <h3 className="text-xl text-white mb-6 flex items-center gap-2">
                <Globe className="w-5 h-5" />
                General Settings
              </h3>
              <div className="space-y-4">
                <div>
                  <Label className="text-white mb-2 block">Weight Unit</Label>
                  <div className="flex gap-2">
                    <Button className="flex-1 bg-gradient-to-r from-[#FF6B35] to-[#DC2626] border-0">
                      Kilograms (kg)
                    </Button>
                    <Button variant="outline" className="flex-1 border-[#374151] text-[#9CA3AF]">
                      Pounds (lbs)
                    </Button>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              <h3 className="text-xl text-white mb-6 flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Privacy & Security
              </h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-3 border-b border-[#374151]">
                  <div>
                    <div className="text-white">Profile visibility</div>
                    <div className="text-sm text-[#9CA3AF]">Make your profile visible to others</div>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between py-3 border-b border-[#374151]">
                  <div>
                    <div className="text-white">Leaderboard participation</div>
                    <div className="text-sm text-[#9CA3AF]">Appear on public leaderboards</div>
                  </div>
                  <Switch defaultChecked />
                </div>
                <Button variant="outline" className="w-full border-[#374151] text-white hover:bg-[#374151]/50 mt-4">
                  <Download className="w-4 h-4 mr-2" />
                  Export All Data
                </Button>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
