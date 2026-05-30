import { describe, expect, it } from "vitest";
import { generateRecordsCSV } from "../csv";

// Use the function's own parameter type so we don't depend on the import path
// of the PersonalRecord type.
type Records = Parameters<typeof generateRecordsCSV>[0];

function record(recordType: string): Records[number] {
	return {
		exercise_name: "Squat",
		muscle_group: "Legs",
		record_type: recordType,
		value: 100,
		previous_value: null,
		unit: "kg",
		achieved_at: new Date("2026-04-20T00:00:00.000Z"),
	} as unknown as Records[number];
}

describe("generateRecordsCSV record type labels", () => {
	it("maps uppercase MAX_WEIGHT to 'Max Weight'", () => {
		const csv = generateRecordsCSV([record("MAX_WEIGHT")] as Records);
		expect(csv).toContain("Max Weight");
		expect(csv).not.toContain("MAX_WEIGHT");
	});
	it("maps MAX_VOLUME to 'Max Volume'", () => {
		const csv = generateRecordsCSV([record("MAX_VOLUME")] as Records);
		expect(csv).toContain("Max Volume");
	});
	it("maps 1RM to 'Estimated 1RM'", () => {
		const csv = generateRecordsCSV([record("1RM")] as Records);
		expect(csv).toContain("Estimated 1RM");
	});
});
