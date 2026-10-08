import { describe, expect, it } from "vitest";
import { formatExercisePrescriptionLine } from "@/lib/exercisePrescription";

const loaded = {
	sets: 3,
	reps: 10,
	weight: 20,
	durationSeconds: null,
	isAmrap: false,
	isBodyweight: false,
	mode: "OLD_SCHOOL",
};

describe("formatExercisePrescriptionLine", () => {
	it("formats a rep-based loaded set", () => {
		expect(formatExercisePrescriptionLine(loaded, "kg")).toBe(
			"3 sets • 10 reps • 20 kg per cable • Old School",
		);
	});

	it("formats the same load in pounds", () => {
		expect(formatExercisePrescriptionLine(loaded, "lbs")).toBe(
			"3 sets • 10 reps • 44.1 lbs per cable • Old School",
		);
	});

	it("shows duration in seconds ahead of reps and AMRAP", () => {
		expect(
			formatExercisePrescriptionLine(
				{
					...loaded,
					durationSeconds: 45,
					isAmrap: true,
					mode: "PUMP",
				},
				"kg",
			),
		).toBe("3 sets • 45s • 20 kg per cable • Pump");
	});

	it("treats a zero duration as unset and falls through to AMRAP", () => {
		expect(
			formatExercisePrescriptionLine(
				{ ...loaded, durationSeconds: 0, isAmrap: true, mode: "ECHO" },
				"kg",
			),
		).toBe("3 sets • AMRAP • 20 kg per cable • Echo");
	});

	it("replaces the load with Bodyweight", () => {
		expect(
			formatExercisePrescriptionLine(
				{ ...loaded, isBodyweight: true, weight: 20, mode: "TUT" },
				"kg",
			),
		).toBe("3 sets • 10 reps • Bodyweight • TUT");
	});

	it("shows an unrecognized mode verbatim", () => {
		expect(
			formatExercisePrescriptionLine({ ...loaded, mode: "CUSTOM" }, "kg"),
		).toBe("3 sets • 10 reps • 20 kg per cable • CUSTOM");
	});
});
