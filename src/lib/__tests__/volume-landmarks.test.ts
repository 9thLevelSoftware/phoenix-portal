import { describe, expect, it } from "vitest";
import {
	classifyVolumeStatus,
	computeWeeklyVolume,
	type ExerciseSessionData,
	VOLUME_LANDMARKS,
} from "@/lib/volume-landmarks";

describe("VOLUME_LANDMARKS", () => {
	it("has entries for all 6 muscle groups", () => {
		const groups = VOLUME_LANDMARKS.map((l) => l.muscleGroup);
		expect(groups).toContain("Chest");
		expect(groups).toContain("Back");
		expect(groups).toContain("Shoulders");
		expect(groups).toContain("Legs");
		expect(groups).toContain("Arms");
		expect(groups).toContain("Core");
	});

	it("has mev <= mavLow <= mavHigh <= mrv for all entries", () => {
		for (const l of VOLUME_LANDMARKS) {
			expect(l.mev).toBeLessThanOrEqual(l.mavLow);
			expect(l.mavLow).toBeLessThanOrEqual(l.mavHigh);
			expect(l.mavHigh).toBeLessThanOrEqual(l.mrv);
		}
	});
});

describe("computeWeeklyVolume", () => {
	it("counts primary muscle group sets only", () => {
		const exercises: ExerciseSessionData[] = [
			{ name: "Bench Press", muscleGroup: "Chest", setCount: 4 },
			{ name: "Bench Press", muscleGroup: "Chest", setCount: 4 },
			{ name: "Cable Fly", muscleGroup: "Chest", setCount: 3 },
		];
		const result = computeWeeklyVolume(exercises);
		expect(result.Chest).toBe(11);
	});

	it("uses exercise-muscle map primary group over DB muscle_group", () => {
		const exercises: ExerciseSessionData[] = [
			{ name: "Bench Press", muscleGroup: "Upper Body", setCount: 4 },
		];
		const result = computeWeeklyVolume(exercises);
		expect(result.Chest).toBe(4);
		expect(result["Upper Body"]).toBeUndefined();
	});

	it("falls back to DB muscle_group for unknown exercises", () => {
		const exercises: ExerciseSessionData[] = [
			{ name: "Phoenix Special Move", muscleGroup: "Back", setCount: 5 },
		];
		const result = computeWeeklyVolume(exercises);
		expect(result.Back).toBe(5);
	});

	it("returns empty object for empty input", () => {
		expect(computeWeeklyVolume([])).toEqual({});
	});

	it("excludes General group from volume", () => {
		const exercises: ExerciseSessionData[] = [
			{ name: "Unknown", muscleGroup: null, setCount: 3 },
		];
		const result = computeWeeklyVolume(exercises);
		expect(result.General).toBeUndefined();
	});
});

describe("classifyVolumeStatus", () => {
	it("returns below_mev when sets < mev", () => {
		expect(classifyVolumeStatus("Chest", 8)).toBe("below_mev");
	});

	it("returns in_mav when sets in MAV range", () => {
		expect(classifyVolumeStatus("Chest", 16)).toBe("in_mav");
	});

	it("returns above_mav when above MAV but below MRV", () => {
		expect(classifyVolumeStatus("Chest", 20)).toBe("above_mav");
	});

	it("returns above_mrv when sets >= mrv", () => {
		expect(classifyVolumeStatus("Chest", 22)).toBe("above_mrv");
	});

	it("returns between_mev_mav for sets between MEV and MAV", () => {
		expect(classifyVolumeStatus("Chest", 12)).toBe("between_mev_mav");
	});

	it("returns null for unknown muscle group", () => {
		expect(classifyVolumeStatus("Nonexistent", 10)).toBeNull();
	});
});
