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

// ─── Routine-exercise setting vocabularies ─────────────────────────────────
//
// Each list is mobile's enum by `.name`, which is what mobile pushes
// (PortalSyncAdapter.kt:586-615) and what its pull parsers accept. Mobile
// parses a value outside a list to its default, so the normalizers return
// null for it ("machine default"). The SQL backfill for legacy portal values
// is 20260920001200_routine_setting_vocabulary.sql.

/**
 * EccentricLoad (Models.kt:313-323). Mobile's parseEccentricLoad falls back to
 * 100% for anything that isn't LOAD_<n> or a number (PortalPullAdapter.kt:396).
 */
export const ECCENTRIC_LOADS = [
	"LOAD_0",
	"LOAD_50",
	"LOAD_75",
	"LOAD_100",
	"LOAD_110",
	"LOAD_120",
	"LOAD_130",
	"LOAD_140",
	"LOAD_150",
] as const;
export type EccentricLoad = (typeof ECCENTRIC_LOADS)[number];
export const ECCENTRIC_LOAD_LABELS: Record<EccentricLoad, string> = {
	LOAD_0: "0%",
	LOAD_50: "50%",
	LOAD_75: "75%",
	LOAD_100: "100%",
	LOAD_110: "110%",
	LOAD_120: "120%",
	LOAD_130: "130%",
	LOAD_140: "140%",
	LOAD_150: "150%",
};

/**
 * EchoLevel (Models.kt:302-307). Mobile's parseEchoLevel uppercases its input
 * and defaults to HARDER (PortalPullAdapter.kt:409-415).
 */
export const ECHO_LEVELS = ["HARD", "HARDER", "HARDEST", "EPIC"] as const;
export type EchoLevel = (typeof ECHO_LEVELS)[number];
export const ECHO_LEVEL_LABELS: Record<EchoLevel, string> = {
	HARD: "Hard",
	HARDER: "Harder",
	HARDEST: "Hardest",
	EPIC: "Epic",
};

/**
 * RepCountTiming (Models.kt:338-341). Mobile stores the string (default TOP)
 * and reads it with the case-sensitive RepCountTiming.valueOf, falling back to
 * TOP (SqlDelightSyncRepository.kt:2346, 1092-1098).
 */
export const REP_COUNT_TIMINGS = ["TOP", "BOTTOM"] as const;
export type RepCountTiming = (typeof REP_COUNT_TIMINGS)[number];
export const REP_COUNT_TIMING_LABELS: Record<RepCountTiming, string> = {
	TOP: "Top",
	BOTTOM: "Bottom",
};

/**
 * Stop-at position. Mobile sets stopAtTop only for exactly "TOP"
 * (SqlDelightSyncRepository.kt:2345) and pushes "TOP" or nothing
 * (PortalSyncAdapter.kt:605). null means "don't stop at the top".
 */
export const STOP_AT_POSITIONS = ["TOP"] as const;
export type StopAtPosition = (typeof STOP_AT_POSITIONS)[number];

/**
 * Superset colour names in mobile's SupersetColors index order. Mobile
 * lowercases before matching (SqlDelightSyncRepository.kt:2236-2248) and
 * pushes these names (PortalSyncAdapter.kt:562-567). The hex values are the
 * portal's display colours, which older portal builds stored verbatim.
 */
export const SUPERSET_COLOR_NAMES = [
	"indigo",
	"pink",
	"green",
	"amber",
] as const;
export type SupersetColorName = (typeof SUPERSET_COLOR_NAMES)[number];
export const SUPERSET_COLOR_HEX: Record<SupersetColorName, string> = {
	indigo: "#6366F1",
	pink: "#EC4899",
	green: "#10B981",
	amber: "#F59E0B",
};

function inList<T extends string>(
	list: readonly T[],
	key: string | null,
): T | null {
	return key !== null && (list as readonly string[]).includes(key)
		? (key as T)
		: null;
}

function upperToken(value: unknown): string | null {
	return typeof value === "string" ? value.trim().toUpperCase() : null;
}

export function toEccentricLoad(value: unknown): EccentricLoad | null {
	return inList(ECCENTRIC_LOADS, upperToken(value));
}

export function toEchoLevel(value: unknown): EchoLevel | null {
	return inList(ECHO_LEVELS, upperToken(value));
}

// Timing and stop-at are matched exactly: mobile compares them
// case-sensitively, so "top" already meant the default on the machine.
export function toRepCountTiming(value: unknown): RepCountTiming | null {
	return inList(REP_COUNT_TIMINGS, typeof value === "string" ? value : null);
}

export function toStopAtPosition(value: unknown): StopAtPosition | null {
	return inList(STOP_AT_POSITIONS, typeof value === "string" ? value : null);
}

/** Colour name for a stored name (any case) or legacy portal hex, else null. */
export function toSupersetColorName(value: unknown): SupersetColorName | null {
	if (typeof value !== "string") return null;
	const key = value.trim().toLowerCase();
	const byName = inList(SUPERSET_COLOR_NAMES, key);
	if (byName) return byName;
	return (
		SUPERSET_COLOR_NAMES.find(
			(name) => SUPERSET_COLOR_HEX[name].toLowerCase() === key,
		) ?? null
	);
}

/** CSS colour for a stored superset colour (name or legacy hex). */
export function supersetColorHex(value: unknown): string | undefined {
	const name = toSupersetColorName(value);
	return name ? SUPERSET_COLOR_HEX[name] : undefined;
}
