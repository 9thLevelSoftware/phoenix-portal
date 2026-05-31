import Papa from "papaparse";
import { supabase } from "@/lib/supabase";
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

/** Pounds to kilograms conversion factor */
const LBS_TO_KG = 0.453592;

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
 * and produces one NormalizedActivity per workout.
 *
 * @param csvContent  Raw CSV text from a Strong export file.
 * @param weightUnit  The unit the user's Strong app was set to ("kg" or "lbs").
 *                    Strong exports in whatever unit the user has configured --
 *                    there is no standardization in the export.
 */
export function parseStrongCSV(
	csvContent: string,
	_weightUnit: "kg" | "lbs" = "kg",
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

	return Object.entries(workoutGroups).map(([_key, rows]) => {
		const first = rows[0];
		const startTime = new Date(first.Date);

		// Duration comes from the Duration column (e.g., "1h 23m")
		const durationSeconds = parseDurationToSeconds(first.Duration);

		// Generate a deterministic external_id from workout name + timestamp
		const externalId = `strong-${first["Workout Name"]}-${startTime.getTime()}`;

		// Weight is already in the user's chosen unit -- convert if lbs
		// (We don't aggregate weight into the activity, but we note the unit for set detail)
		// Distance aggregation for cardio exercises
		const totalDistanceMeters = rows.reduce((sum, row) => {
			const distance = parseFloat(row.Distance);
			return sum + (Number.isNaN(distance) || distance === 0 ? 0 : distance);
		}, 0);

		return {
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
		};
	});
}

/**
 * Detailed exercise/set information from parsed Strong CSV rows for preview.
 */
export interface StrongExerciseDetail {
	name: string;
	sets: Array<{
		setOrder: number;
		weightKg: number;
		reps: number;
		durationSeconds: number;
		notes: string;
	}>;
}

/**
 * Parse exercise-level detail from Strong CSV for a specific workout.
 * Used for import preview with set-level detail.
 */
export function parseStrongExercises(
	csvContent: string,
	workoutName: string,
	date: string,
	weightUnit: "kg" | "lbs" = "kg",
): StrongExerciseDetail[] {
	const result = Papa.parse<StrongCSVRow>(csvContent, {
		header: true,
		skipEmptyLines: true,
	});

	const workoutRows = result.data.filter(
		(row) => row["Workout Name"] === workoutName && row.Date === date,
	);

	const exerciseGroups = groupBy(workoutRows, (row) => row["Exercise Name"]);

	return Object.entries(exerciseGroups).map(([name, rows]) => ({
		name,
		sets: rows.map((row) => {
			const rawWeight = parseFloat(row.Weight) || 0;
			const weightKg =
				weightUnit === "lbs"
					? Math.round(rawWeight * LBS_TO_KG * 100) / 100
					: rawWeight;

			return {
				setOrder: parseInt(row["Set Order"], 10) || 0,
				weightKg,
				reps: parseInt(row.Reps, 10) || 0,
				durationSeconds: parseInt(row.Seconds, 10) || 0,
				notes: row.Notes || "",
			};
		}),
	}));
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
	if (activities.length === 0) return 0;

	const rows = activities.map((a) => ({
		user_id: userId,
		external_id: a.external_id,
		provider: "strong",
		name: a.name,
		activity_type: a.activity_type,
		started_at: a.started_at,
		duration_seconds: a.duration_seconds,
		distance_meters: a.distance_meters,
		calories: a.calories,
		avg_heart_rate: a.avg_heart_rate,
		max_heart_rate: a.max_heart_rate,
		elevation_gain_meters: a.elevation_gain_meters,
	}));

	const { error } = await supabase
		.from("external_activities")
		.upsert(rows, { onConflict: "user_id,provider,external_id" });

	if (error) throw error;

	return activities.length;
}
