import { describe, expect, it } from "vitest";
import {
	convertWeight,
	formatVolume,
	formatWeight,
	getUnitLabel,
	toKg,
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
	});

	describe("getUnitLabel", () => {
		it("returns the unit label", () => {
			expect(getUnitLabel("kg")).toBe("kg");
			expect(getUnitLabel("lbs")).toBe("lbs");
		});
	});
});
