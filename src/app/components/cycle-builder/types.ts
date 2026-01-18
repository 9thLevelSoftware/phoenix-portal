// Training Cycle Builder Type Definitions

export interface TrainingCycle {
  id: string;
  name: string;
  description: string;
  days: CycleDay[];
  progressionType: 'percentage' | 'fixed' | 'manual';
  progressionConfig: ProgressionConfig;
  deloadEnabled: boolean;
  deloadConfig?: DeloadConfig;
  createdAt: Date;
  updatedAt: Date;
}

export interface CycleDay {
  dayNumber: number;
  type: 'workout' | 'rest';
  routineId?: string;
  routineName?: string;
  exerciseCount?: number;
  duration?: number;
  overrides?: DayOverrides;
  notes?: string;
  restType?: 'complete' | 'active' | 'mobility';
}

export interface DayOverrides {
  weightAdjustment: number; // percentage, e.g., -10 or +5
  repModifier: number; // e.g., -2 or +2
  restTimeOverride?: number; // seconds
}

export interface ProgressionConfig {
  percentageIncrease?: number;
  cycleFrequency?: number;
  trigger?: 'all_sets' | 'target_rpe' | 'cycle_complete';
  upperBodyIncrement?: number;
  lowerBodyIncrement?: number;
}

export interface DeloadConfig {
  frequencyWeeks: number;
  intensityPercent: number;
  volumePercent: number;
}

export interface Routine {
  id: string;
  name: string;
  exercises: number;
  duration: number;
  muscleGroup: string;
  lastUsed?: Date;
}
