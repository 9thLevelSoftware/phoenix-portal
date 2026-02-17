// Recovery Readiness Score — Pure ACWR Computation
// Medical liability: 14-day minimum gate, descriptive language only, no imperative commands

// --- Constants ---

export const ACWR_SWEET_SPOT = { min: 0.8, max: 1.3 } as const;
export const ACWR_DANGER_HIGH = 1.5;
export const ACWR_DANGER_LOW = 0.6;
export const GATING_THRESHOLD_DAYS = 14;
export const CLAMPING_THRESHOLD_DAYS = 30;
export const CLAMP_MIN = 25;
export const CLAMP_MAX = 75;

export const STATUS_LABELS = {
	elevated: "Your recovery capacity appears elevated",
	moderate: "Your training load appears balanced",
	low: "Your recent training volume suggests increased fatigue",
} as const;

// --- Types ---

export interface RecoverySession {
	started_at: Date;
	total_volume: number;
}

export interface CyclePosition {
	currentWeek: number;
	durationWeeks: number;
	status: "active" | "completed" | "draft";
}

export interface RecoveryInput {
	sessions: RecoverySession[];
	daysSinceFirstSession: number;
	cyclePosition?: CyclePosition | null;
}

export type RecoveryStatus = "elevated" | "moderate" | "low";

export interface RecoveryFactors {
	acwr: number;
	weeklyVolume: number;
	chronicVolume: number;
	trainingFrequency: number;
	restDays: number;
	cyclePosition: string | null;
}

export interface RecoveryResult {
	score: number;
	status: RecoveryStatus;
	label: string;
	isGated: boolean;
	isClamped: boolean;
	factors: RecoveryFactors;
}

// --- Score component weights ---
const WEIGHT_ACWR = 0.5;
const WEIGHT_REST = 0.3;
const WEIGHT_CYCLE = 0.2;

// --- Helpers ---

/** Count unique calendar days with at least one session in the last N days */
function countTrainingDaysInWindow(
	sessions: RecoverySession[],
	days: number,
): number {
	const now = new Date();
	const cutoff = new Date(now);
	cutoff.setDate(cutoff.getDate() - days);

	const uniqueDays = new Set<string>();
	for (const s of sessions) {
		if (s.started_at >= cutoff) {
			uniqueDays.add(s.started_at.toISOString().slice(0, 10));
		}
	}
	return uniqueDays.size;
}

/** Sum total volume for sessions within the last N days */
function volumeInWindow(sessions: RecoverySession[], days: number): number {
	const now = new Date();
	const cutoff = new Date(now);
	cutoff.setDate(cutoff.getDate() - days);

	let total = 0;
	for (const s of sessions) {
		if (s.started_at >= cutoff) {
			total += s.total_volume;
		}
	}
	return total;
}

/** Compute ACWR: acute (7d) volume / chronic weekly average (42d / 6 weeks) */
function computeACWR(sessions: RecoverySession[]): number {
	const acuteVolume = volumeInWindow(sessions, 7);
	const chronicVolume = volumeInWindow(sessions, 42);
	const chronicWeeklyAvg = chronicVolume / 6;

	if (chronicWeeklyAvg === 0) {
		return acuteVolume > 0 ? 2.0 : 1.0; // No chronic baseline = spike if any acute
	}

	return acuteVolume / chronicWeeklyAvg;
}

/** Score ACWR on 0-100 scale */
function scoreACWR(acwr: number): number {
	if (acwr >= ACWR_SWEET_SPOT.min && acwr <= ACWR_SWEET_SPOT.max) {
		// Sweet spot: 70-100 based on how centered (1.0 is ideal)
		const center = (ACWR_SWEET_SPOT.min + ACWR_SWEET_SPOT.max) / 2;
		const deviation = Math.abs(acwr - center) / (center - ACWR_SWEET_SPOT.min);
		return Math.round(100 - deviation * 30);
	}

	if (acwr > ACWR_DANGER_HIGH) {
		return 20; // Dangerous spike
	}

	if (acwr < ACWR_DANGER_LOW) {
		return 40; // Detraining
	}

	// Transition zones
	if (acwr > ACWR_SWEET_SPOT.max && acwr <= ACWR_DANGER_HIGH) {
		// Linearly decrease from 70 to 20
		const t =
			(acwr - ACWR_SWEET_SPOT.max) / (ACWR_DANGER_HIGH - ACWR_SWEET_SPOT.max);
		return Math.round(70 - t * 50);
	}

	if (acwr >= ACWR_DANGER_LOW && acwr < ACWR_SWEET_SPOT.min) {
		// Linearly increase from 40 to 70
		const t =
			(acwr - ACWR_DANGER_LOW) / (ACWR_SWEET_SPOT.min - ACWR_DANGER_LOW);
		return Math.round(40 + t * 30);
	}

	return 50; // Fallback
}

/** Score rest days (in last 7 days) on 0-100 scale */
function scoreRestDays(restDays: number): number {
	if (restDays >= 2) return 80;
	if (restDays === 1) return 60;
	return 30; // 0 rest days
}

/** Score cycle position on 0-100 scale */
function scoreCyclePosition(cycle: CyclePosition | null | undefined): {
	score: number;
	label: string | null;
} {
	if (!cycle || cycle.status !== "active") {
		return { score: 60, label: null }; // Neutral
	}

	const { currentWeek, durationWeeks } = cycle;

	// Deload heuristic: currentWeek divisible by 4 (every 4th week is deload)
	if (currentWeek % 4 === 0) {
		return {
			score: 90,
			label: `Week ${currentWeek}/${durationWeeks} — deload`,
		};
	}

	// Peak week: final week of cycle (but not a deload week)
	if (currentWeek >= durationWeeks) {
		return {
			score: 40,
			label: `Week ${currentWeek}/${durationWeeks} — peak`,
		};
	}

	// Mid-cycle: neutral
	return {
		score: 60,
		label: `Week ${currentWeek}/${durationWeeks} — mid-cycle`,
	};
}

/** Map raw score to status */
function getStatus(score: number): RecoveryStatus {
	if (score >= 70) return "elevated";
	if (score >= 50) return "moderate";
	return "low";
}

// --- Main ---

export function computeReadinessScore(input: RecoveryInput): RecoveryResult {
	const { sessions, daysSinceFirstSession, cyclePosition } = input;

	// Gating: < 14 days of data
	if (daysSinceFirstSession < GATING_THRESHOLD_DAYS) {
		return {
			score: 0,
			status: "low",
			label: STATUS_LABELS.low,
			isGated: true,
			isClamped: false,
			factors: {
				acwr: 0,
				weeklyVolume: 0,
				chronicVolume: 0,
				trainingFrequency: 0,
				restDays: 0,
				cyclePosition: null,
			},
		};
	}

	// Compute factors
	const acwr = computeACWR(sessions);
	const weeklyVolume = volumeInWindow(sessions, 7);
	const chronicVolume = volumeInWindow(sessions, 42);
	const trainingFrequency = countTrainingDaysInWindow(sessions, 7);
	const restDays = 7 - trainingFrequency;

	// Score components
	const acwrScore = scoreACWR(acwr);
	const restScore = scoreRestDays(restDays);
	const cycleResult = scoreCyclePosition(cyclePosition);

	// Weighted composite
	let rawScore = Math.round(
		acwrScore * WEIGHT_ACWR +
			restScore * WEIGHT_REST +
			cycleResult.score * WEIGHT_CYCLE,
	);

	// Clamping for 14-29 day users
	const isClamped = daysSinceFirstSession < CLAMPING_THRESHOLD_DAYS;
	if (isClamped) {
		rawScore = Math.max(CLAMP_MIN, Math.min(CLAMP_MAX, rawScore));
	}

	const status = getStatus(rawScore);

	return {
		score: rawScore,
		status,
		label: STATUS_LABELS[status],
		isGated: false,
		isClamped,
		factors: {
			acwr: Math.round(acwr * 100) / 100,
			weeklyVolume: Math.round(weeklyVolume),
			chronicVolume: Math.round(chronicVolume),
			trainingFrequency,
			restDays,
			cyclePosition: cycleResult.label,
		},
	};
}
