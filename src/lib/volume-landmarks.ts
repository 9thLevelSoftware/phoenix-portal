import { getExerciseProfile } from "@/lib/exercise-muscles";

export interface VolumeLandmark {
	muscleGroup: string;
	/** Minimum Effective Volume — lowest weekly sets that produce adaptation */
	mev: number;
	/** Maximum Adaptive Volume (low bound) */
	mavLow: number;
	/** Maximum Adaptive Volume (high bound) */
	mavHigh: number;
	/** Maximum Recoverable Volume — sets above this cause overtraining */
	mrv: number;
}

export const VOLUME_LANDMARKS: VolumeLandmark[] = [
	{ muscleGroup: "Chest", mev: 10, mavLow: 14, mavHigh: 18, mrv: 22 },
	{ muscleGroup: "Back", mev: 10, mavLow: 14, mavHigh: 20, mrv: 24 },
	{ muscleGroup: "Shoulders", mev: 8, mavLow: 12, mavHigh: 16, mrv: 22 },
	{ muscleGroup: "Legs", mev: 8, mavLow: 12, mavHigh: 16, mrv: 20 },
	{ muscleGroup: "Arms", mev: 6, mavLow: 10, mavHigh: 14, mrv: 20 },
	{ muscleGroup: "Core", mev: 0, mavLow: 6, mavHigh: 12, mrv: 18 },
];

export type VolumeStatus =
	| "below_mev"
	| "between_mev_mav"
	| "in_mav"
	| "above_mav"
	| "above_mrv";

export interface ExerciseSessionData {
	name: string;
	muscleGroup: string | null;
	setCount: number;
}

/**
 * Aggregates weekly set volume per primary muscle group across all exercises.
 *
 * Resolution order (via getExerciseProfile):
 * 1. Exercise map exact/fuzzy match → use its primary group
 * 2. DB muscle_group fallback
 * 3. "General" fallback — excluded from volume counts
 */
export function computeWeeklyVolume(
	exercises: ExerciseSessionData[],
): Record<string, number> {
	const result: Record<string, number> = {};

	for (const exercise of exercises) {
		const profile = getExerciseProfile(
			exercise.name,
			exercise.muscleGroup ?? undefined,
		);
		const primaryGroup = profile.primary.group;

		// Exclude the generic "General" fallback — it has no landmark data
		if (primaryGroup === "General") {
			continue;
		}

		result[primaryGroup] = (result[primaryGroup] ?? 0) + exercise.setCount;
	}

	return result;
}

/**
 * Returns the landmark entry for a given muscle group, or undefined if not found.
 */
export function getVolumeLandmark(
	muscleGroup: string,
): VolumeLandmark | undefined {
	return VOLUME_LANDMARKS.find((l) => l.muscleGroup === muscleGroup);
}

/**
 * Classifies weekly set volume relative to RP landmarks for a given muscle group.
 * Returns null if the muscle group has no landmark data.
 *
 * Boundaries (inclusive on the low end, exclusive on the high end):
 * - below_mev:      sets < mev
 * - between_mev_mav: mev <= sets < mavLow
 * - in_mav:         mavLow <= sets <= mavHigh
 * - above_mav:      mavHigh < sets < mrv
 * - above_mrv:      sets >= mrv
 */
export function classifyVolumeStatus(
	muscleGroup: string,
	weeklySets: number,
): VolumeStatus | null {
	const landmark = getVolumeLandmark(muscleGroup);
	if (!landmark) return null;

	const { mev, mavLow, mavHigh, mrv } = landmark;

	if (weeklySets >= mrv) return "above_mrv";
	if (weeklySets > mavHigh) return "above_mav";
	if (weeklySets >= mavLow) return "in_mav";
	if (weeklySets >= mev) return "between_mev_mav";
	return "below_mev";
}
