/**
 * Workout-mode wire vocabulary shared by the portal SPA and Edge Functions.
 *
 * Mobile's `ProgramMode.fromSyncString` (Project-Phoenix-MP
 * shared/.../domain/model/Models.kt) accepts exactly these strings (plus the
 * legacy `CLASSIC` alias) and maps anything else to Old School. Every value
 * the portal stores in `routine_exercises.mode` must therefore be one of
 * WIRE_MODES; display names are UI labels only.
 *
 * The SQL mirror of `toWireMode` is `public.normalize_workout_mode(text)`
 * (20260920001100_normalize_routine_exercise_modes.sql). Keep them in sync.
 */
export const WIRE_MODES = [
	"OLD_SCHOOL",
	"PUMP",
	"TUT",
	"TUT_BEAST",
	"ECCENTRIC_ONLY",
	"ECHO",
] as const;

export type WireMode = (typeof WIRE_MODES)[number];

export const DEFAULT_WIRE_MODE: WireMode = "OLD_SCHOOL";

export const WIRE_MODE_LABELS: Record<WireMode, string> = {
	OLD_SCHOOL: "Old School",
	PUMP: "Pump",
	TUT: "TUT",
	TUT_BEAST: "TUT Beast",
	ECCENTRIC_ONLY: "Eccentric Only",
	ECHO: "Echo",
};

// Legacy aliases observed in stored data (see
// 20260304120000_mode_wire_format_migration.sql): CLASSIC is mobile's old
// name for Old School; POWER was a retired portal-only mode.
const LEGACY_ALIASES: Record<string, WireMode> = {
	CLASSIC: "OLD_SCHOOL",
	POWER: "OLD_SCHOOL",
};

export function isWireMode(value: unknown): value is WireMode {
	return (
		typeof value === "string" && (WIRE_MODES as readonly string[]).includes(value)
	);
}

/**
 * Normalize a wire name, display name ("TUT Beast", "eccentric only") or
 * legacy alias to its wire name. Returns null for anything unrecognized so
 * callers choose whether to reject (writers) or pass through (readers).
 */
export function toWireMode(value: unknown): WireMode | null {
	if (typeof value !== "string") return null;
	const key = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
	if (isWireMode(key)) return key;
	return LEGACY_ALIASES[key] ?? null;
}

/** Display label for a stored mode; unknown values are shown verbatim. */
export function workoutModeLabel(value: string): string {
	const wire = toWireMode(value);
	return wire ? WIRE_MODE_LABELS[wire] : value;
}
