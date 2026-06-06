import { convertWeight, type WeightUnit } from "@/lib/units";
import { normalizeWorkoutPhase } from "@/lib/workout-phases";

export interface ProgressionProgressRow {
	id: string;
	user_id: string;
	exercise_name: string;
	session_id: string;
	recorded_at: Date;
	max_weight_kg: number;
	total_volume_kg: number;
	estimated_1rm_kg: number;
	max_reps: number;
	set_count: number;
}

export interface ProgressionRecordRow {
	id: string;
	exercise_name: string;
	exercise_id: string | null;
	record_type: string;
	workout_phase: string | null;
	value: number;
	unit: string;
	achieved_at: Date;
}

export interface ProgressionRecommendation {
	kind: "load" | "reps" | "variation";
	label: string;
	description: string;
}

export interface ProgressionExerciseSummary {
	exerciseName: string;
	currentOneRm: number;
	currentOneRmKg: number;
	gainRatePctPer30Days: number;
	plateauRisk: "low" | "medium" | "high";
	phasePrCount: number;
	lastProgressAt: Date;
	lastPrAt: Date | null;
	recommendation: ProgressionRecommendation;
	points: Array<{
		date: string;
		oneRm: number;
		oneRmKg: number;
		volume: number;
		maxWeight: number;
	}>;
}

export interface ProgressionWorkbenchModel {
	exercises: ProgressionExerciseSummary[];
	selectedExercise: ProgressionExerciseSummary | null;
	emptyReason: string | null;
}

interface BuildProgressionWorkbenchModelInput {
	progressRows: ProgressionProgressRow[];
	records: ProgressionRecordRow[];
	selectedExercise?: string | null;
	phaseFilter: string;
	unit: WeightUnit;
	now?: Date;
}

function round(value: number, digits = 1): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function pctChange(first: number, last: number): number {
	if (first <= 0) return 0;
	return ((last - first) / first) * 100;
}

function daysBetween(first: Date, last: Date): number {
	const ms = last.getTime() - first.getTime();
	return Math.max(1, ms / (1000 * 60 * 60 * 24));
}

function matchesPhase(
	record: ProgressionRecordRow,
	phaseFilter: string,
): boolean {
	if (phaseFilter === "all") return true;
	return (
		normalizeWorkoutPhase(record.workout_phase) ===
		normalizeWorkoutPhase(phaseFilter)
	);
}

function phaseRecordsForExercise(
	records: ProgressionRecordRow[],
	exerciseName: string,
	phaseFilter: string,
): ProgressionRecordRow[] {
	return records.filter(
		(record) =>
			record.exercise_name.toLowerCase() === exerciseName.toLowerCase() &&
			matchesPhase(record, phaseFilter),
	);
}

function detectPlateauRisk({
	rows,
	gainRatePctPer30Days,
	lastPrAt,
	now,
}: {
	rows: ProgressionProgressRow[];
	gainRatePctPer30Days: number;
	lastPrAt: Date | null;
	now: Date;
}): "low" | "medium" | "high" {
	const lastThree = rows.slice(-3).map((row) => row.estimated_1rm_kg);
	const lastThreeRangePct =
		lastThree.length >= 3
			? pctChange(Math.min(...lastThree), Math.max(...lastThree))
			: null;
	const daysSincePr = lastPrAt
		? daysBetween(lastPrAt, now)
		: Number.POSITIVE_INFINITY;

	if (lastThreeRangePct != null && lastThreeRangePct <= 2 && daysSincePr > 42) {
		return "high";
	}

	if (gainRatePctPer30Days < 1 || daysSincePr > 30) {
		return "medium";
	}

	return "low";
}

function buildRecommendation(
	risk: ProgressionExerciseSummary["plateauRisk"],
	latest: ProgressionProgressRow,
	unit: WeightUnit,
): ProgressionRecommendation {
	if (risk === "high") {
		return {
			kind: "variation",
			label: "Rotate stimulus",
			description:
				"Progress has flattened. Try a variation, rep-range change, or short deload before chasing load.",
		};
	}

	if (risk === "medium") {
		return {
			kind: "reps",
			label: "Earn the jump",
			description:
				"Hold load steady and add clean reps before the next weight increase.",
		};
	}

	const nextLoad = convertWeight(latest.max_weight_kg + 2.5, unit);
	return {
		kind: "load",
		label: `Add ${unit === "lbs" ? "5 lb" : "2.5 kg"}`,
		description: `Recent trend supports testing about ${round(nextLoad, unit === "lbs" ? 0 : 1)} ${unit} next time.`,
	};
}

function buildExerciseSummary({
	exerciseName,
	rows,
	records,
	phaseFilter,
	unit,
	now,
}: {
	exerciseName: string;
	rows: ProgressionProgressRow[];
	records: ProgressionRecordRow[];
	phaseFilter: string;
	unit: WeightUnit;
	now: Date;
}): ProgressionExerciseSummary {
	const sortedRows = [...rows].sort(
		(a, b) => a.recorded_at.getTime() - b.recorded_at.getTime(),
	);
	const first = sortedRows[0];
	const latest = sortedRows[sortedRows.length - 1];
	const elapsedDays = daysBetween(first.recorded_at, latest.recorded_at);
	const totalGainPct = pctChange(
		first.estimated_1rm_kg,
		latest.estimated_1rm_kg,
	);
	const gainRatePctPer30Days = (totalGainPct / elapsedDays) * 30;
	const phasePrs = phaseRecordsForExercise(records, exerciseName, phaseFilter);
	const lastPrAt =
		phasePrs.length > 0
			? [...phasePrs].sort(
					(a, b) => b.achieved_at.getTime() - a.achieved_at.getTime(),
				)[0].achieved_at
			: null;
	const plateauRisk = detectPlateauRisk({
		rows: sortedRows,
		gainRatePctPer30Days,
		lastPrAt,
		now,
	});

	const placeholder = {
		plateauRisk,
	} as ProgressionExerciseSummary;
	const recommendation = buildRecommendation(
		placeholder.plateauRisk,
		latest,
		unit,
	);

	return {
		exerciseName,
		currentOneRm: round(convertWeight(latest.estimated_1rm_kg, unit), 1),
		currentOneRmKg: latest.estimated_1rm_kg,
		gainRatePctPer30Days: round(gainRatePctPer30Days, 1),
		plateauRisk,
		phasePrCount: phasePrs.length,
		lastProgressAt: latest.recorded_at,
		lastPrAt,
		recommendation,
		points: sortedRows.map((row) => ({
			date: row.recorded_at.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
			}),
			oneRm: round(convertWeight(row.estimated_1rm_kg, unit), 1),
			oneRmKg: row.estimated_1rm_kg,
			volume: round(convertWeight(row.total_volume_kg, unit), 1),
			maxWeight: round(convertWeight(row.max_weight_kg, unit), 1),
		})),
	};
}

export function buildProgressionWorkbenchModel({
	progressRows,
	records,
	selectedExercise,
	phaseFilter,
	unit,
	now = new Date(),
}: BuildProgressionWorkbenchModelInput): ProgressionWorkbenchModel {
	if (progressRows.length === 0) {
		return {
			exercises: [],
			selectedExercise: null,
			emptyReason: "No exercise progress history is available yet.",
		};
	}

	const grouped = new Map<string, ProgressionProgressRow[]>();
	for (const row of progressRows) {
		const existing = grouped.get(row.exercise_name) ?? [];
		existing.push(row);
		grouped.set(row.exercise_name, existing);
	}

	const exercises = [...grouped.entries()]
		.map(([exerciseName, rows]) =>
			buildExerciseSummary({
				exerciseName,
				rows,
				records,
				phaseFilter,
				unit,
				now,
			}),
		)
		.sort((a, b) => {
			const dateDelta = b.lastProgressAt.getTime() - a.lastProgressAt.getTime();
			if (dateDelta !== 0) return dateDelta;
			return b.currentOneRmKg - a.currentOneRmKg;
		});

	const selected =
		exercises.find((exercise) => exercise.exerciseName === selectedExercise) ??
		exercises[0] ??
		null;

	return {
		exercises,
		selectedExercise: selected,
		emptyReason: null,
	};
}
