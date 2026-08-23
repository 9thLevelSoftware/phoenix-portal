import { describe, expect, it } from "vitest";
import { estimateOneRepMaxKg } from "../../../supabase/functions/_shared/exerciseProgressRows.ts";
import {
	ASYMMETRY_THRESHOLD,
	calculateAsymmetry,
	calculatePower,
	calculateRom,
	estimateOneRepMax,
} from "../biomechanics";

/** Mobile OneRepMaxCalculator.estimate goldens (unrounded hybrid). */
const HYBRID_1RM_GOLDENS = [
	{ weight: 100, reps: 5, expected: 112.5 },
	{ weight: 100, reps: 10, expected: 133.333 },
	{ weight: 100, reps: 11, expected: 136.666 },
] as const;

describe("calculateAsymmetry", () => {
	it("returns 0 when both forces are 0", () => {
		expect(calculateAsymmetry(0, 0)).toBe(0);
	});

	it("returns 0 for equal forces", () => {
		expect(calculateAsymmetry(100, 100)).toBe(0);
	});

	it("returns positive value when right dominant", () => {
		// ((200 - 100) / 300) * 200 = 66.666... -> rounded to 66.7
		const result = calculateAsymmetry(100, 200);
		expect(result).toBeGreaterThan(0);
		expect(result).toBeCloseTo(66.7, 1);
	});

	it("returns negative value when left dominant", () => {
		// ((100 - 200) / 300) * 200 = -66.666... -> rounded to -66.7
		const result = calculateAsymmetry(200, 100);
		expect(result).toBeLessThan(0);
		expect(result).toBeCloseTo(-66.7, 1);
	});

	it("rounds to 1 decimal place", () => {
		// ((150 - 100) / 250) * 200 = 40.0
		const result = calculateAsymmetry(100, 150);
		expect(result).toBe(40);
		// Check string representation has at most 1 decimal
		const decimalPart = String(result).split(".")[1];
		expect(!decimalPart || decimalPart.length <= 1).toBe(true);
	});

	it("ASYMMETRY_THRESHOLD is 10", () => {
		expect(ASYMMETRY_THRESHOLD).toBe(10);
	});
});

describe("estimateOneRepMax", () => {
	it("returns 0 when weight is 0", () => {
		expect(estimateOneRepMax(0, 5)).toBe(0);
	});

	it("returns 0 when weight is negative", () => {
		expect(estimateOneRepMax(-50, 5)).toBe(0);
	});

	it("returns 0 when reps is 0", () => {
		expect(estimateOneRepMax(100, 0)).toBe(0);
	});

	it("returns 0 when reps is negative", () => {
		expect(estimateOneRepMax(100, -3)).toBe(0);
	});

	it("returns weight itself for 1 rep (identity)", () => {
		expect(estimateOneRepMax(100, 1)).toBe(100);
		expect(estimateOneRepMax(225, 1)).toBe(225);
	});

	it("estimateOneRepMax uses Brzycki at or below 10 reps", () => {
		expect(estimateOneRepMax(100, 5)).toBeCloseTo(112.5);
	});

	it("estimateOneRepMax is continuous at 10 reps", () => {
		expect(estimateOneRepMax(100, 10)).toBeCloseTo(133.333);
	});

	it("estimateOneRepMax uses Epley above 10 reps", () => {
		expect(estimateOneRepMax(100, 11)).toBeCloseTo(136.666);
	});

	it("matches Edge estimateOneRepMaxKg for hybrid goldens", () => {
		for (const { weight, reps, expected } of HYBRID_1RM_GOLDENS) {
			const portal = estimateOneRepMax(weight, reps);
			const edge = estimateOneRepMaxKg(weight, reps);
			expect(portal).toBe(edge);
			expect(portal).toBeCloseTo(expected);
		}
	});

	it("estimateOneRepMax returns weight for 1 rep and 0 for invalid", () => {
		expect(estimateOneRepMax(100, 1)).toBe(100);
		expect(estimateOneRepMax(0, 5)).toBe(0);
	});

	it("calculates correctly for higher reps (Brzycki)", () => {
		// 80 * (36 / (37 - 10)) = 80 * (36/27) = 106.666...
		expect(estimateOneRepMax(80, 10)).toBeCloseTo(106.667);
	});
});

describe("calculatePower", () => {
	it("calculates P = F * v correctly", () => {
		// 500 * 0.8 = 400
		expect(calculatePower(500, 0.8)).toBe(400);
	});

	it("returns 0 when force is 0", () => {
		expect(calculatePower(0, 1.5)).toBe(0);
	});

	it("returns 0 when velocity is 0", () => {
		expect(calculatePower(500, 0)).toBe(0);
	});

	it("rounds to nearest integer", () => {
		// 333 * 0.7 = 233.1 -> 233
		expect(calculatePower(333, 0.7)).toBe(233);
	});
});

describe("calculateRom", () => {
	it("returns 0 for empty array", () => {
		expect(calculateRom([])).toBe(0);
	});

	it("returns 0 for single position", () => {
		expect(calculateRom([150])).toBe(0);
	});

	it("returns max - min for multiple positions", () => {
		expect(calculateRom([100, 200, 300])).toBe(200);
	});

	it("handles negative positions", () => {
		expect(calculateRom([-50, 0, 50])).toBe(100);
	});

	it("handles unordered positions", () => {
		expect(calculateRom([300, 100, 200, 400, 150])).toBe(300);
	});

	it("rounds to nearest integer", () => {
		expect(calculateRom([0.1, 0.9])).toBe(1);
	});
});
