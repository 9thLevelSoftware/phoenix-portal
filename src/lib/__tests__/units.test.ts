import { describe, expect, it } from "vitest";
import {
	convertWeight,
	convertWeightFromUnit,
	formatLeaderboardValue,
	formatVolume,
	formatWeight,
	getUnitLabel,
	isWeightUnit,
	normalizeWeightUnit,
	toKg,
	weightInputToKg,
	weightInputValue,
} from "../units";

describe("units", () => {
	describe("convertWeight", () => {
		it("returns kg value unchanged when unit is kg", () => {
			expect(convertWeight(100, "kg")).toBe(100);
		});

		it("converts kg to lbs", () => {
			expect(convertWeight(100, "lbs")).toBeCloseTo(220.462, 1);
		});

		it("handles zero", () => {
			expect(convertWeight(0, "lbs")).toBe(0);
		});

		it("handles null and undefined gracefully", () => {
			expect(convertWeight(null, "lbs")).toBe(0);
			expect(convertWeight(undefined, "kg")).toBe(0);
		});
	});

	describe("formatWeight", () => {
		it("formats kg as a whole number with unit", () => {
			expect(formatWeight(100, "kg")).toBe("100 kg");
		});

		it("formats lbs with 1 decimal", () => {
			expect(formatWeight(100, "lbs")).toBe("220.5 lbs");
		});

		it("handles zero", () => {
			expect(formatWeight(0, "kg")).toBe("0 kg");
		});
	});

	describe("toKg", () => {
		it("converts lbs to kg", () => {
			expect(toKg(220.462)).toBeCloseTo(100, 0);
		});
	});

	describe("formatVolume", () => {
		it("formats large volumes with a K suffix", () => {
			expect(formatVolume(2300, "kg")).toBe("2.3K kg");
		});

		it("formats small volumes without a suffix", () => {
			expect(formatVolume(500, "kg")).toBe("500 kg");
		});

		it("formats lbs volumes", () => {
			expect(formatVolume(1000, "lbs")).toMatch(/lbs$/);
		});

		it("converts and abbreviates lbs volume from canonical kg", () => {
			expect(formatVolume(1000, "lbs")).toBe("2.2K lbs");
		});

		it("formats million-scale volumes with an M suffix", () => {
			expect(formatVolume(1_200_000, "kg")).toBe("1.2M kg");
		});

		it("uses absolute magnitude when abbreviating negative volume deltas", () => {
			expect(formatVolume(-2300, "kg")).toBe("-2.3K kg");
		});
	});

	describe("getUnitLabel", () => {
		it("returns the unit label", () => {
			expect(getUnitLabel("kg")).toBe("kg");
			expect(getUnitLabel("lbs")).toBe("lbs");
		});
	});

	describe("normalizeWeightUnit", () => {
		it("returns lbs only for the explicit lbs preference", () => {
			expect(normalizeWeightUnit("lbs")).toBe("lbs");
			expect(normalizeWeightUnit("kg")).toBe("kg");
			expect(normalizeWeightUnit(null)).toBe("kg");
			expect(normalizeWeightUnit("stone")).toBe("kg");
		});
	});

	describe("weight input helpers", () => {
		it("converts kg values to preferred display input values", () => {
			expect(weightInputValue(42.5, "kg")).toBe("42.5");
			expect(weightInputValue(42.5, "lbs")).toBe("93.7");
		});

		it("round-trips lbs display inputs back to canonical kg", () => {
			const displayValue = weightInputValue(42.5, "lbs");
			expect(weightInputToKg(displayValue, "lbs")).toBeCloseTo(42.5, 1);
		});

		it("handles blank and null input values as zero kg", () => {
			expect(weightInputValue(null, "lbs")).toBe("");
			expect(weightInputToKg("", "lbs")).toBe(0);
			expect(weightInputToKg(null, "kg")).toBe(0);
		});
	});

	describe("convertWeightFromUnit", () => {
		it("converts source lbs to the requested display unit", () => {
			expect(convertWeightFromUnit(220.462, "lbs", "kg")).toBeCloseTo(100, 1);
			expect(convertWeightFromUnit(220.462, "lbs", "lbs")).toBeCloseTo(
				220.462,
				1,
			);
		});

		it("treats non-lbs source values as canonical kg", () => {
			expect(convertWeightFromUnit(100, "kg", "lbs")).toBeCloseTo(220.462, 1);
			expect(convertWeightFromUnit(100, "%", "lbs")).toBeCloseTo(220.462, 1);
		});
	});

	describe("isWeightUnit", () => {
		it("identifies supported weight unit strings", () => {
			expect(isWeightUnit("kg")).toBe(true);
			expect(isWeightUnit("lbs")).toBe(true);
			expect(isWeightUnit("%")).toBe(false);
			expect(isWeightUnit(null)).toBe(false);
		});
	});

	describe("formatLeaderboardValue", () => {
		it("formats volume metrics with the preferred weight unit", () => {
			expect(formatLeaderboardValue(1000, "totalVolume", "lbs")).toBe(
				"2.2K lbs",
			);
		});

		it("does not convert non-volume metrics", () => {
			expect(formatLeaderboardValue(42, "workoutCount", "lbs")).toBe("42");
		});
	});
});
