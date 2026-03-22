import { supabase } from "@/lib/supabase";

// =============================================================================
// Export Phoenix workouts as Strong-compatible CSV
// Strong CSV is the de facto standard for strength data interchange --
// both Strong and Hevy can import this format.
//
// Strong CSV columns:
//   Date, Workout Name, Duration, Exercise Name, Set Order,
//   Weight, Reps, Distance, Seconds, Notes, Workout Notes
// =============================================================================

/** Per-cable to total weight multiplier (must match WEIGHT_MULTIPLIER in transforms.ts) */
const WEIGHT_MULTIPLIER = 2;

/** Kilograms to pounds conversion factor */
const KG_TO_LBS = 2.20462;

interface RawSession {
	id: string;
	name: string | null;
	started_at: string;
	duration_seconds: number;
	notes: string | null;
}

interface RawExercise {
	id: string;
	session_id: string;
	name: string;
	order_index: number;
}

interface RawSet {
	exercise_id: string;
	set_number: number;
	actual_reps: number;
	weight: number; // per-cable kg in DB
	rpe: number | null;
	notes: string | null;
}

interface CSVRow {
	Date: string;
	"Workout Name": string;
	Duration: string;
	"Exercise Name": string;
	"Set Order": number;
	Weight: number;
	Reps: number;
	Distance: number;
	Seconds: number;
	Notes: string;
	"Workout Notes": string;
}

/**
 * Format seconds into Strong's duration string format (e.g., "1h 23m", "45m").
 */
function formatDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;

	const parts: string[] = [];
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	if (secs > 0 && hours === 0) parts.push(`${secs}s`);
	return parts.join(" ") || "0m";
}

/**
 * Format a Date as Strong's expected date format: "YYYY-MM-DD HH:MM:SS"
 */
function formatDate(isoString: string): string {
	const d = new Date(isoString);
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Escape a CSV field value. Wraps in quotes if it contains commas,
 * quotes, or newlines.
 */
function escapeCSV(value: string): string {
	if (
		value.includes(",") ||
		value.includes('"') ||
		value.includes("\n") ||
		value.includes("\r")
	) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

export interface ExportOptions {
	/** Weight unit for the exported CSV. Default: "kg" */
	weightUnit?: "kg" | "lbs";
}

export interface ExportResult {
	csv: string;
	sessionCount: number;
	setCount: number;
}

/**
 * Fetch all workout data for a user and produce a Strong-compatible CSV string.
 *
 * Queries sessions, exercises, and sets from Supabase, flattens to
 * one-row-per-set, and formats as CSV with Strong column headers.
 *
 * Weight values are converted from per-cable (DB storage) to total
 * (display weight = per-cable x 2), then optionally to lbs if requested.
 */
export async function exportWorkoutsAsCSV(
	userId: string,
	options: ExportOptions = {},
): Promise<ExportResult> {
	const { weightUnit = "kg" } = options;

	// 1. Fetch all sessions
	const { data: sessions, error: sessionError } = await supabase
		.from("workout_sessions")
		.select("id, name, started_at, duration_seconds, notes")
		.eq("user_id", userId)
		.order("started_at", { ascending: true });
	if (sessionError) throw sessionError;
	if (!sessions || sessions.length === 0) {
		return { csv: "", sessionCount: 0, setCount: 0 };
	}

	const sessionIds = sessions.map((s: RawSession) => s.id);

	// 2. Fetch all exercises for those sessions
	const { data: exercises, error: exerciseError } = await supabase
		.from("exercises")
		.select("id, session_id, name, order_index")
		.in("session_id", sessionIds)
		.order("order_index", { ascending: true });
	if (exerciseError) throw exerciseError;

	// 3. Fetch all sets for those exercises
	const exerciseIds = (exercises ?? []).map((e: RawExercise) => e.id);
	let allSets: RawSet[] = [];
	if (exerciseIds.length > 0) {
		// Supabase .in() has a limit; batch if necessary
		const BATCH_SIZE = 500;
		for (let i = 0; i < exerciseIds.length; i += BATCH_SIZE) {
			const batch = exerciseIds.slice(i, i + BATCH_SIZE);
			const { data: sets, error: setError } = await supabase
				.from("sets")
				.select("exercise_id, set_number, actual_reps, weight, rpe, notes")
				.in("exercise_id", batch)
				.order("set_number", { ascending: true });
			if (setError) throw setError;
			if (sets) allSets = allSets.concat(sets as RawSet[]);
		}
	}

	// 4. Build lookup maps
	const sessionMap = new Map(sessions.map((s: RawSession) => [s.id, s]));
	const exercisesBySession = new Map<string, RawExercise[]>();
	for (const ex of exercises ?? []) {
		const typed = ex as RawExercise;
		const list = exercisesBySession.get(typed.session_id) ?? [];
		list.push(typed);
		exercisesBySession.set(typed.session_id, list);
	}
	const setsByExercise = new Map<string, RawSet[]>();
	for (const s of allSets) {
		const list = setsByExercise.get(s.exercise_id) ?? [];
		list.push(s);
		setsByExercise.set(s.exercise_id, list);
	}

	// 5. Flatten to CSV rows
	const csvRows: CSVRow[] = [];

	for (const sessionId of sessionIds) {
		const session = sessionMap.get(sessionId);
		if (!session) continue;

		const sessionExercises = exercisesBySession.get(sessionId) ?? [];

		for (const exercise of sessionExercises) {
			const exerciseSets = setsByExercise.get(exercise.id) ?? [];

			for (const set of exerciseSets) {
				// Convert per-cable weight to total, then optionally to lbs
				let weight = set.weight * WEIGHT_MULTIPLIER;
				if (weightUnit === "lbs") {
					weight = Math.round(weight * KG_TO_LBS * 100) / 100;
				} else {
					weight = Math.round(weight * 100) / 100;
				}

				csvRows.push({
					Date: formatDate(session.started_at),
					"Workout Name": session.name?.trim() || "Untitled Workout",
					Duration: formatDuration(session.duration_seconds),
					"Exercise Name": exercise.name,
					"Set Order": set.set_number,
					Weight: weight,
					Reps: set.actual_reps,
					Distance: 0,
					Seconds: 0,
					Notes: set.notes ?? "",
					"Workout Notes": session.notes ?? "",
				});
			}
		}
	}

	// 6. Generate CSV string
	const headers = [
		"Date",
		"Workout Name",
		"Duration",
		"Exercise Name",
		"Set Order",
		"Weight",
		"Reps",
		"Distance",
		"Seconds",
		"Notes",
		"Workout Notes",
	];

	const lines = [headers.join(",")];
	for (const row of csvRows) {
		const values = headers.map((h) => {
			const val = row[h as keyof CSVRow];
			if (typeof val === "number") return val.toString();
			return escapeCSV(String(val));
		});
		lines.push(values.join(","));
	}

	return {
		csv: lines.join("\n"),
		sessionCount: sessions.length,
		setCount: csvRows.length,
	};
}

/**
 * Trigger a browser download of the CSV content.
 */
export function downloadCSV(csv: string, filename: string): void {
	const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}
