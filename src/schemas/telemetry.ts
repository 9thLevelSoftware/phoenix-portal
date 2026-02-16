import { z } from 'zod';

// Per-cable to total weight conversion (independent copy -- see transforms.ts rationale)
const WEIGHT_MULTIPLIER = 2;
const weightTransform = z.number().transform((perCable) => perCable * WEIGHT_MULTIPLIER);

// --- Telemetry Point ---

export const telemetryPointSchema = z.object({
  timestamp_ms: z.number(),
  force_n: z.number(),
  velocity_mps: z.number(),
  position_mm: z.number(),
  cable: z.enum(['left', 'right']),
});

export type TelemetryPointRow = z.infer<typeof telemetryPointSchema>;

// --- Rep Summary ---

export const repSummarySchema = z.object({
  id: z.string().uuid(),
  set_id: z.string().uuid(),
  rep_number: z.number().int(),
  mean_velocity_mps: z.number(),
  peak_velocity_mps: z.number(),
  mean_force_n: z.number(),
  peak_force_n: z.number(),
  power_watts: z.number(),
  rom_mm: z.number(),
  tut_ms: z.number(),
  left_force_avg: z.number(),
  right_force_avg: z.number(),
  asymmetry_pct: z.number(),
  vbt_zone: z.string(),
});

export type RepSummary = z.infer<typeof repSummarySchema>;

// --- Exercise Progress ---

export const exerciseProgressSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  exercise_name: z.string(),
  session_id: z.string().uuid(),
  recorded_at: z.string().transform((s) => new Date(s)),
  max_weight_kg: weightTransform,
  total_volume_kg: weightTransform,
  estimated_1rm_kg: weightTransform,
  max_reps: z.number(),
  set_count: z.number(),
});

export type ExerciseProgress = z.infer<typeof exerciseProgressSchema>;
