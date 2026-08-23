import { expect } from "vitest";

/**
 * Mobile OneRepMaxCalculator.estimate goldens (unrounded hybrid).
 * Expected values are exact algebra so 2dp stand-ins (133.33 / 136.67)
 * fail toBeCloseTo at HYBRID_1RM_DIGITS.
 */
export const HYBRID_1RM_GOLDENS = [
	{ weight: 100, reps: 5, expected: 112.5 },
	{ weight: 100, reps: 10, expected: 100 * (36 / 27) },
	{ weight: 100, reps: 11, expected: 100 * (1 + 11 / 30) },
] as const;

/** Rejects default digits=2 2dp rounding (threshold 0.005 vs 10^-10 / 2). */
export const HYBRID_1RM_DIGITS = 10;

export function expectHybrid1rm(actual: number, expected: number): void {
	expect(actual).toBeCloseTo(expected, HYBRID_1RM_DIGITS);
}
