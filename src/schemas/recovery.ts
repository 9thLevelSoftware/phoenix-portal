import { z } from "zod";

/**
 * Schema for recovery session data as stored: per-cable volume.
 * ACWR uses those values because the algorithm cares about relative
 * ratios, not display totals.
 */
export const recoverySessionSchema = z.object({
	started_at: z.coerce.date(),
	total_volume: z.number().finite().nonnegative(),
});

export const recoverySessionListSchema = z.array(recoverySessionSchema);

/**
 * Active cycle position from training_cycles table.
 */
export const activeCycleSchema = z.object({
	current_week: z.number(),
	duration_weeks: z.number(),
	status: z.enum(["active", "completed", "draft"]),
});

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
