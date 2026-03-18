import { describe, expect, it } from "vitest";
import {
  calculateCurveConsistency,
  calculateTempoControl,
  calculateFatigueResistance,
  calculateBilateralBalance,
  calculateFormScore,
  getLetterGrade,
  type RepMetrics,
} from "../form-analysis";

const sampleReps: RepMetrics[] = [
  { peakForce: 400, meanVelocity: 0.8, rom: 350, tut: 3500, asymmetry: 2 },
  { peakForce: 390, meanVelocity: 0.75, rom: 345, tut: 3600, asymmetry: 3 },
  { peakForce: 375, meanVelocity: 0.7, rom: 340, tut: 3800, asymmetry: 4 },
  { peakForce: 360, meanVelocity: 0.63, rom: 330, tut: 4000, asymmetry: 7 },
  { peakForce: 340, meanVelocity: 0.55, rom: 310, tut: 4500, asymmetry: 12 },
];

describe("calculateCurveConsistency", () => {
  it("returns high score for identical forces", () => {
    const evenReps: RepMetrics[] = Array.from({ length: 5 }, () => ({
      peakForce: 400, meanVelocity: 0.8, rom: 350, tut: 3500, asymmetry: 2,
    }));
    expect(calculateCurveConsistency(evenReps)).toBe(100);
  });

  it("returns lower score for varied forces", () => {
    expect(calculateCurveConsistency(sampleReps)).toBeLessThan(100);
    expect(calculateCurveConsistency(sampleReps)).toBeGreaterThan(0);
  });

  it("returns 0 for empty/single rep", () => {
    expect(calculateCurveConsistency([])).toBe(0);
    expect(calculateCurveConsistency([sampleReps[0]])).toBe(0);
  });
});

describe("calculateTempoControl", () => {
  it("returns high score for consistent TUT", () => {
    const evenReps: RepMetrics[] = Array.from({ length: 5 }, () => ({
      peakForce: 400, meanVelocity: 0.8, rom: 350, tut: 3500, asymmetry: 2,
    }));
    expect(calculateTempoControl(evenReps)).toBe(100);
  });

  it("returns lower score for varied TUT", () => {
    expect(calculateTempoControl(sampleReps)).toBeLessThan(100);
    expect(calculateTempoControl(sampleReps)).toBeGreaterThan(0);
  });
});

describe("calculateFatigueResistance", () => {
  it("returns high score for minimal decay", () => {
    const evenReps: RepMetrics[] = Array.from({ length: 5 }, () => ({
      peakForce: 400, meanVelocity: 0.8, rom: 350, tut: 3500, asymmetry: 2,
    }));
    expect(calculateFatigueResistance(evenReps)).toBeGreaterThan(90);
  });

  it("returns lower score for significant decay", () => {
    expect(calculateFatigueResistance(sampleReps)).toBeLessThan(80);
  });

  it("returns 0 for empty input", () => {
    expect(calculateFatigueResistance([])).toBe(0);
  });
});

describe("calculateBilateralBalance", () => {
  it("returns high score for symmetric reps", () => {
    const symmetricReps: RepMetrics[] = Array.from({ length: 5 }, () => ({
      peakForce: 400, meanVelocity: 0.8, rom: 350, tut: 3500, asymmetry: 1,
    }));
    expect(calculateBilateralBalance(symmetricReps)).toBeGreaterThan(90);
  });

  it("penalizes increasing asymmetry (compensation pattern)", () => {
    expect(calculateBilateralBalance(sampleReps)).toBeLessThan(80);
  });
});

describe("getLetterGrade", () => {
  it("returns A+ for 95+", () => {
    expect(getLetterGrade(97)).toBe("A+");
  });
  it("returns B+ for 80-84", () => {
    expect(getLetterGrade(82)).toBe("B+");
  });
  it("returns F for < 50", () => {
    expect(getLetterGrade(40)).toBe("F");
  });
});

describe("calculateFormScore", () => {
  it("returns a weighted composite between 0-100", () => {
    const score = calculateFormScore(sampleReps);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
