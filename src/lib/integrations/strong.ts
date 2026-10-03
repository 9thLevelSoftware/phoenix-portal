import Papa from "papaparse";
import { upsertExternalActivities } from "./externalActivities";
import type { NormalizedActivity } from "./types";

// =============================================================================
// Strong CSV Parsing
// Source: https://help.strongapp.io/article/235-export-workout-data
// CSV columns (note: header names contain spaces):
//   Date, Workout Name, Duration, Exercise Name, Set Order,
//   Weight, Reps, Distance, Seconds, Notes, Workout Notes
// =============================================================================

interface StrongCSVRow {
	Date: string;
	"Workout Name": string;
	Duration: string;
	"Exercise Name": string;
	"Set Order": string;
	Weight: string;
	Reps: string;
	Distance: string;
	Seconds: string;
	Notes: string;
	"Workout Notes": string;
}

/** Miles to meters conversion factor */
const MILES_TO_METERS = 1609.344;

/**
 * Parse a Strong duration string into seconds.
 * Handles formats like "1h 23m", "45m", "1h 5m 30s", "30s", "1h", etc.
 */
function parseDurationToSeconds(duration: string): number {
	if (!duration) return 0;

	let totalSeconds = 0;
	const hourMatch = duration.match(/(\d+)\s*h/i);
	const minMatch = duration.match(/(\d+)\s*m(?!s)/i);
	const secMatch = duration.match(/(\d+)\s*s/i);

	if (hourMatch) totalSeconds += parseInt(hourMatch[1], 10) * 3600;
	if (minMatch) totalSeconds += parseInt(minMatch[1], 10) * 60;
	if (secMatch) totalSeconds += parseInt(secMatch[1], 10);

	// Fallback: try parsing as raw seconds if no unit markers found
	if (totalSeconds === 0 && /^\d+$/.test(duration.trim())) {
		totalSeconds = parseInt(duration.trim(), 10);
	}

	return totalSeconds;
}

/**
 * Group an array of items by a key function.
 */
function groupBy<T>(
	items: T[],
	keyFn: (item: T) => string,
): Record<string, T[]> {
	const groups: Record<string, T[]> = {};
	for (const item of items) {
		const key = keyFn(item);
		if (!groups[key]) {
			groups[key] = [];
		}
		groups[key].push(item);
	}
	return groups;
}

/**
 * Parse a Strong CSV export into normalized activities.
 *
 * CSV rows represent individual sets -- multiple rows share the same workout
 * (identified by Workout Name + Date). This function groups rows by workout
 * and produces one NormalizedActivity per workout. Set loads are not imported.
 *
 * @param csvContent  Raw CSV text from a Strong export file.
 * @param distanceUnit  The unit Strong used for the Distance column ("km" or "miles").
 *                      Defaults to "km". Values are converted to meters for storage.
 */
export function parseStrongCSV(
	csvContent: string,
	distanceUnit: "km" | "miles" = "km",
): NormalizedActivity[] {
	const result = Papa.parse<StrongCSVRow>(csvContent, {
		header: true,
		skipEmptyLines: true,
	});

	if (result.errors.length > 0) {
		console.warn("Strong CSV parse warnings:", result.errors);
	}

	// Filter out rows with no workout name or date (empty/malformed rows)
	const validRows = result.data.filter(
		(row) => row.Date && row["Workout Name"],
	);

	if (validRows.length === 0) {
		return [];
	}

	// Group rows by workout (Workout Name + Date combination)
	const workoutGroups = groupBy(
		validRows,
		(row) => `${row["Workout Name"]}|${row.Date}`,
	);

	const activities: NormalizedActivity[] = [];
	for (const [_key, rows] of Object.entries(workoutGroups)) {
		const first = rows[0];
		const startTime = new Date(first.Date);

		// Skip workouts with an unparseable Date rather than letting a single
		// malformed/locale-specific row throw RangeError and cancel the import.
		if (!Number.isFinite(startTime.getTime())) {
			console.warn(
				`Strong CSV: skipping workout "${first["Workout Name"]}" with invalid Date "${first.Date}"`,
			);
			continue;
		}

		// Duration comes from the Duration column (e.g., "1h 23m")
		const durationSeconds = parseDurationToSeconds(first.Duration);

		// Generate a deterministic external_id from workout name + timestamp
		const externalId = `strong-${first["Workout Name"]}-${startTime.getTime()}`;

		// Distance aggregation for cardio exercises. Set loads are not imported.
		// Strong exports distance in the user's locale unit (km or miles) so we
		// must convert to meters before storing. The caller supplies distanceUnit.
		const distanceMultiplier =
			distanceUnit === "miles" ? MILES_TO_METERS : 1000;
		const totalDistanceMeters = rows.reduce((sum, row) => {
			const distance = parseFloat(row.Distance);
			return (
				sum +
				(Number.isNaN(distance) || distance === 0
					? 0
					: distance * distanceMultiplier)
			);
		}, 0);

		activities.push({
			external_id: externalId,
			provider: "strong" as const,
			name: first["Workout Name"],
			activity_type: "strength",
			started_at: startTime.toISOString(),
			duration_seconds: durationSeconds > 0 ? durationSeconds : 0,
			distance_meters:
				totalDistanceMeters > 0 ? Math.round(totalDistanceMeters) : null,
			calories: null, // Strong does not export calorie data
			avg_heart_rate: null,
			max_heart_rate: null,
			elevation_gain_meters: null,
		});
	}
	return activities;
}

// =============================================================================
// Strong CSV Import (Supabase persistence)
// =============================================================================

/**
 * Upsert parsed Strong activities into the external_activities table.
 *
 * @param userId  The authenticated user's ID.
 * @param activities  Activities previously obtained from `parseStrongCSV`.
 * @returns The number of activities upserted.
 * @throws Re-throws Supabase errors so callers can surface them.
 */
export async function importStrongActivities(
	userId: string,
	activities: NormalizedActivity[],
): Promise<number> {
	return upsertExternalActivities(userId, "strong", activities);
}
