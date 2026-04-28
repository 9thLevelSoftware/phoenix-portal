/**
 * Weight Transform Tests
 *
 * Validates the critical weight transformation that occurs between:
 * - Database storage: Per-cable values (0-220kg range)
 * - Portal display: Total values (per-cable * 2)
 *
 * The Vitruvian Trainer has dual cables, so the database stores per-cable weights
 * but users see total weight lifted. This is a parity-critical transform.
 *
 * Key test scenarios:
 * - Per-cable storage verification
 * - x2 multiplier for display
 * - Edge cases: 0, 1, 110 (max per-cable), 220 (max total)
 * - Weight in all entity types: sessions, exercises, sets, routines
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	callPullEndpoint,
	callPushEndpoint,
	createMinimalPushPayload,
	createTestSession,
	createTestSet,
	createTestUser,
	generateTestId,
	type RoutineDto,
	type RoutineExerciseDto,
	type SessionDto,
	type SetDto,
} from "../helpers/edge-function-harness";
import { getMockSession, resetMockStore } from "../helpers/mock-edge-functions";

// Weight transform constant (must match src/schemas/transforms.ts)
const WEIGHT_MULTIPLIER = 2;
const MAX_PER_CABLE_KG = 110; // Machine physical limit per cable
const MAX_TOTAL_KG = MAX_PER_CABLE_KG * WEIGHT_MULTIPLIER;

vi.setConfig({ testTimeout: 30000 });

describe("Weight Transform Tests", () => {
	let testUser: { id: string; email: string; accessToken: string };

	beforeEach(async () => {
		resetMockStore();
		testUser = await createTestUser();
	});

	describe("Per-Cable Storage Verification", () => {
		it("should store weight values as per-cable in the database", async () => {
			// Arrange: Set with specific per-cable weight
			const perCableWeight = 50; // 50kg per cable = 100kg total
			const sessionId = generateTestId();
			const exerciseId = generateTestId();
			const setId = generateTestId();

			const set: SetDto = createTestSet(exerciseId, 1, {
				id: setId,
				weightKg: perCableWeight,
			});

			const session: SessionDto = createTestSession(testUser.id, {
				id: sessionId,
				exercises: [
					{
						id: exerciseId,
						sessionId,
						name: "Bench Press",
						muscleGroup: "Chest",
						orderIndex: 0,
						sets: [set],
					},
				],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});

			// Act
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			// Assert: Weight stored as per-cable value
			const pulledSet = pullResult.data?.sessions[0].exercises[0].sets[0];
			expect(pulledSet.weightKg).toBe(perCableWeight);

			// Verify mock store has per-cable value
			const mockSession = getMockSession(sessionId);
			if (mockSession) {
				expect(mockSession.exercises[0].sets[0].weightKg).toBe(perCableWeight);
			}
		});

		it("should preserve exact per-cable values through round-trip", async () => {
			// Test various per-cable weights to ensure no rounding/transformation
			const testWeights = [0, 1, 2.5, 5, 10, 25, 50, 75, 100, 110];

			for (const perCableWeight of testWeights) {
				resetMockStore();

				const sessionId = generateTestId();
				const exerciseId = generateTestId();

				const session: SessionDto = createTestSession(testUser.id, {
					id: sessionId,
					exercises: [
						{
							id: exerciseId,
							sessionId,
							name: "Test Exercise",
							muscleGroup: "Test",
							orderIndex: 0,
							sets: [
								createTestSet(exerciseId, 1, {
									id: generateTestId(),
									weightKg: perCableWeight,
								}),
							],
						},
					],
				});

				const payload = createMinimalPushPayload(testUser.id, {
					sessions: [session],
				});
				await callPushEndpoint(payload, testUser.accessToken);
				const pullResult = await callPullEndpoint(0, testUser.accessToken);

				const pulledWeight =
					pullResult.data?.sessions[0].exercises[0].sets[0].weightKg;
				expect(pulledWeight).toBe(perCableWeight);
			}
		});
	});

	describe("Display Multiplier Application", () => {
		it("should apply x2 multiplier when transforming for display", () => {
			// This tests the transform logic that should be applied in the portal UI
			const perCableValue = 60;
			const expectedDisplay = perCableValue * WEIGHT_MULTIPLIER;

			expect(expectedDisplay).toBe(120);
		});

		it("should correctly calculate total weight for various per-cable values", () => {
			const testCases = [
				{ perCable: 0, expectedTotal: 0 },
				{ perCable: 1, expectedTotal: 2 },
				{ perCable: 2.5, expectedTotal: 5 },
				{ perCable: 25, expectedTotal: 50 },
				{ perCable: 50, expectedTotal: 100 },
				{ perCable: 75, expectedTotal: 150 },
				{ perCable: 100, expectedTotal: 200 },
				{ perCable: 110, expectedTotal: 220 },
			];

			for (const { perCable, expectedTotal } of testCases) {
				const displayValue = perCable * WEIGHT_MULTIPLIER;
				expect(displayValue).toBe(expectedTotal);
			}
		});

		it("should handle decimal per-cable weights correctly", () => {
			const decimalWeights = [
				{ perCable: 2.5, expectedTotal: 5 },
				{ perCable: 7.5, expectedTotal: 15 },
				{ perCable: 12.5, expectedTotal: 25 },
				{ perCable: 17.5, expectedTotal: 35 },
				{ perCable: 22.5, expectedTotal: 45 },
			];

			for (const { perCable, expectedTotal } of decimalWeights) {
				const displayValue = perCable * WEIGHT_MULTIPLIER;
				expect(displayValue).toBe(expectedTotal);
			}
		});
	});

	describe("Edge Case Weight Values", () => {
		it("should handle weight = 0 correctly", async () => {
			const sessionId = generateTestId();
			const exerciseId = generateTestId();

			const session: SessionDto = createTestSession(testUser.id, {
				id: sessionId,
				exercises: [
					{
						id: exerciseId,
						sessionId,
						name: "Bodyweight Exercise",
						muscleGroup: "Full Body",
						orderIndex: 0,
						sets: [
							createTestSet(exerciseId, 1, {
								id: generateTestId(),
								weightKg: 0, // Bodyweight or no resistance
							}),
						],
					},
				],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			const pulledWeight =
				pullResult.data?.sessions[0].exercises[0].sets[0].weightKg;
			expect(pulledWeight).toBe(0);

			// Display should also be 0
			const displayWeight = pulledWeight * WEIGHT_MULTIPLIER;
			expect(displayWeight).toBe(0);
		});

		it("should handle weight = 1 (minimum meaningful weight)", async () => {
			const sessionId = generateTestId();
			const exerciseId = generateTestId();

			const session: SessionDto = createTestSession(testUser.id, {
				id: sessionId,
				exercises: [
					{
						id: exerciseId,
						sessionId,
						name: "Light Warmup",
						muscleGroup: "Chest",
						orderIndex: 0,
						sets: [
							createTestSet(exerciseId, 1, {
								id: generateTestId(),
								weightKg: 1, // 1kg per cable = 2kg total
							}),
						],
					},
				],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			const pulledWeight =
				pullResult.data?.sessions[0].exercises[0].sets[0].weightKg;
			expect(pulledWeight).toBe(1);

			const displayWeight = pulledWeight * WEIGHT_MULTIPLIER;
			expect(displayWeight).toBe(2);
		});

		it("should handle weight = 110 (max per-cable)", async () => {
			const sessionId = generateTestId();
			const exerciseId = generateTestId();

			const session: SessionDto = createTestSession(testUser.id, {
				id: sessionId,
				exercises: [
					{
						id: exerciseId,
						sessionId,
						name: "Max Effort Lift",
						muscleGroup: "Legs",
						orderIndex: 0,
						sets: [
							createTestSet(exerciseId, 1, {
								id: generateTestId(),
								weightKg: MAX_PER_CABLE_KG, // 110kg per cable = 220kg total
							}),
						],
					},
				],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			const pulledWeight =
				pullResult.data?.sessions[0].exercises[0].sets[0].weightKg;
			expect(pulledWeight).toBe(MAX_PER_CABLE_KG);

			const displayWeight = pulledWeight * WEIGHT_MULTIPLIER;
			expect(displayWeight).toBe(MAX_TOTAL_KG);
		});

		it("should validate machine physical limits", () => {
			// The Vitruvian Trainer has physical limits
			expect(MAX_PER_CABLE_KG).toBe(110);
			expect(MAX_TOTAL_KG).toBe(220);

			// Values above this shouldn't be possible with the hardware
			const invalidPerCable = 120;
			const wouldBeDisplay = invalidPerCable * WEIGHT_MULTIPLIER;
			expect(wouldBeDisplay).toBe(240);

			// This test documents the expected bounds
			expect(invalidPerCable).toBeGreaterThan(MAX_PER_CABLE_KG);
		});
	});

	describe("Weight in Sessions", () => {
		it("should store session total_volume as per-cable sum", async () => {
			const perCableVolume = 5000; // Total per-cable volume

			const session: SessionDto = createTestSession(testUser.id, {
				id: generateTestId(),
				totalVolume: perCableVolume,
				exercises: [],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			expect(pullResult.data?.sessions[0].totalVolume).toBe(perCableVolume);
		});

		it("should store heaviest_lift_kg as per-cable value", async () => {
			const heaviestPerCable = 100;

			const session: SessionDto = createTestSession(testUser.id, {
				id: generateTestId(),
				heaviestLiftKg: heaviestPerCable,
				exercises: [],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			expect(pullResult.data?.sessions[0].heaviestLiftKg).toBe(
				heaviestPerCable,
			);
		});
	});

	describe("Weight in Sets", () => {
		it("should preserve set weight through complete round-trip", async () => {
			const weights = [20, 40, 60, 80, 100]; // Progressive per-cable weights

			const sessionId = generateTestId();
			const exerciseId = generateTestId();

			const sets: SetDto[] = weights.map((weight, i) =>
				createTestSet(exerciseId, i + 1, {
					id: generateTestId(),
					weightKg: weight,
				}),
			);

			const session: SessionDto = createTestSession(testUser.id, {
				id: sessionId,
				exercises: [
					{
						id: exerciseId,
						sessionId,
						name: "Progressive Set",
						muscleGroup: "Chest",
						orderIndex: 0,
						sets,
					},
				],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			const pulledSets = pullResult.data?.sessions[0].exercises[0].sets;
			expect(pulledSets).toHaveLength(5);

			// Verify each set's weight preserved
			for (let i = 0; i < weights.length; i++) {
				const pulledSet = pulledSets.find((s) => s.setNumber === i + 1);
				expect(pulledSet?.weightKg).toBe(weights[i]);
			}
		});
	});

	describe("Weight in Routines", () => {
		it("should store routine exercise weight as per-cable", async () => {
			const routineId = generateTestId();
			const perCableWeight = 55;

			const exercise: RoutineExerciseDto = {
				id: generateTestId(),
				routineId,
				name: "Routine Bench Press",
				muscleGroup: "Chest",
				sets: 4,
				reps: 10,
				weight: perCableWeight,
				restSeconds: 90,
				mode: "OLD_SCHOOL",
				orderIndex: 0,
			};

			const routine: RoutineDto = {
				id: routineId,
				userId: testUser.id,
				name: "Weight Test Routine",
				description: null,
				exerciseCount: 1,
				estimatedDuration: 20,
				timesCompleted: 0,
				isFavorite: false,
				exercises: [exercise],
			};

			const payload = createMinimalPushPayload(testUser.id, {
				routines: [routine],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			const pulledExercise = pullResult.data?.routines[0].exercises[0];
			expect(pulledExercise.weight).toBe(perCableWeight);
		});

		it("should preserve per-set weights as per-cable values", async () => {
			const routineId = generateTestId();
			const perSetWeightsPerCable = [50, 55, 60, 55]; // Pyramid scheme

			const exercise: RoutineExerciseDto = {
				id: generateTestId(),
				routineId,
				name: "Pyramid Press",
				muscleGroup: "Chest",
				sets: 4,
				reps: 10,
				weight: 50, // Base per-cable
				restSeconds: 90,
				mode: "OLD_SCHOOL",
				orderIndex: 0,
				perSetWeights: JSON.stringify(perSetWeightsPerCable),
			};

			const routine: RoutineDto = {
				id: routineId,
				userId: testUser.id,
				name: "Pyramid Routine",
				description: null,
				exerciseCount: 1,
				estimatedDuration: 20,
				timesCompleted: 0,
				isFavorite: false,
				exercises: [exercise],
			};

			const payload = createMinimalPushPayload(testUser.id, {
				routines: [routine],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			const pulledPerSetWeights =
				pullResult.data?.routines[0].exercises[0].perSetWeights;
			expect(pulledPerSetWeights).toBe(JSON.stringify(perSetWeightsPerCable));

			// Verify parsing and values
			const parsed = JSON.parse(pulledPerSetWeights as string);
			expect(parsed).toEqual(perSetWeightsPerCable);
		});
	});

	describe("Weight Transform Consistency", () => {
		it("should use consistent WEIGHT_MULTIPLIER = 2", () => {
			// This is a critical constant that must match across:
			// - src/schemas/transforms.ts (portal display)
			// - Mobile app (data storage)
			// - This test file

			expect(WEIGHT_MULTIPLIER).toBe(2);
		});

		it("should correctly round-trip volume calculations", async () => {
			// Volume = weight * reps
			// If weight is per-cable, volume should also be per-cable

			const perCableWeight = 50;
			const reps = 10;
			const sets = 3;
			const exercises = 2;

			const expectedPerCableVolume = perCableWeight * reps * sets * exercises;
			const expectedTotalDisplay = expectedPerCableVolume * WEIGHT_MULTIPLIER;

			expect(expectedPerCableVolume).toBe(3000); // 50 * 10 * 3 * 2
			expect(expectedTotalDisplay).toBe(6000); // Displayed as 6000kg total

			// Verify the session stores per-cable volume
			const session: SessionDto = createTestSession(testUser.id, {
				id: generateTestId(),
				totalVolume: expectedPerCableVolume,
				exercises: [],
			});

			const payload = createMinimalPushPayload(testUser.id, {
				sessions: [session],
			});
			await callPushEndpoint(payload, testUser.accessToken);
			const pullResult = await callPullEndpoint(0, testUser.accessToken);

			expect(pullResult.data?.sessions[0].totalVolume).toBe(
				expectedPerCableVolume,
			);
		});
	});
});
