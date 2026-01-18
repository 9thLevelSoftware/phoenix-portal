import { useState } from 'react';
import { motion } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { GripVertical, ArrowDown, Unlink, Plus, Edit, X } from 'lucide-react';
import { Superset, RoutineExercise, getSupersetLabel, getSupersetColorHex } from './superset-types';
import { ExerciseCard } from './ExerciseCard';

interface SupersetContainerProps {
  superset: Superset;
  exercises: RoutineExercise[];
  onUpdateTransitionTime: (exerciseId: string, time: number) => void;
  onUpdateRestAfter: (time: number) => void;
  onUngroup: () => void;
  onRemoveExercise: (exerciseId: string) => void;
  onEditExercise: (exerciseId: string) => void;
  onAddExercise: () => void;
  isDragging?: boolean;
}

export function SupersetContainer({
  superset,
  exercises,
  onUpdateTransitionTime,
  onUpdateRestAfter,
  onUngroup,
  onRemoveExercise,
  onEditExercise,
  onAddExercise,
  isDragging = false,
}: SupersetContainerProps) {
  const supersetExercises = exercises
    .filter((ex) => superset.exerciseIds.includes(ex.id))
    .sort((a, b) => (a.supersetOrder || 0) - (b.supersetOrder || 0));

  const colorHex = getSupersetColorHex(superset.color);
  const label = getSupersetLabel(superset.color);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`relative rounded-lg border-l-4 p-4 transition-all ${isDragging ? 'opacity-50' : ''}`}
      style={{
        borderLeftColor: colorHex,
        backgroundColor: `${colorHex}08`,
        borderTop: '1px solid #374151',
        borderRight: '1px solid #374151',
        borderBottom: '1px solid #374151',
      }}
    >
      {/* Superset Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GripVertical className="w-5 h-5 text-[#6B7280] cursor-grab active:cursor-grabbing" />
          <div
            className="text-sm font-bold px-2 py-1 rounded"
            style={{
              color: colorHex,
              backgroundColor: `${colorHex}20`,
            }}
          >
            SUPERSET {label}
          </div>
          <span className="text-xs text-[#6B7280]">{supersetExercises.length} exercises</span>
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
            {/* Exercise Card */}
            <div className="p-3 bg-[#0D0D0D] rounded-lg border border-[#374151] hover:border-[#FF6B35] transition-all">
              <div className="flex items-center justify-between">
                <div className="flex-1 flex items-center gap-3">
                  <GripVertical className="w-4 h-4 text-[#6B7280] cursor-grab active:cursor-grabbing" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-white">{exercise.exerciseName}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-[#374151] text-[#9CA3AF]">
                        {exercise.muscleGroup}
                      </span>
                    </div>
                    <div className="text-sm text-[#6B7280]">
                      {exercise.sets.length} sets • {exercise.sets[0]?.reps || 0} reps •{' '}
                      {exercise.sets[0]?.weight || 0} kg • {exercise.programMode}
                    </div>
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

            {/* Transition Indicator */}
            {index < supersetExercises.length - 1 && (
              <TransitionIndicator
                time={exercise.transitionTime || 10}
                onUpdate={(time) => onUpdateTransitionTime(exercise.id, time)}
              />
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
        Add Exercise to Superset
      </Button>

      {/* Footer Controls */}
      <div className="mt-4 pt-4 border-t border-[#374151] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#9CA3AF]">Rest after superset:</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onUpdateRestAfter(Math.max(0, superset.restAfter - 15))}
            className="border-[#374151] h-8 w-8 p-0"
          >
            −
          </Button>
          <Input
            type="number"
            value={superset.restAfter}
            onChange={(e) => onUpdateRestAfter(parseInt(e.target.value) || 90)}
            className="w-16 text-center bg-[#0D0D0D] border-[#374151] h-8"
          />
          <span className="text-sm text-[#9CA3AF]">s</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onUpdateRestAfter(superset.restAfter + 15)}
            className="border-[#374151] h-8 w-8 p-0"
          >
            +
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function TransitionIndicator({ time, onUpdate }: { time: number; onUpdate: (time: number) => void }) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="flex items-center justify-center my-2">
      <div className="flex items-center gap-2 text-xs text-[#6B7280]">
        <ArrowDown className="w-4 h-4" />
        {isEditing ? (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onUpdate(Math.max(0, time - 5))}
              className="h-6 w-6 p-0"
            >
              −
            </Button>
            <Input
              type="number"
              value={time}
              onChange={(e) => onUpdate(parseInt(e.target.value) || 10)}
              onBlur={() => setIsEditing(false)}
              className="w-12 text-center h-6 text-xs bg-[#0D0D0D] border-[#374151]"
              autoFocus
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onUpdate(time + 5)}
              className="h-6 w-6 p-0"
            >
              +
            </Button>
            <span>s transition</span>
          </div>
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="hover:text-[#9CA3AF] transition-colors"
          >
            {time}s transition
          </button>
        )}
      </div>
    </div>
  );
}