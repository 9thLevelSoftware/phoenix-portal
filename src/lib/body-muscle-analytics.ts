import { MUSCLE_GROUPS, MUSCLE_MAP } from "body-muscles";
import {
	getExerciseProfile,
	normalizeExerciseName,
} from "@/lib/exercise-muscles";
import { WEIGHT_MULTIPLIER } from "@/schemas/transforms";
import { BODY_MUSCLE_MAP } from "./body-muscle-map.generated";

export interface BodyMuscleWeight {
	id: string;
	weight: number;
}

export interface BodyMuscleMapEntry {
	exerciseId: string;
	name: string;
	normalizedName: string;
	aliases: string[];
	normalizedAliases: string[];
	sourceMuscles: string[];
	bodyMuscles: BodyMuscleWeight[];
}

export interface BodyMuscleContributionExercise {
	exerciseId: string;
	exerciseName: string;
	sessionId: string;
	date: Date | null;
	sets: number;
	reps: number;
	volumeKg: number;
	allocatedSets: number;
	allocatedReps: number;
	allocatedVolumeKg: number;
	allocatedLoad: number;
	shareOfMuscleLoad: number;
	estimated: boolean;
}

export interface BodyMuscleContribution {
	muscleId: string;
	muscleName: string;
	group: string;
	totalSets: number;
	totalReps: number;
	totalVolumeKg: number;
	totalLoad: number;
	loadShare: number;
	intensity: number;
	estimated: boolean;
	exercises: BodyMuscleContributionExercise[];
}

export interface BodyMuscleFocusModel {
	muscles: BodyMuscleContribution[];
	muscleById: Record<string, BodyMuscleContribution>;
	totalSets: number;
	totalReps: number;
	totalVolumeKg: number;
	totalLoad: number;
	estimatedExerciseCount: number;
	unmatchedExerciseCount: number;
}

export interface BodyMuscleFocusRow {
	id: string;
	name: string;
	muscle_group?: string | null;
	session_id: string;
	setCount?: number;
	sets?: Array<{
		id?: string;
		actual_reps?: number | null;
		weight_kg?: number | null;
	}>;
	workout_sessions?: {
		started_at?: string | Date | null;
	} | null;
}

interface ResolvedBodyMuscleMapping {
	entry: BodyMuscleMapEntry;
	estimated: boolean;
	unmatched: boolean;
}

const BODY_MUSCLE_NAME_BY_ID = new Map(
	MUSCLE_MAP.map((muscle) => [muscle.id, muscle.name]),
);

const BODY_MUSCLE_GROUP_BY_ID = new Map<string, string>();
for (const [groupName, muscleIds] of Object.entries(MUSCLE_GROUPS)) {
	for (const muscleId of muscleIds) {
		BODY_MUSCLE_GROUP_BY_ID.set(muscleId, groupName);
	}
}

const ENTRY_BY_ID = new Map(
	BODY_MUSCLE_MAP.map((entry) => [entry.exerciseId, entry]),
);

const ENTRIES_BY_NAME = new Map<string, BodyMuscleMapEntry[]>();
for (const entry of BODY_MUSCLE_MAP) {
	const aliases = [entry.normalizedName, ...entry.normalizedAliases];
	for (const alias of aliases) {
		if (!alias) continue;
		const entries = ENTRIES_BY_NAME.get(alias) ?? [];
		entries.push(entry);
		ENTRIES_BY_NAME.set(alias, entries);
	}
}

const GROUP_FALLBACK_MUSCLES: Record<string, BodyMuscleWeight[]> = {
	Chest: distribute([
		"chest-upper-left",
		"chest-upper-right",
		"chest-lower-left",
		"chest-lower-right",
	]),
	Back: distribute([
		"lats-upper-left",
		"lats-mid-left",
		"lats-lower-left",
		"lats-upper-right",
		"lats-mid-right",
		"lats-lower-right",
		"traps-mid-left",
		"traps-mid-right",
		"lower-back-erectors-left",
		"lower-back-erectors-right",
	]),
	Shoulders: distribute([
		"shoulder-front-left",
		"shoulder-front-right",
		"shoulder-side-left",
		"shoulder-side-right",
		"deltoid-rear-left",
		"deltoid-rear-right",
	]),
	Arms: distribute([
		"biceps-left",
		"biceps-right",
		"triceps-long-left",
		"triceps-lateral-left",
		"triceps-long-right",
		"triceps-lateral-right",
		"forearm-left",
		"forearm-right",
	]),
	Legs: distribute([
		"quads-left",
		"quads-right",
		"hamstrings-medial-left",
		"hamstrings-lateral-left",
		"hamstrings-medial-right",
		"hamstrings-lateral-right",
		"gluteus-maximus-left",
		"gluteus-maximus-right",
		"calves-gastroc-medial-left",
		"calves-gastroc-medial-right",
	]),
	Core: distribute([
		"abs-upper-left",
		"abs-upper-right",
		"abs-lower-left",
		"abs-lower-right",
		"obliques-left",
		"obliques-right",
	]),
	General: distribute(["spine"]),
};

function distribute(muscleIds: string[]): BodyMuscleWeight[] {
	if (muscleIds.length === 0) return [];
	const weight = 1 / muscleIds.length;
	return muscleIds.map((id) => ({ id, weight }));
}

function round(value: number, digits = 2): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function resolveDate(value: string | Date | null | undefined): Date | null {
	if (!value) return null;
	if (value instanceof Date) return value;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function toTotalWeightKg(weightKg: number | null | undefined): number {
	return (weightKg ?? 0) * WEIGHT_MULTIPLIER;
}

function normalizeWeights(weights: BodyMuscleWeight[]): BodyMuscleWeight[] {
	const merged = new Map<string, number>();
	for (const item of weights) {
		if (!item.id || item.weight <= 0) continue;
		merged.set(item.id, (merged.get(item.id) ?? 0) + item.weight);
	}
	const total = [...merged.values()].reduce((sum, value) => sum + value, 0);
	if (total <= 0) return [];
	return [...merged.entries()]
		.map(([id, weight]) => ({ id, weight: weight / total }))
		.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
}

function buildFallbackEntry(
	exerciseId: string,
	exerciseName: string,
	dbMuscleGroup?: string | null,
): BodyMuscleMapEntry {
	const profile = getExerciseProfile(exerciseName, dbMuscleGroup ?? undefined);
	const profileWeights: BodyMuscleWeight[] = [
		...(GROUP_FALLBACK_MUSCLES[profile.primary.group] ?? []),
		...profile.secondary.flatMap((secondary) =>
			(GROUP_FALLBACK_MUSCLES[secondary.group] ?? []).map((item) => ({
				id: item.id,
				weight: item.weight * secondary.activation,
			})),
		),
	];
	const normalizedName = normalizeExerciseName(exerciseName);

	return {
		exerciseId,
		name: exerciseName,
		normalizedName,
		aliases: [],
		normalizedAliases: [normalizedName],
		sourceMuscles: [
			profile.primary.group,
			...profile.secondary.map((item) => item.group),
		],
		bodyMuscles: normalizeWeights(profileWeights),
	};
}

function scoreMappingCandidate(
	entry: BodyMuscleMapEntry,
	exerciseName: string,
	normalizedName: string,
): number {
	const exactName =
		entry.name.trim().toLowerCase() === exerciseName.trim().toLowerCase();
	const exactAlias = entry.aliases.some(
		(alias) => alias.trim().toLowerCase() === exerciseName.trim().toLowerCase(),
	);
	const normalizedPrimary = entry.normalizedName === normalizedName;
	return (
		(exactName ? 1000 : 0) +
		(exactAlias ? 500 : 0) +
		(normalizedPrimary ? 100 : 0) +
		entry.sourceMuscles.length * 10 +
		entry.bodyMuscles.length
	);
}

function resolveBodyMuscleMapping(
	exerciseId: string | null | undefined,
	exerciseName: string,
	dbMuscleGroup?: string | null,
): ResolvedBodyMuscleMapping {
	const byId = exerciseId ? ENTRY_BY_ID.get(exerciseId) : undefined;
	if (byId) {
		return { entry: byId, estimated: false, unmatched: false };
	}

	const normalizedName = normalizeExerciseName(exerciseName);
	const nameCandidates = ENTRIES_BY_NAME.get(normalizedName) ?? [];
	const byName = [...nameCandidates].sort(
		(a, b) =>
			scoreMappingCandidate(b, exerciseName, normalizedName) -
				scoreMappingCandidate(a, exerciseName, normalizedName) ||
			a.name.localeCompare(b.name),
	)[0];
	if (byName) {
		return { entry: byName, estimated: false, unmatched: false };
	}

	const fallback = buildFallbackEntry(
		exerciseId ?? normalizedName,
		exerciseName,
		dbMuscleGroup,
	);
	return {
		entry: fallback,
		estimated: true,
		unmatched: fallback.bodyMuscles.length === 0,
	};
}

export function getBodyMuscleMappingForExercise(
	exerciseId: string | null | undefined,
	exerciseName: string,
	dbMuscleGroup?: string | null,
): BodyMuscleMapEntry {
	return resolveBodyMuscleMapping(exerciseId, exerciseName, dbMuscleGroup)
		.entry;
}

export function getBodyMuscleLabel(muscleId: string): string {
	return BODY_MUSCLE_NAME_BY_ID.get(muscleId) ?? muscleId;
}

export function getBodyMuscleGroup(muscleId: string): string {
	return BODY_MUSCLE_GROUP_BY_ID.get(muscleId) ?? "Other";
}

export function buildBodyMuscleFocusModel(
	rows: BodyMuscleFocusRow[],
): BodyMuscleFocusModel {
	const muscleAccumulator = new Map<
		string,
		Omit<BodyMuscleContribution, "loadShare" | "intensity" | "exercises">
	>();
	const contributionRows = new Map<string, BodyMuscleContributionExercise[]>();
	let totalSets = 0;
	let totalReps = 0;
	let totalVolumeKg = 0;
	let estimatedExerciseCount = 0;
	let unmatchedExerciseCount = 0;

	for (const row of rows) {
		const sets = row.sets ?? [];
		const setCount = sets.length > 0 ? sets.length : (row.setCount ?? 0);
		const reps = sets.reduce((sum, set) => sum + (set.actual_reps ?? 0), 0);
		const volumeKg = sets.reduce(
			(sum, set) =>
				sum + (set.actual_reps ?? 0) * toTotalWeightKg(set.weight_kg),
			0,
		);
		const contributionLoad = Math.max(volumeKg, setCount);
		if (setCount <= 0 && reps <= 0 && contributionLoad <= 0) continue;

		const resolved = resolveBodyMuscleMapping(
			row.id,
			row.name,
			row.muscle_group,
		);
		if (resolved.estimated) estimatedExerciseCount++;
		if (resolved.unmatched) unmatchedExerciseCount++;

		totalSets += setCount;
		totalReps += reps;
		totalVolumeKg += volumeKg;

		for (const muscle of resolved.entry.bodyMuscles) {
			const current = muscleAccumulator.get(muscle.id) ?? {
				muscleId: muscle.id,
				muscleName: getBodyMuscleLabel(muscle.id),
				group: getBodyMuscleGroup(muscle.id),
				totalSets: 0,
				totalReps: 0,
				totalVolumeKg: 0,
				totalLoad: 0,
				estimated: false,
			};
			const allocatedSets = setCount * muscle.weight;
			const allocatedReps = reps * muscle.weight;
			const allocatedVolumeKg = volumeKg * muscle.weight;
			const allocatedLoad = contributionLoad * muscle.weight;
			current.totalSets += allocatedSets;
			current.totalReps += allocatedReps;
			current.totalVolumeKg += allocatedVolumeKg;
			current.totalLoad += allocatedLoad;
			current.estimated = current.estimated || resolved.estimated;
			muscleAccumulator.set(muscle.id, current);

			const rowsForMuscle = contributionRows.get(muscle.id) ?? [];
			rowsForMuscle.push({
				exerciseId: row.id,
				exerciseName: row.name,
				sessionId: row.session_id,
				date: resolveDate(row.workout_sessions?.started_at),
				sets: setCount,
				reps,
				volumeKg,
				allocatedSets,
				allocatedReps,
				allocatedVolumeKg,
				allocatedLoad,
				shareOfMuscleLoad: 0,
				estimated: resolved.estimated,
			});
			contributionRows.set(muscle.id, rowsForMuscle);
		}
	}

	const maxLoad = Math.max(
		0,
		...[...muscleAccumulator.values()].map((item) => item.totalLoad),
	);
	const totalLoad = [...muscleAccumulator.values()].reduce(
		(sum, item) => sum + item.totalLoad,
		0,
	);

	const muscles = [...muscleAccumulator.values()]
		.map((item): BodyMuscleContribution => {
			const muscleLoad = item.totalLoad;
			const exercises = (contributionRows.get(item.muscleId) ?? [])
				.map((exercise) => ({
					...exercise,
					allocatedSets: round(exercise.allocatedSets, 2),
					allocatedReps: round(exercise.allocatedReps, 1),
					allocatedVolumeKg: round(exercise.allocatedVolumeKg, 1),
					allocatedLoad: round(exercise.allocatedLoad, 2),
					shareOfMuscleLoad:
						muscleLoad > 0
							? round((exercise.allocatedLoad / muscleLoad) * 100, 1)
							: 0,
				}))
				.sort((a, b) => {
					const loadDelta = b.allocatedLoad - a.allocatedLoad;
					if (loadDelta !== 0) return loadDelta;
					return (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0);
				});
			return {
				...item,
				totalSets: item.totalSets,
				totalReps: item.totalReps,
				totalVolumeKg: item.totalVolumeKg,
				totalLoad: item.totalLoad,
				loadShare: totalLoad > 0 ? round((muscleLoad / totalLoad) * 100, 1) : 0,
				intensity:
					maxLoad > 0
						? Math.max(1, Math.round((muscleLoad / maxLoad) * 10))
						: 0,
				exercises,
			};
		})
		.sort((a, b) => {
			const loadDelta = b.totalLoad - a.totalLoad;
			if (loadDelta !== 0) return loadDelta;
			return a.muscleName.localeCompare(b.muscleName);
		});

	return {
		muscles,
		muscleById: Object.fromEntries(
			muscles.map((muscle) => [muscle.muscleId, muscle]),
		),
		totalSets,
		totalReps,
		totalVolumeKg: round(totalVolumeKg, 1),
		totalLoad: round(totalLoad, 2),
		estimatedExerciseCount,
		unmatchedExerciseCount,
	};
}
