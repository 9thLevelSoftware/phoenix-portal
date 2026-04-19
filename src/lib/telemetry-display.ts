/**
 * Display helpers for telemetry data.
 *
 * The canonical wire format for cable identifiers is "A" | "B", matching the
 * BLE convention used by Vitruvian hardware and the mobile app (authoritative
 * for BLE-captured data per monorepo CLAUDE.md).
 *
 * Use these helpers at the presentation boundary when the UI needs a
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
 */
export function cableDisplayName(c: Cable): "Left" | "Right" {
	return c === "A" ? "Left" : "Right";
}

/**
 * Convert a cable identifier to a lowercase slug suitable for CSS class names
 * or URL fragments.
 */
export function cableSlug(c: Cable): "left" | "right" {
	return c === "A" ? "left" : "right";
}
