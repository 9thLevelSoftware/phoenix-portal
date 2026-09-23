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
// (PortalSyncAdapter.kt:586-615) and what its pull parsers accept. Eccentric
// load and echo level only take effect in Echo mode on the phone
// (ActiveSessionEngine.kt:6772-6773, 6805-6806; ExerciseEditBottomSheet.kt:
// 426-436; PortalSyncAdapter.kt:607-616).

/** EccentricLoad (Models.kt:313-323). */
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

/** EchoLevel (Models.kt:302-307). Mobile default: HARDER. */
export const ECHO_LEVELS = ["HARD", "HARDER", "HARDEST", "EPIC"] as const;
export type EchoLevel = (typeof ECHO_LEVELS)[number];
export const ECHO_LEVEL_LABELS: Record<EchoLevel, string> = {
	HARD: "Hard",
	HARDER: "Harder",
	HARDEST: "Hardest",
	EPIC: "Epic",
};

/** RepCountTiming (Models.kt:338-341). Mobile default: TOP. */
export const REP_COUNT_TIMINGS = ["TOP", "BOTTOM"] as const;
export type RepCountTiming = (typeof REP_COUNT_TIMINGS)[number];
export const REP_COUNT_TIMING_LABELS: Record<RepCountTiming, string> = {
	TOP: "Top",
	BOTTOM: "Bottom",
};

/**
 * Stop-at position: "TOP" or none. Mobile pushes "TOP" or nothing
 * (PortalSyncAdapter.kt:605); null means "don't stop at the top".
 */
export const STOP_AT_POSITIONS = ["TOP"] as const;
export type StopAtPosition = (typeof STOP_AT_POSITIONS)[number];

/**
 * Superset colour names in mobile's SupersetColors index order
 * (SqlDelightSyncRepository.kt:2236-2241; pushed by PortalSyncAdapter.kt:
 * 562-567). The hex values are the portal's display colours, which older
 * portal builds stored verbatim.
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

// ─── Normalizers: "what the phone actually does with this stored value" ────
//
// Each one mirrors mobile's parser exactly (case, whitespace, numbers). A
// value mobile would replace with its default normalizes to null; a value it
// uses normalizes to the canonical enum name (off-list eccentric numbers and
// colour indexes are kept verbatim, see below). The storage normalizers
// (toEchoLevel, toRepCountTiming, toStopAtPosition, toSupersetColorName,
// normalizeEccentricLoad) are mirrored by public.normalize_* in
// 20260920001200_routine_setting_vocabulary.sql; keep them in sync (both are
// pinned by the same case table in tests).

function inList<T extends string>(list: readonly T[], key: unknown): T | null {
	return typeof key === "string" && (list as readonly string[]).includes(key)
		? (key as T)
		: null;
}

const LONG_MIN = -(2n ** 63n);
const LONG_MAX = 2n ** 63n - 1n;

/**
 * Kotlin String.toLongOrNull for ASCII input: optional sign, digits only,
 * no whitespace, within Long range. (Kotlin also accepts non-ASCII Unicode
 * digits; no writer produces those.)
 */
function kotlinToLongOrNull(value: string): bigint | null {
	if (!/^[+-]?[0-9]+$/.test(value)) return null;
	const parsed = BigInt(value);
	return parsed < LONG_MIN || parsed > LONG_MAX ? null : parsed;
}

/**
 * Step 1 of how mobile trains an eccentric load: parseEccentricLoad
 * (PortalPullAdapter.kt:396-403) — case-sensitive removePrefix("LOAD_") then
 * toLongOrNull (the whole-string retry can only differ when the prefix was
 * removed, and then it can't parse), else the 100% default; no trimming.
 * The Long is stored and later read with Long.toInt(). Returns that Int, or
 * null when mobile takes the default.
 */
function mobileEccentricInt(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const parsed = kotlinToLongOrNull(
		value.startsWith("LOAD_") ? value.slice(5) : value,
	);
	return parsed === null ? null : Number(BigInt.asIntN(32, parsed));
}

/**
 * The EccentricLoad the phone trains for a stored value: step 2,
 * mapEccentricLoadFromDb (SqlDelightWorkoutRepository.kt:449-482) —
 * coerceIn(0, 150), then the exact enum or the nearest one (first in enum
 * order on a tie). null = mobile's default (100%). Used for display.
 */
export function toEccentricLoad(value: unknown): EccentricLoad | null {
	const int = mobileEccentricInt(value);
	if (int === null) return null;
	const percent = Math.min(150, Math.max(0, int));
	let best: EccentricLoad = ECCENTRIC_LOADS[0];
	for (const load of ECCENTRIC_LOADS) {
		const distance = Math.abs(Number(load.slice(5)) - percent);
		if (distance < Math.abs(Number(best.slice(5)) - percent)) best = load;
	}
	return best;
}

/**
 * Stored form of an eccentric load (mirror: public.normalize_eccentric_load):
 * null when mobile takes the default, `LOAD_<n>` when mobile parses exactly an
 * enum percentage, otherwise the value verbatim — the phone rounds it itself,
 * and a newer build may mean something by it.
 */
export function normalizeEccentricLoad(value: unknown): string | null {
	const int = mobileEccentricInt(value);
	if (int === null) return null;
	const exact = ECCENTRIC_LOADS.find((load) => Number(load.slice(5)) === int);
	return exact ?? (value as string);
}

/** parseEchoLevel (PortalPullAdapter.kt:409-415): uppercase(), no trim. */
export function toEchoLevel(value: unknown): EchoLevel | null {
	return typeof value === "string"
		? inList(ECHO_LEVELS, value.toUpperCase())
		: null;
}

/** RepCountTiming.valueOf: exact, case-sensitive (SqlDelightSyncRepository.kt:1092-1098). */
export function toRepCountTiming(value: unknown): RepCountTiming | null {
	return inList(REP_COUNT_TIMINGS, value);
}

/** stopAtTop only for exactly "TOP" (SqlDelightSyncRepository.kt:2345). */
export function toStopAtPosition(value: unknown): StopAtPosition | null {
	return inList(STOP_AT_POSITIONS, value);
}

/**
 * Superset colour as mobile reads it (SqlDelightSyncRepository.kt:2245-2248):
 * lowercase() (no trim) matched against the names, else toLongOrNull as a
 * colour index, else the superset's order index (= null here).
 * Index strings 0-3 become their name; other indexes are kept verbatim
 * because mobile does use them. The portal's four legacy hex values map to
 * their names on purpose (the portal only ever wrote those four, so an exact
 * table is the "nearest named colour").
 */
export function toSupersetColorName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const byName = inList(SUPERSET_COLOR_NAMES, value.toLowerCase());
	if (byName) return byName;
	const byHex = SUPERSET_COLOR_NAMES.find(
		(name) => SUPERSET_COLOR_HEX[name] === value.toUpperCase(),
	);
	if (byHex) return byHex;
	const index = kotlinToLongOrNull(value);
	if (index === null) return null;
	return index >= 0n && index < BigInt(SUPERSET_COLOR_NAMES.length)
		? SUPERSET_COLOR_NAMES[Number(index)]
		: value;
}

/** CSS colour for a stored superset colour (name, index or legacy hex). */
export function supersetColorHex(value: unknown): string | undefined {
	const name = inList(SUPERSET_COLOR_NAMES, toSupersetColorName(value));
	return name ? SUPERSET_COLOR_HEX[name] : undefined;
}

// ─── Display labels (unknown values are shown verbatim) ────────────────────

export function eccentricLoadLabel(value: string): string {
	const load = toEccentricLoad(value);
	return load ? ECCENTRIC_LOAD_LABELS[load] : value;
}

export function echoLevelLabel(value: string): string {
	const level = toEchoLevel(value);
	return level ? ECHO_LEVEL_LABELS[level] : value;
}

export function repCountTimingLabel(value: string): string {
	const timing = toRepCountTiming(value);
	return timing ? REP_COUNT_TIMING_LABELS[timing] : value;
}
