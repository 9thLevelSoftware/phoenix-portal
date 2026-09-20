import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	generateInsights,
	type InsightInput,
	type TrainingInsight,
	type WeightUnit,
} from "../insights";

interface FixtureCase {
	id: string;
	unit: WeightUnit;
	input: InsightInput;
	expected: TrainingInsight[];
}

// Same file the Deno suite reads (vitest runs from the repo root).
const fixture: { cases: FixtureCase[] } = JSON.parse(
	readFileSync(
		resolve(process.cwd(), "tests/fixtures/insight-cases.json"),
		"utf8",
	),
);

function fixtureCase(id: string): FixtureCase {
	const found = fixture.cases.find((c) => c.id === id);
	if (!found) throw new Error(`insight fixture case "${id}" is missing`);
	return found;
}

const baseInput: InsightInput = fixtureCase("balanced-progress-kg").input;

// The Deno side (supabase/functions/_shared/insightRules.test.ts) asserts the
// same file. Both runtimes import ONE module, so this pins the rules rather
// than the wiring: fork the rules and the golden goes red (F-059 / KD-14).
describe("insight rule parity fixture", () => {
	it("has cases", () => {
		expect(fixture.cases.length).toBeGreaterThan(0);
	});

	it.each(
		fixture.cases.map((c) => [c.id, c] as const),
	)("matches the golden output for %s", (_id, testCase) => {
		const actual = generateInsights(testCase.input, testCase.unit);
		expect(JSON.parse(JSON.stringify(actual))).toEqual(testCase.expected);
	});
});

describe("generateInsights", () => {
	it("flags volume increase as success", () => {
		const insights = generateInsights(baseInput);
		const volumeInsight = insights.find((i) => i.title.includes("Volume"));
		expect(volumeInsight?.type).toBe("success");
		expect(volumeInsight?.description).toMatch(/volume/i);
	});

	it("flags muscle imbalance when ratio > 3x", () => {
		const insights = generateInsights(baseInput);
		const imbalance = insights.find((i) => i.title.includes("Leg"));
		expect(imbalance?.type).toBe("warning");
		expect(imbalance?.description).toMatch(/leg|imbalance/i);
	});

	it("includes PR achievements", () => {
		const insights = generateInsights(baseInput);
		const pr = insights.find(
			(i) => i.type === "achievement" && i.title.includes("PR"),
		);
		expect(pr).toBeDefined();
	});

	it("formats PR descriptions and metric badges in kg by default", () => {
		const insights = generateInsights(baseInput);
		const pr = insights.find(
			(i) => i.type === "achievement" && i.title.includes("PR"),
		);
		// Personal records are per cable (KD-8); no doubling, labelled.
		expect(pr?.description).toContain("225 kg per cable");
		expect(pr?.description).toContain(
			"up 10 kg per cable from 215 kg per cable",
		);
		expect(pr?.description).not.toContain("lbs");
		expect(pr?.metric).toMatchObject({
			name: "Bench Press Max Weight",
			value: 225,
			unit: "kg",
			delta: 10,
		});
	});

	it("formats PR descriptions and metric badges in lbs when requested", () => {
		const insights = generateInsights(baseInput, "lbs");
		const pr = insights.find(
			(i) => i.type === "achievement" && i.title.includes("PR"),
		);
		expect(pr?.description).toContain("496.0 lbs per cable");
		expect(pr?.description).toContain(
			"up 22.0 lbs per cable from 474.0 lbs per cable",
		);
		expect(pr?.metric).toMatchObject({
			name: "Bench Press Max Weight",
			value: 496,
			unit: "lbs",
			delta: 22,
		});
	});

	it("abbreviates MAX_VOLUME records instead of formatting them as a load", () => {
		const insights = generateInsights({
			...baseInput,
			recentPRs: [
				{
					exercise: "Deadlift",
					displayName: "Deadlift Max Volume",
					recordType: "MAX_VOLUME",
					value: 12500,
					previousValue: 11000,
				},
			],
		});
		const pr = insights.find((i) => i.title.startsWith("New PR:"));
		expect(pr?.description).toContain("12.5K kg");
		expect(pr?.description).not.toContain("12500 kg");
	});

	it("falls back to the exercise name when no displayName is supplied", () => {
		const insights = generateInsights({
			...baseInput,
			recentPRs: [{ exercise: "Squat", value: 180 }],
		});
		const pr = insights.find((i) => i.title.startsWith("New PR:"));
		expect(pr?.title).toBe("New PR: Squat");
		expect(pr?.id).toBe("pr-squat");
	});

	it("flags plateau exercises", () => {
		const insights = generateInsights(baseInput);
		const plateau = insights.find((i) => i.title.includes("Plateau"));
		expect(plateau?.type).toBe("warning");
		expect(plateau?.description).toMatch(/overhead press|plateau/i);
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
