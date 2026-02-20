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
 * Estimate one-rep max using the Epley formula.
 * Returns 0 for invalid inputs, weight itself for single reps.
 */
export function estimateOneRepMax(weight: number, reps: number): number {
	if (weight <= 0 || reps <= 0) return 0;
	if (reps === 1) return weight;
	return Math.round(weight * (1 + reps / 30));
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
