import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { calculateRTL as sharedCalculateRTL } from "../../../supabase/functions/_shared/trainingLoad.ts";
import {
	calculateRTL,
	classifyTrainingLoad,
	type WorkoutLoadInput,
} from "../training-load";

interface FixtureCase {
	id: string;
	sessions: WorkoutLoadInput[];
	expected: number;
}

// Same file the Deno suite reads (vitest runs from the repo root).
const fixture: { cases: FixtureCase[] } = JSON.parse(
	readFileSync(resolve(process.cwd(), "tests/fixtures/rtl-cases.json"), "utf8"),
);

describe("calculateRTL", () => {
	it("is the shared edge implementation", () => {
		expect(calculateRTL).toBe(sharedCalculateRTL);
	});

	it("matches the golden parity fixture", () => {
		expect(fixture.cases.length).toBeGreaterThan(0);
		for (const testCase of fixture.cases) {
			expect(calculateRTL(testCase.sessions), testCase.id).toBe(
				testCase.expected,
			);
		}
	});

	it("returns 0 for empty input", () => {
		expect(calculateRTL([])).toBe(0);
	});

	it("returns moderate score for typical week", () => {
		const sessions: WorkoutLoadInput[] = [
			{ totalVolume: 5000, setCount: 16 },
			{ totalVolume: 6000, setCount: 20 },
			{ totalVolume: 4500, setCount: 14 },
		];
		const score = calculateRTL(sessions);
		expect(score).toBeGreaterThan(30);
		expect(score).toBeLessThan(80);
	});

	it("returns high score for overtraining week", () => {
		const sessions: WorkoutLoadInput[] = Array.from({ length: 7 }, () => ({
			totalVolume: 10000,
			setCount: 30,
		}));
		const score = calculateRTL(sessions);
		expect(score).toBeGreaterThan(80);
	});

	it("caps at 100", () => {
		const sessions: WorkoutLoadInput[] = Array.from({ length: 14 }, () => ({
			totalVolume: 20000,
			setCount: 50,
		}));
		expect(calculateRTL(sessions)).toBeLessThanOrEqual(100);
	});
});

describe("classifyTrainingLoad", () => {
	it("classifies low load", () => {
		expect(classifyTrainingLoad(20)).toBe("low");
	});
	it("classifies optimal load", () => {
		expect(classifyTrainingLoad(55)).toBe("optimal");
	});
	it("classifies high load", () => {
		expect(classifyTrainingLoad(85)).toBe("high");
	});
});
