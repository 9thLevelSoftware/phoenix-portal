/**
 * Display helpers for telemetry data.
 *
 * The canonical wire format for cable identifiers is "A" | "B", matching the
 * BLE convention used by Phoenix hardware and the mobile app (authoritative
 * for BLE-captured data per monorepo CLAUDE.md).
 *
 * Use this helper at the presentation boundary when the UI needs a
 * human-readable label. Never translate at the storage or wire boundary.
 *
 * Resolves audit item #4 (2026-04-19).
 */

export type Cable = "A" | "B";

/**
 * Convert canonical cable identifier ("A" / "B") to a human-readable label.
 *
 * - Cable A → "Left" (left actuator)
 * - Cable B → "Right" (right actuator)
 *
 * Database/query results can surface `cable` as `string | null`; any value that
 * is not the canonical "A"/"B" returns an explicit "Unknown" rather than being
 * silently treated as "Right".
 */
export function cableDisplayName(
	c: Cable | string | null | undefined,
): "Left" | "Right" | "Unknown" {
	if (c === "A") return "Left";
	if (c === "B") return "Right";
	return "Unknown";
}
