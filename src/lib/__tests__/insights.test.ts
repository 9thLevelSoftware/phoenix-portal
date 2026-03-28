import { describe, expect, it } from "vitest";
import { generateInsights, type InsightInput } from "../insights";

const baseInput: InsightInput = {
	currentVolume: 15000,
	previousVolume: 12000,
	muscleGroups: {
		Chest: 30,
		Back: 25,
		Legs: 8,
		Shoulders: 15,
		Arms: 14,
		Core: 8,
	},
	avgSessionsPerWeek: 4.2,
	currentStreak: 12,
	bestStreak: 21,
	recentPRs: [{ exercise: "Bench Press", value: 225, previousValue: 215 }],
	plateauExercises: ["Overhead Press"],
	trainingLoadScore: 72,
};

describe("generateInsights", () => {
	it("flags volume increase as success", () => {
		const insights = generateInsights(baseInput);
		const volumeInsight = insights.find((i) => i.title.includes("Volume"));
		expect(volumeInsight?.type).toBe("success");
		expect(volumeInsight?.message).toMatch(/volume/i);
	});

	it("flags muscle imbalance when ratio > 3x", () => {
		const insights = generateInsights(baseInput);
		const imbalance = insights.find((i) => i.title.includes("Leg"));
		expect(imbalance?.type).toBe("warning");
		expect(imbalance?.message).toMatch(/leg|imbalance/i);
	});

	it("includes PR achievements", () => {
		const insights = generateInsights(baseInput);
		const pr = insights.find(
			(i) => i.type === "achievement" && i.title.includes("PR"),
		);
		expect(pr).toBeDefined();
	});

	it("flags plateau exercises", () => {
		const insights = generateInsights(baseInput);
		const plateau = insights.find((i) => i.title.includes("Plateau"));
		expect(plateau?.type).toBe("warning");
		expect(plateau?.message).toMatch(/overhead press|plateau/i);
	});

	it("returns empty array for empty input", () => {
		const empty: InsightInput = {
			currentVolume: 0,
			previousVolume: 0,
			muscleGroups: {},
			avgSessionsPerWeek: 0,
			currentStreak: 0,
			bestStreak: 0,
			recentPRs: [],
			plateauExercises: [],
			trainingLoadScore: 0,
		};
		expect(generateInsights(empty)).toEqual([]);
	});

	it("flags volume decrease as warning", () => {
		const input = { ...baseInput, currentVolume: 8000, previousVolume: 12000 };
		const insights = generateInsights(input);
		const volumeDown = insights.find(
			(i) => i.title.includes("Volume") && i.type === "warning",
		);
		expect(volumeDown?.title).toMatch(/volume|Volume/i);
		expect(volumeDown?.type).toBe("warning");
	});

	it("flags low consistency", () => {
		const input = { ...baseInput, avgSessionsPerWeek: 1.5 };
		const insights = generateInsights(input);
		const consistency = insights.find(
			(i) => i.title.includes("Consistency") || i.title.includes("consistency"),
		);
		expect(consistency).toBeDefined();
		expect(consistency?.type).toBe("warning");
	});

	it("flags streak milestones", () => {
		const input = { ...baseInput, currentStreak: 14 };
		const insights = generateInsights(input);
		const streak = insights.find(
			(i) =>
				i.type === "achievement" &&
				(i.title.includes("Streak") || i.title.includes("streak")),
		);
		expect(streak?.title).toMatch(/streak|Streak/i);
		expect(streak?.type).toBe("achievement");
	});

	it("flags high training load", () => {
		const input = { ...baseInput, trainingLoadScore: 85 };
		const insights = generateInsights(input);
		const load = insights.find(
			(i) => i.title.includes("Load") || i.title.includes("load"),
		);
		expect(load?.title).toMatch(/load|Load/i);
		expect(load?.type).toBe("warning");
	});
});
