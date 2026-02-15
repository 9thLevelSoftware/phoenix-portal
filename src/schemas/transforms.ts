import { z } from 'zod';

// Per-cable to total weight conversion
// Vitruvian has dual cables; DB stores per-cable, portal shows total
// Change to 1 if DB convention changes to store total
const WEIGHT_MULTIPLIER = 2;
const weightTransform = z.number().transform((perCable) => perCable * WEIGHT_MULTIPLIER);

// Workout mode mapping from DB enum values to friendly display names
const workoutModeMap: Record<string, string> = {
  OLD_SCHOOL: 'Old School',
  ECHO: 'Echo',
  PUMP: 'Pump',
  POWER: 'Power',
  CLASSIC: 'Old School', // Android alias
};

const workoutModeSchema = z
  .string()
  .nullable()
  .transform((mode) => (mode ? (workoutModeMap[mode] ?? mode) : null));

// --- Workout Session ---

export const workoutSessionSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string(),
  started_at: z.string().transform((s) => new Date(s)),
  duration_seconds: z.number().transform((s) => Math.round(s / 60)), // output as minutes
  total_volume: weightTransform,
  set_count: z.number(),
  exercise_count: z.number(),
  pr_count: z.number(),
  routine_name: z.string().nullable(),
  workout_mode: workoutModeSchema,
});

export const workoutListSchema = z.array(workoutSessionSchema);

export type WorkoutSession = z.infer<typeof workoutSessionSchema>;

// --- Exercise ---

export const exerciseSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  name: z.string(),
  muscle_group: z.string(),
  order_index: z.number(),
});

export type Exercise = z.infer<typeof exerciseSchema>;

// --- Set ---

export const setSchema = z.object({
  id: z.string().uuid(),
  exercise_id: z.string().uuid(),
  set_number: z.number(),
  target_reps: z.number(),
  actual_reps: z.number(),
  weight_kg: weightTransform,
  rpe: z.number().nullable(),
  is_pr: z.boolean(),
  notes: z.string().nullable(),
});

export type WorkoutSet = z.infer<typeof setSchema>;

// --- Personal Record ---

export const personalRecordSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  exercise_name: z.string(),
  muscle_group: z.string(),
  record_type: z.string(),
  value: weightTransform,
  unit: z.string(),
  achieved_at: z.string().transform((s) => new Date(s)),
  previous_value: z
    .number()
    .nullable()
    .transform((v) => (v !== null ? v * WEIGHT_MULTIPLIER : null)),
});

export const personalRecordListSchema = z.array(personalRecordSchema);

export type PersonalRecord = z.infer<typeof personalRecordSchema>;

// --- Routine ---

export const routineSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  exercise_count: z.number(),
  estimated_duration: z.number(),
  times_completed: z.number(),
  last_used_at: z
    .string()
    .nullable()
    .transform((s) => (s ? new Date(s) : null)),
  tags: z.array(z.string()).nullable(),
  is_favorite: z.boolean(),
});

export const routineListSchema = z.array(routineSchema);

export type Routine = z.infer<typeof routineSchema>;

// --- Training Cycle ---

export const trainingCycleSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string(),
  duration_weeks: z.number(),
  current_week: z.number(),
  status: z.enum(['active', 'completed', 'draft']),
  workout_days: z.number(),
  rest_days: z.number(),
  last_used_at: z
    .string()
    .nullable()
    .transform((s) => (s ? new Date(s) : null)),
});

export const trainingCycleListSchema = z.array(trainingCycleSchema);

export type TrainingCycle = z.infer<typeof trainingCycleSchema>;

// --- Analytics Summary ---

export const analyticsSummarySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  period: z.string(),
  total_workouts: z.number(),
  total_volume: weightTransform,
  total_duration: z.number(),
  avg_session_duration: z.number(),
  streak_days: z.number(),
  computed_at: z.string().transform((s) => new Date(s)),
});

export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;
