import { z } from "zod";

// Per-cable to total weight conversion (independent copy -- see transforms.ts rationale)
const WEIGHT_MULTIPLIER = 2;
const weightTransform = z
	.number()
	.transform((perCable) => perCable * WEIGHT_MULTIPLIER);

// Nullable per-cable weight: applies the same x2 display multiplier, but
// preserves null/absent (legacy rows with no velocity-based 1RM) as null so the
// UI can hide the metric entirely.
const nullableWeightTransform = z
	.number()
	.nullable()
	.optional()
	.transform((perCable) =>
		perCable == null ? null : perCable * WEIGHT_MULTIPLIER,
	);

// --- Telemetry Point ---

// Cable canonical wire format: "A" | "B" (BLE convention, mobile authoritative).
// Cable A = left actuator, Cable B = right actuator. Use cableDisplayName()
// from src/lib/telemetry-display.ts for UI presentation.
// Resolves audit item #4 (2026-04-19).
export const telemetryPointSchema = z.object({
	timestamp_ms: z.number().finite().nonnegative(),
	force_n: z.number().finite(),
	velocity_mps: z.number().finite(),
	position_mm: z.number().finite(),
	cable: z.enum(["A", "B"]),
});

export type TelemetryPointRow = z.infer<typeof telemetryPointSchema>;

// --- Rep Summary ---

export const repSummarySchema = z.object({
	id: z.string().uuid(),
	set_id: z.string().uuid(),
	rep_number: z.number().int().nonnegative(),
	mean_velocity_mps: z.number().finite(),
	peak_velocity_mps: z.number().finite(),
	mean_force_n: z.number().finite(),
	peak_force_n: z.number().finite(),
	power_watts: z.number().finite(),
	rom_mm: z.number().finite().nonnegative(),
	tut_ms: z.number().finite().nonnegative(),
	left_force_avg: z.number().finite(),
	right_force_avg: z.number().finite(),
	asymmetry_pct: z.number().finite(),
	vbt_zone: z.string(),
});

export type RepSummary = z.infer<typeof repSummarySchema>;

// --- Exercise Progress ---

export const exerciseProgressSchema = z.object({
	id: z.string().uuid(),
	user_id: z.string().uuid(),
	exercise_name: z.string(),
	session_id: z.string().uuid(),
	recorded_at: z.coerce.date(),
	max_weight_kg: weightTransform,
	total_volume_kg: weightTransform,
	estimated_1rm_kg: weightTransform,
	// Velocity-based (VBT) 1RM — distinct from the rep-based estimated_1rm_kg.
	// Nullable; null when the row predates VBT capture. Issue #517 Phase 6.
	velocity_estimated_1rm_kg: nullableWeightTransform,
	max_reps: z.number().finite().nonnegative(),
	set_count: z.number().finite().nonnegative(),
});

export type ExerciseProgress = z.infer<typeof exerciseProgressSchema>;
