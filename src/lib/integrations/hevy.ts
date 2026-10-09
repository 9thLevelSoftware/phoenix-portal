import Papa from "papaparse";
import { groupBy, MILES_TO_METERS } from "./csvShared";
import { upsertExternalActivities } from "./externalActivities";
import type { NormalizedActivity } from "./types";

// =============================================================================
// Hevy CSV Parsing
// Source: https://help.hevyapp.com/hc/en-us/articles/35687878672663
// CSV columns: title, start_time, end_time, description, exercise_title,
//   superset_id, exercise_notes, set_index, set_type, weight_lbs, reps,
//   distance_miles, duration_seconds, rpe
// =============================================================================

interface HevyCSVRow {
	title: string;
	start_time: string;
	end_time: string;
	description: string;
	exercise_title: string;
	superset_id: string;
	exercise_notes: string;
	set_index: string;
	set_type: string;
	weight_lbs: string;
	reps: string;
	distance_miles: string;
	duration_seconds: string;
	rpe: string;
}

/**
 * Parse a Hevy CSV export into normalized activities.
 *
 * CSV rows represent individual sets -- multiple rows share the same workout
 * (identified by title + start_time). This function groups rows by workout
 * and produces one NormalizedActivity per workout. Set loads are not imported:
 * the `weight_lbs` column is ignored here. Distance values are converted from
 * miles to meters.
 */
export function parseHevyCSV(csvContent: string): NormalizedActivity[] {
	const result = Papa.parse<HevyCSVRow>(csvContent, {
		header: true,
		skipEmptyLines: true,
	});

	if (result.errors.length > 0) {
		// Log but don't fail -- Papa Parse is lenient and partial data is usable
		console.warn("Hevy CSV parse warnings:", result.errors);
	}

	// Filter out rows with no title (empty/malformed rows)
	const validRows = result.data.filter((row) => row.title && row.start_time);

	if (validRows.length === 0) {
		return [];
	}

	// Group rows by workout (title + start_time combination)
	const workoutGroups = groupBy(
		validRows,
		(row) => `${row.title}|${row.start_time}`,
	);

	const activities: NormalizedActivity[] = [];
	for (const [_key, rows] of Object.entries(workoutGroups)) {
		const first = rows[0];
		const startTime = new Date(first.start_time);
		const endTime = new Date(first.end_time);

		// Skip workouts with an unparseable start_time rather than letting a single
		// malformed row throw RangeError and abort the entire import.
		if (!Number.isFinite(startTime.getTime())) {
			console.warn(
				`Hevy CSV: skipping workout "${first.title}" with invalid start_time "${first.start_time}"`,
			);
			continue;
		}

		const endMs = endTime.getTime();
		const durationSeconds = Number.isFinite(endMs)
			? Math.round((endMs - startTime.getTime()) / 1000)
			: 0;

		// Generate a deterministic external_id from workout title + timestamp
		const externalId = `hevy-${first.title}-${startTime.getTime()}`;

		// Aggregate total distance from all sets (if any have distance)
		const totalDistanceMeters = rows.reduce((sum, row) => {
			const miles = parseFloat(row.distance_miles);
			return (
				sum + (Number.isNaN(miles) || miles === 0 ? 0 : miles * MILES_TO_METERS)
			);
		}, 0);

		activities.push({
			external_id: externalId,
			provider: "hevy" as const,
			name: first.title,
			activity_type: "strength",
			started_at: startTime.toISOString(),
			duration_seconds: durationSeconds > 0 ? durationSeconds : 0,
			distance_meters:
				totalDistanceMeters > 0 ? Math.round(totalDistanceMeters) : null,
			calories: null, // Hevy does not export calorie data
			avg_heart_rate: null,
			max_heart_rate: null,
			elevation_gain_meters: null,
		});
	}
	return activities;
}

// =============================================================================
// Hevy CSV Import (Supabase persistence)
// =============================================================================

/**
 * Upsert parsed Hevy activities into the external_activities table.
 *
 * @param userId  The authenticated user's ID.
 * @param activities  Activities previously obtained from `parseHevyCSV`.
 * @returns The number of activities upserted.
 * @throws Re-throws Supabase errors so callers can surface them.
 */
export async function importHevyActivities(
	userId: string,
	activities: NormalizedActivity[],
): Promise<number> {
	return upsertExternalActivities(userId, "hevy", activities);
}
