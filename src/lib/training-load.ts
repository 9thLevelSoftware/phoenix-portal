export interface WorkoutLoadInput {
  totalVolume: number;
  durationSeconds: number;
  setCount: number;
}

/**
 * Calculate Resistance Training Load (RTL) score 0-100.
 *
 * Composite of:
 * - Volume component: total volume normalized against a reference (20,000 lbs/week)
 * - Intensity component: volume per set (proxy for avg weight × reps), reference 400 lbs/set
 * - Frequency component: number of sessions normalized against reference (5/week)
 *
 * Each component is 0-33, summed and capped at 100.
 */
export function calculateRTL(sessions: WorkoutLoadInput[]): number {
  if (sessions.length === 0) return 0;

  const totalVolume = sessions.reduce((sum, s) => sum + s.totalVolume, 0);
  const totalSets = sessions.reduce((sum, s) => sum + s.setCount, 0);

  // Volume component (0-33): normalized against 20,000 lbs/week reference
  const volumeScore = Math.min(33, (totalVolume / 20000) * 33);

  // Intensity component (0-33): volume per set, reference ~400 lbs/set
  const avgVolumePerSet = totalSets > 0 ? totalVolume / totalSets : 0;
  const intensityScore = Math.min(33, (avgVolumePerSet / 400) * 33);

  // Frequency component (0-34): sessions normalized against 5/week
  const frequencyScore = Math.min(34, (sessions.length / 5) * 34);

  return Math.min(100, Math.round(volumeScore + intensityScore + frequencyScore));
}

export type TrainingLoadZone = "low" | "optimal" | "high";

export function classifyTrainingLoad(rtl: number): TrainingLoadZone {
  if (rtl < 35) return "low";
  if (rtl < 75) return "optimal";
  return "high";
}
