import { describe, expect, it } from "vitest";
import { type SessionSummary, compareSessions } from "../comparison";

/** Helper to create a SessionSummary with sensible defaults */
function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		id: "session-1",
		name: "Workout A",
		startedAt: new Date("2026-01-15"),
		totalVolume: 10000,
		duration: 60,
		exerciseCount: 3,
		setCount: 9,
		prCount: 0,
		exercises: [
			{
				name: "Bench Press",
				volume: 5000,
				maxWeight: 100,
				sets: 3,
				avgVelocity: 0.8,
			},
			{
				name: "Squat",
				volume: 3000,
				maxWeight: 120,
				sets: 3,
				avgVelocity: 0.6,
			},
			{
				name: "Deadlift",
				volume: 2000,
				maxWeight: 140,
				sets: 3,
				avgVelocity: 0.5,
			},
		],
		...overrides,
	};
}

describe("compareSessions", () => {
	it("returns 0 deltas for two identical sessions", () => {
		const a = makeSession();
		const b = makeSession({ id: "session-2", name: "Workout B" });
		const result = compareSessions(a, b);
		expect(result.volumeDelta).toBe(0);
		expect(result.durationDelta).toBe(0);
	});

	it("returns 100% volumeDelta when session B has double volume", () => {
		const a = makeSession({ totalVolume: 5000 });
		const b = makeSession({ totalVolume: 10000 });
		const result = compareSessions(a, b);
		expect(result.volumeDelta).toBe(100);
	});

	it("handles session A with 0 volume and B with 100 volume", () => {
		const a = makeSession({ totalVolume: 0 });
		const b = makeSession({ totalVolume: 100 });
		const result = compareSessions(a, b);
		// pctChange(0, 100) -> a===0 ? b===0 ? 0 : 100 -> 100
		expect(result.volumeDelta).toBe(100);
	});

	it("handles both sessions with 0 volume", () => {
		const a = makeSession({ totalVolume: 0 });
		const b = makeSession({ totalVolume: 0 });
		const result = compareSessions(a, b);
		expect(result.volumeDelta).toBe(0);
	});

	it("calculates duration delta correctly", () => {
		const a = makeSession({ duration: 30 });
		const b = makeSession({ duration: 45 });
		const result = compareSessions(a, b);
		// ((45 - 30) / 30) * 100 = 50
		expect(result.durationDelta).toBe(50);
	});

	it("counts shared exercises correctly", () => {
		const a = makeSession();
		const b = makeSession({
			exercises: [
				{ name: "Bench Press", volume: 4000, maxWeight: 90, sets: 3, avgVelocity: 0.7 },
				{ name: "Squat", volume: 3500, maxWeight: 130, sets: 3, avgVelocity: 0.65 },
				{ name: "Overhead Press", volume: 1500, maxWeight: 60, sets: 3, avgVelocity: 0.9 },
			],
		});
		const result = compareSessions(a, b);
		// Bench Press and Squat shared, Deadlift only in A, OHP only in B
		expect(result.sharedExerciseCount).toBe(2);
	});

	it("marks exercise only in A with onlyInA=true and deltaPct=0", () => {
		const a = makeSession({
			exercises: [
				{ name: "Bench Press", volume: 5000, maxWeight: 100, sets: 3, avgVelocity: 0.8 },
			],
		});
		const b = makeSession({ exercises: [] });
		const result = compareSessions(a, b);
		const benchDelta = result.exerciseDeltas.find((d) => d.name === "Bench Press");
		expect(benchDelta?.onlyInA).toBe(true);
		expect(benchDelta?.onlyInB).toBe(false);
		expect(benchDelta?.deltaPct).toBe(0);
	});

	it("marks exercise only in B with onlyInB=true and deltaPct=0", () => {
		const a = makeSession({ exercises: [] });
		const b = makeSession({
			exercises: [
				{ name: "Rows", volume: 3000, maxWeight: 80, sets: 3, avgVelocity: 0.7 },
			],
		});
		const result = compareSessions(a, b);
		const rowDelta = result.exerciseDeltas.find((d) => d.name === "Rows");
		expect(rowDelta?.onlyInB).toBe(true);
		expect(rowDelta?.onlyInA).toBe(false);
		expect(rowDelta?.deltaPct).toBe(0);
	});

	it("calculates per-exercise volume delta for shared exercises", () => {
		const a = makeSession({
			exercises: [
				{ name: "Bench Press", volume: 4000, maxWeight: 100, sets: 3, avgVelocity: 0.8 },
			],
		});
		const b = makeSession({
			exercises: [
				{ name: "Bench Press", volume: 6000, maxWeight: 110, sets: 3, avgVelocity: 0.85 },
			],
		});
		const result = compareSessions(a, b);
		const benchDelta = result.exerciseDeltas.find((d) => d.name === "Bench Press");
		// ((6000 - 4000) / 4000) * 100 = 50
		expect(benchDelta?.deltaPct).toBe(50);
		expect(benchDelta?.onlyInA).toBe(false);
		expect(benchDelta?.onlyInB).toBe(false);
	});

	it("warns when fewer than 2 shared exercises", () => {
		const a = makeSession({
			exercises: [
				{ name: "Bench Press", volume: 5000, maxWeight: 100, sets: 3, avgVelocity: 0.8 },
			],
		});
		const b = makeSession({
			exercises: [
				{ name: "Bench Press", volume: 5000, maxWeight: 100, sets: 3, avgVelocity: 0.8 },
			],
		});
		const result = compareSessions(a, b);
		expect(result.sharedExerciseCount).toBe(1);
		expect(result.warning).toBe(
			"These sessions share fewer than 2 exercises — comparison may not be meaningful",
		);
	});

	it("no warning when 2+ shared exercises", () => {
		const a = makeSession();
		const b = makeSession();
		const result = compareSessions(a, b);
		expect(result.sharedExerciseCount).toBe(3);
		expect(result.warning).toBeNull();
	});

	it("matches exercises case-insensitively", () => {
		const a = makeSession({
			exercises: [
				{ name: "Bench Press", volume: 5000, maxWeight: 100, sets: 3, avgVelocity: 0.8 },
			],
		});
		const b = makeSession({
			exercises: [
				{ name: "bench press", volume: 5000, maxWeight: 100, sets: 3, avgVelocity: 0.8 },
			],
		});
		const result = compareSessions(a, b);
		expect(result.sharedExerciseCount).toBe(1);
		// Should have 1 exercise delta, not 2 separate entries
		expect(result.exerciseDeltas).toHaveLength(1);
		expect(result.exerciseDeltas[0].onlyInA).toBe(false);
		expect(result.exerciseDeltas[0].onlyInB).toBe(false);
	});

	it("preserves original casing from session A for display name", () => {
		const a = makeSession({
			exercises: [
				{ name: "Bench Press", volume: 5000, maxWeight: 100, sets: 3, avgVelocity: 0.8 },
			],
		});
		const b = makeSession({
			exercises: [
				{ name: "bench press", volume: 5000, maxWeight: 100, sets: 3, avgVelocity: 0.8 },
			],
		});
		const result = compareSessions(a, b);
		expect(result.exerciseDeltas[0].name).toBe("Bench Press");
	});
});
