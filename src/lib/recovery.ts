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

// --- Stub Implementation (to be completed in GREEN phase) ---

export function computeReadinessScore(_input: RecoveryInput): RecoveryResult {
	return {
		score: 0,
		status: "low",
		label: STATUS_LABELS.low,
		isGated: false,
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
