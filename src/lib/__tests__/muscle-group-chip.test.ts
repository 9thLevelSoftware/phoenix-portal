import { describe, expect, it } from "vitest";
import {
	getMuscleGroupColor,
	MUSCLE_GROUP_CHIP_CLASS,
} from "@/lib/muscle-group-chip";

describe("muscle group chip map", () => {
	it("styles every canonical group, including Core", () => {
		expect(Object.keys(MUSCLE_GROUP_CHIP_CLASS)).toEqual([
			"Chest",
			"Shoulders",
			"Back",
			"Legs",
			"Arms",
			"Core",
		]);
		expect(getMuscleGroupColor("Core")).toBe("bg-chart-5 text-background");
		expect(getMuscleGroupColor("Chest")).toBe("bg-primary text-background");
	});

	it("falls unknown groups through to the secondary chip", () => {
		expect(getMuscleGroupColor("General")).toBe(
			"bg-secondary text-secondary-foreground",
		);
	});
});
