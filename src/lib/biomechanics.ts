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

/**
 * Calculate power output in watts from force and velocity.
 * P = F * v
 */
export function calculatePower(
	forceNewtons: number,
	velocityMps: number,
): number {
	return Math.round(forceNewtons * velocityMps);
}

/**
 * Calculate range of motion from position readings.
 * Returns max - min in millimeters.
 */
export function calculateRom(positions: number[]): number {
	if (positions.length === 0) return 0;
	return Math.round(Math.max(...positions) - Math.min(...positions));
}
