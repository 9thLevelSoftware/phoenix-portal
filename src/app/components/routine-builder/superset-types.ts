// Superset Type Definitions for Routine Builder

import {
	SUPERSET_COLOR_HEX,
	SUPERSET_COLOR_NAMES,
	type SupersetColorName,
	type WireMode,
} from "../../../../supabase/functions/_shared/workoutModes.ts";

// Stored and synced by name (mobile's vocabulary), never as hex.
export type SupersetColor = SupersetColorName;

export interface Superset {
	id: string;
	color: SupersetColor;
	restAfter: number; // Rest time after completing all exercises
	exerciseIds: string[]; // Ordered list of exercise IDs
}

export interface RoutineExercise {
	id: string;
	exerciseId: string;
	exerciseName: string;
	sets: SetConfig[];
	programMode: ProgramMode;
	restTime: number;
	muscleGroup: string;
	// Superset properties
	supersetId?: string; // Groups exercises together
	supersetOrder?: number; // Order within superset
	transitionTime?: number; // Time before next exercise in superset (default 10s)
}

export interface SetConfig {
	reps: number;
	weight: number;
	rpe?: number;
}

// Routine modes are stored and synced as wire names (OLD_SCHOOL, ECHO, ...).
export type ProgramMode = WireMode;

export const SUPERSET_COLORS: SupersetColor[] = [...SUPERSET_COLOR_NAMES];

export const SUPERSET_COLOR_MAP: Record<
	SupersetColor,
	{ hex: string; label: string }
> = {
	indigo: { hex: SUPERSET_COLOR_HEX.indigo, label: "A" },
	pink: { hex: SUPERSET_COLOR_HEX.pink, label: "B" },
	green: { hex: SUPERSET_COLOR_HEX.green, label: "C" },
	amber: { hex: SUPERSET_COLOR_HEX.amber, label: "D" },
};

export function getNextSupersetColor(
	existingSupersets: Superset[],
): SupersetColor {
	const usedColors = existingSupersets.map((s) => s.color);
	const availableColor = SUPERSET_COLORS.find((c) => !usedColors.includes(c));
	return availableColor || SUPERSET_COLORS[0];
}

export function getSupersetLabel(color: SupersetColor): string {
	return SUPERSET_COLOR_MAP[color].label;
}

export function getSupersetColorHex(color: SupersetColor): string {
	return SUPERSET_COLOR_MAP[color].hex;
}
