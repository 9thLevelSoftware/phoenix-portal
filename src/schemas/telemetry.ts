import { z } from "zod";

// Loads are per cable, as stored and as the phone shows them (KD-8). No
// conversion happens here; see src/lib/units/loadDisplay.ts.
const perCableWeight = z.number();

// Nullable per-cable weight: preserves null/absent (legacy rows with no
// velocity-based 1RM) as null so the UI can hide the metric entirely.
const nullablePerCableWeight = z
	.number()
	.nullable()
	.optional()
	.transform((perCable) => perCable ?? null);

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
	max_weight_kg: perCableWeight,
	total_volume_kg: perCableWeight,
	estimated_1rm_kg: perCableWeight,
	// Velocity-based (VBT) 1RM — distinct from the rep-based estimated_1rm_kg.
	// Nullable; null when the row predates VBT capture. Issue #517 Phase 6.
	// INFERNO-only (20260925900000): the column is not client-readable, and the
	// progress RPCs return it as null below INFERNO. Absent parses as null.
	velocity_estimated_1rm_kg: nullablePerCableWeight,
	max_reps: z.number().finite().nonnegative(),
	set_count: z.number().finite().nonnegative(),
});

export type ExerciseProgress = z.infer<typeof exerciseProgressSchema>;
