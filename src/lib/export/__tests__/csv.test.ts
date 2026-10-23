import { describe, expect, it } from "vitest";
import { PERSONAL_RECORD_TYPE_LABELS } from "@/lib/personal-record-labels";
import { PERSONAL_RECORD_TYPES } from "../../../../supabase/functions/_shared/personalRecordRow.ts";
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

const RECORD_CSV_HEADERS =
	"Exercise,Muscle Group,Record Type,Workout Phase,Value,Unit,Date Achieved,Previous Value";

/** Labels the Records tab shows; the export must use these exact strings. */
const RECORD_TYPE_EXPORT_LABELS: Record<string, string> = {
	MAX_WEIGHT: "Weight PR",
	MAX_VOLUME: "Volume PR",
	"1RM": "1RM PR",
	MAX_REPS: "Reps PR",
	MAX_DURATION: "Duration PR",
	MAX_FORCE: "Force PR",
	MAX_VELOCITY: "Velocity PR",
	FASTEST_TIME: "Fastest Time",
	LONGEST_DISTANCE: "Longest Distance",
};

function csvRows(csv: string): string[][] {
	return csv.split(/\r?\n/).map((line) => line.split(","));
}

function recordTypeCell(csv: string): string {
	const [cols, values] = csvRows(csv);
	return values[cols.indexOf("Record Type")];
}

describe("generateRecordsCSV record type labels", () => {
	it("keeps the personal-record column order", () => {
		const csv = generateRecordsCSV([record("MAX_WEIGHT")] as Records);
		expect(csvRows(csv)[0].join(",")).toBe(RECORD_CSV_HEADERS);
	});

	it("labels every canonical personal-record type", () => {
		expect(Object.keys(PERSONAL_RECORD_TYPE_LABELS).sort()).toEqual(
			[...PERSONAL_RECORD_TYPES].sort(),
		);
		expect(RECORD_TYPE_EXPORT_LABELS).toEqual(PERSONAL_RECORD_TYPE_LABELS);
	});

	it.each(
		Object.entries(RECORD_TYPE_EXPORT_LABELS),
	)("exports %s as %s", (recordType, label) => {
		const csv = generateRecordsCSV([record(recordType)] as Records);
		expect(recordTypeCell(csv)).toBe(label);
		expect(recordTypeCell(csv)).not.toBe(recordType);
	});

	it.each(
		Object.entries(RECORD_TYPE_EXPORT_LABELS),
	)("exports lowercase %s as %s", (recordType, label) => {
		const csv = generateRecordsCSV([
			record(recordType.toLowerCase()),
		] as Records);
		expect(recordTypeCell(csv)).toBe(label);
	});
});

describe("generateRecordsCSV per-cable unit (KD-8)", () => {
	it("labels kg record values per cable and keeps the stored value", () => {
		const csv = generateRecordsCSV([record("MAX_WEIGHT")] as Records);
		const [header, row] = csv.split("\n");
		const cols = header.split(",");
		const values = row.split(",");
		expect(values[cols.indexOf("Unit")]).toBe("kg per cable");
		expect(values[cols.indexOf("Value")]).toBe("100");
	});
});
