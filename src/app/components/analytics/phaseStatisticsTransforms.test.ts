import { describe, expect, it } from "vitest";
import { buildPhaseMetricSummary } from "./phaseStatisticsTransforms";

describe("buildPhaseMetricSummary", () => {
	it("summarizes peak and average kg for both phases", () => {
		const result = buildPhaseMetricSummary([
			{
				concentric_kg_avg: 80,
				concentric_kg_max: 100,
				concentric_vel_avg: 0.5,
				concentric_vel_max: 0.8,
				concentric_watt_avg: 200,
				concentric_watt_max: 300,
				eccentric_kg_avg: 95,
				eccentric_kg_max: 125,
				eccentric_vel_avg: 0.4,
				eccentric_vel_max: 0.7,
				eccentric_watt_avg: 220,
				eccentric_watt_max: 340,
			},
		]);

		expect(result.load).toEqual({
			concentricAvg: 80,
			concentricMax: 100,
			eccentricAvg: 95,
			eccentricMax: 125,
		});
	});

	it("averages row averages and takes row maximums", () => {
		const result = buildPhaseMetricSummary([
			{
				concentric_kg_avg: 80,
				concentric_kg_max: 100,
				concentric_vel_avg: 0.5,
				concentric_vel_max: 0.8,
				concentric_watt_avg: 200,
				concentric_watt_max: 300,
				eccentric_kg_avg: 95,
				eccentric_kg_max: 125,
				eccentric_vel_avg: 0.4,
				eccentric_vel_max: 0.7,
				eccentric_watt_avg: 220,
				eccentric_watt_max: 340,
			},
			{
				concentric_kg_avg: 90,
				concentric_kg_max: 115,
				concentric_vel_avg: 0.7,
				concentric_vel_max: 0.9,
				concentric_watt_avg: 260,
				concentric_watt_max: 360,
				eccentric_kg_avg: 105,
				eccentric_kg_max: 140,
				eccentric_vel_avg: 0.6,
				eccentric_vel_max: 0.85,
				eccentric_watt_avg: 280,
				eccentric_watt_max: 390,
			},
		]);

		expect(result.load).toEqual({
			concentricAvg: 85,
			concentricMax: 115,
			eccentricAvg: 100,
			eccentricMax: 140,
		});
		expect(result.velocity.eccentricMax).toBe(0.85);
		expect(result.power.concentricAvg).toBe(230);
	});
});
