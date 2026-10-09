/** Asymmetry percentage threshold for flagging imbalances */
export const ASYMMETRY_THRESHOLD = 10;

/**
 * Calculate left/right force asymmetry as a signed percentage.
 * Positive = right dominant, negative = left dominant.
 * Formula: ((right - left) / total) * 200
 */
export function calculateAsymmetry(
	leftForce: number,
	rightForce: number,
): number {
	const total = leftForce + rightForce;
	if (total === 0) return 0;
	return Math.round(((rightForce - leftForce) / total) * 200 * 10) / 10;
}

/**
 * Estimate one-rep max using the canonical hybrid (parity with mobile
 * OneRepMaxCalculator.estimate and Edge estimateOneRepMaxKg): Brzycki for
 * reps <= 10, Epley for reps > 10.
 * Returns the unrounded float; 0 for invalid input; weight itself for 1 rep.
 *
 * NOTE: After 1RM parity, the portal reads estimated_1rm_kg from
 * exercise_progress (mobile-provided). This client computation is a fallback
 * only and MUST use the same formula — never round here.
 */
export function estimateOneRepMax(weight: number, reps: number): number {
	if (weight <= 0 || reps <= 0) return 0;
	if (reps === 1) return weight;
	if (reps <= 10) return weight * (36 / (37 - reps));
	return weight * (1 + reps / 30);
}

export function authoritativeRepPower(rep: {
	power_method?: string | null;
	power_watts?: number | null;
	peak_power_watts?: number | null;
}): { meanWatts: number | null; peakWatts: number | null } {
	const validated = rep.power_method === "PAIRED_CABLE_WORK_V1";
	return {
		meanWatts:
			validated &&
			typeof rep.power_watts === "number" &&
			Number.isFinite(rep.power_watts)
				? rep.power_watts
				: null,
		peakWatts:
			validated &&
			typeof rep.peak_power_watts === "number" &&
			Number.isFinite(rep.peak_power_watts)
				? rep.peak_power_watts
				: null,
	};
}
