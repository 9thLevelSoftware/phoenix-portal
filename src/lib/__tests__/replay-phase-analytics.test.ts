import { describe, expect, it } from "vitest";
import { buildReplayPhaseAnalytics } from "@/lib/replay-phase-analytics";
import type { RepSummary, TelemetryPointRow } from "@/schemas/telemetry";

function point(
	timestampMs: number,
	positionMm: number,
	forceN: number,
	velocityMps: number,
	cable: "A" | "B" = "A",
): TelemetryPointRow {
	return {
		id: crypto.randomUUID(),
		set_id: "set-1",
		timestamp_ms: timestampMs,
		force_n: forceN,
		velocity_mps: velocityMps,
		position_mm: positionMm,
		cable,
	};
}

function rep(repNumber: number): RepSummary {
	return {
		id: crypto.randomUUID(),
		set_id: "set-1",
		rep_number: repNumber,
		mean_velocity_mps: 0.5,
		peak_velocity_mps: 0.8,
		mean_force_n: 100,
		peak_force_n: 130,
		power_watts: 80,
		rom_mm: 100,
		tut_ms: 1000,
		left_force_avg: 100,
		right_force_avg: 100,
		asymmetry_pct: 0,
		vbt_zone: "speed",
	};
}

describe("buildReplayPhaseAnalytics", () => {
	it("segments phases and calculates energy from summed dual-cable force", () => {
		const analytics = buildReplayPhaseAnalytics({
			telemetry: [
				point(0, 0, 100, 0.2, "A"),
				point(0, 0, 120, 0.4, "B"),
				point(100, 100, 140, 0.6, "A"),
				point(100, 100, 160, 0.8, "B"),
				point(200, 40, 200, -0.3, "A"),
				point(200, 40, 220, -0.5, "B"),
			],
			repSummaries: [rep(1)],
			repBoundaries: [0],
		});

		expect(analytics.status).toBe("ready");
		expect(analytics.segments.map((segment) => segment.phase)).toEqual([
			"concentric",
			"eccentric",
		]);
		expect(analytics.segments[0]).toMatchObject({
			avgForceN: 260,
			avgVelocityMps: 0.5,
			energyJ: 26,
			repNumber: 1,
		});
		expect(analytics.segments[1]).toMatchObject({
			avgForceN: 360,
			energyJ: 21.6,
		});
		expect(analytics.summary).toMatchObject({
			totalEnergyJ: 47.6,
			concentricEnergyJ: 26,
			eccentricEnergyJ: 21.6,
			segmentCount: 2,
		});
	});

	it("ignores position deltas under 1mm as noise", () => {
		const analytics = buildReplayPhaseAnalytics({
			telemetry: [
				point(0, 0, 100, 0.1),
				point(50, 0.5, 110, 0.1),
				point(100, 2, 120, 0.1),
			],
			repSummaries: [],
			repBoundaries: [],
		});

		expect(analytics.segments).toHaveLength(1);
		expect(analytics.segments[0]?.deltaMm).toBe(2);
	});

	it("accumulates gradual sub-millimeter samples until real movement is present", () => {
		const analytics = buildReplayPhaseAnalytics({
			telemetry: [
				point(0, 0, 100, 0.1),
				point(25, 0.5, 100, 0.1),
				point(50, 1, 100, 0.1),
				point(75, 1.5, 100, 0.1),
				point(100, 2, 100, 0.1),
			],
			repSummaries: [],
			repBoundaries: [],
		});

		expect(analytics.segments).toHaveLength(2);
		expect(analytics.segments.map((segment) => segment.deltaMm)).toEqual([
			1, 1,
		]);
		expect(analytics.summary.totalEnergyJ).toBe(0.2);
	});

	it("marks phase analytics partial when summaries exist without enough telemetry", () => {
		const noTelemetry = buildReplayPhaseAnalytics({
			telemetry: [],
			repSummaries: [rep(1)],
			repBoundaries: [0],
		});

		expect(noTelemetry.status).toBe("partial");
		expect(noTelemetry.partialReason).toMatch(/dense position telemetry/i);

		const sparseTelemetry = buildReplayPhaseAnalytics({
			telemetry: [point(0, 0, 100, 0.1), point(100, 20, 120, 0.2)],
			repSummaries: [rep(1), rep(2)],
			repBoundaries: [0, 1000],
		});

		expect(sparseTelemetry.status).toBe("partial");
		expect(sparseTelemetry.partialReason).toMatch(/density/i);
	});
});
