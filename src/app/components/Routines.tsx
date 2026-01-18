import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { Plus, Calendar, Clock, Dumbbell, Eye, Edit, Trash2, Copy } from 'lucide-react';
import { motion } from 'motion/react';

export function Routines() {
  const myRoutines = [
    {
      id: 1,
      name: 'Push Day A',
      exercises: 6,
      duration: '60 min',
      lastUsed: '2 hours ago',
      timesCompleted: 24,
      isFavorite: true,
    },
    {
      id: 2,
      name: 'Pull Day B',
      exercises: 6,
      duration: '55 min',
      lastUsed: 'Yesterday',
      timesCompleted: 22,
      isFavorite: true,
    },
    {
      id: 3,
      name: 'Leg Day',
      exercises: 7,
      duration: '65 min',
      lastUsed: '2 days ago',
      timesCompleted: 19,
      isFavorite: true,
    },
    {
      id: 4,
      name: 'Upper Power',
      exercises: 5,
      duration: '50 min',
      lastUsed: '3 days ago',
      timesCompleted: 18,
      isFavorite: false,
    },
  ];

  const trainingCycles = [
    {
      id: 1,
      name: 'Upper/Lower 4-Day Split',
      weeks: 8,
      currentWeek: 3,
      currentDay: 2,
      progress: 37,
      status: 'active',
    },
    {
      id: 2,
      name: 'Strength Building Phase',
      weeks: 12,
      currentWeek: 0,
      currentDay: 0,
      progress: 0,
      status: 'upcoming',
    },
  ];

  const exerciseLibrary = [
    { name: 'Bench Press', category: 'Chest', equipment: 'Barbell' },
    { name: 'Squat', category: 'Legs', equipment: 'Barbell' },
    { name: 'Deadlift', category: 'Back', equipment: 'Barbell' },
    { name: 'Overhead Press', category: 'Shoulders', equipment: 'Barbell' },
    { name: 'Barbell Row', category: 'Back', equipment: 'Barbell' },
    { name: 'Pull-ups', category: 'Back', equipment: 'Bodyweight' },
  ];

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-20 md:pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl mb-2">
              <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                My Routines
              </span>
            </h1>
            <p className="text-[#9CA3AF]">Create, manage, and track your workout routines</p>
          </div>
          <Button className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0 shadow-lg shadow-[#FF6B35]/50">
            <Plus className="w-4 h-4 mr-2" />
            Create Routine
          </Button>
        </div>

        <Tabs defaultValue="routines" className="space-y-6">
          <TabsList className="bg-[#1a1a1a] border border-[#374151] p-1">
            <TabsTrigger value="routines" className="data-[state=active]:bg-[#FF6B35]">
              My Routines
            </TabsTrigger>
            <TabsTrigger value="cycles" className="data-[state=active]:bg-[#FF6B35]">
              Training Cycles
            </TabsTrigger>
            <TabsTrigger value="library" className="data-[state=active]:bg-[#FF6B35]">
              Exercise Library
            </TabsTrigger>
          </TabsList>

          {/* My Routines Tab */}
          <TabsContent value="routines" className="space-y-6">
            {/* Favorites */}
            <div>
              <h2 className="text-2xl text-white mb-4">⭐ Favorites</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {myRoutines.filter(r => r.isFavorite).map((routine, index) => (
                  <motion.div
                    key={routine.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] hover:border-[#FF6B35]/50 transition-all h-full flex flex-col">
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-4">
                          <h3 className="text-xl text-white">{routine.name}</h3>
                          <Badge className="bg-[#F59E0B] text-[#0D0D0D] border-0">⭐</Badge>
                        </div>

                        <div className="space-y-3 mb-4">
                          <div className="flex items-center gap-2 text-[#9CA3AF]">
                            <Dumbbell className="w-4 h-4" />
                            <span className="text-sm">{routine.exercises} exercises</span>
                          </div>
                          <div className="flex items-center gap-2 text-[#9CA3AF]">
                            <Clock className="w-4 h-4" />
                            <span className="text-sm">~{routine.duration}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[#9CA3AF]">
                            <Calendar className="w-4 h-4" />
                            <span className="text-sm">Last used: {routine.lastUsed}</span>
                          </div>
                        </div>

                        <div className="p-3 bg-[#0D0D0D] rounded-lg border border-[#374151] mb-4">
                          <div className="text-xs text-[#9CA3AF] mb-1">Times Completed</div>
                          <div className="text-2xl text-[#FF6B35]">{routine.timesCompleted}</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <Button className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0">
                          <Eye className="w-4 h-4 mr-2" />
                          View
                        </Button>
                        <Button variant="outline" className="border-[#374151] text-white hover:bg-[#374151]/50">
                          <Edit className="w-4 h-4 mr-2" />
                          Edit
                        </Button>
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* All Routines */}
            <div>
              <h2 className="text-2xl text-white mb-4">All Routines</h2>
              <div className="space-y-3">
                {myRoutines.map((routine) => (
                  <Card
                    key={routine.id}
                    className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] hover:border-[#FF6B35]/50 transition-all"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-lg text-white">{routine.name}</h3>
                          {routine.isFavorite && <span className="text-[#F59E0B]">⭐</span>}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-[#9CA3AF]">
                          <span>{routine.exercises} exercises</span>
                          <span>•</span>
                          <span>{routine.duration}</span>
                          <span>•</span>
                          <span>{routine.timesCompleted} times completed</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0">
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="outline" className="border-[#374151] text-white hover:bg-[#374151]/50">
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="outline" className="border-[#374151] text-white hover:bg-[#374151]/50">
                          <Copy className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="outline" className="border-[#EF4444] text-[#EF4444] hover:bg-[#EF4444]/10">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* Training Cycles Tab */}
          <TabsContent value="cycles" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {trainingCycles.map((cycle, index) => (
                <motion.div
                  key={cycle.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <Card className={`p-6 h-full flex flex-col ${
                    cycle.status === 'active'
                      ? 'bg-gradient-to-br from-[#FF6B35]/20 to-[#DC2626]/20 border-[#FF6B35] border-2'
                      : 'bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]'
                  }`}>
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-4">
                        <h3 className="text-xl text-white">{cycle.name}</h3>
                        <Badge className={cycle.status === 'active'
                          ? 'bg-gradient-to-r from-[#FF6B35] to-[#DC2626] text-white border-0'
                          : 'bg-[#374151] text-[#9CA3AF] border-0'
                        }>
                          {cycle.status === 'active' ? 'ACTIVE' : 'UPCOMING'}
                        </Badge>
                      </div>

                      <div className="space-y-3 mb-4">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-[#9CA3AF]">Duration</span>
                          <span className="text-white">{cycle.weeks} weeks</span>
                        </div>
                        {cycle.status === 'active' && (
                          <>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-[#9CA3AF]">Current Week</span>
                              <span className="text-white">Week {cycle.currentWeek} of {cycle.weeks}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-[#9CA3AF]">Progress</span>
                              <span className="text-[#FF6B35]">{cycle.progress}%</span>
                            </div>
                            <div className="h-2 bg-[#374151] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-[#FF6B35] to-[#DC2626] rounded-full"
                                style={{ width: `${cycle.progress}%` }}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {cycle.status === 'active' ? (
                        <>
                          <Button className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0">
                            Continue
                          </Button>
                          <Button variant="outline" className="border-[#374151] text-white hover:bg-[#374151]/50">
                            Edit
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0">
                            Start
                          </Button>
                          <Button variant="outline" className="border-[#374151] text-white hover:bg-[#374151]/50">
                            Preview
                          </Button>
                        </>
                      )}
                    </div>
                  </Card>
                </motion.div>
              ))}

              {/* Create New Cycle Card */}
              <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] border-dashed hover:border-[#FF6B35]/50 transition-all flex items-center justify-center min-h-[300px] cursor-pointer">
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-[#FF6B35] to-[#DC2626] flex items-center justify-center">
                    <Plus className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-xl text-white mb-2">Create Training Cycle</h3>
                  <p className="text-sm text-[#9CA3AF]">Plan your long-term training program</p>
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* Exercise Library Tab */}
          <TabsContent value="library" className="space-y-6">
            <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              <h3 className="text-xl text-white mb-6">Exercise Library</h3>
              <div className="space-y-2">
                {exerciseLibrary.map((exercise, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-4 bg-[#0D0D0D] rounded-lg border border-[#374151] hover:border-[#FF6B35]/50 transition-all cursor-pointer"
                  >
                    <div>
                      <h4 className="text-white mb-1">{exercise.name}</h4>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-[#374151] text-[#E5E7EB] border-0 text-xs">
                          {exercise.category}
                        </Badge>
                        <Badge className="bg-[#374151] text-[#E5E7EB] border-0 text-xs">
                          {exercise.equipment}
                        </Badge>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="border-[#FF6B35] text-[#FF6B35] hover:bg-[#FF6B35]/10">
                      <Plus className="w-4 h-4 mr-2" />
                      Add to Routine
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
