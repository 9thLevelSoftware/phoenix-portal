import { describe, expect, it } from "vitest";
import {
	classifyMannZone,
	classifyVbtZone,
	getMannZoneById,
	getSimplifiedZoneById,
	MANN_ZONES,
	SIMPLIFIED_ZONES,
	VBT_ZONES,
} from "../vbt";

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

// ============================================================
// Simplified Zone System Tests (Mobile/EXPLOSIVE-FAST-MODERATE-SLOW-GRIND)
// ============================================================

describe("SIMPLIFIED_ZONES", () => {
	it("contains exactly 5 zones", () => {
		expect(SIMPLIFIED_ZONES).toHaveLength(5);
	});

	it("zones are contiguous", () => {
		for (let i = 0; i < SIMPLIFIED_ZONES.length - 1; i++) {
			expect(SIMPLIFIED_ZONES[i].maxVelocity).toBe(
				SIMPLIFIED_ZONES[i + 1].minVelocity,
			);
		}
	});

	it("last zone has Infinity maxVelocity", () => {
		expect(SIMPLIFIED_ZONES[SIMPLIFIED_ZONES.length - 1].maxVelocity).toBe(
			Infinity,
		);
	});

	it("zones follow correct order: GRIND, SLOW, MODERATE, FAST, EXPLOSIVE", () => {
		const expectedZones = ["GRIND", "SLOW", "MODERATE", "FAST", "EXPLOSIVE"];
		SIMPLIFIED_ZONES.forEach((z, i) => {
			expect(z.zone).toBe(expectedZones[i]);
		});
	});
});

describe("classifyVbtZone (Simplified System)", () => {
	// Core zone classification tests
	it("classifies < 0.25 as GRIND", () => {
		expect(classifyVbtZone(0).zone).toBe("GRIND");
		expect(classifyVbtZone(0.1).zone).toBe("GRIND");
		expect(classifyVbtZone(0.24).zone).toBe("GRIND");
	});

	it("classifies 0.25 - 0.5 as SLOW", () => {
		expect(classifyVbtZone(0.25).zone).toBe("SLOW");
		expect(classifyVbtZone(0.3).zone).toBe("SLOW");
		expect(classifyVbtZone(0.49).zone).toBe("SLOW");
	});

	it("classifies 0.5 - 0.75 as MODERATE", () => {
		expect(classifyVbtZone(0.5).zone).toBe("MODERATE");
		expect(classifyVbtZone(0.6).zone).toBe("MODERATE");
		expect(classifyVbtZone(0.74).zone).toBe("MODERATE");
	});

	it("classifies 0.75 - 1.0 as FAST", () => {
		expect(classifyVbtZone(0.75).zone).toBe("FAST");
		expect(classifyVbtZone(0.85).zone).toBe("FAST");
		expect(classifyVbtZone(0.99).zone).toBe("FAST");
	});

	it("classifies >= 1.0 as EXPLOSIVE", () => {
		expect(classifyVbtZone(1.0).zone).toBe("EXPLOSIVE");
		expect(classifyVbtZone(1.15).zone).toBe("EXPLOSIVE");
		expect(classifyVbtZone(1.5).zone).toBe("EXPLOSIVE");
		expect(classifyVbtZone(2.5).zone).toBe("EXPLOSIVE");
	});

	// Boundary tests
	it("classifies exactly 0.25 as SLOW (boundary)", () => {
		const result = classifyVbtZone(0.25);
		expect(result.zone).toBe("SLOW");
		expect(result.label).toBe("Slow");
	});

	it("classifies exactly 0.5 as MODERATE (boundary)", () => {
		const result = classifyVbtZone(0.5);
		expect(result.zone).toBe("MODERATE");
		expect(result.label).toBe("Moderate");
	});

	it("classifies exactly 0.75 as FAST (boundary)", () => {
		const result = classifyVbtZone(0.75);
		expect(result.zone).toBe("FAST");
		expect(result.label).toBe("Fast");
	});

	it("classifies exactly 1.0 as EXPLOSIVE (boundary)", () => {
		const result = classifyVbtZone(1.0);
		expect(result.zone).toBe("EXPLOSIVE");
		expect(result.label).toBe("Explosive");
	});

	// Edge cases
	it("handles 0 velocity as GRIND", () => {
		const result = classifyVbtZone(0);
		expect(result.zone).toBe("GRIND");
	});

	it("handles negative velocity as GRIND (fallback)", () => {
		const result = classifyVbtZone(-0.5);
		expect(result.zone).toBe("GRIND");
	});

	it("handles very high velocity as EXPLOSIVE", () => {
		const result = classifyVbtZone(5.0);
		expect(result.zone).toBe("EXPLOSIVE");
	});

	it("returns a SimplifiedZoneInfo with all required fields", () => {
		const result = classifyVbtZone(0.6);
		expect(result).toHaveProperty("zone");
		expect(result).toHaveProperty("label");
		expect(result).toHaveProperty("color");
		expect(result).toHaveProperty("minVelocity");
		expect(result).toHaveProperty("maxVelocity");
		expect(result).toHaveProperty("description");
	});
});

// ============================================================
// Dr. Mann Zone System Tests
// ============================================================

describe("MANN_ZONES", () => {
	it("contains exactly 5 zones", () => {
		expect(MANN_ZONES).toHaveLength(5);
	});

	it("zones are contiguous", () => {
		for (let i = 0; i < MANN_ZONES.length - 1; i++) {
			expect(MANN_ZONES[i].maxVelocity).toBe(MANN_ZONES[i + 1].minVelocity);
		}
	});

	it("last zone has Infinity maxVelocity", () => {
		expect(MANN_ZONES[MANN_ZONES.length - 1].maxVelocity).toBe(Infinity);
	});

	it("zones follow correct order", () => {
		const expectedZones = [
			"absolute-strength",
			"accelerative-strength",
			"strength-speed",
			"speed-strength",
			"starting-strength",
		];
		MANN_ZONES.forEach((z, i) => {
			expect(z.zone).toBe(expectedZones[i]);
		});
	});
});

describe("classifyMannZone (Dr. Mann System)", () => {
	// Core zone classification tests
	it("classifies < 0.5 as absolute-strength", () => {
		expect(classifyMannZone(0).zone).toBe("absolute-strength");
		expect(classifyMannZone(0.25).zone).toBe("absolute-strength");
		expect(classifyMannZone(0.49).zone).toBe("absolute-strength");
	});

	it("classifies 0.5 - 0.75 as accelerative-strength", () => {
		expect(classifyMannZone(0.5).zone).toBe("accelerative-strength");
		expect(classifyMannZone(0.6).zone).toBe("accelerative-strength");
		expect(classifyMannZone(0.74).zone).toBe("accelerative-strength");
	});

	it("classifies 0.75 - 1.0 as strength-speed", () => {
		expect(classifyMannZone(0.75).zone).toBe("strength-speed");
		expect(classifyMannZone(0.85).zone).toBe("strength-speed");
		expect(classifyMannZone(0.99).zone).toBe("strength-speed");
	});

	it("classifies 1.0 - 1.3 as speed-strength", () => {
		expect(classifyMannZone(1.0).zone).toBe("speed-strength");
		expect(classifyMannZone(1.15).zone).toBe("speed-strength");
		expect(classifyMannZone(1.29).zone).toBe("speed-strength");
	});

	it("classifies >= 1.3 as starting-strength", () => {
		expect(classifyMannZone(1.3).zone).toBe("starting-strength");
		expect(classifyMannZone(1.5).zone).toBe("starting-strength");
		expect(classifyMannZone(2.5).zone).toBe("starting-strength");
	});

	// Boundary tests
	it("classifies exactly 0.5 as accelerative-strength (boundary)", () => {
		const result = classifyMannZone(0.5);
		expect(result.zone).toBe("accelerative-strength");
		expect(result.label).toBe("Accelerative Strength");
	});

	it("classifies exactly 0.75 as strength-speed (boundary)", () => {
		const result = classifyMannZone(0.75);
		expect(result.zone).toBe("strength-speed");
		expect(result.label).toBe("Strength-Speed");
	});

	it("classifies exactly 1.0 as speed-strength (boundary)", () => {
		const result = classifyMannZone(1.0);
		expect(result.zone).toBe("speed-strength");
		expect(result.label).toBe("Speed-Strength");
	});

	it("classifies exactly 1.3 as starting-strength (boundary)", () => {
		const result = classifyMannZone(1.3);
		expect(result.zone).toBe("starting-strength");
		expect(result.label).toBe("Starting Strength");
	});

	// Edge cases
	it("handles 0 velocity as absolute-strength", () => {
		const result = classifyMannZone(0);
		expect(result.zone).toBe("absolute-strength");
	});

	it("handles negative velocity as absolute-strength (fallback)", () => {
		const result = classifyMannZone(-0.5);
		expect(result.zone).toBe("absolute-strength");
	});

	it("handles very high velocity as starting-strength", () => {
		const result = classifyMannZone(5.0);
		expect(result.zone).toBe("starting-strength");
	});

	it("returns a MannZoneInfo with all required fields", () => {
		const result = classifyMannZone(0.6);
		expect(result).toHaveProperty("zone");
		expect(result).toHaveProperty("label");
		expect(result).toHaveProperty("color");
		expect(result).toHaveProperty("minVelocity");
		expect(result).toHaveProperty("maxVelocity");
		expect(result).toHaveProperty("description");
	});
});

// ============================================================
// Helper Function Tests
// ============================================================

describe("getSimplifiedZoneById", () => {
	it("returns zone info for valid GRIND zone", () => {
		const zone = getSimplifiedZoneById("GRIND");
		expect(zone).toBeDefined();
		expect(zone?.label).toBe("Grind");
	});

	it("returns zone info for valid EXPLOSIVE zone", () => {
		const zone = getSimplifiedZoneById("EXPLOSIVE");
		expect(zone).toBeDefined();
		expect(zone?.label).toBe("Explosive");
	});

	it("returns undefined for invalid zone", () => {
		// biome-ignore lint/suspicious/noExplicitAny: intentionally passing invalid type to test runtime guard
		const zone = getSimplifiedZoneById("INVALID" as any);
		expect(zone).toBeUndefined();
	});
});

describe("getMannZoneById", () => {
	it("returns zone info for valid absolute-strength zone", () => {
		const zone = getMannZoneById("absolute-strength");
		expect(zone).toBeDefined();
		expect(zone?.label).toBe("Absolute Strength");
	});

	it("returns zone info for valid starting-strength zone", () => {
		const zone = getMannZoneById("starting-strength");
		expect(zone).toBeDefined();
		expect(zone?.label).toBe("Starting Strength");
	});

	it("returns undefined for invalid zone", () => {
		// biome-ignore lint/suspicious/noExplicitAny: intentionally passing invalid type to test runtime guard
		const zone = getMannZoneById("invalid" as any);
		expect(zone).toBeUndefined();
	});
});

// ============================================================
// Parity Tests: Mobile vs Portal Zone Boundaries
// ============================================================

describe("Zone Boundary Parity (Mobile vs Portal)", () => {
	const testCases = [
		{ velocity: 0, simplified: "GRIND", mann: "absolute-strength" },
		{ velocity: 0.1, simplified: "GRIND", mann: "absolute-strength" },
		{ velocity: 0.24, simplified: "GRIND", mann: "absolute-strength" },
		{ velocity: 0.25, simplified: "SLOW", mann: "absolute-strength" },
		{ velocity: 0.3, simplified: "SLOW", mann: "absolute-strength" },
		{ velocity: 0.49, simplified: "SLOW", mann: "absolute-strength" },
		{ velocity: 0.5, simplified: "MODERATE", mann: "accelerative-strength" },
		{ velocity: 0.6, simplified: "MODERATE", mann: "accelerative-strength" },
		{ velocity: 0.74, simplified: "MODERATE", mann: "accelerative-strength" },
		{ velocity: 0.75, simplified: "FAST", mann: "strength-speed" },
		{ velocity: 0.85, simplified: "FAST", mann: "strength-speed" },
		{ velocity: 0.99, simplified: "FAST", mann: "strength-speed" },
		{ velocity: 1.0, simplified: "EXPLOSIVE", mann: "speed-strength" },
		{ velocity: 1.15, simplified: "EXPLOSIVE", mann: "speed-strength" },
		{ velocity: 1.29, simplified: "EXPLOSIVE", mann: "speed-strength" },
		{ velocity: 1.3, simplified: "EXPLOSIVE", mann: "starting-strength" },
		{ velocity: 1.5, simplified: "EXPLOSIVE", mann: "starting-strength" },
		{ velocity: 2.5, simplified: "EXPLOSIVE", mann: "starting-strength" },
	];

	testCases.forEach(({ velocity, simplified, mann }) => {
		it(`velocity ${velocity}: simplified=${simplified}, mann=${mann}`, () => {
			expect(classifyVbtZone(velocity).zone).toBe(simplified);
			expect(classifyMannZone(velocity).zone).toBe(mann);
		});
	});
});
