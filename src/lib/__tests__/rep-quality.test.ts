import { describe, expect, it } from "vitest";
import type { RepSummary } from "@/schemas/telemetry";
import { calculateRepQualityScore } from "../rep-quality";

/** Helper to create a RepSummary with sensible defaults */
function makeRep(overrides: Partial<RepSummary> = {}): RepSummary {
	return {
		id: "rep-1",
		set_id: "set-1",
		rep_number: 1,
		mean_velocity_mps: 0.8,
		peak_velocity_mps: 1.04, // ratio 1.3 (ideal range 1.2-1.5)
		mean_force_n: 500,
		peak_force_n: 600,
		power_watts: 400,
		rom_mm: 400, // matches default target
		tut_ms: 3000, // within default range [2000, 5000]
		left_force_avg: 250,
		right_force_avg: 250,
		asymmetry_pct: 0,
		vbt_zone: "strength-speed",
		...overrides,
	};
}

describe("calculateRepQualityScore", () => {
	it("returns high score for a perfect rep", () => {
		const rep = makeRep();
		const result = calculateRepQualityScore(rep);
		// velocityConsistency=100 (ratio 1.3), romScore=100, asymmetryPenalty=100 (0%), tutScore=100
		// score = 100*0.3 + 100*0.25 + 100*0.25 + 100*0.2 = 100
		expect(result.score).toBeGreaterThanOrEqual(95);
		expect(result.isLowQuality).toBe(false);
	});

	it("returns 0 velocityConsistency when mean velocity is 0", () => {
		const rep = makeRep({ mean_velocity_mps: 0 });
		const result = calculateRepQualityScore(rep);
		expect(result.factors.velocityConsistency).toBe(0);
		expect(result.score).toBeLessThan(100);
	});

	it("romScore is 50 when ROM is 50% of target", () => {
		const rep = makeRep({ rom_mm: 200 }); // 200/400 = 50%
		const result = calculateRepQualityScore(rep);
		expect(result.factors.romScore).toBe(50);
	});

	it("romScore is capped at 100 when ROM exceeds target", () => {
		const rep = makeRep({ rom_mm: 600 }); // 150% of target
		const result = calculateRepQualityScore(rep);
		expect(result.factors.romScore).toBe(100);
	});

	it("romScore is 0 when ROM is 0", () => {
		const rep = makeRep({ rom_mm: 0 });
		const result = calculateRepQualityScore(rep);
		expect(result.factors.romScore).toBe(0);
	});

	it("asymmetryPenalty is 0 when asymmetry is 20%", () => {
		// penalty = 20 * 5 = 100, score = 100 - 100 = 0
		const rep = makeRep({ asymmetry_pct: 20 });
		const result = calculateRepQualityScore(rep);
		expect(result.factors.asymmetryPenalty).toBe(0);
	});

	it("asymmetryPenalty handles negative asymmetry (uses absolute value)", () => {
		const rep = makeRep({ asymmetry_pct: -10 });
		const result = calculateRepQualityScore(rep);
		// abs(-10) * 5 = 50, score = 100 - 50 = 50
		expect(result.factors.asymmetryPenalty).toBe(50);
	});

	it("tutScore is 100 when TUT is within default range", () => {
		const rep = makeRep({ tut_ms: 3000 }); // within [2000, 5000]
		const result = calculateRepQualityScore(rep);
		expect(result.factors.tutScore).toBe(100);
	});

	it("tutScore is less than 100 when TUT is below range", () => {
		const rep = makeRep({ tut_ms: 1000 }); // below 2000
		const result = calculateRepQualityScore(rep);
		expect(result.factors.tutScore).toBeLessThan(100);
	});

	it("tutScore is less than 100 when TUT is above range", () => {
		const rep = makeRep({ tut_ms: 8000 }); // above 5000
		const result = calculateRepQualityScore(rep);
		expect(result.factors.tutScore).toBeLessThan(100);
	});

	it("marks isLowQuality when score < 60", () => {
		// Create a very poor rep
		const rep = makeRep({
			mean_velocity_mps: 0, // velocityConsistency = 0
			rom_mm: 0, // romScore = 0
			asymmetry_pct: 20, // asymmetryPenalty = 0
			tut_ms: 0, // tutScore = 0
		});
		const result = calculateRepQualityScore(rep);
		expect(result.score).toBeLessThan(60);
		expect(result.isLowQuality).toBe(true);
	});

	it("factors object contains all 4 fields", () => {
		const rep = makeRep();
		const result = calculateRepQualityScore(rep);
		expect(result.factors).toHaveProperty("velocityConsistency");
		expect(result.factors).toHaveProperty("romScore");
		expect(result.factors).toHaveProperty("asymmetryPenalty");
		expect(result.factors).toHaveProperty("tutScore");
	});

	it("score is clamped between 0 and 100", () => {
		const rep = makeRep();
		const result = calculateRepQualityScore(rep);
		expect(result.score).toBeGreaterThanOrEqual(0);
		expect(result.score).toBeLessThanOrEqual(100);
	});

	it("accepts custom targetRomMm", () => {
		const rep = makeRep({ rom_mm: 200 });
		const result = calculateRepQualityScore(rep, 200); // target = 200
		expect(result.factors.romScore).toBe(100);
	});

	it("accepts custom targetTutRangeMs", () => {
		const rep = makeRep({ tut_ms: 1000 });
		const result = calculateRepQualityScore(rep, 400, [500, 1500]);
		expect(result.factors.tutScore).toBe(100); // 1000 is within [500, 1500]
	});
});
