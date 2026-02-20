import { format } from "date-fns";
import Papa from "papaparse";
import type { PersonalRecord, WorkoutSession } from "@/schemas/transforms";

/**
 * Generate CSV content for workout history.
 * Accepts Zod-transformed WorkoutSession[] where:
 *   - started_at is a Date object
 *   - duration_seconds is already converted to minutes by the transform
 *   - total_volume is already multiplied by WEIGHT_MULTIPLIER
 */
export function generateWorkoutCSV(workouts: WorkoutSession[]): string {
	const data = workouts.map((w) => ({
		Date: format(w.started_at, "yyyy-MM-dd"),
		Time: format(w.started_at, "HH:mm"),
		"Workout Name": w.name,
		"Duration (min)": w.duration_seconds ?? "",
		"Total Volume (kg)": w.total_volume ?? "",
		Sets: w.set_count ?? "",
		Exercises: w.exercise_count ?? "",
		PRs: w.pr_count ?? "",
		Routine: w.routine_name ?? "",
		Mode: w.workout_mode ?? "",
	}));

	return Papa.unparse(data);
}

/**
 * Generate CSV content for personal records.
 * Accepts Zod-transformed PersonalRecord[] where:
 *   - achieved_at is a Date object
 *   - value is already multiplied by WEIGHT_MULTIPLIER
 */
export function generateRecordsCSV(records: PersonalRecord[]): string {
	const data = records.map((r) => ({
		Exercise: r.exercise_name,
		"Muscle Group": r.muscle_group,
		"Record Type": formatRecordType(r.record_type),
		Value: r.value,
		Unit: r.unit,
		"Date Achieved": format(r.achieved_at, "yyyy-MM-dd"),
		"Previous Value": r.previous_value ?? "",
	}));

	return Papa.unparse(data);
}

function formatRecordType(type: string): string {
	const types: Record<string, string> = {
		max_weight: "Max Weight",
		max_reps: "Max Reps",
		max_volume: "Max Volume",
		max_e1rm: "Estimated 1RM",
		fastest_time: "Fastest Time",
		longest_distance: "Longest Distance",
	};
	return types[type] ?? type;
}

/**
 * Trigger CSV download in browser.
 * UTF-8 BOM prefix ensures Excel opens the file with correct encoding.
 */
export function downloadCSV(content: string, filename: string): void {
	const BOM = "\uFEFF";
	const blob = new Blob([BOM + content], { type: "text/csv;charset=utf-8;" });

	const link = document.createElement("a");
	link.href = URL.createObjectURL(blob);
	link.download = `${filename}.csv`;
	link.click();

	URL.revokeObjectURL(link.href);
}
