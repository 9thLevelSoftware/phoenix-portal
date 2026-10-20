import { format } from "date-fns";
import Papa from "papaparse";
import { formatPersonalRecordTypeLabel } from "@/lib/personal-record-labels";
import { convertWeight, getUnitLabel, type WeightUnit } from "@/lib/units";
import type { PersonalRecord, WorkoutSession } from "@/schemas/transforms";

/**
 * Generate CSV content for workout history.
 * Accepts Zod-transformed WorkoutSession[] where:
 *   - started_at is a Date object
 *   - duration_seconds is in raw seconds (no transform applied by schema)
 *   - total_volume is per cable, as stored (KD-8)
 */
export function generateWorkoutCSV(
	workouts: WorkoutSession[],
	unit: WeightUnit = "kg",
): string {
	const data = workouts.map((w) => ({
		Date: format(w.started_at, "yyyy-MM-dd"),
		Time: format(w.started_at, "HH:mm"),
		"Workout Name": w.name,
		"Duration (min)":
			w.duration_seconds != null ? Math.round(w.duration_seconds / 60) : "",
		[`Volume per Cable (${getUnitLabel(unit)})`]: convertWeight(
			w.total_volume ?? 0,
			unit,
		),
		Sets: w.set_count ?? "",
		Exercises: w.exercise_count ?? "",
		PRs: w.pr_count ?? "",
		Routine: w.routine_name ?? "",
		Mode: w.workout_mode ?? "",
	}));

	return Papa.unparse(data, { escapeFormulae: true });
}

/**
 * Generate CSV content for personal records.
 * Accepts Zod-transformed PersonalRecord[] where:
 *   - achieved_at is a Date object
 *   - value is per cable, as stored (KD-8); records carry no cable count,
 *     so no total is derived
 */
export function generateRecordsCSV(
	records: PersonalRecord[],
	unit: WeightUnit = "kg",
): string {
	const data = records.map((r) => ({
		Exercise: r.exercise_name,
		"Muscle Group": r.muscle_group,
		"Record Type": formatPersonalRecordTypeLabel(r.record_type),
		"Workout Phase": r.workout_phase ?? "Combined",
		Value: r.unit === "kg" ? convertWeight(r.value, unit) : r.value,
		Unit: r.unit === "kg" ? `${getUnitLabel(unit)} per cable` : r.unit,
		"Date Achieved": format(r.achieved_at, "yyyy-MM-dd"),
		"Previous Value":
			r.previous_value != null && r.unit === "kg"
				? convertWeight(r.previous_value, unit)
				: (r.previous_value ?? ""),
	}));

	return Papa.unparse(data, { escapeFormulae: true });
}

/**
 * Trigger CSV download in browser.
 * UTF-8 BOM prefix ensures Excel opens the file with correct encoding.
 */
export function downloadCSV(content: string, filename: string): void {
	const BOM = "\uFEFF";
	const blob = new Blob([BOM + content], { type: "text/csv;charset=utf-8;" });

	const link = document.createElement("a");
	const url = URL.createObjectURL(blob);
	link.href = url;
	link.download = `${filename}.csv`;
	// Append to the document before clicking; some browsers/WebViews ignore
	// synthetic clicks on detached anchors. Defer revoke so the click is handled.
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
