import { format } from "date-fns";
import JSZip from "jszip";
import Papa from "papaparse";
import {
	type BodyMuscleFocusModel,
	type BodyMuscleFocusRow,
	buildBodyMuscleFocusModel,
} from "@/lib/body-muscle-analytics";
import { supabase } from "@/lib/supabase";
import { convertWeight, getUnitLabel, type WeightUnit } from "@/lib/units";

type ProgressCallback = (step: string, current: number, total: number) => void;

export interface AnalyticsWorkoutExerciseSummaryRow {
	date: string | Date;
	workoutName: string;
	exerciseId: string;
	exerciseName: string;
	muscleGroup: string | null;
	sets: number;
	reps: number;
	volumeKg: number;
	maxWeightKg: number;
}

export interface AnalyticsRepSummaryRow {
	date: string | Date | null;
	workoutName: string | null;
	exerciseName: string | null;
	setNumber: number | null;
	repNumber: number;
	meanVelocityMps: number | null;
	peakVelocityMps: number | null;
	meanForceN: number | null;
	peakForceN: number | null;
	powerWatts: number | null;
	romMm: number | null;
	tutMs: number | null;
	asymmetryPct: number | null;
	vbtZone: string | null;
}

interface WorkoutRow {
	id: string;
	name: string | null;
	started_at: string;
	duration_seconds?: number | null;
}

interface ExerciseRow {
	id: string;
	name: string;
	muscle_group: string | null;
	session_id: string;
}

interface SetRow {
	id: string;
	exercise_id: string;
	set_number: number;
	actual_reps: number;
	weight_kg: number;
}

interface RepSummaryRow {
	id: string;
	set_id: string;
	rep_number: number;
	mean_velocity_mps: number | null;
	peak_velocity_mps: number | null;
	mean_force_n: number | null;
	peak_force_n: number | null;
	power_watts: number | null;
	rom_mm: number | null;
	tut_ms: number | null;
	asymmetry_pct: number | null;
	vbt_zone: string | null;
}

function csv<T extends Record<string, unknown>>(
	fields: string[],
	rows: T[],
): string {
	return Papa.unparse({ fields, data: rows }, { escapeFormulae: true });
}

function dateKey(value: string | Date | null): string {
	if (!value) return "";
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? "" : format(date, "yyyy-MM-dd");
}

function round(value: number, digits = 2): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

export function generateWorkoutExerciseSummaryCsv(
	rows: AnalyticsWorkoutExerciseSummaryRow[],
	unit: WeightUnit = "kg",
): string {
	const unitLabel = getUnitLabel(unit);
	const fields = [
		"Date",
		"Workout",
		"Exercise",
		"Muscle Group",
		"Sets",
		"Reps",
		`Volume (${unitLabel})`,
		`Max Weight (${unitLabel})`,
	];
	const data = rows.map((row) => ({
		Date: dateKey(row.date),
		Workout: row.workoutName,
		Exercise: row.exerciseName,
		"Muscle Group": row.muscleGroup ?? "",
		Sets: row.sets,
		Reps: row.reps,
		[`Volume (${unitLabel})`]: round(convertWeight(row.volumeKg, unit), 1),
		[`Max Weight (${unitLabel})`]: round(
			convertWeight(row.maxWeightKg, unit),
			1,
		),
	}));
	return csv(fields, data);
}

export function generateDailyExerciseSummaryCsv(
	rows: AnalyticsWorkoutExerciseSummaryRow[],
	unit: WeightUnit = "kg",
): string {
	const grouped = new Map<string, AnalyticsWorkoutExerciseSummaryRow>();
	for (const row of rows) {
		const key = [
			dateKey(row.date),
			row.exerciseName,
			row.muscleGroup ?? "",
		].join("\u0000");
		const current = grouped.get(key);
		if (!current) {
			grouped.set(key, { ...row, workoutName: "Daily Total" });
			continue;
		}
		current.sets += row.sets;
		current.reps += row.reps;
		current.volumeKg += row.volumeKg;
		current.maxWeightKg = Math.max(current.maxWeightKg, row.maxWeightKg);
	}

	return generateWorkoutExerciseSummaryCsv(
		[...grouped.values()].sort(
			(a, b) =>
				dateKey(a.date).localeCompare(dateKey(b.date)) ||
				a.exerciseName.localeCompare(b.exerciseName),
		),
		unit,
	);
}

export function generateMuscleContributionCsv(
	model: BodyMuscleFocusModel,
	unit: WeightUnit = "kg",
): string {
	const unitLabel = getUnitLabel(unit);
	const fields = [
		"Muscle ID",
		"Muscle",
		"Body Group",
		"Load Share %",
		"Sets",
		"Reps",
		`Allocated Volume (${unitLabel})`,
		"Estimated Mapping",
		"Top Exercises",
	];
	const data = model.muscles.map((muscle) => ({
		"Muscle ID": muscle.muscleId,
		Muscle: muscle.muscleName,
		"Body Group": muscle.group,
		"Load Share %": muscle.loadShare,
		Sets: round(muscle.totalSets, 2),
		Reps: round(muscle.totalReps, 1),
		[`Allocated Volume (${unitLabel})`]: round(
			convertWeight(muscle.totalVolumeKg, unit),
			1,
		),
		"Estimated Mapping": muscle.estimated ? "yes" : "no",
		"Top Exercises": muscle.exercises
			.slice(0, 5)
			.map((exercise) => exercise.exerciseName)
			.join("; "),
	}));
	return csv(fields, data);
}

export function generateRepSummaryCsv(rows: AnalyticsRepSummaryRow[]): string {
	const fields = [
		"Date",
		"Workout",
		"Exercise",
		"Set Number",
		"Rep Number",
		"Mean Velocity (m/s)",
		"Peak Velocity (m/s)",
		"Mean Force (N)",
		"Peak Force (N)",
		"Power (W)",
		"ROM (mm)",
		"TUT (ms)",
		"Asymmetry %",
		"VBT Zone",
	];
	const data = rows.map((row) => ({
		Date: dateKey(row.date),
		Workout: row.workoutName ?? "",
		Exercise: row.exerciseName ?? "",
		"Set Number": row.setNumber ?? "",
		"Rep Number": row.repNumber,
		"Mean Velocity (m/s)": row.meanVelocityMps ?? "",
		"Peak Velocity (m/s)": row.peakVelocityMps ?? "",
		"Mean Force (N)": row.meanForceN ?? "",
		"Peak Force (N)": row.peakForceN ?? "",
		"Power (W)": row.powerWatts ?? "",
		"ROM (mm)": row.romMm ?? "",
		"TUT (ms)": row.tutMs ?? "",
		"Asymmetry %": row.asymmetryPct ?? "",
		"VBT Zone": row.vbtZone ?? "",
	}));
	return csv(fields, data);
}

function buildWorkoutExerciseRows(
	workouts: WorkoutRow[],
	exercises: ExerciseRow[],
	sets: SetRow[],
): AnalyticsWorkoutExerciseSummaryRow[] {
	const workoutById = new Map(workouts.map((workout) => [workout.id, workout]));
	const setsByExercise = new Map<string, SetRow[]>();
	for (const set of sets) {
		const rows = setsByExercise.get(set.exercise_id) ?? [];
		rows.push(set);
		setsByExercise.set(set.exercise_id, rows);
	}

	return exercises.map((exercise) => {
		const workout = workoutById.get(exercise.session_id);
		const exerciseSets = setsByExercise.get(exercise.id) ?? [];
		return {
			date: workout?.started_at ?? "",
			workoutName: workout?.name ?? "Workout",
			exerciseId: exercise.id,
			exerciseName: exercise.name,
			muscleGroup: exercise.muscle_group,
			sets: exerciseSets.length,
			reps: exerciseSets.reduce((sum, set) => sum + set.actual_reps, 0),
			volumeKg: exerciseSets.reduce(
				(sum, set) => sum + set.actual_reps * set.weight_kg,
				0,
			),
			maxWeightKg: Math.max(0, ...exerciseSets.map((set) => set.weight_kg)),
		};
	});
}

function buildBodyFocusRows(
	workouts: WorkoutRow[],
	exercises: ExerciseRow[],
	sets: SetRow[],
): BodyMuscleFocusRow[] {
	const workoutById = new Map(workouts.map((workout) => [workout.id, workout]));
	const setsByExercise = new Map<string, SetRow[]>();
	for (const set of sets) {
		const rows = setsByExercise.get(set.exercise_id) ?? [];
		rows.push(set);
		setsByExercise.set(set.exercise_id, rows);
	}

	return exercises.map((exercise) => ({
		id: exercise.id,
		name: exercise.name,
		muscle_group: exercise.muscle_group,
		session_id: exercise.session_id,
		setCount: setsByExercise.get(exercise.id)?.length ?? 0,
		sets: (setsByExercise.get(exercise.id) ?? []).map((set) => ({
			id: set.id,
			actual_reps: set.actual_reps,
			weight_kg: set.weight_kg,
		})),
		workout_sessions: {
			started_at: workoutById.get(exercise.session_id)?.started_at ?? null,
		},
	}));
}

function buildRepRows(
	workouts: WorkoutRow[],
	exercises: ExerciseRow[],
	sets: SetRow[],
	repSummaries: RepSummaryRow[],
): AnalyticsRepSummaryRow[] {
	const exerciseById = new Map(
		exercises.map((exercise) => [exercise.id, exercise]),
	);
	const workoutById = new Map(workouts.map((workout) => [workout.id, workout]));
	const setById = new Map(sets.map((set) => [set.id, set]));

	return repSummaries.map((repSummary) => {
		const set = setById.get(repSummary.set_id);
		const exercise = set ? exerciseById.get(set.exercise_id) : undefined;
		const workout = exercise ? workoutById.get(exercise.session_id) : undefined;
		return {
			date: workout?.started_at ?? null,
			workoutName: workout?.name ?? null,
			exerciseName: exercise?.name ?? null,
			setNumber: set?.set_number ?? null,
			repNumber: repSummary.rep_number,
			meanVelocityMps: repSummary.mean_velocity_mps,
			peakVelocityMps: repSummary.peak_velocity_mps,
			meanForceN: repSummary.mean_force_n,
			peakForceN: repSummary.peak_force_n,
			powerWatts: repSummary.power_watts,
			romMm: repSummary.rom_mm,
			tutMs: repSummary.tut_ms,
			asymmetryPct: repSummary.asymmetry_pct,
			vbtZone: repSummary.vbt_zone,
		};
	});
}

async function fetchUserAnalyticsRows(userId: string) {
	const workoutResult = await supabase
		.from("workout_sessions")
		.select("id, name, started_at, duration_seconds")
		.eq("user_id", userId)
		.order("started_at", { ascending: false });

	if (workoutResult.error) throw workoutResult.error;
	const workouts = (workoutResult.data ?? []) as WorkoutRow[];
	const workoutIds = workouts.map((workout) => workout.id);

	const exerciseResult =
		workoutIds.length > 0
			? await supabase
					.from("exercises")
					.select("id, name, muscle_group, session_id")
					.in("session_id", workoutIds)
			: { data: [], error: null };
	if (exerciseResult.error) throw exerciseResult.error;
	const exercises = (exerciseResult.data ?? []) as ExerciseRow[];

	const setResult = await supabase
		.from("sets")
		.select("id, exercise_id, set_number, actual_reps, weight_kg")
		.eq("user_id", userId);
	if (setResult.error) throw setResult.error;
	const sets = (setResult.data ?? []) as SetRow[];

	const repResult = await supabase
		.from("rep_summaries")
		.select(
			"id, set_id, rep_number, mean_velocity_mps, peak_velocity_mps, mean_force_n, peak_force_n, power_watts, rom_mm, tut_ms, asymmetry_pct, vbt_zone",
		)
		.eq("user_id", userId);
	if (repResult.error) throw repResult.error;
	const repSummaries = (repResult.data ?? []) as RepSummaryRow[];

	return { workouts, exercises, sets, repSummaries };
}

export async function exportAnalyticsTablesZip(
	userId: string,
	unit: WeightUnit = "kg",
	onProgress?: ProgressCallback,
): Promise<void> {
	const totalSteps = 5;
	let step = 0;
	const progress = (label: string) => {
		step++;
		onProgress?.(label, step, totalSteps);
	};

	try {
		progress("Fetching workout analytics...");
		const { workouts, exercises, sets, repSummaries } =
			await fetchUserAnalyticsRows(userId);

		progress("Building workout summaries...");
		const workoutRows = buildWorkoutExerciseRows(workouts, exercises, sets);
		const bodyFocusModel = buildBodyMuscleFocusModel(
			buildBodyFocusRows(workouts, exercises, sets),
		);
		const repRows = buildRepRows(workouts, exercises, sets, repSummaries);

		progress("Generating CSV tables...");
		const zip = new JSZip();
		zip.file(
			"workout-exercise-summary.csv",
			generateWorkoutExerciseSummaryCsv(workoutRows, unit),
		);
		zip.file(
			"daily-exercise-summary.csv",
			generateDailyExerciseSummaryCsv(workoutRows, unit),
		);
		zip.file(
			"muscle-contribution-summary.csv",
			generateMuscleContributionCsv(bodyFocusModel, unit),
		);
		zip.file("rep-summary.csv", generateRepSummaryCsv(repRows));

		progress("Compressing analytics tables...");
		const blob = await zip.generateAsync({ type: "blob" });

		progress("Starting download...");
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `phoenix-analytics-tables-${new Date().toISOString().split("T")[0]}.zip`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	} catch (error) {
		console.error("Analytics table export failed:", error);
		throw new Error(
			error instanceof Error
				? `Analytics table export failed: ${error.message}`
				: "Analytics table export failed unexpectedly",
		);
	}
}
