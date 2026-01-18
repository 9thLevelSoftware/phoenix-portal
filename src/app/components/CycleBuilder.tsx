import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Textarea } from '@/app/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';
import { Switch } from '@/app/components/ui/switch';
import { Calendar, ChevronLeft, Plus, Edit2, X, Save, Eye, AlertCircle, Dumbbell } from 'lucide-react';

interface CycleBuilderProps {
  cycleId?: string;
  onBack: () => void;
  onSave: (cycle: any) => void;
}

interface DayConfig {
  dayNumber: number;
  type: 'workout' | 'rest';
  routineId?: string;
  routineName?: string;
  exerciseCount?: number;
  duration?: number;
  weightAdjustment?: number;
  repModifier?: number;
  restOverride?: number;
  notes?: string;
  restType?: 'complete' | 'active' | 'mobility';
}

export function CycleBuilder({ cycleId, onBack, onSave }: CycleBuilderProps) {
  const [cycleName, setCycleName] = useState('Untitled Cycle');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState(7);
  const [startDate, setStartDate] = useState<string>('');
  const [days, setDays] = useState<DayConfig[]>([
    { dayNumber: 1, type: 'workout' },
    { dayNumber: 2, type: 'workout' },
    { dayNumber: 3, type: 'rest', restType: 'complete' },
    { dayNumber: 4, type: 'workout' },
    { dayNumber: 5, type: 'workout' },
    { dayNumber: 6, type: 'rest', restType: 'complete' },
    { dayNumber: 7, type: 'rest', restType: 'complete' },
  ]);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showRoutinePicker, setShowRoutinePicker] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Progression settings
  const [progressionType, setProgressionType] = useState<'percentage' | 'fixed' | 'manual'>('percentage');
  const [progressionAmount, setProgressionAmount] = useState(2.5);
  const [progressionFrequency, setProgressionFrequency] = useState(1);
  const [progressionTrigger, setProgressionTrigger] = useState<'all-sets' | 'target-rpe' | 'cycle-complete'>('target-rpe');
  const [upperBodyIncrement, setUpperBodyIncrement] = useState(2.5);
  const [lowerBodyIncrement, setLowerBodyIncrement] = useState(5.0);
  const [includeDeload, setIncludeDeload] = useState(true);
  const [deloadFrequency, setDeloadFrequency] = useState(4);
  const [deloadIntensity, setDeloadIntensity] = useState(60);
  const [deloadVolume, setDeloadVolume] = useState(50);

  // Mock routines for selection
  const mockRoutines = [
    { id: '1', name: 'Push Day A', exercises: 6, duration: 60, muscleGroup: 'Push' },
    { id: '2', name: 'Pull Day A', exercises: 5, duration: 55, muscleGroup: 'Pull' },
    { id: '3', name: 'Leg Day', exercises: 7, duration: 70, muscleGroup: 'Legs' },
    { id: '4', name: 'Push Day B', exercises: 6, duration: 60, muscleGroup: 'Push' },
    { id: '5', name: 'Upper Body', exercises: 8, duration: 65, muscleGroup: 'Upper' },
  ];

  const handleCancel = () => {
    if (hasUnsavedChanges) {
      if (confirm('You have unsaved changes. Are you sure you want to leave?')) {
        onBack();
      }
    } else {
      onBack();
    }
  };

  const handleSave = () => {
    const cycle = {
      name: cycleName,
      description,
      duration,
      startDate,
      days,
      progression: {
        type: progressionType,
        amount: progressionAmount,
        frequency: progressionFrequency,
        trigger: progressionTrigger,
        upperIncrement: upperBodyIncrement,
        lowerIncrement: lowerBodyIncrement,
      },
      deload: includeDeload ? {
        frequency: deloadFrequency,
        intensity: deloadIntensity,
        volume: deloadVolume,
      } : null,
    };
    onSave(cycle);
  };

  const handleDayClick = (dayNumber: number) => {
    setSelectedDay(dayNumber);
  };

  const handleAssignRoutine = (dayNumber: number, routineId: string) => {
    const routine = mockRoutines.find(r => r.id === routineId);
    if (routine) {
      setDays(days.map(day =>
        day.dayNumber === dayNumber
          ? {
              ...day,
              type: 'workout',
              routineId: routine.id,
              routineName: routine.name,
              exerciseCount: routine.exercises,
              duration: routine.duration,
            }
          : day
      ));
      setHasUnsavedChanges(true);
      setShowRoutinePicker(false);
    }
  };

  const handleSetRestDay = (dayNumber: number) => {
    setDays(days.map(day =>
      day.dayNumber === dayNumber
        ? { ...day, type: 'rest', restType: 'complete', routineId: undefined, routineName: undefined }
        : day
    ));
    setHasUnsavedChanges(true);
  };

  const handleAddDay = () => {
    const newDay: DayConfig = {
      dayNumber: days.length + 1,
      type: 'workout',
    };
    setDays([...days, newDay]);
    setDuration(days.length + 1);
    setHasUnsavedChanges(true);
  };

  const handleRemoveDay = (dayNumber: number) => {
    if (days.length <= 1) return;
    setDays(days.filter(d => d.dayNumber !== dayNumber).map((d, i) => ({ ...d, dayNumber: i + 1 })));
    setDuration(days.length - 1);
    setHasUnsavedChanges(true);
  };

  const selectedDayData = days.find(d => d.dayNumber === selectedDay);

  const workoutDays = days.filter(d => d.type === 'workout').length;
  const restDays = days.filter(d => d.type === 'rest').length;

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-8">
      {/* Sticky Top Bar */}
      <div className="sticky top-0 z-40 bg-[#0D0D0D]/95 backdrop-blur-lg border-b border-[#374151] px-4 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4 flex-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              className="text-[#9CA3AF] hover:text-white"
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
              <Badge variant="outline" className="bg-[#F59E0B]/20 text-[#F59E0B] border-[#F59E0B]/30">
                ● Unsaved
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => setShowPreview(true)}
              className="border-[#374151] hover:border-[#FF6B35]"
            >
              <Eye className="w-4 h-4 mr-2" />
              Preview
            </Button>
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
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
            <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#FF6B35]" />
              Cycle Details
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label className="text-[#E5E7EB] mb-2">Cycle Name</Label>
                <Input
                  value={cycleName}
                  onChange={(e) => {
                    setCycleName(e.target.value);
                    setHasUnsavedChanges(true);
                  }}
                  className="bg-[#0D0D0D] border-[#374151]"
                  placeholder="e.g., 12-Week Strength Builder"
                />
              </div>

              <div>
                <Label className="text-[#E5E7EB] mb-2">Duration (Days)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={duration}
                    onChange={(e) => {
                      setDuration(parseInt(e.target.value) || 7);
                      setHasUnsavedChanges(true);
                    }}
                    className="bg-[#0D0D0D] border-[#374151] w-24"
                    min="1"
                  />
                  <div className="flex gap-2">
                    {[3, 4, 5, 6, 7].map((num) => (
                      <Button
                        key={num}
                        size="sm"
                        variant={duration === num ? 'default' : 'outline'}
                        onClick={() => {
                          setDuration(num);
                          setHasUnsavedChanges(true);
                        }}
                        className={duration === num ? 'bg-[#FF6B35] border-0' : 'border-[#374151]'}
                      >
                        {num}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="md:col-span-2">
                <Label className="text-[#E5E7EB] mb-2">Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setHasUnsavedChanges(true);
                  }}
                  className="bg-[#0D0D0D] border-[#374151] min-h-[80px]"
                  placeholder="Describe your training cycle goals and approach..."
                />
              </div>

              <div>
                <Label className="text-[#E5E7EB] mb-2">Start Date (Optional)</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setHasUnsavedChanges(true);
                  }}
                  className="bg-[#0D0D0D] border-[#374151]"
                />
                <p className="text-xs text-[#6B7280] mt-1">Leave blank to start anytime</p>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Section 2: Day Schedule */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Dumbbell className="w-5 h-5 text-[#FF6B35]" />
                Workout Schedule
              </h2>
              <Button
                size="sm"
                onClick={handleAddDay}
                className="bg-[#FF6B35] hover:bg-[#DC2626] border-0"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Day
              </Button>
            </div>

            {/* Horizontal Scrollable Day Cards */}
            <div className="overflow-x-auto pb-4 -mx-2 px-2">
              <div className="flex gap-4 min-w-max">
                {days.map((day) => (
                  <DayCard
                    key={day.dayNumber}
                    day={day}
                    onClick={() => handleDayClick(day.dayNumber)}
                    onRemove={() => handleRemoveDay(day.dayNumber)}
                    isSelected={selectedDay === day.dayNumber}
                  />
                ))}
              </div>
            </div>

            <p className="text-sm text-[#6B7280] mt-4 text-center">
              Click a day to configure • Scroll horizontally for more days
            </p>
          </Card>
        </motion.div>

        {/* Day Editor Side Panel (Inline) */}
        <AnimatePresence>
          {selectedDay && selectedDayData && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <DayEditorPanel
                day={selectedDayData}
                onClose={() => setSelectedDay(null)}
                onAssignRoutine={() => setShowRoutinePicker(true)}
                onSetRestDay={() => handleSetRestDay(selectedDay)}
                onUpdate={(updates) => {
                  setDays(days.map(d =>
                    d.dayNumber === selectedDay ? { ...d, ...updates } : d
                  ));
                  setHasUnsavedChanges(true);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Section 3: Progression Rules */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <ProgressionRules
            progressionType={progressionType}
            onProgressionTypeChange={setProgressionType}
            progressionAmount={progressionAmount}
            onProgressionAmountChange={setProgressionAmount}
            progressionFrequency={progressionFrequency}
            onProgressionFrequencyChange={setProgressionFrequency}
            progressionTrigger={progressionTrigger}
            onProgressionTriggerChange={setProgressionTrigger}
            upperBodyIncrement={upperBodyIncrement}
            onUpperBodyIncrementChange={setUpperBodyIncrement}
            lowerBodyIncrement={lowerBodyIncrement}
            onLowerBodyIncrementChange={setLowerBodyIncrement}
            includeDeload={includeDeload}
            onIncludeDeloadChange={setIncludeDeload}
            deloadFrequency={deloadFrequency}
            onDeloadFrequencyChange={setDeloadFrequency}
            deloadIntensity={deloadIntensity}
            onDeloadIntensityChange={setDeloadIntensity}
            deloadVolume={deloadVolume}
            onDeloadVolumeChange={setDeloadVolume}
            onSettingsChange={() => setHasUnsavedChanges(true)}
          />
        </motion.div>

        {/* Section 4: Week Overview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
            <h2 className="text-xl font-semibold text-white mb-6">Week at a Glance</h2>

            <div className="grid grid-cols-7 gap-2 mb-6">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayName, i) => {
                const day = days[i];
                return (
                  <div key={dayName} className="text-center">
                    <div className="text-xs text-[#9CA3AF] mb-2">{dayName}</div>
                    <div className={`h-16 rounded-lg flex items-center justify-center text-2xl ${
                      day?.type === 'workout'
                        ? 'bg-[#FF6B35]/20 border border-[#FF6B35]/30'
                        : 'bg-[#374151]/20 border border-[#374151]'
                    }`}>
                      {day?.type === 'workout' ? '🏋️' : '🛋️'}
                    </div>
                    <div className="text-xs text-[#6B7280] mt-1 truncate">
                      {day?.routineName || (day?.type === 'rest' ? 'REST' : '-')}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="text-sm text-[#E5E7EB] mb-4">
              📊 {workoutDays} workout days • {restDays} rest days
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Routine Picker Modal */}
      <RoutinePickerModal
        isOpen={showRoutinePicker}
        onClose={() => setShowRoutinePicker(false)}
        routines={mockRoutines}
        onSelect={(routineId) => selectedDay && handleAssignRoutine(selectedDay, routineId)}
      />

      {/* Preview Modal */}
      <PreviewModal
        isOpen={showPreview}
        onClose={() => setShowPreview(false)}
        cycle={{ name: cycleName, description, duration, days }}
      />
    </div>
  );
}

// Day Card Component
function DayCard({
  day,
  onClick,
  onRemove,
  isSelected,
}: {
  day: DayConfig;
  onClick: () => void;
  onRemove: () => void;
  isSelected: boolean;
}) {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={`relative min-w-[180px] cursor-pointer transition-all ${
        isSelected ? 'ring-2 ring-[#FF6B35]' : ''
      }`}
    >
      <Card
        onClick={onClick}
        className={`p-4 ${
          day.type === 'workout'
            ? 'bg-gradient-to-br from-[#FF6B35]/10 to-[#DC2626]/5 border-l-4 border-l-[#FF6B35]'
            : 'bg-gradient-to-br from-[#374151]/20 to-[#0D0D0D] border-[#374151]'
        }`}
      >
        <div className="text-center mb-3">
          <div className="text-sm font-semibold text-[#9CA3AF]">Day {day.dayNumber}</div>
        </div>

        {day.type === 'workout' && day.routineName ? (
          <div className="text-center space-y-2">
            <div className="text-2xl">🏋️</div>
            <div className="font-semibold text-white text-sm">{day.routineName}</div>
            <div className="text-xs text-[#9CA3AF]">
              {day.exerciseCount} ex. • ~{day.duration} min
            </div>
          </div>
        ) : day.type === 'workout' ? (
          <div className="text-center space-y-2">
            <div className="text-4xl text-[#6B7280]">+</div>
            <div className="text-xs text-[#9CA3AF]">Add Routine</div>
          </div>
        ) : (
          <div className="text-center space-y-2">
            <div className="text-2xl">🛋️</div>
            <div className="text-sm font-semibold text-[#9CA3AF]">REST</div>
          </div>
        )}

        {day.dayNumber > 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="absolute top-2 right-2 p-1 bg-[#EF4444]/20 hover:bg-[#EF4444]/40 rounded transition-colors"
          >
            <X className="w-3 h-3 text-[#EF4444]" />
          </button>
        )}
      </Card>
    </motion.div>
  );
}

// Day Editor Panel Component
function DayEditorPanel({
  day,
  onClose,
  onAssignRoutine,
  onSetRestDay,
  onUpdate,
}: {
  day: DayConfig;
  onClose: () => void;
  onAssignRoutine: () => void;
  onSetRestDay: () => void;
  onUpdate: (updates: Partial<DayConfig>) => void;
}) {
  return (
    <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-white">Day {day.dayNumber} Configuration</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      {day.type === 'workout' ? (
        <div className="space-y-6">
          {day.routineName ? (
            <div>
              <Label className="text-[#E5E7EB] mb-2">Assigned Routine</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 p-3 bg-[#0D0D0D] border border-[#374151] rounded-lg">
                  <div className="font-semibold text-white">{day.routineName}</div>
                  <div className="text-sm text-[#9CA3AF]">
                    {day.exerciseCount} exercises • ~{day.duration} min
                  </div>
                </div>
                <Button size="sm" onClick={onAssignRoutine} variant="outline" className="border-[#374151]">
                  Change
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Label className="text-[#E5E7EB] mb-2">Routine</Label>
              <Button onClick={onAssignRoutine} variant="outline" className="w-full border-[#374151]">
                <Plus className="w-4 h-4 mr-2" />
                Assign Routine
              </Button>
            </div>
          )}

          <div>
            <Label className="text-[#E5E7EB] mb-2">Day-Specific Overrides</Label>
            <p className="text-xs text-[#6B7280] mb-4">
              Optional - override routine defaults for this day only
            </p>

            <div className="space-y-4">
              <div>
                <Label className="text-sm text-[#9CA3AF] mb-2">Weight Adjustment (%)</Label>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onUpdate({ weightAdjustment: (day.weightAdjustment || 0) - 5 })}
                    className="border-[#374151]"
                  >
                    −
                  </Button>
                  <Input
                    type="number"
                    value={day.weightAdjustment || 0}
                    onChange={(e) => onUpdate({ weightAdjustment: parseInt(e.target.value) || 0 })}
                    className="text-center bg-[#0D0D0D] border-[#374151]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onUpdate({ weightAdjustment: (day.weightAdjustment || 0) + 5 })}
                    className="border-[#374151]"
                  >
                    +
                  </Button>
                </div>
              </div>

              <div>
                <Label className="text-sm text-[#9CA3AF] mb-2">Rep Modifier</Label>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onUpdate({ repModifier: (day.repModifier || 0) - 1 })}
                    className="border-[#374151]"
                  >
                    −
                  </Button>
                  <Input
                    type="number"
                    value={day.repModifier || 0}
                    onChange={(e) => onUpdate({ repModifier: parseInt(e.target.value) || 0 })}
                    className="text-center bg-[#0D0D0D] border-[#374151]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onUpdate({ repModifier: (day.repModifier || 0) + 1 })}
                    className="border-[#374151]"
                  >
                    +
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div>
            <Label className="text-[#E5E7EB] mb-2">Notes</Label>
            <Textarea
              value={day.notes || ''}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              className="bg-[#0D0D0D] border-[#374151]"
              placeholder="e.g., Focus on form, Deload week, etc."
            />
          </div>

          <Button
            onClick={onSetRestDay}
            variant="outline"
            className="w-full border-[#374151] text-[#9CA3AF]"
          >
            Convert to Rest Day
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="text-center py-4">
            <div className="text-4xl mb-2">🛋️</div>
            <div className="text-lg font-semibold text-white">Rest Day</div>
          </div>

          <div>
            <Label className="text-[#E5E7EB] mb-2">Rest Type</Label>
            <Select
              value={day.restType || 'complete'}
              onValueChange={(value: any) => onUpdate({ restType: value })}
            >
              <SelectTrigger className="bg-[#0D0D0D] border-[#374151]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="complete">Complete Rest</SelectItem>
                <SelectItem value="active">Active Recovery</SelectItem>
                <SelectItem value="mobility">Mobility/Stretching</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-[#E5E7EB] mb-2">Notes</Label>
            <Textarea
              value={day.notes || ''}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              className="bg-[#0D0D0D] border-[#374151]"
              placeholder="e.g., Light walk, foam rolling, yoga..."
            />
          </div>

          <Button
            onClick={onAssignRoutine}
            variant="outline"
            className="w-full border-[#FF6B35] text-[#FF6B35] hover:bg-[#FF6B35]/10"
          >
            Convert to Workout Day
          </Button>
        </div>
      )}
    </Card>
  );
}

// Progression Rules Component (continued in next file due to length)
function ProgressionRules({ ...props }: any) {
  return (
    <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
      <h2 className="text-xl font-semibold text-white mb-6">Progression Rules</h2>
      
      {/* Implementation continues - see next part */}
      <p className="text-[#9CA3AF]">Progression settings panel...</p>
    </Card>
  );
}

// Routine Picker Modal stub
function RoutinePickerModal({ isOpen, onClose, routines, onSelect }: any) {
  return null; // Will implement in next file
}

// Preview Modal stub
function PreviewModal({ isOpen, onClose, cycle }: any) {
  return null; // Will implement in next file
}
