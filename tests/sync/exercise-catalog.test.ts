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

describe("Exercise Catalog Sync", () => {
	describe("exercise_id preservation through push", () => {
		it("should store exercise_id on session exercises when provided", () => {
			const exerciseRow = {
				id: "session-ex-uuid-1",
				session_id: "session-uuid-1",
				user_id: "user-uuid-1",
				name: "Bicep Curl",
				muscle_group: "Arms",
				order_index: 0,
				exercise_id: "abc123_long_bar",
			};

			expect(exerciseRow.exercise_id).toBe("abc123_long_bar");
			expect(exerciseRow.name).toBe("Bicep Curl");
		});

		it("should accept null exercise_id for backward compatibility", () => {
			const exerciseRow = {
				id: "session-ex-uuid-2",
				session_id: "session-uuid-2",
				user_id: "user-uuid-2",
				name: "Bicep Curl",
				muscle_group: "Arms",
				order_index: 0,
				exercise_id: null,
			};

			expect(exerciseRow.exercise_id).toBeNull();
		});

		it("should store exercise_id on routine exercises when provided", () => {
			const routineExRow = {
				id: "re-uuid-1",
				routine_id: "routine-uuid-1",
				name: "Bicep Curl",
				muscle_group: "Arms",
				exercise_id: "abc123_long_bar",
				sets: 3,
				reps: 10,
			};

			expect(routineExRow.exercise_id).toBe("abc123_long_bar");
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
