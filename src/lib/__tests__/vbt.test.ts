import { describe, expect, it } from "vitest";
import { VBT_ZONES, classifyVbtZone } from "../vbt";

describe("VBT_ZONES", () => {
	it("contains exactly 5 zones", () => {
		expect(VBT_ZONES).toHaveLength(5);
	});

	it("zones are contiguous (each maxVelocity equals next minVelocity)", () => {
		for (let i = 0; i < VBT_ZONES.length - 1; i++) {
			expect(VBT_ZONES[i].maxVelocity).toBe(VBT_ZONES[i + 1].minVelocity);
		}
	});

	it("last zone has Infinity maxVelocity", () => {
		expect(VBT_ZONES[VBT_ZONES.length - 1].maxVelocity).toBe(Infinity);
	});
});

describe("classifyVbtZone", () => {
	it("classifies 0.25 as absolute-strength (0 to 0.5)", () => {
		const result = classifyVbtZone(0.25);
		expect(result.zone).toBe("absolute-strength");
		expect(result.label).toBe("Absolute Strength");
	});

	it("classifies 0.6 as accelerative-strength (0.5 to 0.75)", () => {
		const result = classifyVbtZone(0.6);
		expect(result.zone).toBe("accelerative-strength");
		expect(result.label).toBe("Accelerative Strength");
	});

	it("classifies 0.85 as strength-speed (0.75 to 1.0)", () => {
		const result = classifyVbtZone(0.85);
		expect(result.zone).toBe("strength-speed");
		expect(result.label).toBe("Strength-Speed");
	});

	it("classifies 1.15 as speed-strength (1.0 to 1.3)", () => {
		const result = classifyVbtZone(1.15);
		expect(result.zone).toBe("speed-strength");
		expect(result.label).toBe("Speed-Strength");
	});

	it("classifies 1.5 as starting-strength (1.3 to Infinity)", () => {
		const result = classifyVbtZone(1.5);
		expect(result.zone).toBe("starting-strength");
		expect(result.label).toBe("Starting Strength");
	});

	// Boundary tests
	it("classifies exactly 0.5 as accelerative-strength (>= min, < max)", () => {
		const result = classifyVbtZone(0.5);
		expect(result.zone).toBe("accelerative-strength");
	});

	it("classifies exactly 0.75 as strength-speed", () => {
		const result = classifyVbtZone(0.75);
		expect(result.zone).toBe("strength-speed");
	});

	it("classifies exactly 1.0 as speed-strength", () => {
		const result = classifyVbtZone(1.0);
		expect(result.zone).toBe("speed-strength");
	});

	it("classifies exactly 1.3 as starting-strength", () => {
		const result = classifyVbtZone(1.3);
		expect(result.zone).toBe("starting-strength");
	});

	it("classifies 0 as absolute-strength (lower bound)", () => {
		const result = classifyVbtZone(0);
		expect(result.zone).toBe("absolute-strength");
	});

	it("classifies negative velocity as absolute-strength (fallback)", () => {
		const result = classifyVbtZone(-0.5);
		expect(result.zone).toBe("absolute-strength");
	});

	it("returns a VbtZoneInfo with all required fields", () => {
		const result = classifyVbtZone(0.6);
		expect(result).toHaveProperty("zone");
		expect(result).toHaveProperty("label");
		expect(result).toHaveProperty("color");
		expect(result).toHaveProperty("minVelocity");
		expect(result).toHaveProperty("maxVelocity");
		expect(result).toHaveProperty("description");
	});
});
