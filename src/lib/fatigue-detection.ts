import type { RepSummary } from '@/schemas/telemetry';

// Fatigue threshold per VBT research (REPLAY-06)
export const FATIGUE_THRESHOLD_PERCENT = 20;

// Severity thresholds
const MODERATE_THRESHOLD = 20;
const HIGH_THRESHOLD = 30;

export type FatigueSeverity = 'none' | 'moderate' | 'high';

export interface FatigueAnalysis {
  isFatigued: boolean;
  fatigueStartRepIndex: number | null;
  velocityDropPercent: number;
  insight: string | null;
  perRepDrops: number[];
  severity: FatigueSeverity;
}

/**
 * Detect fatigue in a set by analyzing velocity drop from first rep.
 *
 * Per VBT research, fatigue is indicated when velocity drops >20% from the first rep.
 * Severity levels:
 * - none: <20% drop
 * - moderate: 20-30% drop
 * - high: >30% drop
 *
 * @param repSummaries - Array of rep summaries from a single set
 * @returns Fatigue analysis with severity and actionable insight
 */
export function detectFatigue(repSummaries: RepSummary[]): FatigueAnalysis {
  if (repSummaries.length === 0) {
    return createNoFatigueResult([]);
  }

  const firstRepVelocity = repSummaries[0].mean_velocity_mps;

  if (firstRepVelocity <= 0) {
    return createNoFatigueResult([]);
  }

  // Calculate per-rep velocity drops compared to first rep
  const perRepDrops = repSummaries.map((rep) => {
    const drop = ((firstRepVelocity - rep.mean_velocity_mps) / firstRepVelocity) * 100;
    return Math.max(0, drop); // Negative drops (faster reps) become 0
  });

  // Find first rep where fatigue threshold is exceeded
  const fatigueStartIndex = perRepDrops.findIndex((drop) => drop >= FATIGUE_THRESHOLD_PERCENT);

  // Get maximum velocity drop
  const maxVelocityDrop = Math.max(...perRepDrops);
  const maxDropRepIndex = perRepDrops.indexOf(maxVelocityDrop);

  if (fatigueStartIndex === -1) {
    return createNoFatigueResult(perRepDrops);
  }

  const severity = determineSeverity(maxVelocityDrop);
  const insight = generateInsight(maxVelocityDrop, maxDropRepIndex + 1, fatigueStartIndex + 1);

  return {
    isFatigued: true,
    fatigueStartRepIndex: fatigueStartIndex,
    velocityDropPercent: Math.round(maxVelocityDrop * 10) / 10, // Round to 1 decimal
    insight,
    perRepDrops: perRepDrops.map((d) => Math.round(d * 10) / 10),
    severity,
  };
}

function createNoFatigueResult(perRepDrops: number[]): FatigueAnalysis {
  return {
    isFatigued: false,
    fatigueStartRepIndex: null,
    velocityDropPercent: perRepDrops.length > 0 ? Math.round(Math.max(...perRepDrops) * 10) / 10 : 0,
    insight: null,
    perRepDrops: perRepDrops.map((d) => Math.round(d * 10) / 10),
    severity: 'none',
  };
}

function determineSeverity(maxDrop: number): FatigueSeverity {
  if (maxDrop >= HIGH_THRESHOLD) {
    return 'high';
  }
  if (maxDrop >= MODERATE_THRESHOLD) {
    return 'moderate';
  }
  return 'none';
}

function generateInsight(maxDrop: number, maxDropRepNumber: number, fatigueStartRepNumber: number): string {
  const dropFormatted = Math.round(maxDrop);

  if (maxDrop >= HIGH_THRESHOLD) {
    return `Velocity dropped ${dropFormatted}% on rep ${maxDropRepNumber} — consider stopping at rep ${fatigueStartRepNumber - 1} next time`;
  }

  return `Velocity dropped ${dropFormatted}% on rep ${maxDropRepNumber} — consider stopping earlier`;
}
