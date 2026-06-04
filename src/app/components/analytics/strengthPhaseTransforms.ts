import {
	normalizeWorkoutPhase,
	type WorkoutPhaseFilter,
} from "@/lib/workout-phases";

export interface StrengthPhaseRecord {
	exercise_name: string;
	exercise_id?: string | null;
	record_type?: string | null;
	workout_phase?: string | null;
	value: number;
	achieved_at: string;
}

export interface StrengthPhaseSeries {
	key: string;
	name: string;
	exerciseName: string;
	phase: string;
	latestValue: number;
}

export interface StrengthPhaseSummary {
	prCount: number;
	daysSinceLastPR: number | null;
}

const strengthRecordTypes = new Set(["MAX_WEIGHT", "1RM"]);
const phaseOrder = new Map([
	["Combined", 0],
	["Concentric", 1],
	["Eccentric", 2],
]);

function isStrengthRecord(recordType: string | null | undefined): boolean {
	if (!recordType) return true;
	return strengthRecordTypes.has(recordType.toUpperCase());
}

function filterStrengthPhaseRecords(
	data: StrengthPhaseRecord[],
	phaseFilter: WorkoutPhaseFilter,
): StrengthPhaseRecord[] {
	return data.filter((item) => {
		if (!isStrengthRecord(item.record_type)) return false;
		const phase = normalizeWorkoutPhase(item.workout_phase);
		return phaseFilter === "all" || phase === phaseFilter;
	});
}

export function buildStrengthPhaseSeries(
	data: StrengthPhaseRecord[],
	phaseFilter: WorkoutPhaseFilter,
): {
	points: Record<string, string | number>[];
	series: StrengthPhaseSeries[];
} {
	const filtered = filterStrengthPhaseRecords(data, phaseFilter);

	const dateSet = new Set<string>();
	const dateOrder = new Map<string, number>();
	const valueBySeries = new Map<string, Map<string, number>>();
	const latestBySeries = new Map<
		string,
		StrengthPhaseSeries & { at: number }
	>();

	for (const item of filtered) {
		const phase = normalizeWorkoutPhase(item.workout_phase);
		const baseKey = item.exercise_id ?? item.exercise_name;
		const key = `${baseKey}::${phase}`;
		const name = `${item.exercise_name} ${phase}`;
		const achievedAt = new Date(item.achieved_at);
		const date = achievedAt.toLocaleDateString("en-US", {
			month: "short",
		});

		dateSet.add(date);
		const existingDateOrder = dateOrder.get(date);
		if (!existingDateOrder || achievedAt.getTime() < existingDateOrder) {
			dateOrder.set(date, achievedAt.getTime());
		}
		if (!valueBySeries.has(key)) {
			valueBySeries.set(key, new Map());
		}

		const existing = valueBySeries.get(key)?.get(date) ?? 0;
		if (item.value > existing) {
			valueBySeries.get(key)?.set(date, item.value);
		}

		const at = achievedAt.getTime();
		const latest = latestBySeries.get(key);
		if (!latest || at > latest.at) {
			latestBySeries.set(key, {
				key,
				name,
				exerciseName: item.exercise_name,
				phase,
				latestValue: item.value,
				at,
			});
		}
	}

	const selectedSeries = Array.from(latestBySeries.values())
		.sort((a, b) => b.latestValue - a.latestValue)
		.slice(0, 6);

	const series = selectedSeries
		.sort((a, b) => {
			const exerciseCompare = a.exerciseName.localeCompare(b.exerciseName);
			if (exerciseCompare !== 0) return exerciseCompare;
			return (phaseOrder.get(a.phase) ?? 99) - (phaseOrder.get(b.phase) ?? 99);
		})
		.map(({ at: _at, ...item }) => item);

	const points = Array.from(dateSet)
		.sort((a, b) => (dateOrder.get(a) ?? 0) - (dateOrder.get(b) ?? 0))
		.map((date) => {
			const point: Record<string, string | number> = { date };
			for (const item of series) {
				point[item.key] = valueBySeries.get(item.key)?.get(date) ?? 0;
			}
			return point;
		});

	return { points, series };
}

export function buildMobileStrengthPhaseData(
	data: StrengthPhaseRecord[],
	phaseFilter: WorkoutPhaseFilter,
): Array<{ exercise: string; weight: number; phase: string }> {
	const { series } = buildStrengthPhaseSeries(data, phaseFilter);
	return [...series]
		.sort((a, b) => b.latestValue - a.latestValue)
		.slice(0, 5)
		.map((item) => ({
			exercise: item.name,
			weight: item.latestValue,
			phase: item.phase,
		}));
}

export function buildStrengthPhaseSummary(
	data: StrengthPhaseRecord[],
	phaseFilter: WorkoutPhaseFilter,
	now = new Date(),
): StrengthPhaseSummary {
	const filtered = filterStrengthPhaseRecords(data, phaseFilter);
	if (filtered.length === 0) {
		return { prCount: 0, daysSinceLastPR: null };
	}

	const latestTime = filtered.reduce((latest, item) => {
		const achievedAt = new Date(item.achieved_at).getTime();
		return Number.isFinite(achievedAt) ? Math.max(latest, achievedAt) : latest;
	}, Number.NEGATIVE_INFINITY);

	return {
		prCount: filtered.length,
		daysSinceLastPR: Number.isFinite(latestTime)
			? Math.floor((now.getTime() - latestTime) / (1000 * 60 * 60 * 24))
			: null,
	};
}
