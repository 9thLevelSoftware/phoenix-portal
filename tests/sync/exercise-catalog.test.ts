/**
 * Exercise Catalog Sync Tests
 *
 * Validates that exercise_id is preserved through the sync pipeline
 * and that equipment variants maintain their identity.
 */
import { describe, it, expect } from "vitest";
import {
	catalogExerciseSchema,
	equipmentDisplayMap,
	formatEquipment,
} from "@/schemas/transforms";
import { pushPayloadSchema } from "../../supabase/functions/_shared/pushPayloadSchema.ts";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_EXERCISE_ID = "22222222-2222-4222-8222-222222222222";
const ROUTINE_ID = "33333333-3333-4333-8333-333333333333";
const ROUTINE_EXERCISE_ID = "44444444-4444-4444-8444-444444444444";

describe("Exercise Catalog Sync", () => {
	describe("exercise_id preservation through push", () => {
		it("should store exercise_id on session exercises when provided", () => {
			const parsed = pushPayloadSchema.parse({
				deviceId: "device-1",
				platform: "android",
				sessions: [
					{
						id: SESSION_ID,
						userId: "user-uuid-1",
						exercises: [
							{
								id: SESSION_EXERCISE_ID,
								sessionId: SESSION_ID,
								name: "Bicep Curl",
								muscleGroup: "Arms",
								exerciseId: "abc123_long_bar",
							},
						],
					},
				],
			});

			expect(parsed.sessions[0]?.exercises[0]?.exerciseId).toBe(
				"abc123_long_bar",
			);
			expect(parsed.sessions[0]?.exercises[0]?.name).toBe("Bicep Curl");
		});

		it("should accept null exercise_id for backward compatibility", () => {
			const parsed = pushPayloadSchema.parse({
				deviceId: "device-1",
				platform: "android",
				sessions: [
					{
						id: SESSION_ID,
						userId: "user-uuid-2",
						exercises: [
							{
								id: SESSION_EXERCISE_ID,
								sessionId: SESSION_ID,
								name: "Bicep Curl",
								exerciseId: null,
							},
						],
					},
				],
			});

			expect(parsed.sessions[0]?.exercises[0]?.exerciseId).toBeNull();
		});

		it("should store exercise_id on routine exercises when provided", () => {
			const parsed = pushPayloadSchema.parse({
				deviceId: "device-1",
				platform: "android",
				routines: [
					{
						id: ROUTINE_ID,
						userId: "user-uuid-1",
						name: "Arm Day",
						exercises: [
							{
								id: ROUTINE_EXERCISE_ID,
								routineId: ROUTINE_ID,
								name: "Bicep Curl",
								muscleGroup: "Arms",
								exerciseId: "abc123_long_bar",
							},
						],
					},
				],
			});

			expect(parsed.routines[0]?.exercises[0]?.exerciseId).toBe(
				"abc123_long_bar",
			);
		});
	});

	describe("equipment variant disambiguation", () => {
		it("should treat same-name exercises with different IDs as distinct", () => {
			const longBar = {
				id: "abc123",
				name: "Bicep Curl",
				equipment: ["LONG_BAR"],
			};
			const shortBar = {
				id: "def456",
				name: "Bicep Curl",
				equipment: ["SHORT_BAR"],
			};
			const handles = {
				id: "ghi789",
				name: "Bicep Curl",
				equipment: ["HANDLES"],
			};

			expect(longBar.id).not.toBe(shortBar.id);
			expect(shortBar.id).not.toBe(handles.id);
			expect(longBar.name).toBe(shortBar.name);
			expect(longBar.name).toBe(handles.name);
		});
	});

	describe("display name generation", () => {
		it("should disambiguate equipment variants with parenthetical suffix", () => {
			const exercises = [
				{ id: "1", name: "Bicep Curl", equipment: ["LONG_BAR"] },
				{ id: "2", name: "Bicep Curl", equipment: ["SHORT_BAR"] },
				{ id: "3", name: "Bicep Curl", equipment: ["HANDLES"] },
				{ id: "4", name: "Deadlift", equipment: ["BAR"] },
			];

			const nameCount = new Map<string, number>();
			for (const ex of exercises) {
				nameCount.set(ex.name, (nameCount.get(ex.name) ?? 0) + 1);
			}

			const displayNames = exercises.map((ex) => {
				if ((nameCount.get(ex.name) ?? 1) > 1 && ex.equipment.length > 0) {
					return `${ex.name} (${equipmentDisplayMap[ex.equipment[0]] ?? ex.equipment[0]})`;
				}
				return ex.name;
			});

			expect(displayNames).toEqual([
				"Bicep Curl (Long Bar)",
				"Bicep Curl (Short Bar)",
				"Bicep Curl (Handles)",
				"Deadlift",
			]);
		});

		it("should trim trailing whitespace from exercise names", () => {
			const rawName = "Alternating Lunges ";
			expect(rawName.trim()).toBe("Alternating Lunges");
		});
	});

	describe("formatEquipment", () => {
		it("should format known equipment codes to display labels", () => {
			expect(formatEquipment(["LONG_BAR"])).toBe("Long Bar");
			expect(formatEquipment(["HANDLES", "BENCH"])).toBe("Handles, Bench");
			expect(formatEquipment(["GREY_CABLES"])).toBe("Cables");
		});

		it("should pass through unknown equipment codes", () => {
			expect(formatEquipment(["UNKNOWN_THING"])).toBe("UNKNOWN_THING");
		});

		it("should handle empty equipment array", () => {
			expect(formatEquipment([])).toBe("");
		});
	});

	describe("catalogExerciseSchema", () => {
		it("should parse a valid catalog exercise", () => {
			const raw = {
				id: "4kmhj9yyZcBI54Vi",
				name: "Bicep Curl",
				display_name: "Bicep Curl (Long Bar)",
				description: null,
				muscle_group: "Arms",
				muscle_groups: ["Arms"],
				muscles: ["Biceps"],
				equipment: ["LONG_BAR"],
				movement: "PULL",
				sidedness: null,
				grip: null,
				grip_width: null,
				default_cable_config: "DOUBLE",
				min_rep_range: null,
				popularity: 0.5,
				aliases: null,
				thumbnail_url: null,
				archived: false,
				is_custom: false,
			};

			const parsed = catalogExerciseSchema.parse(raw);
			expect(parsed.id).toBe("4kmhj9yyZcBI54Vi");
			expect(parsed.display_name).toBe("Bicep Curl (Long Bar)");
			expect(parsed.equipment).toEqual(["LONG_BAR"]);
			expect(parsed.is_custom).toBe(false);
		});

		it("should parse a custom exercise", () => {
			const raw = {
				id: "custom_1714700000000",
				name: "My Custom Press",
				display_name: "My Custom Press",
				description: null,
				muscle_group: "Chest",
				muscle_groups: ["Chest"],
				muscles: null,
				equipment: [],
				movement: null,
				sidedness: null,
				grip: null,
				grip_width: null,
				default_cable_config: "DOUBLE",
				min_rep_range: null,
				popularity: 0,
				aliases: null,
				thumbnail_url: null,
				archived: false,
				is_custom: true,
			};

			const parsed = catalogExerciseSchema.parse(raw);
			expect(parsed.id).toBe("custom_1714700000000");
			expect(parsed.is_custom).toBe(true);
		});
	});
});
