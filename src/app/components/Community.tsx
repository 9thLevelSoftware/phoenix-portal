import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Input } from '@/app/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { Star, Download, Heart, MessageCircle, Share2, Search, TrendingUp, Clock, Dumbbell } from 'lucide-react';
import { motion } from 'motion/react';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { CommunityMobile } from '@/app/components/mobile/CommunityMobile';

export function Community() {
  const isMobile = useIsMobile();
  
  if (isMobile) {
    return <CommunityMobile />;
  }
  
  const featuredRoutines = [
    {
      id: 1,
      name: 'Phoenix Push Pull Legs',
      creator: 'Marcus Chen',
      creatorAvatar: 'MC',
      rating: 4.9,
      downloads: 2847,
      tags: ['Hypertrophy', 'Intermediate', '6-Day'],
      description: 'Complete PPL split optimized for muscle growth',
      exercises: 18,
      duration: '60-75 min',
    },
    {
      id: 2,
      name: 'Strength Foundation 5x5',
      creator: 'Sarah Williams',
      creatorAvatar: 'SW',
      rating: 4.8,
      downloads: 1923,
      tags: ['Strength', 'Beginner', '3-Day'],
      description: 'Classic compound-focused program for beginners',
      exercises: 5,
      duration: '45-60 min',
    },
    {
      id: 3,
      name: 'Upper Lower Split',
      creator: 'David Rodriguez',
      creatorAvatar: 'DR',
      rating: 4.7,
      downloads: 3214,
      tags: ['Strength', 'Intermediate', '4-Day'],
      description: 'Balanced upper/lower split for strength and size',
      exercises: 16,
      duration: '60-70 min',
    },
  ];

  const popularRoutines = [
    { name: 'German Volume Training', creator: 'Emma Thompson', rating: 4.6, downloads: 1654 },
    { name: 'Powerlifting Peaking', creator: 'James Lee', rating: 4.9, downloads: 987 },
    { name: 'Bodyweight Basics', creator: 'Lisa Chen', rating: 4.5, downloads: 2103 },
    { name: 'Olympic Lifting Primer', creator: 'Tom Wilson', rating: 4.8, downloads: 756 },
  ];

  const trainingCycles = [
    {
      id: 1,
      name: '12-Week Strength Builder',
      creator: 'Alex Morgan',
      creatorAvatar: 'AM',
      rating: 4.9,
      downloads: 1247,
      weeks: 12,
      tags: ['Strength', 'Periodization', 'Advanced'],
      description: 'Progressive overload program with deload weeks',
    },
    {
      id: 2,
      name: '8-Week Hypertrophy Block',
      creator: 'Rachel Kim',
      creatorAvatar: 'RK',
      rating: 4.7,
      downloads: 1856,
      weeks: 8,
      tags: ['Hypertrophy', 'Volume', 'Intermediate'],
      description: 'High volume training for maximum muscle growth',
    },
  ];

  const communityPosts = [
    {
      user: 'Marcus Chen',
      avatar: 'MC',
      time: '2 hours ago',
      content: 'Just hit a 120kg bench PR! The Phoenix Push Pull program is incredible. Highly recommend!',
      likes: 47,
      comments: 12,
    },
    {
      user: 'Sarah Williams',
      avatar: 'SW',
      time: '5 hours ago',
      content: 'Completed my 30-day streak today! The accountability from challenges keeps me consistent. 🔥',
      likes: 89,
      comments: 23,
    },
  ];

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-20 md:pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl mb-2">
            <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
              Community Hub
            </span>
          </h1>
          <p className="text-[#9CA3AF]">Discover, share, and connect with fellow athletes</p>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#9CA3AF]" />
            <Input
              placeholder="Search routines, programs, or creators..."
              className="pl-10 bg-[#1a1a1a] border-[#374151] text-white"
            />
          </div>
        </div>

        <Tabs defaultValue="routines" className="space-y-6">
          <TabsList className="bg-[#1a1a1a] border border-[#374151] p-1">
            <TabsTrigger value="routines" className="data-[state=active]:bg-[#FF6B35]">
              Routine Marketplace
            </TabsTrigger>
            <TabsTrigger value="cycles" className="data-[state=active]:bg-[#FF6B35]">
              Training Cycles
            </TabsTrigger>
            <TabsTrigger value="feed" className="data-[state=active]:bg-[#FF6B35]">
              Community Feed
            </TabsTrigger>
          </TabsList>

          {/* Routines Tab */}
          <TabsContent value="routines" className="space-y-6">
            {/* Featured Section */}
            <div>
              <h2 className="text-2xl text-white mb-4 flex items-center gap-2">
                <Star className="w-6 h-6 text-[#F59E0B]" fill="#F59E0B" />
                Featured Routines
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {featuredRoutines.map((routine, index) => (
                  <motion.div
                    key={routine.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] hover:border-[#FF6B35]/50 transition-all h-full flex flex-col cursor-pointer">
                      <div className="flex-1">
                        {/* Header */}
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#FF6B35] to-[#DC2626] flex items-center justify-center text-white text-sm">
                              {routine.creatorAvatar}
                            </div>
                            <div>
                              <div className="text-xs text-[#9CA3AF]">{routine.creator}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Star className="w-4 h-4 text-[#F59E0B]" fill="#F59E0B" />
                            <span className="text-sm text-white">{routine.rating}</span>
                          </div>
                        </div>

                        {/* Content */}
                        <h3 className="text-lg text-white mb-2">{routine.name}</h3>
                        <p className="text-sm text-[#9CA3AF] mb-4">{routine.description}</p>

                        {/* Tags */}
                        <div className="flex flex-wrap gap-2 mb-4">
                          {routine.tags.map((tag) => (
                            <Badge
                              key={tag}
                              className="bg-[#374151] text-[#E5E7EB] border-0 hover:bg-[#FF6B35]/20"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>

                        {/* Stats */}
                        <div className="flex items-center gap-4 text-sm text-[#9CA3AF] mb-4">
                          <div className="flex items-center gap-1">
                            <Dumbbell className="w-4 h-4" />
                            {routine.exercises} exercises
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            {routine.duration}
                          </div>
                        </div>

                        {/* Downloads */}
                        <div className="flex items-center gap-2 text-sm text-[#9CA3AF]">
                          <Download className="w-4 h-4" />
                          <span>{routine.downloads.toLocaleString()} downloads</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 mt-4">
                        <Button className="flex-1 bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0">
                          <Download className="w-4 h-4 mr-2" />
                          Save to Library
                        </Button>
                        <Button variant="outline" size="icon" className="border-[#374151] hover:border-[#FF6B35]">
                          <Heart className="w-4 h-4" />
                        </Button>
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Popular Routines */}
            <div>
              <h2 className="text-2xl text-white mb-4 flex items-center gap-2">
                <TrendingUp className="w-6 h-6 text-[#FF6B35]" />
                Most Popular
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {popularRoutines.map((routine, index) => (
                  <Card
                    key={index}
                    className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] hover:border-[#FF6B35]/50 transition-all cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="text-white mb-1">{routine.name}</h3>
                        <p className="text-sm text-[#9CA3AF]">by {routine.creator}</p>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-1 mb-1">
                          <Star className="w-4 h-4 text-[#F59E0B]" fill="#F59E0B" />
                          <span className="text-sm text-white">{routine.rating}</span>
                        </div>
                        <div className="text-xs text-[#9CA3AF]">
                          {routine.downloads} downloads
                        </div>
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
                  <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] hover:border-[#FF6B35]/50 transition-all h-full flex flex-col cursor-pointer">
                    <div className="flex-1">
                      {/* Header */}
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#FF6B35] to-[#DC2626] flex items-center justify-center text-white text-sm">
                            {cycle.creatorAvatar}
                          </div>
                          <div>
                            <div className="text-xs text-[#9CA3AF]">{cycle.creator}</div>
                          </div>
                        </div>
                        <Badge className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] text-white border-0">
                          {cycle.weeks} Weeks
                        </Badge>
                      </div>

                      {/* Content */}
                      <h3 className="text-xl text-white mb-2">{cycle.name}</h3>
                      <p className="text-sm text-[#9CA3AF] mb-4">{cycle.description}</p>

                      {/* Tags */}
                      <div className="flex flex-wrap gap-2 mb-4">
                        {cycle.tags.map((tag) => (
                          <Badge
                            key={tag}
                            className="bg-[#374151] text-[#E5E7EB] border-0"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>

                      {/* Stats */}
                      <div className="flex items-center gap-4 text-sm text-[#9CA3AF] mb-4">
                        <div className="flex items-center gap-1">
                          <Star className="w-4 h-4 text-[#F59E0B]" fill="#F59E0B" />
                          <span>{cycle.rating}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Download className="w-4 h-4" />
                          <span>{cycle.downloads.toLocaleString()} downloads</span>
                        </div>
                      </div>
                    </div>

                    {/* Action */}
                    <Button className="w-full bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0">
                      <Download className="w-4 h-4 mr-2" />
                      Import Program
                    </Button>
                  </Card>
                </motion.div>
              ))}
            </div>
          </TabsContent>

          {/* Community Feed Tab */}
          <TabsContent value="feed" className="space-y-6">
            {communityPosts.map((post, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#FF6B35] to-[#DC2626] flex items-center justify-center text-white ring-2 ring-[#F59E0B] ring-offset-2 ring-offset-[#0D0D0D]">
                      {post.avatar}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className="text-white">{post.user}</div>
                          <div className="text-sm text-[#9CA3AF]">{post.time}</div>
                        </div>
                      </div>
                      <p className="text-[#E5E7EB] mb-4">{post.content}</p>
                      <div className="flex items-center gap-6">
                        <Button variant="ghost" size="sm" className="text-[#9CA3AF] hover:text-[#FF6B35] hover:bg-[#FF6B35]/10">
                          <Heart className="w-4 h-4 mr-2" />
                          {post.likes}
                        </Button>
                        <Button variant="ghost" size="sm" className="text-[#9CA3AF] hover:text-[#FF6B35] hover:bg-[#FF6B35]/10">
                          <MessageCircle className="w-4 h-4 mr-2" />
                          {post.comments}
                        </Button>
                        <Button variant="ghost" size="sm" className="text-[#9CA3AF] hover:text-[#FF6B35] hover:bg-[#FF6B35]/10">
                          <Share2 className="w-4 h-4 mr-2" />
                          Share
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}