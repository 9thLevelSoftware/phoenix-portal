import { describe, expect, it } from "vitest";
import { computeRecoveryHours, computeSraStatus } from "@/lib/sra-recovery";

describe("computeRecoveryHours", () => {
	it("returns base hours for normal session", () => {
		const hours = computeRecoveryHours("Chest", {
			isHeavy: false,
			isHighVolume: false,
		});
		expect(hours).toBe(60);
	});

	it("adds heavy modifier", () => {
		const hours = computeRecoveryHours("Chest", {
			isHeavy: true,
			isHighVolume: false,
		});
		expect(hours).toBe(72); // 60 + 12
	});

	it("adds both modifiers when heavy and high volume", () => {
		const hours = computeRecoveryHours("Legs", {
			isHeavy: true,
			isHighVolume: true,
		});
		expect(hours).toBe(112); // 84 + 16 + 12
	});

	it("returns 48 as default for unknown muscle group", () => {
		const hours = computeRecoveryHours("Unknown", {
			isHeavy: false,
			isHighVolume: false,
		});
		expect(hours).toBe(48);
	});
});

describe("computeSraStatus", () => {
	it("returns FATIGUED when < 33% elapsed", () => {
		const result = computeSraStatus("Chest", {
			hoursSinceLastTrained: 10,
			isHeavy: false,
			isHighVolume: false,
		});
		expect(result.status).toBe("FATIGUED");
		// hoursRemaining should be time to RECOVERED (80% of 60h = 48h), not to end of FATIGUED phase
		expect(result.hoursRemaining).toBe(38); // 48 - 10
	});

	it("returns RECOVERING when 33-80% elapsed", () => {
		const result = computeSraStatus("Chest", {
			hoursSinceLastTrained: 30,
			isHeavy: false,
			isHighVolume: false,
		});
		expect(result.status).toBe("RECOVERING");
	});

	it("returns RECOVERED when 80-120% elapsed", () => {
		const result = computeSraStatus("Chest", {
			hoursSinceLastTrained: 55,
			isHeavy: false,
			isHighVolume: false,
		});
		expect(result.status).toBe("RECOVERED");
		expect(result.hoursRemaining).toBeNull();
	});

	it("returns SUPERCOMPENSATED when > 120% elapsed", () => {
		const result = computeSraStatus("Chest", {
			hoursSinceLastTrained: 80,
			isHeavy: false,
			isHighVolume: false,
		});
		expect(result.status).toBe("SUPERCOMPENSATED");
		expect(result.hoursRemaining).toBeNull();
	});

	it("accounts for heavy modifier in status calculation", () => {
		const result = computeSraStatus("Chest", {
			hoursSinceLastTrained: 30,
			isHeavy: true,
			isHighVolume: false,
		});
		expect(result.status).toBe("RECOVERING");
		expect(result.estimatedRecoveryHours).toBe(72);
	});

	it("handles muscle group never trained", () => {
		const result = computeSraStatus("Chest", {
			hoursSinceLastTrained: null,
			isHeavy: false,
			isHighVolume: false,
		});
		expect(result.status).toBe("RECOVERED");
		expect(result.hoursSinceLastTrained).toBe(0);
	});
});
