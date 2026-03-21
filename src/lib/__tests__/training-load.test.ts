import { describe, expect, it } from "vitest";
import {
	calculateRTL,
	classifyTrainingLoad,
	type WorkoutLoadInput,
} from "../training-load";

describe("calculateRTL", () => {
	it("returns 0 for empty input", () => {
		expect(calculateRTL([])).toBe(0);
	});

	it("returns moderate score for typical week", () => {
		const sessions: WorkoutLoadInput[] = [
			{ totalVolume: 5000, durationSeconds: 3600, setCount: 16 },
			{ totalVolume: 6000, durationSeconds: 4200, setCount: 20 },
			{ totalVolume: 4500, durationSeconds: 3000, setCount: 14 },
		];
		const score = calculateRTL(sessions);
		expect(score).toBeGreaterThan(30);
		expect(score).toBeLessThan(80);
	});

	it("returns high score for overtraining week", () => {
		const sessions: WorkoutLoadInput[] = Array.from({ length: 7 }, () => ({
			totalVolume: 10000,
			durationSeconds: 5400,
			setCount: 30,
		}));
		const score = calculateRTL(sessions);
		expect(score).toBeGreaterThan(80);
	});

	it("caps at 100", () => {
		const sessions: WorkoutLoadInput[] = Array.from({ length: 14 }, () => ({
			totalVolume: 20000,
			durationSeconds: 7200,
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
