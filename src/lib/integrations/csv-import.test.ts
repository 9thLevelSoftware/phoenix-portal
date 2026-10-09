import { describe, expect, it } from "vitest";
import { MILES_TO_METERS } from "./csvShared";
import { parseHevyCSV } from "./hevy";
import { parseStrongCSV } from "./strong";

const HEVY_CSV = [
	"title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_lbs,reps,distance_miles,duration_seconds,rpe",
	"Push,2026-01-01T10:00:00Z,2026-01-01T11:00:00Z,,Bench,,,1,normal,225,5,1,0,",
	"Push,2026-01-01T10:00:00Z,2026-01-01T11:00:00Z,,Bench,,,2,normal,315,3,0,0,",
].join("\n");

const STRONG_CSV = [
	"Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes",
	"2026-01-01T10:00:00Z,Push,45m,Bench,1,100,5,1,0,,",
	"2026-01-01T10:00:00Z,Push,45m,Bench,2,110,5,1,0,,",
].join("\n");

describe("CSV activity import", () => {
	it("keeps Hevy set loads out of the stored activity", () => {
		const [activity] = parseHevyCSV(HEVY_CSV);

		expect(parseHevyCSV(HEVY_CSV)).toHaveLength(1);
		expect(activity).toEqual({
			external_id: `hevy-Push-${new Date("2026-01-01T10:00:00Z").getTime()}`,
			provider: "hevy",
			name: "Push",
			activity_type: "strength",
			started_at: "2026-01-01T10:00:00.000Z",
			duration_seconds: 3600,
			distance_meters: Math.round(MILES_TO_METERS),
			calories: null,
			avg_heart_rate: null,
			max_heart_rate: null,
			elevation_gain_meters: null,
		});
	});

	it("parses Strong distance without a weight unit and ignores set loads", () => {
		const [kilometers] = parseStrongCSV(STRONG_CSV);
		const [miles] = parseStrongCSV(STRONG_CSV, "miles");

		expect(kilometers).toMatchObject({
			provider: "strong",
			name: "Push",
			distance_meters: 2000,
		});
		expect(kilometers).not.toHaveProperty("weightKg");
		expect(miles?.distance_meters).toBe(Math.round(2 * MILES_TO_METERS));
	});
});
