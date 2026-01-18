import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Badge } from '@/app/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { Search, Star, Download, Heart, X, TrendingUp, Clock, Users } from 'lucide-react';

interface Routine {
  id: string;
  name: string;
  author: string;
  rating: number;
  downloads: number;
  tags: string[];
  description: string;
  duration: string;
  exercises: number;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
}

function FeaturedRoutineCard({ routine, onTap }: { routine: Routine; onTap: () => void }) {
  return (
    <motion.div
      whileTap={{ scale: 0.95 }}
      onClick={onTap}
      className="min-w-[160px] w-[160px] snap-start"
    >
      <Card className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] h-full">
        <div className="flex flex-col h-full">
          <h3 className="text-white font-semibold text-sm mb-2 line-clamp-2 h-10">
            {routine.name}
          </h3>
          <div className="flex items-center gap-1 mb-2">
            <Star className="w-3 h-3 text-[#F59E0B] fill-[#F59E0B]" />
            <span className="text-xs text-white font-semibold">{routine.rating}</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-[#9CA3AF] mb-3">
            <Download className="w-3 h-3" />
            <span>{(routine.downloads / 1000).toFixed(1)}k</span>
          </div>
          <div className="flex flex-wrap gap-1 mt-auto">
            {routine.tags.slice(0, 2).map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="text-[10px] py-0 px-1.5 border-[#374151] text-[#9CA3AF]"
              >
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function RoutineListCard({ routine, onTap }: { routine: Routine; onTap: () => void }) {
  return (
    <Card 
      onClick={onTap}
      className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] active:scale-[0.98] transition-transform"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-semibold mb-1 truncate">{routine.name}</h3>
          <p className="text-xs text-[#9CA3AF] mb-2">by {routine.author}</p>
          
          <div className="flex items-center gap-3 text-xs text-[#9CA3AF] mb-2">
            <div className="flex items-center gap-1">
              <Star className="w-3 h-3 text-[#F59E0B] fill-[#F59E0B]" />
              <span className="text-white font-semibold">{routine.rating}</span>
            </div>
            <div className="flex items-center gap-1">
              <Download className="w-3 h-3" />
              <span>{routine.downloads.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{routine.duration}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {routine.tags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="text-[10px] py-0 px-1.5 border-[#374151] text-[#9CA3AF]"
              >
                {tag}
              </Badge>
            ))}
          </div>
        </div>

        <Button
          size="sm"
          className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0 text-xs"
        >
          Import
        </Button>
      </div>
    </Card>
  );
}

function FullScreenSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-[#0D0D0D]"
        >
          <div className="flex flex-col h-full">
            {/* Search Header */}
            <div className="flex items-center gap-3 p-4 border-b border-[#374151]">
              <button onClick={onClose} className="text-[#9CA3AF] hover:text-white">
                <X className="w-6 h-6" />
              </button>
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B7280]" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search routines, cycles..."
                  className="pl-10 bg-[#1a1a1a] border-[#374151]"
                  autoFocus
                />
              </div>
            </div>

            {/* Filter Chips */}
            <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-hide">
              {['Strength', 'Hypertrophy', 'Powerlifting', 'PPL', 'Full Body'].map((filter) => (
                <Badge
                  key={filter}
                  variant="outline"
                  className="whitespace-nowrap border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-white cursor-pointer"
                >
                  {filter}
                </Badge>
              ))}
            </div>

            {/* Recent Searches */}
            {!searchQuery && (
              <div className="px-4 py-4">
                <h3 className="text-sm text-[#9CA3AF] mb-3">Recent Searches</h3>
                <div className="space-y-2">
                  {['PPL Split', 'German Volume', 'Powerlifting'].map((recent) => (
                    <button
                      key={recent}
                      onClick={() => setSearchQuery(recent)}
                      className="flex items-center gap-3 w-full text-left p-2 rounded-lg hover:bg-[#1a1a1a] transition-colors"
                    >
                      <Clock className="w-4 h-4 text-[#6B7280]" />
                      <span className="text-white text-sm">{recent}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Search Results */}
            {searchQuery && (
              <div className="flex-1 overflow-y-auto px-4 py-4">
                <p className="text-xs text-[#9CA3AF] mb-4">
                  Showing results for "{searchQuery}"
                </p>
                {/* Results would go here */}
                <div className="text-center py-12 text-[#6B7280]">
                  <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No results found</p>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function RoutineDetailSheet({ routine, onClose, onImport }: { 
  routine: Routine | null; 
  onClose: () => void;
  onImport: () => void;
}) {
  if (!routine) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed inset-x-0 bottom-0 z-50 bg-[#0D0D0D] rounded-t-3xl border-t border-[#374151] max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Drag Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-12 h-1 bg-[#374151] rounded-full" />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 pb-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <h2 className="text-xl font-bold text-white mb-1">{routine.name}</h2>
              <p className="text-sm text-[#9CA3AF]">by {routine.author}</p>
            </div>
            <button onClick={onClose} className="text-[#9CA3AF] hover:text-white">
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-1">
              <Star className="w-4 h-4 text-[#F59E0B] fill-[#F59E0B]" />
              <span className="text-white font-semibold">{routine.rating}</span>
              <span className="text-xs text-[#6B7280]">(147 reviews)</span>
            </div>
            <div className="flex items-center gap-1 text-sm text-[#9CA3AF]">
              <Download className="w-4 h-4" />
              <span>{(routine.downloads / 1000).toFixed(1)}k</span>
            </div>
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-2 mb-4">
            {routine.tags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="border-[#374151] text-[#9CA3AF]"
              >
                {tag}
              </Badge>
            ))}
          </div>

          {/* Description */}
          <p className="text-sm text-[#E5E7EB] mb-4">{routine.description}</p>

          {/* Info Grid */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="p-3 bg-[#1a1a1a] rounded-lg border border-[#374151]">
              <p className="text-xs text-[#6B7280] mb-1">Exercises</p>
              <p className="text-lg font-semibold text-white">{routine.exercises}</p>
            </div>
            <div className="p-3 bg-[#1a1a1a] rounded-lg border border-[#374151]">
              <p className="text-xs text-[#6B7280] mb-1">Duration</p>
              <p className="text-lg font-semibold text-white">{routine.duration}</p>
            </div>
            <div className="p-3 bg-[#1a1a1a] rounded-lg border border-[#374151]">
              <p className="text-xs text-[#6B7280] mb-1">Level</p>
              <p className="text-lg font-semibold text-white text-xs">{routine.difficulty}</p>
            </div>
          </div>

          {/* Exercise List Preview */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-white mb-3">Exercises</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-3 p-2 bg-[#1a1a1a] rounded-lg">
                <span className="text-[#6B7280] text-xs">1</span>
                <span className="text-white text-sm flex-1">Bench Press</span>
                <span className="text-xs text-[#9CA3AF]">3×10</span>
              </div>
              <div className="flex items-center gap-3 p-2 bg-[#1a1a1a] rounded-lg">
                <span className="text-[#6B7280] text-xs">2</span>
                <span className="text-white text-sm flex-1">Incline DB Press</span>
                <span className="text-xs text-[#9CA3AF]">3×10</span>
              </div>
              <div className="flex items-center gap-3 p-2 bg-[#1a1a1a] rounded-lg">
                <span className="text-[#6B7280] text-xs">3</span>
                <span className="text-white text-sm flex-1">Cable Flyes</span>
                <span className="text-xs text-[#9CA3AF]">3×12</span>
              </div>
              <p className="text-xs text-[#6B7280] text-center py-2">+{routine.exercises - 3} more exercises</p>
            </div>
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="border-t border-[#374151] p-4 bg-[#0D0D0D]">
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-white"
            >
              <Heart className="w-4 h-4 mr-2" />
              Save
            </Button>
            <Button
              onClick={onImport}
              className="flex-1 bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
            >
              Import Routine
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

export function CommunityMobile() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedRoutine, setSelectedRoutine] = useState<Routine | null>(null);

  const featuredRoutines: Routine[] = [
    {
      id: '1',
      name: 'Phoenix PPL',
      author: 'Marcus Chen',
      rating: 4.9,
      downloads: 2800,
      tags: ['PPL', 'Hypertrophy'],
      description: 'Complete PPL split optimized for muscle growth and strength development.',
      duration: '65 min',
      exercises: 18,
      difficulty: 'Intermediate',
    },
    {
      id: '2',
      name: 'Strength 5x5',
      author: 'Sarah Williams',
      rating: 4.8,
      downloads: 1900,
      tags: ['Strength', '5x5'],
      description: 'Classic 5x5 program for building raw strength.',
      duration: '45 min',
      exercises: 5,
      difficulty: 'Beginner',
    },
    {
      id: '3',
      name: 'Upper Lower',
      author: 'David Rodriguez',
      rating: 4.7,
      downloads: 3200,
      tags: ['Upper/Lower', 'Strength'],
      description: '4-day upper/lower split for balanced development.',
      duration: '55 min',
      exercises: 12,
      difficulty: 'Intermediate',
    },
  ];

  const popularRoutines: Routine[] = [
    {
      id: '4',
      name: 'German Volume Training',
      author: 'Emma Thompson',
      rating: 4.6,
      downloads: 1654,
      tags: ['GVT', 'Hypertrophy', 'Advanced'],
      description: 'Intense 10x10 program for serious muscle growth.',
      duration: '75 min',
      exercises: 6,
      difficulty: 'Advanced',
    },
    {
      id: '5',
      name: 'Powerlifting Peaking',
      author: 'James Lee',
      rating: 4.9,
      downloads: 987,
      tags: ['Powerlifting', 'Strength', 'Advanced'],
      description: '12-week peaking program for competition prep.',
      duration: '90 min',
      exercises: 8,
      difficulty: 'Advanced',
    },
  ];

  const handleImportRoutine = () => {
    console.log('Importing routine:', selectedRoutine?.id);
    setSelectedRoutine(null);
  };

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-20">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-4 border-b border-[#374151]">
        <h1 className="text-2xl font-bold">
          <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
            Community
          </span>
        </h1>
        <button 
          onClick={() => setSearchOpen(true)}
          className="w-10 h-10 flex items-center justify-center text-[#9CA3AF] hover:text-white transition-colors"
        >
          <Search className="w-6 h-6" />
        </button>
      </header>

      {/* Tabs */}
      <Tabs defaultValue="routines">
        <div className="overflow-x-auto scrollbar-hide border-b border-[#374151]">
          <TabsList className="flex px-4 gap-1 bg-transparent">
            <TabsTrigger 
              value="routines"
              className="px-4 py-3 text-sm font-medium whitespace-nowrap data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-[#FF6B35]"
            >
              Routines
            </TabsTrigger>
            <TabsTrigger 
              value="cycles"
              className="px-4 py-3 text-sm font-medium whitespace-nowrap data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-[#FF6B35]"
            >
              Cycles
            </TabsTrigger>
            <TabsTrigger 
              value="feed"
              className="px-4 py-3 text-sm font-medium whitespace-nowrap data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-[#FF6B35]"
            >
              Feed
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Routines Tab */}
        <TabsContent value="routines" className="mt-0">
          {/* Featured Carousel */}
          <section className="py-4">
            <h2 className="px-4 text-lg font-semibold text-white mb-3">Featured</h2>
            <div className="flex overflow-x-auto gap-3 px-4 scrollbar-hide snap-x snap-mandatory pb-2">
              {featuredRoutines.map((routine) => (
                <FeaturedRoutineCard
                  key={routine.id}
                  routine={routine}
                  onTap={() => setSelectedRoutine(routine)}
                />
              ))}
            </div>
          </section>

          {/* Most Popular */}
          <section className="px-4 py-4">
            <h2 className="text-lg font-semibold text-white mb-3">Most Popular</h2>
            <div className="space-y-3">
              {popularRoutines.map((routine) => (
                <RoutineListCard
                  key={routine.id}
                  routine={routine}
                  onTap={() => setSelectedRoutine(routine)}
                />
              ))}
            </div>
          </section>
        </TabsContent>

        {/* Cycles Tab */}
        <TabsContent value="cycles" className="px-4 py-12 mt-0">
          <div className="text-center text-[#6B7280]">
            <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Training cycles coming soon</p>
          </div>
        </TabsContent>

        {/* Feed Tab */}
        <TabsContent value="feed" className="px-4 py-12 mt-0">
          <div className="text-center text-[#6B7280]">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Community feed coming soon</p>
          </div>
        </TabsContent>
      </Tabs>

      {/* Search Modal */}
      <FullScreenSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Routine Detail Sheet */}
      {selectedRoutine && (
        <RoutineDetailSheet
          routine={selectedRoutine}
          onClose={() => setSelectedRoutine(null)}
          onImport={handleImportRoutine}
        />
      )}
    </div>
  );
}
