// ============================================================
// Dual Velocity Zone Classification System
// Supports both simplified 5-zone (mobile) and Dr. Mann VBT zones
// ============================================================

import { memoByTheme } from "./theme-tokens";

// --- Simplified Zone System (Mobile) ---

export type SimplifiedVbtZone =
	| "EXPLOSIVE"
	| "FAST"
	| "MODERATE"
	| "SLOW"
	| "GRIND";

export interface SimplifiedZoneInfo {
	zone: SimplifiedVbtZone;
	label: string;
	color: string;
	minVelocity: number;
	maxVelocity: number;
	description: string;
}

/**
 * Simplified 5-zone system matching mobile app classification.
 * Used for user-facing velocity feedback during workouts.
 */
const simplifiedZones = memoByTheme((tokens): SimplifiedZoneInfo[] => [
	{
		zone: "GRIND",
		label: "Grind",
		color: tokens.danger, // Flame Red
		minVelocity: 0,
		maxVelocity: 0.25,
		description: "Slow controlled movement, heavy resistance",
	},
	{
		zone: "SLOW",
		label: "Slow",
		color: tokens.accent, // Gold
		minVelocity: 0.25,
		maxVelocity: 0.5,
		description: "Controlled tempo, moderate resistance",
	},
	{
		zone: "MODERATE",
		label: "Moderate",
		color: tokens.primary, // Ember
		minVelocity: 0.5,
		maxVelocity: 0.75,
		description: "Steady pace, challenging resistance",
	},
	{
		zone: "FAST",
		label: "Fast",
		color: tokens.success, // Forge Green
		minVelocity: 0.75,
		maxVelocity: 1.0,
		description: "Quick movement, lighter resistance",
	},
	{
		zone: "EXPLOSIVE",
		label: "Explosive",
		color: tokens.cableB, // Blue
		minVelocity: 1.0,
		maxVelocity: Infinity,
		description: "Maximum velocity, explosive power",
	},
]);

/**
 * Simplified 5-zone table for the active theme (a stable array until the
 * theme changes).
 */
export function SIMPLIFIED_ZONES(): SimplifiedZoneInfo[] {
	return simplifiedZones();
}

// --- Dr. Mann VBT Zone System ---

export type MannVbtZone =
	| "absolute-strength"
	| "accelerative-strength"
	| "strength-speed"
	| "speed-strength"
	| "starting-strength";

/**
 * @deprecated Use MannVbtZone instead for clarity
 */
export type VbtZone = MannVbtZone;

export interface MannZoneInfo {
	zone: MannVbtZone;
	label: string;
	color: string;
	minVelocity: number;
	maxVelocity: number;
	description: string;
}

/**
 * @deprecated Use MannZoneInfo instead for clarity
 */
export type VbtZoneInfo = MannZoneInfo;

/**
 * Dr. Bryan Mann's velocity-based training zone thresholds.
 * Colors map to Phoenix theme palette.
 * Used for advanced VBT training zone classification.
 */
const mannZones = memoByTheme((tokens): MannZoneInfo[] => [
	{
		zone: "absolute-strength",
		label: "Absolute Strength",
		color: tokens.danger,
		minVelocity: 0,
		maxVelocity: 0.5,
		description: "Maximum force production, heavy grinding reps",
	},
	{
		zone: "accelerative-strength",
		label: "Accelerative Strength",
		color: tokens.primary,
		minVelocity: 0.5,
		maxVelocity: 0.75,
		description: "Heavy with intent to accelerate",
	},
	{
		zone: "strength-speed",
		label: "Strength-Speed",
		color: tokens.accent,
		minVelocity: 0.75,
		maxVelocity: 1.0,
		description: "Moderate load moved with speed",
	},
	{
		zone: "speed-strength",
		label: "Speed-Strength",
		color: tokens.success,
		minVelocity: 1.0,
		maxVelocity: 1.3,
		description: "Light load, emphasis on velocity",
	},
	{
		zone: "starting-strength",
		label: "Starting Strength",
		color: tokens.cableB,
		minVelocity: 1.3,
		maxVelocity: Infinity,
		description: "Explosive movement from dead stop",
	},
]);

/** Dr. Mann zone table for the active theme (stable until the theme changes). */
export function MANN_ZONES(): MannZoneInfo[] {
	return mannZones();
}

/**
 * @deprecated Use MANN_ZONES instead for clarity
 */
export function VBT_ZONES(): MannZoneInfo[] {
	return MANN_ZONES();
}

// --- Classification Functions ---

/**
 * Classify a mean velocity into the simplified 5-zone system.
 * This matches the mobile app zone classification.
 *
 * Thresholds:
 * - EXPLOSIVE: ≥ 1.0 m/s
 * - FAST: ≥ 0.75 m/s
 * - MODERATE: ≥ 0.5 m/s
 * - SLOW: ≥ 0.25 m/s
 * - GRIND: < 0.25 m/s
 *
 * @param meanVelocityMps - Mean velocity in meters per second
 * @returns Zone information with display label, color, and description
 */
export function classifyVbtZone(meanVelocityMps: number): SimplifiedZoneInfo {
	const zone = SIMPLIFIED_ZONES().find(
		(z) => meanVelocityMps >= z.minVelocity && meanVelocityMps < z.maxVelocity,
	);
	return zone ?? SIMPLIFIED_ZONES()[0];
}

/**
 * Classify a mean velocity into Dr. Bryan Mann's VBT training zones.
 *
 * Thresholds:
 * - starting-strength: ≥ 1.3 m/s
 * - speed-strength: 1.0 - 1.3 m/s
 * - strength-speed: 0.75 - 1.0 m/s
 * - accelerative-strength: 0.5 - 0.75 m/s
 * - absolute-strength: 0 - 0.5 m/s
 *
 * @param meanVelocityMps - Mean velocity in meters per second
 * @returns Zone information with display label, color, and description
 */
export function classifyMannZone(meanVelocityMps: number): MannZoneInfo {
	const zone = MANN_ZONES().find(
		(z) => meanVelocityMps >= z.minVelocity && meanVelocityMps < z.maxVelocity,
	);
	return zone ?? MANN_ZONES()[0];
}

// --- Helper Functions ---

/**
 * Get the dominant (most common) Dr. Mann zone from a set of velocities.
 * Returns the zone info for the zone that appears most frequently.
 * Used for showing the primary training zone for a set.
 */
export function getDominantMannZone(velocities: number[]): MannZoneInfo | null {
	if (velocities.length === 0) return null;

	const zoneCounts = new Map<MannVbtZone, number>();

	for (const velocity of velocities) {
		const zone = classifyMannZone(velocity);
		zoneCounts.set(zone.zone, (zoneCounts.get(zone.zone) ?? 0) + 1);
	}

	let maxCount = 0;
	let dominantZoneId: MannVbtZone = MANN_ZONES()[0].zone;

	for (const [zoneId, count] of zoneCounts) {
		if (count > maxCount) {
			maxCount = count;
			dominantZoneId = zoneId;
		}
	}

	return MANN_ZONES().find((z) => z.zone === dominantZoneId) ?? MANN_ZONES()[0];
}

/**
 * Dominant simplified zone (matches mobile VBT classification).
 */
export function getDominantSimplifiedZone(
	velocities: number[],
): SimplifiedZoneInfo | null {
	if (velocities.length === 0) return null;

	const zoneCounts = new Map<SimplifiedVbtZone, number>();

	for (const velocity of velocities) {
		const zone = classifyVbtZone(velocity);
		zoneCounts.set(zone.zone, (zoneCounts.get(zone.zone) ?? 0) + 1);
	}

	let maxCount = 0;
	let dominantZoneId: SimplifiedVbtZone = SIMPLIFIED_ZONES()[0].zone;

	for (const [zoneId, count] of zoneCounts) {
		if (count > maxCount) {
			maxCount = count;
			dominantZoneId = zoneId;
		}
	}

	return (
		SIMPLIFIED_ZONES().find((z) => z.zone === dominantZoneId) ??
		SIMPLIFIED_ZONES()[0]
	);
}

/**
 * Get zone info by zone ID for the simplified system.
 * @param zoneId - The zone identifier
 * @returns Zone information or undefined if not found
 */
export function getSimplifiedZoneById(
	zoneId: SimplifiedVbtZone,
): SimplifiedZoneInfo | undefined {
	return SIMPLIFIED_ZONES().find((z) => z.zone === zoneId);
}

/**
 * Get zone info by zone ID for the Dr. Mann system.
 * @param zoneId - The zone identifier
 * @returns Zone information or undefined if not found
 */
export function getMannZoneById(zoneId: MannVbtZone): MannZoneInfo | undefined {
	return MANN_ZONES().find((z) => z.zone === zoneId);
}
