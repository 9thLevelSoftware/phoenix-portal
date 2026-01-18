import { motion } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Badge } from '@/app/components/ui/badge';
import { GripVertical, ArrowDown, Unlink, Plus, Edit, X } from 'lucide-react';
import { SupersetGroup } from './superset-helpers';

interface SupersetCardProps {
  superset: SupersetGroup;
  exercises: Array<{ id: string; name: string; muscleGroup: string; sets: number; reps: number; weight: number }>;
  onUpdateTransition: (time: number) => void;
  onUpdateRest: (time: number) => void;
  onUngroup: () => void;
  onRemoveExercise: (exerciseId: string) => void;
  onEditExercise: (exerciseId: string) => void;
  onAddExercise: () => void;
}

export function SupersetCard({
  superset,
  exercises,
  onUpdateTransition,
  onUpdateRest,
  onUngroup,
  onRemoveExercise,
  onEditExercise,
  onAddExercise,
}: SupersetCardProps) {
  const supersetExercises = exercises.filter(ex => superset.exerciseIds.includes(ex.id));
  const colorLabel = ['A', 'B', 'C', 'D'][
    ['#6366F1', '#EC4899', '#10B981', '#F59E0B'].indexOf(superset.color)
  ] || 'A';

  return (
    <Card
      className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-l-4 relative"
      style={{ borderLeftColor: superset.color }}
    >
      {/* Superset Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GripVertical className="w-5 h-5 text-[#6B7280] cursor-grab active:cursor-grabbing" />
          <Badge
            className="text-white border-0"
            style={{ backgroundColor: superset.color }}
          >
            Superset {colorLabel}
          </Badge>
          <span className="text-xs text-[#6B7280]">
            {supersetExercises.length} exercises
          </span>
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={onUngroup}
          className="text-[#9CA3AF] hover:text-white"
        >
          <Unlink className="w-4 h-4 mr-1" />
          Ungroup
        </Button>
      </div>

      {/* Exercises in Superset */}
      <div className="space-y-3">
        {supersetExercises.map((exercise, index) => (
          <div key={exercise.id}>
            <div className="p-3 bg-[#0D0D0D] rounded-lg border border-[#374151] hover:border-[#FF6B35] transition-all">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <GripVertical className="w-4 h-4 text-[#6B7280]" />
                    <span className="font-semibold text-white">{exercise.name}</span>
                    <Badge variant="outline" className="text-xs border-[#374151] text-[#9CA3AF]">
                      {exercise.muscleGroup}
                    </Badge>
                  </div>
                  <div className="text-sm text-[#6B7280] ml-6">
                    {exercise.sets} sets • {exercise.reps} reps • {exercise.weight} kg
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onEditExercise(exercise.id)}
                    className="text-[#9CA3AF] hover:text-white"
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onRemoveExercise(exercise.id)}
                    className="text-[#EF4444] hover:text-[#DC2626]"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Transition Arrow */}
            {index < supersetExercises.length - 1 && (
              <div className="flex items-center justify-center my-2">
                <div className="flex items-center gap-2 text-xs text-[#6B7280]">
                  <ArrowDown className="w-4 h-4" />
                  <span>Transition: {superset.transitionTime}s</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Exercise to Superset */}
      <Button
        size="sm"
        variant="outline"
        onClick={onAddExercise}
        className="w-full mt-3 border-dashed border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-white"
      >
        <Plus className="w-4 h-4 mr-2" />
        Add to Superset
      </Button>

      {/* Superset Settings */}
      <div className="mt-4 pt-4 border-t border-[#374151] grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs text-[#9CA3AF] mb-2">Transition Time (s)</Label>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onUpdateTransition(Math.max(0, superset.transitionTime - 5))}
              className="border-[#374151]"
            >
              −
            </Button>
            <Input
              type="number"
              value={superset.transitionTime}
              onChange={(e) => onUpdateTransition(parseInt(e.target.value) || 10)}
              className="text-center bg-[#0D0D0D] border-[#374151] h-8"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => onUpdateTransition(superset.transitionTime + 5)}
              className="border-[#374151]"
            >
              +
            </Button>
          </div>
        </div>

        <div>
          <Label className="text-xs text-[#9CA3AF] mb-2">Rest After (s)</Label>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onUpdateRest(Math.max(0, superset.restAfter - 15))}
              className="border-[#374151]"
            >
              −
            </Button>
            <Input
              type="number"
              value={superset.restAfter}
              onChange={(e) => onUpdateRest(parseInt(e.target.value) || 90)}
              className="text-center bg-[#0D0D0D] border-[#374151] h-8"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => onUpdateRest(superset.restAfter + 15)}
              className="border-[#374151]"
            >
              +
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

interface SelectionModeBarProps {
  selectedCount: number;
  onCreateSuperset: () => void;
  onCancel: () => void;
}

export function SelectionModeBar({ selectedCount, onCreateSuperset, onCancel }: SelectionModeBarProps) {
  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50"
    >
      <Card className="px-6 py-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#FF6B35] shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="text-sm text-white">
            ✓ <span className="font-semibold">{selectedCount}</span> exercises selected
          </div>

          <div className="h-6 w-px bg-[#374151]" />

          <Button
            onClick={onCreateSuperset}
            disabled={selectedCount < 2}
            className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0 disabled:opacity-50"
          >
            Create Superset
          </Button>

          <Button
            onClick={onCancel}
            variant="ghost"
            className="text-[#9CA3AF] hover:text-white"
          >
            Cancel
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}
