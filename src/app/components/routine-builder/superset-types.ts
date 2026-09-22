// Superset Type Definitions for Routine Builder

export type SupersetColor = "indigo" | "pink" | "green" | "amber";

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

export type ProgramMode = "Old School" | "Echo" | "Pump" | "Power";

export const SUPERSET_COLORS: SupersetColor[] = [
	"indigo",
	"pink",
	"green",
	"amber",
];

export const SUPERSET_COLOR_MAP: Record<
	SupersetColor,
	{ hex: string; label: string }
> = {
	indigo: { hex: "var(--chart-5)", label: "A" },
	pink: { hex: "var(--chart-5)", label: "B" },
	green: { hex: "var(--success)", label: "C" },
	amber: { hex: "var(--accent)", label: "D" },
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
