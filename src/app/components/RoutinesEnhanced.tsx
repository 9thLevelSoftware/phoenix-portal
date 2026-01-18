import { useState } from 'react';
import { motion } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu';
import {
  Plus,
  Dumbbell,
  Clock,
  Eye,
  Edit,
  MoreVertical,
  Copy,
  Trash2,
  Star,
  Heart,
  Share2,
} from 'lucide-react';

interface Routine {
  id: string;
  name: string;
  description: string;
  exercises: number;
  duration: number;
  timesCompleted: number;
  lastUsed: string;
  tags: string[];
  isFavorite: boolean;
}

interface RoutinesEnhancedProps {
  onCreateRoutine: () => void;
  onEditRoutine: (id: string) => void;
}

const mockRoutines: Routine[] = [
  {
    id: '1',
    name: 'Push Day A',
    description: 'Chest, shoulders, and triceps focus with progressive overload',
    exercises: 6,
    duration: 60,
    timesCompleted: 24,
    lastUsed: '2 days ago',
    tags: ['Chest', 'Shoulders', 'Arms'],
    isFavorite: true,
  },
  {
    id: '2',
    name: 'Pull Day B',
    description: 'Back and biceps hypertrophy routine',
    exercises: 6,
    duration: 55,
    timesCompleted: 22,
    lastUsed: '3 days ago',
    tags: ['Back', 'Arms'],
    isFavorite: false,
  },
  {
    id: '3',
    name: 'Leg Day',
    description: 'Quad and glute dominant with hamstring work',
    exercises: 7,
    duration: 70,
    timesCompleted: 19,
    lastUsed: '5 days ago',
    tags: ['Legs'],
    isFavorite: true,
  },
];

const mockImported: Routine[] = [
  {
    id: '4',
    name: 'Community PPL',
    description: 'Popular push/pull/legs split from the community',
    exercises: 8,
    duration: 65,
    timesCompleted: 0,
    lastUsed: 'Never',
    tags: ['Chest', 'Back', 'Legs'],
    isFavorite: false,
  },
];

export function RoutinesEnhanced({ onCreateRoutine, onEditRoutine }: RoutinesEnhancedProps) {
  const [routines, setRoutines] = useState(mockRoutines);
  const [imported, setImported] = useState(mockImported);

  const handleDelete = (id: string) => {
    setRoutines(routines.filter((r) => r.id !== id));
  };

  const handleDuplicate = (id: string) => {
    const routine = routines.find((r) => r.id === id);
    if (routine) {
      const newRoutine = {
        ...routine,
        id: Date.now().toString(),
        name: `${routine.name} (Copy)`,
        timesCompleted: 0,
        lastUsed: 'Never',
      };
      setRoutines([...routines, newRoutine]);
    }
  };

  const handleToggleFavorite = (id: string) => {
    setRoutines(
      routines.map((r) => (r.id === id ? { ...r, isFavorite: !r.isFavorite } : r))
    );
  };

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-24 md:pb-8">
      {/* Header */}
      <div className="bg-gradient-to-b from-[#1a1a1a] to-[#0D0D0D] border-b border-[#374151] sticky top-0 z-40 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          >
            <div>
              <h1 className="text-3xl sm:text-4xl mb-2">
                <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                  My Routines
                </span>
              </h1>
              <p className="text-[#9CA3AF]">Build your perfect workout</p>
            </div>

            <Button
              onClick={onCreateRoutine}
              className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Routine
            </Button>
          </motion.div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="my-routines" className="w-full">
          <TabsList className="bg-[#1a1a1a] border border-[#374151] mb-6">
            <TabsTrigger value="my-routines" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#FF6B35] data-[state=active]:to-[#DC2626]">
              My Routines
            </TabsTrigger>
            <TabsTrigger value="imported" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#FF6B35] data-[state=active]:to-[#DC2626]">
              Imported
            </TabsTrigger>
            <TabsTrigger value="favorites" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#FF6B35] data-[state=active]:to-[#DC2626]">
              Favorites
            </TabsTrigger>
          </TabsList>

          <TabsContent value="my-routines">
            {routines.length === 0 ? (
              <EmptyState onCreateRoutine={onCreateRoutine} />
            ) : (
              <RoutineGrid
                routines={routines}
                onEdit={onEditRoutine}
                onDelete={handleDelete}
                onDuplicate={handleDuplicate}
                onToggleFavorite={handleToggleFavorite}
              />
            )}
          </TabsContent>

          <TabsContent value="imported">
            <RoutineGrid
              routines={imported}
              onEdit={onEditRoutine}
              onDelete={(id) => setImported(imported.filter((r) => r.id !== id))}
              onDuplicate={handleDuplicate}
              onToggleFavorite={handleToggleFavorite}
            />
          </TabsContent>

          <TabsContent value="favorites">
            <RoutineGrid
              routines={routines.filter((r) => r.isFavorite)}
              onEdit={onEditRoutine}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onToggleFavorite={handleToggleFavorite}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function RoutineGrid({
  routines,
  onEdit,
  onDelete,
  onDuplicate,
  onToggleFavorite,
}: {
  routines: Routine[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {routines.map((routine, index) => (
        <motion.div
          key={routine.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
        >
          <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] hover:border-[#FF6B35]/50 transition-all group">
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-white mb-1">{routine.name}</h3>
                <p className="text-sm text-[#9CA3AF] line-clamp-2">{routine.description}</p>
              </div>
              <div className="flex items-center gap-2 ml-2">
                <button
                  onClick={() => onToggleFavorite(routine.id)}
                  className="text-[#9CA3AF] hover:text-[#F59E0B] transition-colors"
                >
                  <Heart
                    className={`w-5 h-5 ${routine.isFavorite ? 'fill-[#F59E0B] text-[#F59E0B]' : ''}`}
                  />
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="text-[#9CA3AF] hover:text-white transition-colors">
                      <MoreVertical className="w-5 h-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="bg-[#1a1a1a] border-[#374151]">
                    <DropdownMenuItem
                      onClick={() => onDuplicate(routine.id)}
                      className="text-[#E5E7EB] hover:bg-[#374151] cursor-pointer"
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-[#E5E7EB] hover:bg-[#374151] cursor-pointer">
                      <Share2 className="w-4 h-4 mr-2" />
                      Share
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onDelete(routine.id)}
                      className="text-[#EF4444] hover:bg-[#374151] cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-4 mb-4 text-sm">
              <div className="flex items-center gap-1 text-[#9CA3AF]">
                <Dumbbell className="w-4 h-4" />
                <span>{routine.exercises} exercises</span>
              </div>
              <div className="flex items-center gap-1 text-[#9CA3AF]">
                <Clock className="w-4 h-4" />
                <span>~{routine.duration} min</span>
              </div>
            </div>

            {/* Tags */}
            <div className="flex flex-wrap gap-2 mb-4">
              {routine.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="border-[#FF6B35]/30 text-[#FF6B35] text-xs"
                >
                  {tag}
                </Badge>
              ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-4 border-t border-[#374151]">
              <div className="text-xs text-[#6B7280]">
                <div>Used {routine.timesCompleted} times</div>
                <div>Last used: {routine.lastUsed}</div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onEdit(routine.id)}
                  className="border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-[#FF6B35]"
                >
                  <Edit className="w-4 h-4 mr-1" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
                >
                  <Eye className="w-4 h-4 mr-1" />
                  View
                </Button>
              </div>
            </div>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

function EmptyState({ onCreateRoutine }: { onCreateRoutine: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center py-16"
    >
      <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-[#FF6B35]/20 to-[#DC2626]/20 flex items-center justify-center">
        <Dumbbell className="w-12 h-12 text-[#FF6B35]" />
      </div>
      <h3 className="text-2xl font-semibold text-white mb-2">No routines yet</h3>
      <p className="text-[#9CA3AF] mb-6 max-w-md mx-auto">
        Create your first routine or import from the community
      </p>
      <div className="flex gap-4 justify-center">
        <Button
          onClick={onCreateRoutine}
          className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Routine
        </Button>
        <Button
          variant="outline"
          className="border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-[#FF6B35]"
        >
          Browse Community
        </Button>
      </div>
    </motion.div>
  );
}
