import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Badge } from '@/app/components/ui/badge';
import { ChevronLeft, Save, Plus, CheckSquare, Square } from 'lucide-react';
import { ExerciseCard } from './routine-builder/ExerciseCard';
import { SupersetContainer } from './routine-builder/SupersetContainer';
import { SelectionModeBar } from './routine-builder/SelectionModeBar';
import {
  Superset,
  RoutineExercise,
  getNextSupersetColor,
  SUPERSET_COLORS,
} from './routine-builder/superset-types';

interface RoutineBuilderEnhancedProps {
  routineId?: string;
  onBack: () => void;
  onSave: (routine: any) => void;
}

export function RoutineBuilderEnhanced({ routineId, onBack, onSave }: RoutineBuilderEnhancedProps) {
  const [routineName, setRoutineName] = useState('Untitled Routine');
  const [exercises, setExercises] = useState<RoutineExercise[]>([
    {
      id: '1',
      exerciseId: 'bench-press',
      exerciseName: 'Bench Press',
      sets: [
        { reps: 10, weight: 80 },
        { reps: 10, weight: 80 },
        { reps: 10, weight: 80 },
      ],
      programMode: 'Old School',
      restTime: 90,
      muscleGroup: 'Chest',
    },
    {
      id: '2',
      exerciseId: 'incline-flyes',
      exerciseName: 'Incline Flyes',
      sets: [
        { reps: 12, weight: 15 },
        { reps: 12, weight: 15 },
        { reps: 12, weight: 15 },
      ],
      programMode: 'Pump',
      restTime: 60,
      muscleGroup: 'Chest',
    },
    {
      id: '3',
      exerciseId: 'shoulder-press',
      exerciseName: 'Shoulder Press',
      sets: [
        { reps: 10, weight: 40 },
        { reps: 10, weight: 40 },
        { reps: 10, weight: 40 },
      ],
      programMode: 'Old School',
      restTime: 90,
      muscleGroup: 'Shoulders',
    },
    {
      id: '4',
      exerciseId: 'lateral-raises',
      exerciseName: 'Lateral Raises',
      sets: [
        { reps: 15, weight: 8 },
        { reps: 15, weight: 8 },
        { reps: 15, weight: 8 },
      ],
      programMode: 'Pump',
      restTime: 60,
      muscleGroup: 'Shoulders',
    },
  ]);

  const [supersets, setSupersets] = useState<Superset[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedExerciseIds, setSelectedExerciseIds] = useState<string[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const handleToggleSelectionMode = () => {
    setIsSelectionMode(!isSelectionMode);
    setSelectedExerciseIds([]);
  };

  const handleToggleSelect = (exerciseId: string) => {
    setSelectedExerciseIds((prev) =>
      prev.includes(exerciseId) ? prev.filter((id) => id !== exerciseId) : [...prev, exerciseId]
    );
  };

  const handleCreateSuperset = () => {
    if (selectedExerciseIds.length < 2) return;

    const newSuperset: Superset = {
      id: `superset-${Date.now()}`,
      color: getNextSupersetColor(supersets),
      restAfter: 90,
      exerciseIds: selectedExerciseIds,
    };

    // Update exercises with superset info
    const updatedExercises = exercises.map((ex, index) => {
      if (selectedExerciseIds.includes(ex.id)) {
        const supersetOrder = selectedExerciseIds.indexOf(ex.id);
        return {
          ...ex,
          supersetId: newSuperset.id,
          supersetOrder,
          transitionTime: supersetOrder < selectedExerciseIds.length - 1 ? 10 : undefined,
        };
      }
      return ex;
    });

    setExercises(updatedExercises);
    setSupersets([...supersets, newSuperset]);
    setSelectedExerciseIds([]);
    setIsSelectionMode(false);
    setHasUnsavedChanges(true);

    // Show success toast (you can add a toast library)
    console.log('Superset created!');
  };

  const handleUngroupSuperset = (supersetId: string) => {
    // Remove superset
    setSupersets(supersets.filter((s) => s.id !== supersetId));

    // Update exercises
    const updatedExercises = exercises.map((ex) => {
      if (ex.supersetId === supersetId) {
        const { supersetId: _, supersetOrder: __, transitionTime: ___, ...rest } = ex;
        return { ...rest, restTime: ex.restTime || 90 };
      }
      return ex;
    });

    setExercises(updatedExercises);
    setHasUnsavedChanges(true);

    console.log('Superset ungrouped');
  };

  const handleUpdateTransitionTime = (exerciseId: string, time: number) => {
    setExercises(
      exercises.map((ex) => (ex.id === exerciseId ? { ...ex, transitionTime: time } : ex))
    );
    setHasUnsavedChanges(true);
  };

  const handleUpdateSupsersetRest = (supersetId: string, time: number) => {
    setSupersets(supersets.map((s) => (s.id === supersetId ? { ...s, restAfter: time } : s)));
    setHasUnsavedChanges(true);
  };

  const handleRemoveExercise = (exerciseId: string) => {
    setExercises(exercises.filter((ex) => ex.id !== exerciseId));
    setHasUnsavedChanges(true);
  };

  const handleSave = () => {
    const routine = {
      id: routineId || `routine-${Date.now()}`,
      name: routineName,
      exercises,
      supersets,
    };
    onSave(routine);
  };

  // Group exercises by superset or individual
  const exerciseGroups: Array<{ type: 'superset' | 'exercise'; id: string; data: any }> = [];
  const processedExerciseIds = new Set<string>();

  supersets.forEach((superset) => {
    exerciseGroups.push({ type: 'superset', id: superset.id, data: superset });
    superset.exerciseIds.forEach((id) => processedExerciseIds.add(id));
  });

  exercises.forEach((exercise) => {
    if (!processedExerciseIds.has(exercise.id)) {
      exerciseGroups.push({ type: 'exercise', id: exercise.id, data: exercise });
    }
  });

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-8">
      {/* Sticky Top Bar */}
      <div className="sticky top-0 z-40 bg-[#0D0D0D]/95 backdrop-blur-lg border-b border-[#374151] px-4 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="text-[#9CA3AF] hover:text-white"
            >
              <ChevronLeft className="w-5 h-5 mr-1" />
              Back
            </Button>

            <Input
              value={routineName}
              onChange={(e) => {
                setRoutineName(e.target.value);
                setHasUnsavedChanges(true);
              }}
              className="text-xl font-semibold bg-transparent border-none focus:ring-0 max-w-md"
              placeholder="Routine Name"
            />

            {hasUnsavedChanges && (
              <Badge variant="outline" className="bg-[#F59E0B]/20 text-[#F59E0B] border-[#F59E0B]/30">
                ● Unsaved
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleSave}
              className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
            >
              <Save className="w-4 h-4 mr-2" />
              Save
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Exercises Section */}
        <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white">
              EXERCISES ({exercises.length})
            </h2>

            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant={isSelectionMode ? 'default' : 'outline'}
                onClick={handleToggleSelectionMode}
                className={
                  isSelectionMode
                    ? 'bg-[#FF6B35] hover:bg-[#DC2626] border-0'
                    : 'border-[#374151] hover:border-[#FF6B35]'
                }
              >
                {isSelectionMode ? (
                  <>
                    <CheckSquare className="w-4 h-4 mr-2" />
                    Done
                  </>
                ) : (
                  <>
                    <Square className="w-4 h-4 mr-2" />
                    Select
                  </>
                )}
              </Button>

              <Button
                size="sm"
                onClick={() => console.log('Add exercise')}
                className="bg-[#FF6B35] hover:bg-[#DC2626] border-0"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Exercise
              </Button>
            </div>
          </div>

          {/* Exercise List */}
          <div className="space-y-4">
            <AnimatePresence>
              {exerciseGroups.map((group) => {
                if (group.type === 'superset') {
                  const superset = group.data as Superset;
                  return (
                    <SupersetContainer
                      key={group.id}
                      superset={superset}
                      exercises={exercises}
                      onUpdateTransitionTime={handleUpdateTransitionTime}
                      onUpdateRestAfter={(time) => handleUpdateSupsersetRest(superset.id, time)}
                      onUngroup={() => handleUngroupSuperset(superset.id)}
                      onRemoveExercise={handleRemoveExercise}
                      onEditExercise={(id) => console.log('Edit exercise:', id)}
                      onAddExercise={() => console.log('Add to superset:', superset.id)}
                    />
                  );
                } else {
                  const exercise = group.data as RoutineExercise;
                  return (
                    <ExerciseCard
                      key={group.id}
                      exercise={exercise}
                      onEdit={() => console.log('Edit:', exercise.id)}
                      onRemove={() => handleRemoveExercise(exercise.id)}
                      isSelectionMode={isSelectionMode}
                      isSelected={selectedExerciseIds.includes(exercise.id)}
                      onToggleSelect={() => handleToggleSelect(exercise.id)}
                    />
                  );
                }
              })}
            </AnimatePresence>

            {exercises.length === 0 && (
              <div className="text-center py-12 text-[#6B7280]">
                <p className="mb-4">No exercises yet</p>
                <Button
                  onClick={() => console.log('Add first exercise')}
                  variant="outline"
                  className="border-[#374151] hover:border-[#FF6B35]"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Your First Exercise
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Selection Mode Bar */}
      <SelectionModeBar
        selectedCount={selectedExerciseIds.length}
        onCreateSuperset={handleCreateSuperset}
        onCancel={() => {
          setIsSelectionMode(false);
          setSelectedExerciseIds([]);
        }}
      />
    </div>
  );
}
