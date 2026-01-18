import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Badge } from '@/app/components/ui/badge';
import {
  ArrowLeft,
  Plus,
  GripVertical,
  Edit,
  X,
  Eye,
  Save,
  Dumbbell,
} from 'lucide-react';

interface Exercise {
  id: string;
  name: string;
  muscleGroup: string;
  sets: number;
  reps: number;
  weight: number;
  rest: number;
  mode: string;
}

interface RoutineBuilderProps {
  routineId?: string;
  onBack: () => void;
  onSave: (routine: any) => void;
}

export function RoutineBuilder({ routineId, onBack, onSave }: RoutineBuilderProps) {
  const [routineName, setRoutineName] = useState('Untitled Routine');
  const [exercises, setExercises] = useState<Exercise[]>([
    {
      id: '1',
      name: 'Bench Press',
      muscleGroup: 'Chest',
      sets: 3,
      reps: 10,
      weight: 80,
      rest: 90,
      mode: 'Old School',
    },
    {
      id: '2',
      name: 'Incline Dumbbell Press',
      muscleGroup: 'Chest',
      sets: 3,
      reps: 12,
      weight: 35,
      rest: 60,
      mode: 'Pump',
    },
  ]);
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setExercises((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
      setHasUnsavedChanges(true);
    }
  };

  const handleDeleteExercise = (id: string) => {
    setExercises(exercises.filter((ex) => ex.id !== id));
    if (selectedExercise === id) {
      setSelectedExercise(null);
    }
    setHasUnsavedChanges(true);
  };

  const handleSave = () => {
    onSave({ name: routineName, exercises });
    setHasUnsavedChanges(false);
  };

  const totalDuration = exercises.reduce((sum, ex) => {
    return sum + ex.sets * 2.5 + ((ex.sets - 1) * ex.rest) / 60;
  }, 0);

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-24 md:pb-8">
      {/* Top Bar */}
      <div className="bg-gradient-to-b from-[#1a1a1a] to-[#0D0D0D] border-b border-[#374151] sticky top-0 z-50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={onBack}
              className="border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-[#FF6B35]"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Cancel
            </Button>

            <div className="flex items-center gap-3">
              {hasUnsavedChanges && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-[#FF6B35] rounded-full animate-pulse" />
                  <span className="text-sm text-[#9CA3AF]">Unsaved changes</span>
                </div>
              )}
              <Input
                value={routineName}
                onChange={(e) => {
                  setRoutineName(e.target.value);
                  setHasUnsavedChanges(true);
                }}
                className="text-xl font-semibold bg-transparent border-none text-white focus-visible:ring-0 w-64 text-center"
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-[#FF6B35]"
              >
                <Eye className="w-4 h-4 mr-2" />
                Preview
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Routine
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Exercise List */}
          <div className="lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">Exercises</h2>
                <p className="text-sm text-[#9CA3AF]">
                  {exercises.length} exercises • ~{Math.round(totalDuration)} min
                </p>
              </div>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={exercises.map((ex) => ex.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {exercises.map((exercise) => (
                    <SortableExerciseItem
                      key={exercise.id}
                      exercise={exercise}
                      isSelected={selectedExercise === exercise.id}
                      onSelect={() => setSelectedExercise(exercise.id)}
                      onDelete={() => handleDeleteExercise(exercise.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <Button
              onClick={() => setShowExercisePicker(true)}
              variant="outline"
              className="w-full mt-4 border-dashed border-2 border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-[#FF6B35]"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Exercise
            </Button>
          </div>

          {/* Right: Exercise Detail Panel */}
          <div className="lg:col-span-1">
            <AnimatePresence mode="wait">
              {selectedExercise ? (
                <ExerciseDetailPanel
                  exercise={exercises.find((ex) => ex.id === selectedExercise)!}
                  onUpdate={(updated) => {
                    setExercises(
                      exercises.map((ex) =>
                        ex.id === selectedExercise ? { ...ex, ...updated } : ex
                      )
                    );
                    setHasUnsavedChanges(true);
                  }}
                  onClose={() => setSelectedExercise(null)}
                />
              ) : (
                <EmptyDetailPanel />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Exercise Picker Modal */}
      <AnimatePresence>
        {showExercisePicker && (
          <ExercisePickerModal
            onClose={() => setShowExercisePicker(false)}
            onSelect={(exercise) => {
              const newExercise: Exercise = {
                id: Date.now().toString(),
                ...exercise,
                sets: 3,
                reps: 10,
                weight: 0,
                rest: 90,
                mode: 'Old School',
              };
              setExercises([...exercises, newExercise]);
              setShowExercisePicker(false);
              setHasUnsavedChanges(true);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SortableExerciseItem({
  exercise,
  isSelected,
  onSelect,
  onDelete,
}: {
  exercise: Exercise;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: exercise.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const getMuscleGroupColor = (group: string) => {
    const colors: Record<string, string> = {
      Chest: 'bg-[#FF6B35]',
      Back: 'bg-[#10B981]',
      Shoulders: 'bg-[#F59E0B]',
      Legs: 'bg-[#DC2626]',
      Arms: 'bg-[#FBBF24]',
    };
    return colors[group] || 'bg-[#6B7280]';
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card
        onClick={onSelect}
        className={`p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] hover:border-[#FF6B35]/50 cursor-pointer transition-all ${
          isSelected ? 'border-[#FF6B35] ring-1 ring-[#FF6B35]' : ''
        }`}
      >
        <div className="flex items-center gap-3">
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-[#6B7280] hover:text-[#9CA3AF]"
          >
            <GripVertical className="w-5 h-5" />
          </button>

          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-white">{exercise.name}</h3>
              <Badge className={`${getMuscleGroupColor(exercise.muscleGroup)} text-white border-0 text-xs`}>
                {exercise.muscleGroup}
              </Badge>
            </div>
            <p className="text-sm text-[#9CA3AF]">
              {exercise.sets} sets • {exercise.reps} reps • {exercise.weight} kg • {exercise.mode}
            </p>
            <p className="text-xs text-[#6B7280] mt-1">Rest: {exercise.rest}s between sets</p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onSelect();
              }}
              className="border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-[#FF6B35]"
            >
              <Edit className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="border-[#374151] text-[#EF4444] hover:border-[#EF4444]"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ExerciseDetailPanel({
  exercise,
  onUpdate,
  onClose,
}: {
  exercise: Exercise;
  onUpdate: (updates: Partial<Exercise>) => void;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
    >
      <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] sticky top-24">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-white">Exercise Settings</h3>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            className="text-[#9CA3AF] hover:text-white"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-6">
          {/* Sets Configuration */}
          <div>
            <label className="text-sm font-medium text-[#E5E7EB] mb-3 block">Sets</label>
            <div className="space-y-2">
              {Array.from({ length: exercise.sets }).map((_, i) => (
                <div key={i} className="grid grid-cols-3 gap-2 text-sm">
                  <Input
                    type="number"
                    value={exercise.reps}
                    onChange={(e) => onUpdate({ reps: parseInt(e.target.value) })}
                    className="bg-[#0D0D0D] border-[#374151] text-white"
                    placeholder="Reps"
                  />
                  <Input
                    type="number"
                    value={exercise.weight}
                    onChange={(e) => onUpdate({ weight: parseInt(e.target.value) })}
                    className="bg-[#0D0D0D] border-[#374151] text-white"
                    placeholder="kg"
                  />
                  <Input
                    type="number"
                    value={exercise.rest}
                    onChange={(e) => onUpdate({ rest: parseInt(e.target.value) })}
                    className="bg-[#0D0D0D] border-[#374151] text-white"
                    placeholder="Rest"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onUpdate({ sets: exercise.sets + 1 })}
                className="border-[#374151] text-[#9CA3AF] flex-1"
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Set
              </Button>
              {exercise.sets > 1 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onUpdate({ sets: exercise.sets - 1 })}
                  className="border-[#374151] text-[#EF4444] flex-1"
                >
                  Remove Set
                </Button>
              )}
            </div>
          </div>

          {/* Training Mode */}
          <div>
            <label className="text-sm font-medium text-[#E5E7EB] mb-2 block">
              Training Mode
            </label>
            <select
              value={exercise.mode}
              onChange={(e) => onUpdate({ mode: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-[#0D0D0D] border border-[#374151] text-white text-sm focus:border-[#FF6B35] focus:outline-none"
            >
              <option>Old School</option>
              <option>Pump</option>
              <option>TUT</option>
              <option>TUT Beast</option>
              <option>Eccentric Only</option>
              <option>Echo</option>
            </select>
            <p className="text-xs text-[#6B7280] mt-1">Traditional resistance training</p>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function EmptyDetailPanel() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] sticky top-24">
        <div className="text-center py-12">
          <Dumbbell className="w-12 h-12 text-[#6B7280] mx-auto mb-4" />
          <p className="text-[#9CA3AF]">Select an exercise to configure</p>
        </div>
      </Card>
    </motion.div>
  );
}

function ExercisePickerModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (exercise: { name: string; muscleGroup: string }) => void;
}) {
  const exercises = [
    { name: 'Bench Press', muscleGroup: 'Chest' },
    { name: 'Squat', muscleGroup: 'Legs' },
    { name: 'Deadlift', muscleGroup: 'Back' },
    { name: 'Overhead Press', muscleGroup: 'Shoulders' },
    { name: 'Barbell Row', muscleGroup: 'Back' },
    { name: 'Pull-ups', muscleGroup: 'Back' },
  ];

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="fixed inset-4 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-2xl bg-[#0D0D0D] rounded-lg border border-[#374151] z-50 overflow-hidden"
      >
        <div className="p-6 border-b border-[#374151]">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Add Exercise</h2>
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="p-6 max-h-96 overflow-y-auto">
          <div className="space-y-2">
            {exercises.map((exercise) => (
              <button
                key={exercise.name}
                onClick={() => onSelect(exercise)}
                className="w-full p-4 rounded-lg bg-[#1a1a1a] border border-[#374151] hover:border-[#FF6B35] transition-all text-left"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-white mb-1">{exercise.name}</h4>
                    <Badge className="bg-[#FF6B35] text-white border-0 text-xs">
                      {exercise.muscleGroup}
                    </Badge>
                  </div>
                  <Plus className="w-5 h-5 text-[#9CA3AF]" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </>
  );
}
