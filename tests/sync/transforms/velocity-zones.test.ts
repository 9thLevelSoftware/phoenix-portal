/**
 * Velocity Zones and Asymmetry Tests
 *
 * Validates the biomechanics data transformations for:
 * - Velocity zone classification boundaries (EXPLOSIVE, FAST, MODERATE, SLOW, GRIND)
 * - Asymmetry threshold (2% = BALANCED)
 *
 * These are parity-critical values shared between mobile and portal.
 *
 * Key test scenarios:
 * - Velocity zone boundary classification
 * - Asymmetry threshold for balance classification
 * - Rep summary data integrity through sync
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ASYMMETRY_BALANCED_THRESHOLD,
	VELOCITY_ZONES,
	type VelocityZone,
} from "../fixtures";
import {
	callPullEndpoint,
	callPushEndpoint,
	createMinimalPushPayload,
	createTestExercise,
	createTestSession,
	createTestSet,
	createTestUser,
	generateTestId,
	type RepSummaryDto,
	type SessionDto,
	type SetDto,
} from "../helpers/edge-function-harness";
import { resetMockStore } from "../helpers/mock-edge-functions";

vi.setConfig({ testTimeout: 30000 });

// Velocity zone thresholds (must match mobile and portal)
const ZONE_THRESHOLDS = {
	EXPLOSIVE: 1.0, // >= 1.0 m/s
	FAST: 0.75, // >= 0.75 m/s
	MODERATE: 0.5, // >= 0.5 m/s
	SLOW: 0.25, // >= 0.25 m/s
	GRIND: 0, // < 0.25 m/s
} as const;

// Asymmetry threshold (percentage difference for BALANCED)
const ASYMMETRY_THRESHOLD = 2; // 2%

/**
 * Classify velocity into a zone based on mean velocity
 */
function classifyVelocityZone(velocityMps: number): VelocityZone {
	if (velocityMps >= ZONE_THRESHOLDS.EXPLOSIVE) return "EXPLOSIVE";
	if (velocityMps >= ZONE_THRESHOLDS.FAST) return "FAST";
	if (velocityMps >= ZONE_THRESHOLDS.MODERATE) return "MODERATE";
	if (velocityMps >= ZONE_THRESHOLDS.SLOW) return "SLOW";
	return "GRIND";
}

/**
 * Classify asymmetry as BALANCED or IMBALANCED
 */
function classifyAsymmetry(asymmetryPct: number): "BALANCED" | "IMBALANCED" {
	return Math.abs(asymmetryPct) <= ASYMMETRY_THRESHOLD
		? "BALANCED"
		: "IMBALANCED";
}

describe("Velocity Zone Tests", () => {
	let testUser: { id: string; email: string; accessToken: string };

	beforeEach(async () => {
		resetMockStore();
		testUser = await createTestUser();
	});

	describe("Zone Boundary Classification", () => {
		it("should classify velocity >= 1.0 m/s as EXPLOSIVE", () => {
			const testVelocities = [1.0, 1.1, 1.5, 2.0, 3.0];

			for (const velocity of testVelocities) {
				expect(classifyVelocityZone(velocity)).toBe("EXPLOSIVE");
			}
		});

		it("should classify velocity >= 0.75 and < 1.0 m/s as FAST", () => {
			const testVelocities = [0.75, 0.8, 0.85, 0.9, 0.99];

			for (const velocity of testVelocities) {
				expect(classifyVelocityZone(velocity)).toBe("FAST");
			}
		});

		it("should classify velocity >= 0.5 and < 0.75 m/s as MODERATE", () => {
			const testVelocities = [0.5, 0.55, 0.6, 0.7, 0.74];

			for (const velocity of testVelocities) {
				expect(classifyVelocityZone(velocity)).toBe("MODERATE");
			}
		});

		it("should classify velocity >= 0.25 and < 0.5 m/s as SLOW", () => {
			const testVelocities = [0.25, 0.3, 0.35, 0.4, 0.49];

			for (const velocity of testVelocities) {
				expect(classifyVelocityZone(velocity)).toBe("SLOW");
			}
		});

		it("should classify velocity < 0.25 m/s as GRIND", () => {
			const testVelocities = [0, 0.05, 0.1, 0.15, 0.24];

			for (const velocity of testVelocities) {
				expect(classifyVelocityZone(velocity)).toBe("GRIND");
			}
		});

		it("should handle exact boundary values correctly", () => {
			// Exact boundary tests - boundary values belong to higher zone
			expect(classifyVelocityZone(1.0)).toBe("EXPLOSIVE"); // >= 1.0
			expect(classifyVelocityZone(0.9999)).toBe("FAST"); // < 1.0

			expect(classifyVelocityZone(0.75)).toBe("FAST"); // >= 0.75
			expect(classifyVelocityZone(0.7499)).toBe("MODERATE"); // < 0.75

			expect(classifyVelocityZone(0.5)).toBe("MODERATE"); // >= 0.5
			expect(classifyVelocityZone(0.4999)).toBe("SLOW"); // < 0.5

			expect(classifyVelocityZone(0.25)).toBe("SLOW"); // >= 0.25
			expect(classifyVelocityZone(0.2499)).toBe("GRIND"); // < 0.25
		});
	});

	describe("Zone Thresholds Match Expected Values", () => {
		it("should have EXPLOSIVE threshold at 1.0 m/s", () => {
			expect(VELOCITY_ZONES.EXPLOSIVE).toBe(1.0);
			expect(ZONE_THRESHOLDS.EXPLOSIVE).toBe(1.0);
		});

		it("should have FAST threshold at 0.75 m/s", () => {
			expect(VELOCITY_ZONES.FAST).toBe(0.75);
			expect(ZONE_THRESHOLDS.FAST).toBe(0.75);
		});

		it("should have MODERATE threshold at 0.5 m/s", () => {
			expect(VELOCITY_ZONES.MODERATE).toBe(0.5);
			expect(ZONE_THRESHOLDS.MODERATE).toBe(0.5);
		});

		it("should have SLOW threshold at 0.25 m/s", () => {
			expect(VELOCITY_ZONES.SLOW).toBe(0.25);
			expect(ZONE_THRESHOLDS.SLOW).toBe(0.25);
		});

		it("should have GRIND threshold at 0 m/s", () => {
			expect(VELOCITY_ZONES.GRIND).toBe(0);
			expect(ZONE_THRESHOLDS.GRIND).toBe(0);
		});
	});

	describe("Velocity Zone in Rep Summary Round-Trip", () => {
		it("should preserve vbt_zone through sync round-trip", async () => {
			const sessionId = generateTestId();
			const exerciseId = generateTestId();
			const setId = generateTestId();

			// Create rep summaries with different velocity zones
			const repSummaries: RepSummaryDto[] = [
				{
					id: generateTestId(),
					setId,
					repNumber: 1,
					meanVelocityMps: 1.2,
					peakVelocityMps: 1.5,
					meanForceN: 500,
					peakForceN: 650,
					powerWatts: 600,
					romMm: 800,
					tutMs: 1500,
					leftForceAvg: 250,
					rightForceAvg: 250,
					asymmetryPct: 0,
					vbtZone: "EXPLOSIVE",
				},
				{
					id: generateTestId(),
					setId,
					repNumber: 2,
					meanVelocityMps: 0.8,
					peakVelocityMps: 1.1,
					meanForceN: 520,
					peakForceN: 680,
					powerWatts: 420,
					romMm: 800,
					tutMs: 2000,
					leftForceAvg: 260,
					rightForceAvg: 260,
					asymmetryPct: 0,
					vbtZone: "FAST",
				},
				{
					id: generateTestId(),
					setId,
					repNumber: 3,
					meanVelocityMps: 0.55,
					peakVelocityMps: 0.8,
					meanForceN: 540,
					peakForceN: 700,
					powerWatts: 300,
					romMm: 800,
					tutMs: 2500,
					leftForceAvg: 270,
					rightForceAvg: 270,
					asymmetryPct: 0,
					vbtZone: "MODERATE",
				},
			];

			const set: SetDto = createTestSet(exerciseId, 1, {
				id: setId,
				actualReps: 3,
				repSummaries,
			});

			const session: SessionDto = createTestSession(testUser.id, {
				id: sessionId,
				exercises: [
					createTestExercise(sessionId, 0, {
						id: exerciseId,
						sets: [set],
					}),
				],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			// Assert: VBT zones preserved
			const pulledReps =
				pullResult.data!.sessions[0].exercises[0].sets[0].repSummaries;
			expect(pulledReps).toHaveLength(3);

			expect(pulledReps.find((r) => r.repNumber === 1)?.vbtZone).toBe(
				"EXPLOSIVE",
			);
			expect(pulledReps.find((r) => r.repNumber === 2)?.vbtZone).toBe("FAST");
			expect(pulledReps.find((r) => r.repNumber === 3)?.vbtZone).toBe(
				"MODERATE",
			);
		});

		it("should preserve mean and peak velocity values", async () => {
			const sessionId = generateTestId();
			const exerciseId = generateTestId();
			const setId = generateTestId();

			const repSummary: RepSummaryDto = {
				id: generateTestId(),
				setId,
				repNumber: 1,
				meanVelocityMps: 0.92,
				peakVelocityMps: 1.35,
				meanForceN: 480,
				peakForceN: 620,
				powerWatts: 442,
				romMm: 850,
				tutMs: 1800,
				leftForceAvg: 240,
				rightForceAvg: 240,
				asymmetryPct: 0,
				vbtZone: "FAST",
			};

			const set: SetDto = createTestSet(exerciseId, 1, {
				id: setId,
				repSummaries: [repSummary],
			});

			const session: SessionDto = createTestSession(testUser.id, {
				id: sessionId,
				exercises: [
					createTestExercise(sessionId, 0, {
						id: exerciseId,
						sets: [set],
					}),
				],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			const pulledRep =
				pullResult.data!.sessions[0].exercises[0].sets[0].repSummaries[0];
			expect(pulledRep.meanVelocityMps).toBe(0.92);
			expect(pulledRep.peakVelocityMps).toBe(1.35);
		});
	});
});

describe("Asymmetry Threshold Tests", () => {
	let testUser: { id: string; email: string; accessToken: string };

	beforeEach(async () => {
		resetMockStore();
		testUser = await createTestUser();
	});

	describe("2% Threshold Classification", () => {
		it("should classify 0% asymmetry as BALANCED", () => {
			expect(classifyAsymmetry(0)).toBe("BALANCED");
		});

		it("should classify 1% asymmetry as BALANCED", () => {
			expect(classifyAsymmetry(1)).toBe("BALANCED");
		});

		it("should classify 2% asymmetry as BALANCED (boundary)", () => {
			expect(classifyAsymmetry(2)).toBe("BALANCED");
		});

		it("should classify 2.1% asymmetry as IMBALANCED", () => {
			expect(classifyAsymmetry(2.1)).toBe("IMBALANCED");
		});

		it("should classify 5% asymmetry as IMBALANCED", () => {
			expect(classifyAsymmetry(5)).toBe("IMBALANCED");
		});

		it("should classify -2% asymmetry as BALANCED (absolute value)", () => {
			expect(classifyAsymmetry(-2)).toBe("BALANCED");
		});

		it("should classify -5% asymmetry as IMBALANCED (absolute value)", () => {
			expect(classifyAsymmetry(-5)).toBe("IMBALANCED");
		});

		it("should handle boundary values precisely", () => {
			// Just at threshold
			expect(classifyAsymmetry(2.0)).toBe("BALANCED");

			// Just over threshold
			expect(classifyAsymmetry(2.01)).toBe("IMBALANCED");

			// Just under threshold
			expect(classifyAsymmetry(1.99)).toBe("BALANCED");
		});
	});

	describe("Asymmetry Threshold Value", () => {
		it("should have ASYMMETRY_BALANCED_THRESHOLD equal to 2", () => {
			expect(ASYMMETRY_BALANCED_THRESHOLD).toBe(2);
			expect(ASYMMETRY_THRESHOLD).toBe(2);
		});
	});

	describe("Asymmetry in Rep Summary Round-Trip", () => {
		it("should preserve asymmetry_pct through sync round-trip", async () => {
			const sessionId = generateTestId();
			const exerciseId = generateTestId();
			const setId = generateTestId();

			const repSummaries: RepSummaryDto[] = [
				{
					id: generateTestId(),
					setId,
					repNumber: 1,
					meanVelocityMps: 0.7,
					peakVelocityMps: 0.95,
					meanForceN: 450,
					peakForceN: 580,
					powerWatts: 315,
					romMm: 800,
					tutMs: 2200,
					leftForceAvg: 225,
					rightForceAvg: 225,
					asymmetryPct: 0, // Perfect balance
					vbtZone: "MODERATE",
				},
				{
					id: generateTestId(),
					setId,
					repNumber: 2,
					meanVelocityMps: 0.68,
					peakVelocityMps: 0.9,
					meanForceN: 460,
					peakForceN: 590,
					powerWatts: 312,
					romMm: 800,
					tutMs: 2300,
					leftForceAvg: 228,
					rightForceAvg: 232,
					asymmetryPct: 1.7, // Slight imbalance, still BALANCED
					vbtZone: "MODERATE",
				},
				{
					id: generateTestId(),
					setId,
					repNumber: 3,
					meanVelocityMps: 0.65,
					peakVelocityMps: 0.85,
					meanForceN: 470,
					peakForceN: 600,
					powerWatts: 305,
					romMm: 800,
					tutMs: 2500,
					leftForceAvg: 220,
					rightForceAvg: 250,
					asymmetryPct: 12.8, // Significant imbalance
					vbtZone: "MODERATE",
				},
			];

			const set: SetDto = createTestSet(exerciseId, 1, {
				id: setId,
				actualReps: 3,
				repSummaries,
			});

			const session: SessionDto = createTestSession(testUser.id, {
				id: sessionId,
				exercises: [
					createTestExercise(sessionId, 0, {
						id: exerciseId,
						sets: [set],
					}),
				],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			// Assert: Asymmetry values preserved
			const pulledReps =
				pullResult.data!.sessions[0].exercises[0].sets[0].repSummaries;

			expect(pulledReps.find((r) => r.repNumber === 1)?.asymmetryPct).toBe(0);
			expect(pulledReps.find((r) => r.repNumber === 2)?.asymmetryPct).toBe(1.7);
			expect(pulledReps.find((r) => r.repNumber === 3)?.asymmetryPct).toBe(
				12.8,
			);
		});

		it("should preserve left and right force values", async () => {
			const sessionId = generateTestId();
			const exerciseId = generateTestId();
			const setId = generateTestId();

			const repSummary: RepSummaryDto = {
				id: generateTestId(),
				setId,
				repNumber: 1,
				meanVelocityMps: 0.7,
				peakVelocityMps: 0.95,
				meanForceN: 450,
				peakForceN: 580,
				powerWatts: 315,
				romMm: 800,
				tutMs: 2200,
				leftForceAvg: 218,
				rightForceAvg: 232,
				asymmetryPct: 6.2, // (232-218)/225 * 100 ~= 6.2%
				vbtZone: "MODERATE",
			};

			const set: SetDto = createTestSet(exerciseId, 1, {
				id: setId,
				repSummaries: [repSummary],
			});

			const session: SessionDto = createTestSession(testUser.id, {
				id: sessionId,
				exercises: [
					createTestExercise(sessionId, 0, {
						id: exerciseId,
						sets: [set],
					}),
				],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			const pulledRep =
				pullResult.data!.sessions[0].exercises[0].sets[0].repSummaries[0];
			expect(pulledRep.leftForceAvg).toBe(218);
			expect(pulledRep.rightForceAvg).toBe(232);
			expect(pulledRep.asymmetryPct).toBe(6.2);
		});
	});

	describe("Session-Level Asymmetry", () => {
		it("should preserve session avg_asymmetry_pct through round-trip", async () => {
			const session: SessionDto = createTestSession(testUser.id, {
				id: generateTestId(),
				avgAsymmetryPct: 1.8, // Below threshold = BALANCED session
				dominantSide: "RIGHT",
				exercises: [],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			expect(pullResult.data!.sessions[0].avgAsymmetryPct).toBe(1.8);
			expect(pullResult.data!.sessions[0].dominantSide).toBe("RIGHT");
		});

		it("should handle imbalanced session correctly", async () => {
			const session: SessionDto = createTestSession(testUser.id, {
				id: generateTestId(),
				avgAsymmetryPct: 8.5, // Above threshold = IMBALANCED session
				dominantSide: "LEFT",
				exercises: [],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			const asymmetry = pullResult.data!.sessions[0].avgAsymmetryPct;
			expect(asymmetry).toBe(8.5);
			expect(classifyAsymmetry(asymmetry!)).toBe("IMBALANCED");
		});
	});
});

describe("Biomechanics Data Integrity", () => {
	let testUser: { id: string; email: string; accessToken: string };

	beforeEach(async () => {
		resetMockStore();
		testUser = await createTestUser();
	});

	describe("Full Rep Summary Round-Trip", () => {
		it("should preserve all biomechanics fields", async () => {
			const sessionId = generateTestId();
			const exerciseId = generateTestId();
			const setId = generateTestId();

			const fullRepSummary: RepSummaryDto = {
				id: generateTestId(),
				setId,
				repNumber: 1,
				meanVelocityMps: 0.82,
				peakVelocityMps: 1.15,
				meanForceN: 485,
				peakForceN: 635,
				powerWatts: 398,
				romMm: 825,
				tutMs: 1950,
				leftForceAvg: 242,
				rightForceAvg: 243,
				asymmetryPct: 0.4,
				vbtZone: "FAST",
			};

			const set: SetDto = createTestSet(exerciseId, 1, {
				id: setId,
				repSummaries: [fullRepSummary],
			});

			const session: SessionDto = createTestSession(testUser.id, {
				id: sessionId,
				exercises: [
					createTestExercise(sessionId, 0, {
						id: exerciseId,
						sets: [set],
					}),
				],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			const pulledRep =
				pullResult.data!.sessions[0].exercises[0].sets[0].repSummaries[0];

			// Assert: All fields preserved
			expect(pulledRep.meanVelocityMps).toBe(0.82);
			expect(pulledRep.peakVelocityMps).toBe(1.15);
			expect(pulledRep.meanForceN).toBe(485);
			expect(pulledRep.peakForceN).toBe(635);
			expect(pulledRep.powerWatts).toBe(398);
			expect(pulledRep.romMm).toBe(825);
			expect(pulledRep.tutMs).toBe(1950);
			expect(pulledRep.leftForceAvg).toBe(242);
			expect(pulledRep.rightForceAvg).toBe(243);
			expect(pulledRep.asymmetryPct).toBe(0.4);
			expect(pulledRep.vbtZone).toBe("FAST");
		});

		it("should handle null biomechanics values gracefully", async () => {
			const sessionId = generateTestId();
			const exerciseId = generateTestId();
			const setId = generateTestId();

			// Rep summary with minimal data (legacy or missing sensors)
			const minimalRepSummary: RepSummaryDto = {
				id: generateTestId(),
				setId,
				repNumber: 1,
				meanVelocityMps: null,
				peakVelocityMps: null,
				meanForceN: null,
				peakForceN: null,
				powerWatts: null,
				romMm: null,
				tutMs: null,
				leftForceAvg: null,
				rightForceAvg: null,
				asymmetryPct: null,
				vbtZone: null,
			};

			const set: SetDto = createTestSet(exerciseId, 1, {
				id: setId,
				repSummaries: [minimalRepSummary],
			});

			const session: SessionDto = createTestSession(testUser.id, {
				id: sessionId,
				exercises: [
					createTestExercise(sessionId, 0, {
						id: exerciseId,
						sets: [set],
					}),
				],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			const pulledRep =
				pullResult.data!.sessions[0].exercises[0].sets[0].repSummaries[0];

			// Assert: Nulls preserved (not converted to 0 or other values)
			expect(pulledRep.meanVelocityMps).toBeNull();
			expect(pulledRep.peakVelocityMps).toBeNull();
			expect(pulledRep.vbtZone).toBeNull();
			expect(pulledRep.asymmetryPct).toBeNull();
		});
	});
});
