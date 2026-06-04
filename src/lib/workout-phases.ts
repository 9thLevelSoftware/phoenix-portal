export const WORKOUT_PHASES = ["Combined", "Concentric", "Eccentric"] as const;
export const WORKOUT_PHASE_FILTERS = ["all", ...WORKOUT_PHASES] as const;

export type WorkoutPhase = (typeof WORKOUT_PHASES)[number];
export type WorkoutPhaseFilter = (typeof WORKOUT_PHASE_FILTERS)[number];

const phaseMap: Record<string, WorkoutPhase> = {
	COMBINED: "Combined",
	Combined: "Combined",
	combined: "Combined",
	CONCENTRIC: "Concentric",
	Concentric: "Concentric",
	concentric: "Concentric",
	ECCENTRIC: "Eccentric",
	Eccentric: "Eccentric",
	eccentric: "Eccentric",
};

export function normalizeWorkoutPhase(
	phase: string | null | undefined,
): WorkoutPhase {
	if (!phase) return "Combined";
	return phaseMap[phase] ?? "Combined";
}

export function formatWorkoutPhase(
	phase: string | null | undefined,
): WorkoutPhase {
	return normalizeWorkoutPhase(phase);
}

export function isWorkoutPhase(value: string): value is WorkoutPhase {
	return WORKOUT_PHASES.includes(value as WorkoutPhase);
}

export function isNonCombinedWorkoutPhase(
	phase: string | null | undefined,
): boolean {
	return normalizeWorkoutPhase(phase) !== "Combined";
}
