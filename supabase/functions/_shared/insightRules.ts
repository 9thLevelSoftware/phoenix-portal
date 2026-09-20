/**
 * The ONE training-insight rule engine (KD-14, F-059).
 *
 * Before PR 64 the same rules were written twice: once in
 * `supabase/functions/generate-insights/index.ts` and once in
 * `src/lib/insights.ts`, with a "keep in sync" comment as the only guard.
 * They had already drifted (the Edge copy knew about record types and volume
 * PRs; the SPA copy did not). This module is now the single source and both
 * sides import it — the Edge by relative path, the SPA through
 * `src/lib/insights.ts`, which Vite resolves by relative path too.
 *
 * Hard constraint: this file must stay dependency-free and runtime-neutral
 * (no `jsr:`/`npm:` imports, no `Deno`, no `@/` alias, no DOM), because it is
 * type-checked and bundled by Vite as well as run by Deno.
 *
 * Parity is pinned by a golden fixture, `tests/fixtures/insight-cases.json`,
 * asserted from Deno (`insightRules.test.ts`) and from Vitest
 * (`src/lib/__tests__/insights.test.ts`). Change the rules -> regenerate the
 * fixture, and mind that `user_insights` rows written by an earlier version
 * live for up to 36 hours.
 */

export type WeightUnit = 'kg' | 'lbs';

export interface TrainingInsight {
  id: string;
  type: 'success' | 'warning' | 'info' | 'achievement';
  title: string;
  description: string;
  recommendation?: string;
  metric?: { name: string; value: number; unit: string; delta?: number };
}

export interface RecentPersonalRecord {
  exercise: string;
  /** Presentation name (phase + record type). Defaults to `exercise`. */
  displayName?: string;
  /** Raw DB value: MAX_WEIGHT | MAX_VOLUME | 1RM. */
  recordType?: string | null;
  value: number;
  previousValue?: number;
}

export interface InsightInput {
  currentVolume: number;
  previousVolume: number;
  muscleGroups: Record<string, number>; // name -> percentage of total
  avgSessionsPerWeek: number;
  currentStreak: number;
  bestStreak: number;
  recentPRs: RecentPersonalRecord[];
  plateauExercises: string[];
  trainingLoadScore: number;
}

const STREAK_MILESTONES = [7, 14, 21, 30];

export const KG_TO_LBS = 2.20462;

export function normalizeWeightUnit(unit: unknown): WeightUnit {
  return unit === 'lbs' ? 'lbs' : 'kg';
}

export function convertWeight(valueKg: number, unit: WeightUnit): number {
  return unit === 'lbs' ? valueKg * KG_TO_LBS : valueKg;
}

export function formatWeight(valueKg: number, unit: WeightUnit): string {
  const converted = convertWeight(valueKg, unit);
  return unit === 'lbs'
    ? `${converted.toFixed(1)} lbs`
    : `${Math.round(converted)} kg`;
}

/** Volume PRs are large numbers; abbreviate above 1K. */
export function formatVolume(valueKg: number, unit: WeightUnit): string {
  const converted = convertWeight(valueKg, unit);
  const absValue = Math.abs(converted);

  if (absValue >= 1_000_000) {
    return `${(converted / 1_000_000).toFixed(1)}M ${unit}`;
  }
  if (absValue >= 1_000) {
    return `${(converted / 1_000).toFixed(1)}K ${unit}`;
  }
  return unit === 'lbs'
    ? `${converted.toFixed(1)} lbs`
    : `${Math.round(converted)} kg`;
}

export function roundWeightMetric(valueKg: number, unit: WeightUnit): number {
  const converted = convertWeight(valueKg, unit);
  return Number(converted.toFixed(unit === 'lbs' ? 1 : 0));
}

export function formatWorkoutPhase(phase: string | null | undefined): string {
  switch ((phase ?? 'COMBINED').toUpperCase()) {
    case 'CONCENTRIC':
      return 'Concentric';
    case 'ECCENTRIC':
      return 'Eccentric';
    default:
      return 'Combined';
  }
}

/**
 * `personal_records` holds MAX_WEIGHT / MAX_VOLUME / 1RM (CLAUDE.md: never
 * relabel the first two as "1RM"); the map keys on the UPPERCASE DB values.
 */
export function formatRecordType(recordType: string | null | undefined): string {
  switch ((recordType ?? '').toUpperCase()) {
    case 'MAX_WEIGHT':
      return 'Max Weight';
    case 'MAX_VOLUME':
      return 'Max Volume';
    case '1RM':
      return '1RM';
    default:
      return 'PR';
  }
}

export function formatPersonalRecordName(
  exercise: string,
  recordType: string | null | undefined,
  phase: string | null | undefined,
): string {
  const formattedType = formatRecordType(recordType);
  const formattedPhase = formatWorkoutPhase(phase);
  return formattedPhase === 'Combined'
    ? `${exercise} ${formattedType}`
    : `${exercise} ${formattedPhase} ${formattedType}`;
}

/**
 * Applies the rule set to an InsightInput. Pure: no async, no I/O, no clock.
 */
export function generateInsights(
  input: InsightInput,
  unit: WeightUnit = 'kg',
): TrainingInsight[] {
  const insights: TrainingInsight[] = [];

  // -- Volume trend ---------------------------------------------------------
  if (input.previousVolume > 0) {
    const volumeDelta =
      (input.currentVolume - input.previousVolume) / input.previousVolume;

    if (volumeDelta > 0.1) {
      const pct = Math.round(volumeDelta * 100);
      insights.push({
        id: 'volume-up',
        type: 'success',
        title: 'Volume Trending Up',
        description: `Your training volume increased by ${pct}% compared to the previous period.`,
        recommendation: 'Maintain this trajectory while monitoring recovery.',
        metric: {
          name: 'Volume Change',
          value: pct,
          unit: '%',
          delta: input.currentVolume - input.previousVolume,
        },
      });
    } else if (volumeDelta < -0.15) {
      const pct = Math.round(Math.abs(volumeDelta) * 100);
      insights.push({
        id: 'volume-down',
        type: 'warning',
        title: 'Volume Trending Down',
        description: `Your training volume dropped by ${pct}% compared to the previous period.`,
        recommendation:
          'Check for schedule disruptions or signs of overtraining. Consider a structured deload.',
        metric: {
          name: 'Volume Change',
          value: -pct,
          unit: '%',
          delta: input.currentVolume - input.previousVolume,
        },
      });
    }
  }

  // -- Muscle group imbalance ----------------------------------------------
  const groupEntries = Object.entries(input.muscleGroups);
  if (groupEntries.length >= 2) {
    const values = groupEntries.map(([, v]) => v);
    const maxValue = Math.max(...values);
    const minValue = Math.min(...values);

    if (maxValue > minValue * 3) {
      const [dominantGroup] = groupEntries.find(([, v]) => v === maxValue) ?? [
        'Unknown',
      ];
      const weakGroups = groupEntries
        .filter(([, v]) => v * 3 < maxValue)
        .map(([name]) => name);

      for (const weakGroup of weakGroups) {
        insights.push({
          id: `muscle-imbalance-${weakGroup}`,
          type: 'warning',
          title: `${weakGroup} Training Imbalance`,
          description: `${dominantGroup} training (${maxValue}%) dominates your programme — ${weakGroup} is under-represented at ${input.muscleGroups[weakGroup]}%.`,
          recommendation: `Add dedicated ${weakGroup} work to balance your programme and reduce injury risk.`,
          metric: {
            name: `${weakGroup} Volume Share`,
            value: input.muscleGroups[weakGroup],
            unit: '%',
          },
        });
      }
    }
  }

  // -- Consistency ----------------------------------------------------------
  if (input.avgSessionsPerWeek > 0 && input.avgSessionsPerWeek < 3) {
    insights.push({
      id: 'low-consistency',
      type: 'warning',
      title: 'Consistency Could Improve',
      description: `You're averaging ${input.avgSessionsPerWeek.toFixed(1)} sessions per week. Consistent training frequency is key to long-term progress.`,
      recommendation:
        'Aim for at least 3 sessions per week for meaningful adaptation.',
      metric: {
        name: 'Avg Sessions / Week',
        value: input.avgSessionsPerWeek,
        unit: 'sessions',
      },
    });
  }

  // -- PR achievements ------------------------------------------------------
  for (const pr of input.recentPRs) {
    const displayName = pr.displayName ?? pr.exercise;
    const delta =
      pr.previousValue !== undefined ? pr.value - pr.previousValue : undefined;
    const isVolumeRecord = (pr.recordType ?? '').toUpperCase() === 'MAX_VOLUME';
    const format = isVolumeRecord ? formatVolume : formatWeight;
    const formattedValue = format(pr.value, unit);
    const formattedDelta = delta !== undefined ? format(delta, unit) : undefined;
    const formattedPrevious =
      pr.previousValue !== undefined ? format(pr.previousValue, unit) : undefined;
    insights.push({
      id: `pr-${displayName.toLowerCase().replace(/\s+/g, '-')}`,
      type: 'achievement',
      title: `New PR: ${displayName}`,
      description:
        delta !== undefined && formattedDelta && formattedPrevious
          ? `You set a personal record on ${displayName} — ${formattedValue} (up ${formattedDelta} from ${formattedPrevious}).`
          : `You set a personal record on ${displayName} — ${formattedValue}.`,
      metric: {
        name: displayName,
        value: roundWeightMetric(pr.value, unit),
        unit,
        delta: delta !== undefined ? roundWeightMetric(delta, unit) : undefined,
      },
    });
  }

  // -- Plateau detection ----------------------------------------------------
  for (const exercise of input.plateauExercises) {
    insights.push({
      id: `plateau-${exercise.toLowerCase().replace(/\s+/g, '-')}`,
      type: 'warning',
      title: `Plateau Detected: ${exercise}`,
      description: `Your ${exercise} performance has stalled over recent sessions.`,
      recommendation:
        'Try varying rep ranges, adding a deload week, or introducing a variation movement.',
    });
  }

  // -- Streak milestones ----------------------------------------------------
  if (STREAK_MILESTONES.includes(input.currentStreak)) {
    insights.push({
      id: `streak-${input.currentStreak}`,
      type: 'achievement',
      title: `${input.currentStreak}-Day Streak!`,
      description: `You've trained consistently for ${input.currentStreak} days in a row — keep the momentum going.`,
      metric: {
        name: 'Current Streak',
        value: input.currentStreak,
        unit: 'days',
      },
    });
  }

  // -- Training load --------------------------------------------------------
  if (input.trainingLoadScore >= 75) {
    insights.push({
      id: 'high-training-load',
      type: 'warning',
      title: 'High Training Load',
      description: `Your training load score is ${input.trainingLoadScore} — above the recommended threshold.`,
      recommendation:
        'Consider scheduling a deload week or reducing intensity to prevent overtraining and injury.',
      metric: {
        name: 'Training Load Score',
        value: input.trainingLoadScore,
        unit: 'pts',
      },
    });
  }

  return insights;
}
