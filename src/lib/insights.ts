// Canonical source for insight generation rules.
// IMPORTANT: The Edge Function at supabase/functions/generate-insights/index.ts
// duplicates these rules. Changes here must be synced there.

export interface TrainingInsight {
	id: string;
	type: "success" | "warning" | "info" | "achievement";
	title: string;
	description: string;
	recommendation?: string;
	metric?: { name: string; value: number; unit: string; delta?: number };
}

export interface InsightInput {
	currentVolume: number;
	previousVolume: number;
	muscleGroups: Record<string, number>; // name → percentage of total
	avgSessionsPerWeek: number;
	currentStreak: number;
	bestStreak: number;
	recentPRs: Array<{ exercise: string; value: number; previousValue?: number }>;
	plateauExercises: string[];
	trainingLoadScore: number;
}

const STREAK_MILESTONES = [7, 14, 21, 30];

/**
 * Applies rule-based logic to an InsightInput and returns a list of
 * TrainingInsight objects. Pure function — no async, no side effects.
 */
export function generateInsights(input: InsightInput): TrainingInsight[] {
	const insights: TrainingInsight[] = [];

	// ── Volume Trend ──────────────────────────────────────────────────────────
	if (input.previousVolume > 0) {
		const volumeDelta =
			(input.currentVolume - input.previousVolume) / input.previousVolume;

		if (volumeDelta > 0.1) {
			const pct = Math.round(volumeDelta * 100);
			insights.push({
				id: "volume-up",
				type: "success",
				title: "Volume Trending Up",
				description: `Your training volume increased by ${pct}% compared to the previous period.`,
				recommendation: "Maintain this trajectory while monitoring recovery.",
				metric: {
					name: "Volume Change",
					value: pct,
					unit: "%",
					delta: input.currentVolume - input.previousVolume,
				},
			});
		} else if (volumeDelta < -0.15) {
			const pct = Math.round(Math.abs(volumeDelta) * 100);
			insights.push({
				id: "volume-down",
				type: "warning",
				title: "Volume Trending Down",
				description: `Your training volume dropped by ${pct}% compared to the previous period.`,
				recommendation:
					"Check for schedule disruptions or signs of overtraining. Consider a structured deload.",
				metric: {
					name: "Volume Change",
					value: -pct,
					unit: "%",
					delta: input.currentVolume - input.previousVolume,
				},
			});
		}
	}

	// ── Muscle Group Imbalance ─────────────────────────────────────────────────
	const groupEntries = Object.entries(input.muscleGroups);
	if (groupEntries.length >= 2) {
		const values = groupEntries.map(([, v]) => v);
		const maxValue = Math.max(...values);
		const minValue = Math.min(...values);

		if (maxValue > minValue * 3) {
			const [dominantGroup] = groupEntries.find(([, v]) => v === maxValue) ?? [
				"Unknown",
			];
			const weakGroups = groupEntries
				.filter(([, v]) => v * 3 < maxValue)
				.map(([name]) => name);

			for (const weakGroup of weakGroups) {
				insights.push({
					id: `muscle-imbalance-${weakGroup}`,
					type: "warning",
					title: `${weakGroup} Training Imbalance`,
					description: `${dominantGroup} training (${maxValue}%) dominates your programme — ${weakGroup} is under-represented at ${input.muscleGroups[weakGroup]}%.`,
					recommendation: `Add dedicated ${weakGroup} work to balance your programme and reduce injury risk.`,
					metric: {
						name: `${weakGroup} Volume Share`,
						value: input.muscleGroups[weakGroup],
						unit: "%",
					},
				});
			}
		}
	}

	// ── Consistency ───────────────────────────────────────────────────────────
	if (input.avgSessionsPerWeek > 0 && input.avgSessionsPerWeek < 3) {
		insights.push({
			id: "low-consistency",
			type: "warning",
			title: "Consistency Could Improve",
			description: `You're averaging ${input.avgSessionsPerWeek.toFixed(1)} sessions per week. Consistent training frequency is key to long-term progress.`,
			recommendation:
				"Aim for at least 3 sessions per week for meaningful adaptation.",
			metric: {
				name: "Avg Sessions / Week",
				value: input.avgSessionsPerWeek,
				unit: "sessions",
			},
		});
	}

	// ── PR Achievements ───────────────────────────────────────────────────────
	for (const pr of input.recentPRs) {
		const delta =
			pr.previousValue !== undefined ? pr.value - pr.previousValue : undefined;
		insights.push({
			id: `pr-${pr.exercise.toLowerCase().replace(/\s+/g, "-")}`,
			type: "achievement",
			title: `New PR: ${pr.exercise}`,
			description:
				delta !== undefined
					? `You set a personal record on ${pr.exercise} — ${pr.value} lbs (up ${delta} lbs from ${pr.previousValue} lbs).`
					: `You set a personal record on ${pr.exercise} — ${pr.value} lbs.`,
			metric: {
				name: pr.exercise,
				value: pr.value,
				unit: "lbs",
				delta,
			},
		});
	}

	// ── Plateau Detection ─────────────────────────────────────────────────────
	for (const exercise of input.plateauExercises) {
		insights.push({
			id: `plateau-${exercise.toLowerCase().replace(/\s+/g, "-")}`,
			type: "warning",
			title: `Plateau Detected: ${exercise}`,
			description: `Your ${exercise} performance has stalled over recent sessions.`,
			recommendation:
				"Try varying rep ranges, adding a deload week, or introducing a variation movement.",
		});
	}

	// ── Streak Milestones ─────────────────────────────────────────────────────
	if (STREAK_MILESTONES.includes(input.currentStreak)) {
		insights.push({
			id: `streak-${input.currentStreak}`,
			type: "achievement",
			title: `${input.currentStreak}-Day Streak!`,
			description: `You've trained consistently for ${input.currentStreak} days in a row — keep the momentum going.`,
			metric: {
				name: "Current Streak",
				value: input.currentStreak,
				unit: "days",
			},
		});
	}

	// ── Training Load ─────────────────────────────────────────────────────────
	if (input.trainingLoadScore >= 75) {
		insights.push({
			id: "high-training-load",
			type: "warning",
			title: "High Training Load",
			description: `Your training load score is ${input.trainingLoadScore} — above the recommended threshold.`,
			recommendation:
				"Consider scheduling a deload week or reducing intensity to prevent overtraining and injury.",
			metric: {
				name: "Training Load Score",
				value: input.trainingLoadScore,
				unit: "pts",
			},
		});
	}

	return insights;
}
