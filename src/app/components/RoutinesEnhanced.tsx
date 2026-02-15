import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { RoutineCardSkeleton } from '@/app/components/ui/skeleton';
import {
  Plus,
  Dumbbell,
  Clock,
  Eye,
  Edit,
  MoreVertical,
  Copy,
  Trash2,
  Heart,
  Share2,
} from 'lucide-react';
import { useAuth } from '@/app/hooks/useAuth';
import { routineListOptions } from '@/queries/routines';
import type { Routine } from '@/schemas/transforms';

interface RoutinesEnhancedProps {
  onCreateRoutine: () => void;
  onEditRoutine: (id: string) => void;
}

export function RoutinesEnhanced({ onCreateRoutine, onEditRoutine }: RoutinesEnhancedProps) {
  const { user } = useAuth();
  const { data: routines, isPending } = useQuery(routineListOptions(user!.id));

  // Local state for UI-only operations (these would need mutations for persistence)
  const [localFavorites, setLocalFavorites] = useState<Set<string>>(new Set());

  const toggleFavorite = (id: string) => {
    setLocalFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const isFavorite = (routine: Routine) =>
    localFavorites.has(routine.id) ? !routine.is_favorite : routine.is_favorite;

  const allRoutines = routines ?? [];
  const favoriteRoutines = allRoutines.filter((r) => isFavorite(r));

  if (isPending) {
    return (
      <div className="min-h-screen bg-[#0D0D0D] pb-24 md:pb-8">
        <div className="bg-gradient-to-b from-[#1a1a1a] to-[#0D0D0D] border-b border-[#374151] sticky top-0 z-40 backdrop-blur-xl">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h1 className="text-3xl sm:text-4xl mb-2">
                  <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                    My Routines
                  </span>
                </h1>
                <p className="text-[#9CA3AF]">Build your perfect workout</p>
              </div>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <RoutineCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

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
            <TabsTrigger value="favorites" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#FF6B35] data-[state=active]:to-[#DC2626]">
              Favorites
            </TabsTrigger>
          </TabsList>

          <TabsContent value="my-routines">
            {allRoutines.length === 0 ? (
              <EmptyState onCreateRoutine={onCreateRoutine} />
            ) : (
              <RoutineGrid
                routines={allRoutines}
                onEdit={onEditRoutine}
                onToggleFavorite={toggleFavorite}
                isFavorite={isFavorite}
              />
            )}
          </TabsContent>

          <TabsContent value="favorites">
            {favoriteRoutines.length === 0 ? (
              <div className="text-center py-12 text-[#6B7280]">
                <Heart className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No favorite routines yet. Heart a routine to add it here.</p>
              </div>
            ) : (
              <RoutineGrid
                routines={favoriteRoutines}
                onEdit={onEditRoutine}
                onToggleFavorite={toggleFavorite}
                isFavorite={isFavorite}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function RoutineGrid({
  routines,
  onEdit,
  onToggleFavorite,
  isFavorite,
}: {
  routines: Routine[];
  onEdit: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  isFavorite: (routine: Routine) => boolean;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {routines.map((routine, index) => {
        const favorite = isFavorite(routine);
        const lastUsedText = routine.last_used_at
          ? routine.last_used_at.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })
          : 'Never';

        return (
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
                      className={`w-5 h-5 ${favorite ? 'fill-[#F59E0B] text-[#F59E0B]' : ''}`}
                    />
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="text-[#9CA3AF] hover:text-white transition-colors">
                        <MoreVertical className="w-5 h-5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="bg-[#1a1a1a] border-[#374151]">
                      <DropdownMenuItem className="text-[#E5E7EB] hover:bg-[#374151] cursor-pointer">
                        <Copy className="w-4 h-4 mr-2" />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-[#E5E7EB] hover:bg-[#374151] cursor-pointer">
                        <Share2 className="w-4 h-4 mr-2" />
                        Share
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 mb-4 text-sm">
                <div className="flex items-center gap-1 text-[#9CA3AF]">
                  <Dumbbell className="w-4 h-4" />
                  <span>{routine.exercise_count} exercises</span>
                </div>
                <div className="flex items-center gap-1 text-[#9CA3AF]">
                  <Clock className="w-4 h-4" />
                  <span>~{routine.estimated_duration} min</span>
                </div>
              </div>

              {/* Tags */}
              {routine.tags && routine.tags.length > 0 && (
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
              )}

              {/* Footer */}
              <div className="flex items-center justify-between pt-4 border-t border-[#374151]">
                <div className="text-xs text-[#6B7280]">
                  <div>Used {routine.times_completed} times</div>
                  <div>Last used: {lastUsedText}</div>
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
        );
      })}
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
