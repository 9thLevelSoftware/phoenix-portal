// SRA Recovery — Stimulus-Recovery-Adaptation per muscle group
// Used by the Body tab's SRA Recovery Matrix (INFERNO tier feature).
// Pure computation: no React deps, no DB access.

// --- Types ---

export type SraStatus =
	| "FATIGUED"
	| "RECOVERING"
	| "RECOVERED"
	| "SUPERCOMPENSATED";

export interface MuscleSessionInput {
	hoursSinceLastTrained: number | null;
	isHeavy: boolean;
	isHighVolume: boolean;
}

export interface MuscleRecovery {
	muscleGroup: string;
	status: SraStatus;
	hoursSinceLastTrained: number;
	estimatedRecoveryHours: number;
	/** null when status is RECOVERED or SUPERCOMPENSATED */
	hoursRemaining: number | null;
	lastSessionVolume: string | null;
	lastSessionIntensity: string | null;
}

// --- Recovery windows ---

interface RecoveryWindow {
	base: number;
	heavyMod: number;
	volumeMod: number;
}

const DEFAULT_WINDOW: RecoveryWindow = { base: 48, heavyMod: 8, volumeMod: 6 };

const RECOVERY_WINDOWS: Record<string, RecoveryWindow> = {
	Chest: { base: 60, heavyMod: 12, volumeMod: 8 },
	Back: { base: 60, heavyMod: 12, volumeMod: 8 },
	Shoulders: { base: 42, heavyMod: 8, volumeMod: 6 },
	Legs: { base: 84, heavyMod: 16, volumeMod: 12 },
	Arms: { base: 36, heavyMod: 6, volumeMod: 4 },
	Core: { base: 30, heavyMod: 4, volumeMod: 4 },
};

// --- SRA phase thresholds (ratio of elapsed / estimated) ---

const THRESHOLD_FATIGUED_END = 0.33; // < 0.33  → FATIGUED
const THRESHOLD_RECOVERING_END = 0.8; // < 0.80  → RECOVERING
const THRESHOLD_RECOVERED_END = 1.2; // < 1.20  → RECOVERED; ≥ 1.20 → SUPERCOMPENSATED

// --- Exports ---

/**
 * Compute total estimated recovery hours for a muscle group given session modifiers.
 */
export function computeRecoveryHours(
	muscleGroup: string,
	modifiers: Pick<MuscleSessionInput, "isHeavy" | "isHighVolume">,
): number {
	const window = RECOVERY_WINDOWS[muscleGroup] ?? DEFAULT_WINDOW;
	return (
		window.base +
		(modifiers.isHeavy ? window.heavyMod : 0) +
		(modifiers.isHighVolume ? window.volumeMod : 0)
	);
}

/**
 * Compute the SRA status for a muscle group given how long ago it was last trained.
 */
export function computeSraStatus(
	muscleGroup: string,
	input: MuscleSessionInput,
): MuscleRecovery {
	const estimatedRecoveryHours = computeRecoveryHours(muscleGroup, input);

	// Never trained → treat as fully recovered with 0 hours elapsed
	const hoursSinceLastTrained = input.hoursSinceLastTrained ?? 0;

	if (input.hoursSinceLastTrained === null) {
		return {
			muscleGroup,
			status: "RECOVERED",
			hoursSinceLastTrained: 0,
			estimatedRecoveryHours,
			hoursRemaining: null,
			lastSessionVolume: null,
			lastSessionIntensity: null,
		};
	}

	const ratio = hoursSinceLastTrained / estimatedRecoveryHours;

	let status: SraStatus;
	let hoursRemaining: number | null;

	if (ratio < THRESHOLD_FATIGUED_END) {
		status = "FATIGUED";
		hoursRemaining = Math.ceil(
			estimatedRecoveryHours * THRESHOLD_FATIGUED_END - hoursSinceLastTrained,
		);
	} else if (ratio < THRESHOLD_RECOVERING_END) {
		status = "RECOVERING";
		hoursRemaining = Math.ceil(
			estimatedRecoveryHours * THRESHOLD_RECOVERING_END - hoursSinceLastTrained,
		);
	} else if (ratio < THRESHOLD_RECOVERED_END) {
		status = "RECOVERED";
		hoursRemaining = null;
	} else {
		status = "SUPERCOMPENSATED";
		hoursRemaining = null;
	}

	return {
		muscleGroup,
		status,
		hoursSinceLastTrained,
		estimatedRecoveryHours,
		hoursRemaining,
		lastSessionVolume: null,
		lastSessionIntensity: null,
	};
}
