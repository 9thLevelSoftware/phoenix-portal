import type { WeightUnit } from "@/lib/units";
import { formatLoad } from "@/lib/units/loadDisplay";
import { workoutModeLabel } from "../../supabase/functions/_shared/workoutModes.ts";

/**
 * Fields for the shared routine-exercise prescription line.
 *
 * `weight` is the per-cable load in kg. Routines carry no cable count, so
 * the load label never assumes two cables (KD-8).
 */
export interface ExercisePrescriptionFields {
	sets: number;
	reps: number;
	weight: number;
	durationSeconds?: number | null;
	isAmrap?: boolean;
	isBodyweight?: boolean;
	mode: string;
}

/**
 * The `sets • reps/duration/AMRAP • load • mode` line used by the routine
 * builder summary and the routine detail prescription.
 *
 * A truthy duration is shown as seconds. Otherwise an AMRAP flag replaces
 * the rep count. Bodyweight replaces the load label.
 */
export function formatExercisePrescriptionLine(
	exercise: ExercisePrescriptionFields,
	unit: WeightUnit,
): string {
	const loadLabel = exercise.isBodyweight
		? "Bodyweight"
		: // Routine weights are per cable; routines carry no cable count (KD-8).
			formatLoad(exercise.weight, null, unit);
	const modeLabel = workoutModeLabel(exercise.mode);

	if (exercise.durationSeconds) {
		return `${exercise.sets} sets • ${exercise.durationSeconds}s • ${loadLabel} • ${modeLabel}`;
	}

	if (exercise.isAmrap) {
		return `${exercise.sets} sets • AMRAP • ${loadLabel} • ${modeLabel}`;
	}

	return `${exercise.sets} sets • ${exercise.reps} reps • ${loadLabel} • ${modeLabel}`;
}
