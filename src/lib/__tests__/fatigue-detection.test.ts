import { describe, expect, it } from "vitest";
import type { RepSummary } from "@/schemas/telemetry";
import {
	FATIGUE_THRESHOLD_PERCENT,
	detectFatigue,
} from "../fatigue-detection";

/** Helper to create a RepSummary with only mean_velocity_mps varied */
function makeRep(meanVelocity: number, repNumber = 1): RepSummary {
	return {
		id: `rep-${repNumber}`,
		set_id: "set-1",
		rep_number: repNumber,
		mean_velocity_mps: meanVelocity,
		peak_velocity_mps: meanVelocity * 1.3,
		mean_force_n: 500,
		peak_force_n: 600,
		power_watts: 400,
		rom_mm: 350,
		tut_ms: 3000,
		left_force_avg: 250,
		right_force_avg: 250,
		asymmetry_pct: 0,
		vbt_zone: "strength-speed",
	};
}

describe("detectFatigue", () => {
	it("FATIGUE_THRESHOLD_PERCENT is 20", () => {
		expect(FATIGUE_THRESHOLD_PERCENT).toBe(20);
	});

	it("returns no fatigue for empty array", () => {
		const result = detectFatigue([]);
		expect(result.isFatigued).toBe(false);
		expect(result.severity).toBe("none");
		expect(result.perRepDrops).toEqual([]);
		expect(result.fatigueStartRepIndex).toBeNull();
		expect(result.insight).toBeNull();
	});

	it("returns no fatigue when first rep velocity is 0", () => {
		const result = detectFatigue([makeRep(0, 1), makeRep(0.5, 2)]);
		expect(result.isFatigued).toBe(false);
		expect(result.severity).toBe("none");
	});

	it("returns no fatigue when first rep velocity is negative", () => {
		const result = detectFatigue([makeRep(-1, 1), makeRep(0.5, 2)]);
		expect(result.isFatigued).toBe(false);
	});

	it("returns no fatigue when all reps have same velocity", () => {
		const reps = [makeRep(1.0, 1), makeRep(1.0, 2), makeRep(1.0, 3)];
		const result = detectFatigue(reps);
		expect(result.isFatigued).toBe(false);
		expect(result.severity).toBe("none");
		expect(result.velocityDropPercent).toBe(0);
	});

	it("returns no fatigue for 19% drop (below threshold)", () => {
		// First rep 1.0, last rep 0.81 -> drop = 19%
		const reps = [makeRep(1.0, 1), makeRep(0.81, 2)];
		const result = detectFatigue(reps);
		expect(result.isFatigued).toBe(false);
		expect(result.severity).toBe("none");
	});

	it("returns moderate fatigue for ~20% drop", () => {
		// First rep 1.0, last rep 0.79 -> drop = 21% (avoids floating point edge at exactly 20%)
		const reps = [makeRep(1.0, 1), makeRep(0.79, 2)];
		const result = detectFatigue(reps);
		expect(result.isFatigued).toBe(true);
		expect(result.severity).toBe("moderate");
		expect(result.velocityDropPercent).toBe(21);
	});

	it("returns moderate fatigue for 25% drop", () => {
		// First rep 1.0, last rep 0.75 -> drop = 25%
		const reps = [makeRep(1.0, 1), makeRep(0.9, 2), makeRep(0.75, 3)];
		const result = detectFatigue(reps);
		expect(result.isFatigued).toBe(true);
		expect(result.severity).toBe("moderate");
	});

	it("returns high fatigue for 35% drop", () => {
		// First rep 1.0, last rep 0.65 -> drop = 35%
		const reps = [makeRep(1.0, 1), makeRep(0.85, 2), makeRep(0.65, 3)];
		const result = detectFatigue(reps);
		expect(result.isFatigued).toBe(true);
		expect(result.severity).toBe("high");
		expect(result.velocityDropPercent).toBe(35);
	});

	it("high fatigue insight mentions consider stopping at rep N", () => {
		const reps = [
			makeRep(1.0, 1),
			makeRep(0.85, 2),
			makeRep(0.65, 3),
		];
		const result = detectFatigue(reps);
		expect(result.insight).toContain("consider stopping at rep");
	});

	it("fatigueStartRepIndex points to first rep exceeding 20%", () => {
		// Rep 1: 1.0, Rep 2: 0.9 (10% drop), Rep 3: 0.75 (25% drop)
		const reps = [makeRep(1.0, 1), makeRep(0.9, 2), makeRep(0.75, 3)];
		const result = detectFatigue(reps);
		expect(result.fatigueStartRepIndex).toBe(2); // index 2 (rep 3)
	});

	it("perRepDrops contains percentage drops from first rep", () => {
		const reps = [makeRep(1.0, 1), makeRep(0.9, 2), makeRep(0.8, 3)];
		const result = detectFatigue(reps);
		expect(result.perRepDrops).toHaveLength(3);
		expect(result.perRepDrops[0]).toBe(0); // First rep: no drop
		expect(result.perRepDrops[1]).toBe(10); // 10% drop
		expect(result.perRepDrops[2]).toBe(20); // 20% drop
	});

	it("faster subsequent reps produce 0 drop (not negative)", () => {
		// Rep 2 is faster than rep 1
		const reps = [makeRep(1.0, 1), makeRep(1.2, 2), makeRep(0.8, 3)];
		const result = detectFatigue(reps);
		expect(result.perRepDrops[1]).toBe(0); // Faster = 0, not negative
	});
});
