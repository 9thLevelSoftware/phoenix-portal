import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
	formatLoad,
	LoadValue,
	normalizeCableCount,
	toLoadDisplay,
} from "./loadDisplay";

describe("toLoadDisplay", () => {
	it("20 kg per cable with 2 cables shows 20 and 40", () => {
		expect(toLoadDisplay(20, 2)).toEqual({ perCableKg: 20, totalKg: 40 });
	});

	it("20 kg per cable with 1 cable shows 20 and 20 (never doubled)", () => {
		expect(toLoadDisplay(20, 1)).toEqual({ perCableKg: 20, totalKg: 20 });
	});

	it("unknown cable count shows per-cable only", () => {
		expect(toLoadDisplay(20, null)).toEqual({ perCableKg: 20, totalKg: null });
		expect(toLoadDisplay(20, undefined)).toEqual({
			perCableKg: 20,
			totalKg: null,
		});
	});

	it("treats out-of-range cable counts as unknown rather than assuming 2", () => {
		for (const bad of [0, 3, 1.5, -2, Number.NaN]) {
			expect(toLoadDisplay(20, bad).totalKg).toBeNull();
		}
		expect(normalizeCableCount("2")).toBeNull();
	});

	it("maps a missing per-cable load to 0", () => {
		expect(toLoadDisplay(null, 2)).toEqual({ perCableKg: 0, totalKg: 0 });
	});
});

describe("formatLoad", () => {
	it("formats per-cable first with total alongside", () => {
		expect(formatLoad(20, 2, "kg")).toBe("20 kg per cable · 40 kg total");
		expect(formatLoad(20, 1, "kg")).toBe("20 kg per cable · 20 kg total");
	});

	it("formats per-cable only when the count is unknown", () => {
		expect(formatLoad(20, null, "kg")).toBe("20 kg per cable");
	});

	it("converts both figures to lbs", () => {
		expect(formatLoad(20, 2, "lbs")).toBe(
			"44.1 lbs per cable · 88.2 lbs total",
		);
	});
});

describe("LoadValue", () => {
	it("renders the formatted load", () => {
		render(
			createElement(LoadValue, { perCableKg: 20, cableCount: 2, unit: "kg" }),
		);
		expect(screen.getByTestId("load-value").textContent).toBe(
			"20 kg per cable · 40 kg total",
		);
	});
});
