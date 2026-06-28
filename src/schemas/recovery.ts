import { z } from "zod";

/**
 * Schema for recovery session data (raw from Supabase, before weight doubling).
 * Recovery uses raw per-cable values for ACWR computation since the algorithm
 * cares about relative ratios, not display values.
 */
export const recoverySessionSchema = z.object({
	started_at: z.coerce.date(),
	total_volume: z.number().finite().nonnegative(),
});

export const recoverySessionListSchema = z.array(recoverySessionSchema);

export type RecoverySessionRow = z.infer<typeof recoverySessionSchema>;

/**
 * Active cycle position from training_cycles table.
 */
export const activeCycleSchema = z.object({
	current_week: z.number(),
	duration_weeks: z.number(),
	status: z.enum(["active", "completed", "draft"]),
});

export type ActiveCycleRow = z.infer<typeof activeCycleSchema>;

/**
 * Wearable recovery data from external_activities table.
 * raw_data is JSONB — we extract what we can.
 */
export const wearableRecoverySchema = z.object({
	id: z.string().uuid(),
	provider: z.string(),
	raw_data: z.unknown().nullable(),
	synced_at: z.coerce.date(),
});

export const wearableRecoveryListSchema = z.array(wearableRecoverySchema);

export type WearableRecoveryRow = z.infer<typeof wearableRecoverySchema>;
