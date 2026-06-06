import { describe, expect, it } from "vitest";
import {
	buildReplayIntelligence,
	type ReplayIntelligenceInput,
} from "@/lib/replay-intelligence";

const repSummaries: ReplayIntelligenceInput["repSummaries"] = [
	{
		id: "rep-1",
		set_id: "set-1",
		rep_number: 1,
		mean_velocity_mps: 0.6,
		peak_velocity_mps: 0.82,
		mean_force_n: 840,
		peak_force_n: 960,
		power_watts: 410,
		rom_mm: 420,
		tut_ms: 1200,
		left_force_avg: 420,
		right_force_avg: 420,
		asymmetry_pct: 0,
		vbt_zone: "speed-strength",
	},
	{
		id: "rep-2",
		set_id: "set-1",
		rep_number: 2,
		mean_velocity_mps: 0.55,
		peak_velocity_mps: 0.75,
		mean_force_n: 860,
		peak_force_n: 980,
		power_watts: 390,
		rom_mm: 418,
		tut_ms: 1250,
		left_force_avg: 430,
		right_force_avg: 430,
		asymmetry_pct: 0,
		vbt_zone: "speed-strength",
	},
	{
		id: "rep-3",
		set_id: "set-1",
		rep_number: 3,
		mean_velocity_mps: 0.48,
		peak_velocity_mps: 0.66,
		mean_force_n: 890,
		peak_force_n: 1030,
		power_watts: 360,
		rom_mm: 415,
		tut_ms: 1300,
		left_force_avg: 455,
		right_force_avg: 435,
		asymmetry_pct: 4,
		vbt_zone: "strength-speed",
	},
	{
		id: "rep-4",
		set_id: "set-1",
		rep_number: 4,
		mean_velocity_mps: 0.39,
		peak_velocity_mps: 0.54,
		mean_force_n: 900,
		peak_force_n: 1010,
		power_watts: 300,
		rom_mm: 405,
		tut_ms: 1500,
		left_force_avg: 470,
		right_force_avg: 430,
		asymmetry_pct: 8,
		vbt_zone: "strength-speed",
	},
];

const telemetry: ReplayIntelligenceInput["telemetry"] = [
	{
		timestamp_ms: 0,
		force_n: 620,
		velocity_mps: 0.3,
		position_mm: 0,
		cable: "A",
	},
	{
		timestamp_ms: 400,
		force_n: 960,
		velocity_mps: 0.78,
		position_mm: 180,
		cable: "A",
	},
	{
		timestamp_ms: 1200,
		force_n: 780,
		velocity_mps: 0.38,
		position_mm: 420,
		cable: "A",
	},
	{
		timestamp_ms: 1500,
		force_n: 640,
		velocity_mps: 0.28,
		position_mm: 0,
		cable: "A",
	},
	{
		timestamp_ms: 2000,
		force_n: 980,
		velocity_mps: 0.7,
		position_mm: 170,
		cable: "A",
	},
	{
		timestamp_ms: 2800,
		force_n: 800,
		velocity_mps: 0.35,
		position_mm: 418,
		cable: "A",
	},
	{
		timestamp_ms: 3000,
		force_n: 700,
		velocity_mps: 0.24,
		position_mm: 0,
		cable: "A",
	},
	{
		timestamp_ms: 3520,
		force_n: 1030,
		velocity_mps: 0.18,
		position_mm: 185,
		cable: "A",
	},
	{
		timestamp_ms: 4300,
		force_n: 820,
		velocity_mps: 0.31,
		position_mm: 415,
		cable: "A",
	},
	{
		timestamp_ms: 4500,
		force_n: 720,
		velocity_mps: 0.2,
		position_mm: 0,
		cable: "A",
	},
	{
		timestamp_ms: 5000,
		force_n: 1010,
		velocity_mps: 0.16,
		position_mm: 175,
		cable: "A",
	},
	{
		timestamp_ms: 5900,
		force_n: 810,
		velocity_mps: 0.29,
		position_mm: 405,
		cable: "A",
	},
];

describe("buildReplayIntelligence", () => {
	it("summarizes velocity loss, fatigue slope, consistency, and force peak", () => {
		const result = buildReplayIntelligence({
			telemetry,
			repSummaries,
			repBoundaries: [0, 1500, 3000, 4500],
		});

		expect(result.status).toBe("ready");
		expect(result.repCount).toBe(4);
		expect(result.velocityLossPct).toBeCloseTo(35, 0);
		expect(result.fatigueSlopePctPerRep).toBeLessThan(-10);
		expect(result.repConsistencyPct).toBeGreaterThan(75);
		expect(result.repConsistencyPct).toBeLessThan(95);
		expect(result.forcePeakN).toBe(1030);
	});

	it("marks sticking points when high force coincides with unusually low velocity", () => {
		const result = buildReplayIntelligence({
			telemetry,
			repSummaries,
			repBoundaries: [0, 1500, 3000, 4500],
		});

		expect(result.stickingPoints).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					repNumber: 3,
					timestampMs: 3520,
					positionMm: 185,
				}),
			]),
		);
	});

	it("reports partial telemetry when summaries exist without enough samples", () => {
		const result = buildReplayIntelligence({
			telemetry: [],
			repSummaries,
			repBoundaries: [0, 1500, 3000, 4500],
		});

		expect(result.status).toBe("partial");
		expect(result.partialReason).toContain("rep summaries");
		expect(result.repInsights).toHaveLength(4);
	});
});
