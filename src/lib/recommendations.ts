// Recommendation Engine
// Aggregates training recommendations from volume landmarks and SRA recovery data.
// Pure computation: no React deps, no DB access.

import type { MuscleRecovery } from "@/lib/sra-recovery";
import {
	classifyVolumeStatus,
	getVolumeLandmark,
} from "@/lib/volume-landmarks";

// --- Types ---

export interface Recommendation {
	id: string;
	priority: "critical" | "actionable" | "info" | "positive";
	signal: string;
	muscleGroup?: string;
	title: string;
	action: string;
	metric?: {
		current: number;
		threshold: number;
		unit: string;
	};
}

// --- Priority ordering ---

export const PRIORITY_ORDER: Record<Recommendation["priority"], number> = {
	critical: 0,
	actionable: 1,
	info: 2,
	positive: 3,
};

// --- Volume recommendations ---

/**
 * Generates volume-based recommendations for each muscle group in the provided
 * weekly volume map. Emits a recommendation only when volume is above MRV
 * (critical) or below MEV (actionable). In-range volumes produce no recommendation.
 */
export function generateVolumeRecommendations(
	weeklyVolume: Record<string, number>,
): Recommendation[] {
	const recommendations: Recommendation[] = [];

	for (const [muscleGroup, sets] of Object.entries(weeklyVolume)) {
		const status = classifyVolumeStatus(muscleGroup, sets);
		const landmark = getVolumeLandmark(muscleGroup);

		if (!status || !landmark) continue;

		if (status === "above_mrv") {
			const excess = sets - landmark.mrv;
			recommendations.push({
				id: `volume_above_mrv_${muscleGroup}`,
				priority: "critical",
				signal: "volume_above_mrv",
				muscleGroup,
				title: `${muscleGroup} volume exceeds MRV`,
				action: `Reduce by ${excess} set${excess !== 1 ? "s" : ""} next week (${sets}/${landmark.mrv} sets)`,
				metric: {
					current: sets,
					threshold: landmark.mrv,
					unit: "sets",
				},
			});
		} else if (status === "below_mev") {
			const deficit = landmark.mev - sets;
			recommendations.push({
				id: `volume_below_mev_${muscleGroup}`,
				priority: "actionable",
				signal: "volume_below_mev",
				muscleGroup,
				title: `${muscleGroup} below MEV`,
				action: `Add ${deficit} set${deficit !== 1 ? "s" : ""} to maintain progress (${sets}/${landmark.mev} sets)`,
				metric: {
					current: sets,
					threshold: landmark.mev,
					unit: "sets",
				},
			});
		}
		// between_mev_mav, in_mav, above_mav → no recommendation
	}

	return recommendations;
}

// --- SRA recommendations ---

/**
 * Generates recovery-based recommendations from an array of MuscleRecovery objects.
 * - SUPERCOMPENSATED → positive: optimal training window
 * - RECOVERED        → positive: ready to train
 * - FATIGUED         → info: needs more recovery time
 * - RECOVERING       → no recommendation (neutral state)
 */
export function generateSraRecommendations(
	recoveries: MuscleRecovery[],
): Recommendation[] {
	const recommendations: Recommendation[] = [];

	for (const recovery of recoveries) {
		const { muscleGroup, status, hoursRemaining } = recovery;

		switch (status) {
			case "SUPERCOMPENSATED":
				recommendations.push({
					id: `sra_supercompensated_${muscleGroup}`,
					priority: "positive",
					signal: "sra_supercompensated",
					muscleGroup,
					title: `${muscleGroup} is in the optimal training window`,
					action: "Prioritize this muscle group in today's session",
				});
				break;

			case "RECOVERED":
				recommendations.push({
					id: `sra_recovered_${muscleGroup}`,
					priority: "positive",
					signal: "sra_recovered",
					muscleGroup,
					title: `${muscleGroup} is recovered and ready to train`,
					action: "Include this muscle group in your next session",
				});
				break;

			case "FATIGUED": {
				const hours = hoursRemaining ?? recovery.estimatedRecoveryHours;
				recommendations.push({
					id: `sra_fatigued_${muscleGroup}`,
					priority: "info",
					signal: "sra_fatigued",
					muscleGroup,
					title: `${muscleGroup} is still fatigued`,
					action: `Allow ~${hours}h more recovery before the next session`,
				});
				break;
			}

			case "RECOVERING":
				// Neutral — no recommendation
				break;
		}
	}

	return recommendations;
}

// --- Merge & deduplicate ---

/**
 * Merges an array of recommendations, deduplicates by (signal + muscleGroup),
 * and sorts by priority order: critical → actionable → info → positive.
 * When deduplicating, the first occurrence is kept.
 */
export function mergeRecommendations(
	recos: Recommendation[],
): Recommendation[] {
	const seen = new Set<string>();
	const deduped: Recommendation[] = [];

	for (const reco of recos) {
		const key = `${reco.signal}::${reco.muscleGroup ?? ""}`;
		if (!seen.has(key)) {
			seen.add(key);
			deduped.push(reco);
		}
	}

	return deduped.sort(
		(a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
	);
}
