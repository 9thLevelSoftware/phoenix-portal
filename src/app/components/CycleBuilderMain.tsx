import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Badge } from '@/app/components/ui/badge';
import { ChevronLeft, Save, Eye } from 'lucide-react';
import { CycleOverview } from './cycle-builder/CycleOverview';
import { DaySchedule } from './cycle-builder/DaySchedule';
import { DayEditor } from './cycle-builder/DayEditor';
import { RoutinePicker } from './cycle-builder/RoutinePicker';
import { ProgressionRules } from './cycle-builder/ProgressionRules';
import { WeekOverview } from './cycle-builder/WeekOverview';
import { TrainingCycle, CycleDay, DayOverrides, ProgressionConfig, DeloadConfig, Routine } from './cycle-builder/types';

interface CycleBuilderProps {
  cycleId?: string;
  onSave: (cycle: TrainingCycle) => void;
  onCancel: () => void;
}

export function CycleBuilderMain({ cycleId, onSave, onCancel }: CycleBuilderProps) {
  const [cycleName, setCycleName] = useState('Untitled Cycle');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState(7);
  const [startDate, setStartDate] = useState('');
  const [days, setDays] = useState<CycleDay[]>([
    { dayNumber: 1, type: 'workout' },
    { dayNumber: 2, type: 'workout' },
    { dayNumber: 3, type: 'rest', restType: 'complete' },
    { dayNumber: 4, type: 'workout' },
    { dayNumber: 5, type: 'workout' },
    { dayNumber: 6, type: 'rest', restType: 'complete' },
    { dayNumber: 7, type: 'rest', restType: 'complete' },
  ]);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showRoutinePicker, setShowRoutinePicker] = useState(false);
  const [progressionType, setProgressionType] = useState<'percentage' | 'fixed' | 'manual'>('percentage');
  const [progressionConfig, setProgressionConfig] = useState<ProgressionConfig>({
    percentageIncrease: 2.5,
    cycleFrequency: 1,
    trigger: 'target_rpe',
  });
  const [deloadEnabled, setDeloadEnabled] = useState(true);
  const [deloadConfig, setDeloadConfig] = useState<DeloadConfig>({
    frequencyWeeks: 4,
    intensityPercent: 60,
    volumePercent: 50,
  });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Mock routines
  const mockRoutines: Routine[] = [
    { id: '1', name: 'Push Day A', exercises: 6, duration: 60, muscleGroup: 'Push', lastUsed: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
    { id: '2', name: 'Pull Day A', exercises: 5, duration: 55, muscleGroup: 'Pull', lastUsed: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
    { id: '3', name: 'Leg Day', exercises: 7, duration: 70, muscleGroup: 'Legs' },
    { id: '4', name: 'Push Day B', exercises: 6, duration: 60, muscleGroup: 'Push' },
    { id: '5', name: 'Upper Power', exercises: 8, duration: 65, muscleGroup: 'Upper' },
  ];

  // Auto-adjust days when duration changes
  useEffect(() => {
    if (duration !== days.length) {
      if (duration > days.length) {
        const newDays = [...days];
        for (let i = days.length; i < duration; i++) {
          newDays.push({ dayNumber: i + 1, type: 'workout' });
        }
        setDays(newDays);
      } else {
        setDays(days.slice(0, duration).map((d, i) => ({ ...d, dayNumber: i + 1 })));
      }
      setHasUnsavedChanges(true);
    }
  }, [duration]);

  const handleCancel = () => {
    if (hasUnsavedChanges) {
      if (confirm('You have unsaved changes. Are you sure you want to leave?')) {
        onCancel();
      }
    } else {
      onCancel();
    }
  };

  const handleSave = () => {
    const cycle: TrainingCycle = {
      id: cycleId || `cycle-${Date.now()}`,
      name: cycleName,
      description,
      days,
      progressionType,
      progressionConfig,
      deloadEnabled,
      deloadConfig: deloadEnabled ? deloadConfig : undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    onSave(cycle);
  };

  const handleDayClick = (dayNumber: number) => {
    setSelectedDay(dayNumber);
  };

  const handleSetRestDay = (dayNumber: number) => {
    setDays(days.map((d) =>
      d.dayNumber === dayNumber
        ? { ...d, type: 'rest', restType: 'complete', routineId: undefined, routineName: undefined }
        : d
    ));
    setHasUnsavedChanges(true);
  };

  const handleAddDay = () => {
    setDays([...days, { dayNumber: days.length + 1, type: 'workout' }]);
    setDuration(days.length + 1);
    setHasUnsavedChanges(true);
  };

  const handleRemoveDay = (dayNumber: number) => {
    if (days.length <= 1) return;
    setDays(days.filter((d) => d.dayNumber !== dayNumber).map((d, i) => ({ ...d, dayNumber: i + 1 })));
    setDuration(days.length - 1);
    setHasUnsavedChanges(true);
    if (selectedDay === dayNumber) setSelectedDay(null);
  };

  const handleAssignRoutine = (routineId: string) => {
    const routine = mockRoutines.find((r) => r.id === routineId);
    if (routine && selectedDay) {
      setDays(days.map((d) =>
        d.dayNumber === selectedDay
          ? {
              ...d,
              type: 'workout',
              routineId: routine.id,
              routineName: routine.name,
              exerciseCount: routine.exercises,
              duration: routine.duration,
            }
          : d
      ));
      setHasUnsavedChanges(true);
      setShowRoutinePicker(false);
    }
  };

  const selectedDayData = days.find((d) => d.dayNumber === selectedDay);

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-8">
      {/* Sticky Top Bar */}
      <div className="sticky top-0 z-40 bg-[#0D0D0D]/95 backdrop-blur-lg border-b border-[#374151] px-4 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              className="text-[#9CA3AF] hover:text-white flex-shrink-0"
            >
              <ChevronLeft className="w-5 h-5 mr-1" />
              Cancel
            </Button>

            <Input
              value={cycleName}
              onChange={(e) => {
                setCycleName(e.target.value);
                setHasUnsavedChanges(true);
              }}
              className="text-xl font-semibold bg-transparent border-none focus:ring-0 max-w-md"
              placeholder="Cycle Name"
            />

            {hasUnsavedChanges && (
              <Badge variant="outline" className="bg-[#F59E0B]/20 text-[#F59E0B] border-[#F59E0B]/30 flex-shrink-0">
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
              Save Cycle
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Section 1: Cycle Overview */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <CycleOverview
            name={cycleName}
            description={description}
            duration={duration}
            startDate={startDate}
            onNameChange={(name) => {
              setCycleName(name);
              setHasUnsavedChanges(true);
            }}
            onDescriptionChange={(desc) => {
              setDescription(desc);
              setHasUnsavedChanges(true);
            }}
            onDurationChange={(dur) => {
              setDuration(dur);
              setHasUnsavedChanges(true);
            }}
            onStartDateChange={(date) => {
              setStartDate(date);
              setHasUnsavedChanges(true);
            }}
          />
        </motion.div>

        {/* Section 2: Day Schedule */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <DaySchedule
            days={days}
            selectedDay={selectedDay}
            onDayClick={handleDayClick}
            onSetRestDay={handleSetRestDay}
            onAddDay={handleAddDay}
            onRemoveDay={handleRemoveDay}
          />
        </motion.div>

        {/* Section 3: Progression Rules */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <ProgressionRules
            progressionType={progressionType}
            progressionConfig={progressionConfig}
            deloadEnabled={deloadEnabled}
            deloadConfig={deloadConfig}
            onProgressionTypeChange={(type) => {
              setProgressionType(type);
              setHasUnsavedChanges(true);
            }}
            onProgressionConfigChange={(config) => {
              setProgressionConfig(config);
              setHasUnsavedChanges(true);
            }}
            onDeloadEnabledChange={(enabled) => {
              setDeloadEnabled(enabled);
              setHasUnsavedChanges(true);
            }}
            onDeloadConfigChange={(config) => {
              setDeloadConfig(config);
              setHasUnsavedChanges(true);
            }}
          />
        </motion.div>

        {/* Section 4: Week Overview */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <WeekOverview days={days} />
        </motion.div>
      </div>

      {/* Day Editor Panel */}
      {selectedDay && selectedDayData && (
        <DayEditor
          day={selectedDayData}
          onClose={() => setSelectedDay(null)}
          onAssignRoutine={() => setShowRoutinePicker(true)}
          onConvertToRest={() => {
            handleSetRestDay(selectedDay);
            setSelectedDay(null);
          }}
          onConvertToWorkout={() => {
            setDays(days.map((d) =>
              d.dayNumber === selectedDay
                ? { ...d, type: 'workout', routineId: undefined, routineName: undefined }
                : d
            ));
            setHasUnsavedChanges(true);
          }}
          onUpdateOverrides={(overrides: DayOverrides) => {
            setDays(days.map((d) => (d.dayNumber === selectedDay ? { ...d, overrides } : d)));
            setHasUnsavedChanges(true);
          }}
          onUpdateNotes={(notes: string) => {
            setDays(days.map((d) => (d.dayNumber === selectedDay ? { ...d, notes } : d)));
            setHasUnsavedChanges(true);
          }}
          onUpdateRestType={(type: 'complete' | 'active' | 'mobility') => {
            setDays(days.map((d) => (d.dayNumber === selectedDay ? { ...d, restType: type } : d)));
            setHasUnsavedChanges(true);
          }}
          onRemoveFromSchedule={() => {
            handleRemoveDay(selectedDay);
          }}
        />
      )}

      {/* Routine Picker Modal */}
      <RoutinePicker
        isOpen={showRoutinePicker}
        onClose={() => setShowRoutinePicker(false)}
        routines={mockRoutines}
        onSelect={handleAssignRoutine}
        onCreateNew={() => {
          setShowRoutinePicker(false);
          alert('Routine Builder would open here');
        }}
      />
    </div>
  );
}
