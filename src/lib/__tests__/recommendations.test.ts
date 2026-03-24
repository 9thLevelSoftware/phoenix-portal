import { describe, expect, it } from "vitest";
import {
	generateSraRecommendations,
	generateVolumeRecommendations,
	mergeRecommendations,
	type Recommendation,
} from "@/lib/recommendations";

describe("generateVolumeRecommendations", () => {
	it("generates critical recommendation when above MRV", () => {
		const recos = generateVolumeRecommendations({ Back: 25 });
		const critical = recos.find((r) => r.signal === "volume_above_mrv");
		expect(critical).toBeDefined();
		expect(critical?.priority).toBe("critical");
		expect(critical?.muscleGroup).toBe("Back");
	});

	it("generates actionable recommendation when below MEV", () => {
		const recos = generateVolumeRecommendations({ Shoulders: 5 });
		const actionable = recos.find((r) => r.signal === "volume_below_mev");
		expect(actionable).toBeDefined();
		expect(actionable?.priority).toBe("actionable");
	});

	it("generates no recommendation when in optimal range", () => {
		const recos = generateVolumeRecommendations({ Chest: 16 });
		// Chest is in-range, but other untrained groups still produce below-MEV
		// (except Core which has MEV=0). Filter to only Chest recos.
		const chestRecos = recos.filter((r) => r.muscleGroup === "Chest");
		expect(chestRecos).toHaveLength(0);
	});

	it("generates below_mev for untrained muscle groups", () => {
		// Empty volume = all muscles untrained
		const recos = generateVolumeRecommendations({});
		// Should have below-MEV for all groups except Core (which has MEV=0)
		const belowMev = recos.filter((r) => r.signal === "volume_below_mev");
		expect(belowMev.length).toBe(5); // Chest, Back, Shoulders, Legs, Arms (not Core since MEV=0)
	});
});

describe("generateSraRecommendations", () => {
	it("generates positive recommendation for supercompensated muscle", () => {
		const recos = generateSraRecommendations([
			{
				muscleGroup: "Chest",
				status: "SUPERCOMPENSATED",
				hoursSinceLastTrained: 80,
				estimatedRecoveryHours: 60,
				hoursRemaining: null,
				lastSessionVolume: 12,
				lastSessionIntensity: 0.75,
			},
		]);
		expect(recos.some((r) => r.signal === "sra_supercompensated")).toBe(true);
	});

	it("generates info recommendation for fatigued muscle", () => {
		const recos = generateSraRecommendations([
			{
				muscleGroup: "Back",
				status: "FATIGUED",
				hoursSinceLastTrained: 5,
				estimatedRecoveryHours: 60,
				hoursRemaining: 55,
				lastSessionVolume: 20,
				lastSessionIntensity: 0.9,
			},
		]);
		const info = recos.find((r) => r.signal === "sra_fatigued");
		expect(info).toBeDefined();
		expect(info?.priority).toBe("info");
	});

	it("skips recommendations for never-trained muscles", () => {
		const recos = generateSraRecommendations([
			{
				muscleGroup: "Chest",
				status: "RECOVERED",
				hoursSinceLastTrained: 0,
				estimatedRecoveryHours: 60,
				hoursRemaining: null,
				lastSessionVolume: null,
				lastSessionIntensity: null,
			},
		]);
		expect(recos).toHaveLength(0);
	});
});

describe("mergeRecommendations", () => {
	it("sorts by priority: critical > actionable > info > positive", () => {
		const recos: Recommendation[] = [
			{ id: "1", priority: "positive", signal: "a", title: "a", action: "a" },
			{ id: "2", priority: "critical", signal: "b", title: "b", action: "b" },
			{ id: "3", priority: "info", signal: "c", title: "c", action: "c" },
			{ id: "4", priority: "actionable", signal: "d", title: "d", action: "d" },
		];
		const sorted = mergeRecommendations(recos);
		expect(sorted.map((r) => r.priority)).toEqual([
			"critical",
			"actionable",
			"info",
			"positive",
		]);
	});

	it("deduplicates by signal + muscleGroup", () => {
		const recos: Recommendation[] = [
			{
				id: "1",
				priority: "critical",
				signal: "volume_above_mrv",
				muscleGroup: "Back",
				title: "a",
				action: "a",
			},
			{
				id: "2",
				priority: "critical",
				signal: "volume_above_mrv",
				muscleGroup: "Back",
				title: "b",
				action: "b",
			},
		];
		expect(mergeRecommendations(recos)).toHaveLength(1);
	});
});
