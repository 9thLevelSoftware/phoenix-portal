import Papa from "papaparse";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
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

/** Pounds to kilograms conversion factor */
const LBS_TO_KG = 0.453592;

/** Miles to meters conversion factor */
const MILES_TO_METERS = 1609.344;

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
 * Parse a Hevy CSV export into normalized activities.
 *
 * CSV rows represent individual sets -- multiple rows share the same workout
 * (identified by title + start_time). This function groups rows by workout
 * and produces one NormalizedActivity per workout.
 *
 * Weight values are converted from lbs to kg (Hevy exports in lbs).
 * Distance values are converted from miles to meters.
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

/**
 * Get detailed exercise/set information from parsed CSV rows for a specific workout.
 * Useful for showing import preview with set-level detail.
 */
export interface HevyExerciseDetail {
	name: string;
	sets: Array<{
		setIndex: number;
		setType: string;
		weightKg: number;
		reps: number;
		durationSeconds: number;
		rpe: number | null;
	}>;
}

export function parseHevyExercises(
	csvContent: string,
	workoutTitle: string,
	startTime: string,
): HevyExerciseDetail[] {
	const result = Papa.parse<HevyCSVRow>(csvContent, {
		header: true,
		skipEmptyLines: true,
	});

	const workoutRows = result.data.filter(
		(row) => row.title === workoutTitle && row.start_time === startTime,
	);

	const exerciseGroups = groupBy(workoutRows, (row) => row.exercise_title);

	return Object.entries(exerciseGroups).map(([name, rows]) => ({
		name,
		sets: rows.map((row) => ({
			setIndex: parseInt(row.set_index, 10) || 0,
			setType: row.set_type || "normal",
			weightKg:
				Math.round((parseFloat(row.weight_lbs) || 0) * LBS_TO_KG * 100) / 100,
			reps: parseInt(row.reps, 10) || 0,
			durationSeconds: parseInt(row.duration_seconds, 10) || 0,
			rpe: row.rpe ? parseFloat(row.rpe) : null,
		})),
	}));
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
	if (activities.length === 0) return 0;

	const rows = activities.map((a) => ({
		user_id: userId,
		external_id: a.external_id,
		provider: "hevy",
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

// =============================================================================
// Hevy API Response Normalization
// For API sync path (requires Hevy PRO subscription)
// API structure is TBD -- this schema validates the expected shape
// =============================================================================

const hevyApiWorkoutSchema = z.object({
	id: z.string(),
	title: z.string(),
	start_time: z.string(),
	end_time: z.string(),
	exercises: z
		.array(
			z.object({
				title: z.string(),
				sets: z.array(
					z.object({
						set_type: z.string().optional().default("normal"),
						weight_kg: z.number().optional().default(0),
						reps: z.number().optional().default(0),
						rpe: z.number().nullable().optional(),
					}),
				),
			}),
		)
		.optional()
		.default([]),
});

/**
 * Normalize a Hevy API workout response into a NormalizedActivity.
 * Validates with Zod and converts to unified format.
 */
export function normalizeHevyActivity(raw: unknown): NormalizedActivity {
	const workout = hevyApiWorkoutSchema.parse(raw);
	const startTime = new Date(workout.start_time);
	const endTime = new Date(workout.end_time);

	if (!Number.isFinite(startTime.getTime())) {
		throw new Error(
			`Hevy API workout ${workout.id} has invalid start_time "${workout.start_time}"`,
		);
	}

	const endMs = endTime.getTime();
	const durationSeconds = Number.isFinite(endMs)
		? Math.round((endMs - startTime.getTime()) / 1000)
		: 0;

	return {
		external_id: `hevy-${workout.id}`,
		provider: "hevy",
		name: workout.title,
		activity_type: "strength",
		started_at: startTime.toISOString(),
		duration_seconds: durationSeconds > 0 ? durationSeconds : 0,
		distance_meters: null,
		calories: null,
		avg_heart_rate: null,
		max_heart_rate: null,
		elevation_gain_meters: null,
	};
}
