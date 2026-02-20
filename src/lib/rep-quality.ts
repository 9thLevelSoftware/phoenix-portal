import type { RepSummary } from "@/schemas/telemetry";

export interface QualityFactors {
	velocityConsistency: number; // 0-100
	romScore: number; // 0-100
	asymmetryPenalty: number; // 0-100 (100 = balanced)
	tutScore: number; // 0-100
}

export interface RepQualityResult {
	score: number; // 0-100 composite
	factors: QualityFactors;
	isLowQuality: boolean; // score < 60 (for warning color)
}

// Quality weights per VBT research
const WEIGHTS = {
	velocityConsistency: 0.3,
	romScore: 0.25,
	asymmetryPenalty: 0.25,
	tutScore: 0.2,
} as const;

// Default targets
const DEFAULT_TARGET_ROM_MM = 400;
const DEFAULT_TUT_RANGE_MS: [number, number] = [2000, 5000];

// Low quality threshold (for muted warning color)
const LOW_QUALITY_THRESHOLD = 60;

/**
 * Calculate rep quality score based on velocity consistency, ROM, asymmetry, and TUT.
 *
 * @param rep - Rep summary data from telemetry
 * @param targetRomMm - Target range of motion in mm (default 400mm)
 * @param targetTutRangeMs - Target time under tension range in ms (default [2000, 5000])
 * @returns Quality result with composite score and factor breakdown
 */
export function calculateRepQualityScore(
	rep: RepSummary,
	targetRomMm: number = DEFAULT_TARGET_ROM_MM,
	targetTutRangeMs: [number, number] = DEFAULT_TUT_RANGE_MS,
): RepQualityResult {
	const factors = calculateQualityFactors(rep, targetRomMm, targetTutRangeMs);

	const score = Math.round(
		factors.velocityConsistency * WEIGHTS.velocityConsistency +
			factors.romScore * WEIGHTS.romScore +
			factors.asymmetryPenalty * WEIGHTS.asymmetryPenalty +
			factors.tutScore * WEIGHTS.tutScore,
	);

	return {
		score: clamp(score, 0, 100),
		factors,
		isLowQuality: score < LOW_QUALITY_THRESHOLD,
	};
}

function calculateQualityFactors(
	rep: RepSummary,
	targetRomMm: number,
	targetTutRangeMs: [number, number],
): QualityFactors {
	return {
		velocityConsistency: calculateVelocityConsistency(rep),
		romScore: calculateRomScore(rep.rom_mm, targetRomMm),
		asymmetryPenalty: calculateAsymmetryPenalty(rep.asymmetry_pct),
		tutScore: calculateTutScore(rep.tut_ms, targetTutRangeMs),
	};
}

/**
 * Velocity consistency derived from peak/mean ratio.
 * Ideal ratio is around 1.2-1.5 (peak slightly higher than mean).
 * Higher ratios indicate inconsistent movement.
 */
function calculateVelocityConsistency(rep: RepSummary): number {
	if (rep.mean_velocity_mps <= 0) return 0;

	const ratio = rep.peak_velocity_mps / rep.mean_velocity_mps;

	// Ideal ratio is 1.2-1.5
	// Score decreases as ratio deviates from ideal
	if (ratio >= 1.2 && ratio <= 1.5) {
		return 100;
	} else if (ratio < 1.2) {
		// Too consistent (unusual) - minor penalty
		const deviation = 1.2 - ratio;
		return Math.max(0, 100 - deviation * 100);
	} else {
		// Too variable - penalty increases with ratio
		const deviation = ratio - 1.5;
		return Math.max(0, 100 - deviation * 50);
	}
}

/**
 * ROM score based on actual vs target range of motion.
 * Score is percentage of target achieved, capped at 100.
 */
function calculateRomScore(actualRomMm: number, targetRomMm: number): number {
	if (targetRomMm <= 0) return 100;

	const percentage = (actualRomMm / targetRomMm) * 100;

	// Cap at 100 - exceeding target is fine but doesn't give bonus
	return clamp(Math.round(percentage), 0, 100);
}

/**
 * Asymmetry penalty based on left/right force imbalance.
 * 100 = perfectly balanced, decreases by 5 points per percentage point of asymmetry.
 */
function calculateAsymmetryPenalty(asymmetryPct: number): number {
	const penalty = Math.abs(asymmetryPct) * 5;
	return clamp(Math.round(100 - penalty), 0, 100);
}

/**
 * TUT score based on time under tension within target range.
 * Within range = 100, outside = scaled based on distance from range.
 */
function calculateTutScore(
	tutMs: number,
	targetRange: [number, number],
): number {
	const [minTut, maxTut] = targetRange;

	if (tutMs >= minTut && tutMs <= maxTut) {
		return 100;
	}

	if (tutMs < minTut) {
		// Too fast - score decreases proportionally
		const shortfall = minTut - tutMs;
		const penalty = (shortfall / minTut) * 100;
		return clamp(Math.round(100 - penalty), 0, 100);
	}

	// Too slow - score decreases proportionally
	const excess = tutMs - maxTut;
	const penalty = (excess / maxTut) * 50; // Slower penalty for exceeding max
	return clamp(Math.round(100 - penalty), 0, 100);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
