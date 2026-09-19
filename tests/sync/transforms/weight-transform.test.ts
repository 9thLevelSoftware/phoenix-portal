/**
 * Weight Transform Tests
 *
 * Loads are stored and synced per cable, exactly as the phone shows them.
 * The portal shows the per-cable figure first and adds a total only when the
 * exercise's cable count is known (KD-8), via src/lib/units/loadDisplay.ts.
 * A NULL cable count means unknown: per cable only, never assume 2 cables.
 *
 * Key test scenarios:
 * - Per-cable storage verification through push/pull
 * - Display adapter: 2 cables -> total x2, 1 cable -> total x1, unknown -> none
 * - Edge cases: 0, 1, 110 (max per-cable)
 * - Weight in all entity types: sessions, exercises, sets, routines
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatLoad, toLoadDisplay } from "@/lib/units/loadDisplay";
import {
	createRoutineExerciseFixture,
	createSessionFixture,
	createSetFixture,
	WEIGHT_BOUNDARY_VALUES,
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
	type RoutineDto,
	type RoutineExerciseDto,
	type SessionDto,
	type SetDto,
} from "../helpers/edge-function-harness";
import { getMockSession, resetMockStore } from "../helpers/mock-edge-functions";

const MAX_PER_CABLE_KG = 110; // Machine physical limit per cable

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
			const perCableWeight = 50; // 50kg per cable, as the phone shows it
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
			const pulledSet = pullResult.data!.sessions[0].exercises[0].sets[0];
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
					pullResult.data!.sessions[0].exercises[0].sets[0].weightKg;
				expect(pulledWeight).toBe(perCableWeight);
			}
		});
	});

	// The three KD-8 acceptance cases, kept here next to the sync round trips
	// (edge cases live in src/lib/units/loadDisplay.test.ts).
	describe("Load display adapter", () => {
		it("20 kg per cable with 2 cables shows 20 and 40", () => {
			expect(toLoadDisplay(20, 2)).toEqual({ perCableKg: 20, totalKg: 40 });
			expect(formatLoad(20, 2, "kg")).toBe("20 kg per cable · 40 kg total");
		});

		it("20 kg per cable with 1 cable shows 20 and 20 (never doubled)", () => {
			expect(toLoadDisplay(20, 1)).toEqual({ perCableKg: 20, totalKg: 20 });
			expect(formatLoad(20, 1, "kg")).toBe("20 kg per cable · 20 kg total");
		});

		it("unknown cable count shows 20 only", () => {
			expect(toLoadDisplay(20, null)).toEqual({
				perCableKg: 20,
				totalKg: null,
			});
			expect(formatLoad(20, null, "kg")).toBe("20 kg per cable");
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
				pullResult.data!.sessions[0].exercises[0].sets[0].weightKg;
			expect(pulledWeight).toBe(0);

			// Display is 0 per cable (and 0 total when the count is known)
			expect(toLoadDisplay(pulledWeight, 2)).toEqual({
				perCableKg: 0,
				totalKg: 0,
			});
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
								weightKg: 1, // 1kg per cable
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
				pullResult.data!.sessions[0].exercises[0].sets[0].weightKg;
			expect(pulledWeight).toBe(1);

			// Primary display is the pulled per-cable value; unknown count -> no total
			expect(toLoadDisplay(pulledWeight, null)).toEqual({
				perCableKg: 1,
				totalKg: null,
			});
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
								weightKg: MAX_PER_CABLE_KG, // 110kg per cable
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
				pullResult.data!.sessions[0].exercises[0].sets[0].weightKg;
			expect(pulledWeight).toBe(MAX_PER_CABLE_KG);

			expect(toLoadDisplay(pulledWeight, 2)).toEqual({
				perCableKg: MAX_PER_CABLE_KG,
				totalKg: MAX_PER_CABLE_KG * 2,
			});
			expect(toLoadDisplay(pulledWeight, 1).totalKg).toBe(MAX_PER_CABLE_KG);
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

			expect(pullResult.data!.sessions[0].totalVolume).toBe(perCableVolume);
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

			expect(pullResult.data!.sessions[0].heaviestLiftKg).toBe(
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

			const pulledSets = pullResult.data!.sessions[0].exercises[0].sets;
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

			const pulledExercise = pullResult.data!.routines[0].exercises[0];
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
				pullResult.data!.routines[0].exercises[0].perSetWeights;
			expect(pulledPerSetWeights).toBe(JSON.stringify(perSetWeightsPerCable));

			// Verify parsing and values
			const parsed = JSON.parse(pulledPerSetWeights as string);
			expect(parsed).toEqual(perSetWeightsPerCable);
		});
	});

	describe("Weight Transform Consistency", () => {
		it("should correctly round-trip volume calculations", async () => {
			// Volume = weight * reps
			// If weight is per-cable, volume should also be per-cable

			const perCableWeight = 50;
			const reps = 10;
			const sets = 3;
			const exercises = 2;

			const expectedPerCableVolume = perCableWeight * reps * sets * exercises;

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

			expect(pullResult.data!.sessions[0].totalVolume).toBe(
				expectedPerCableVolume,
			);
		});
	});
});
