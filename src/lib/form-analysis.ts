export interface RepMetrics {
  peakForce: number;
  meanVelocity: number;
  rom: number;
  tut: number;       // milliseconds
  asymmetry: number; // absolute percentage
}

/**
 * Curve Consistency: how repeatable are the force curves?
 * Uses coefficient of variation of peak force as a proxy.
 */
export function calculateCurveConsistency(reps: RepMetrics[]): number {
  if (reps.length < 2) return 0;
  const forces = reps.map((r) => r.peakForce);
  const mean = forces.reduce((a, b) => a + b, 0) / forces.length;
  if (mean === 0) return 0;
  const variance = forces.reduce((sum, f) => sum + (f - mean) ** 2, 0) / forces.length;
  const cv = Math.sqrt(variance) / mean;
  // CV of 0 = 100%, CV of 0.2+ = 0%
  return Math.max(0, Math.min(100, Math.round((1 - cv / 0.2) * 100)));
}

/**
 * Tempo Control: consistency of time under tension across reps.
 */
export function calculateTempoControl(reps: RepMetrics[]): number {
  if (reps.length < 2) return 0;
  const tuts = reps.map((r) => r.tut);
  const mean = tuts.reduce((a, b) => a + b, 0) / tuts.length;
  if (mean === 0) return 0;
  const variance = tuts.reduce((sum, t) => sum + (t - mean) ** 2, 0) / tuts.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.max(0, Math.min(100, Math.round((1 - cv / 0.3) * 100)));
}

/**
 * Fatigue Resistance: rate of decay in force and velocity across the set.
 */
export function calculateFatigueResistance(reps: RepMetrics[]): number {
  if (reps.length < 2) return 0;

  const forceDecay = normalizedDecayRate(reps.map((r) => r.peakForce));
  const velocityDecay = normalizedDecayRate(reps.map((r) => r.meanVelocity));
  const romDecay = normalizedDecayRate(reps.map((r) => r.rom));

  // Average decay rate, weighted: force 40%, velocity 40%, ROM 20%
  const avgDecay = forceDecay * 0.4 + velocityDecay * 0.4 + romDecay * 0.2;

  // Decay of 0% per rep = 100, decay of 10%+ per rep = 0
  return Math.max(0, Math.min(100, Math.round((1 - avgDecay / 0.1) * 100)));
}

function normalizedDecayRate(values: number[]): number {
  if (values.length < 2 || values[0] === 0) return 0;
  const n = values.length;
  const xs = values.map((_, i) => i);
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (values[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return Math.abs(slope / values[0]);
}

/**
 * Bilateral Balance: penalizes high asymmetry and increasing asymmetry.
 */
export function calculateBilateralBalance(reps: RepMetrics[]): number {
  if (reps.length === 0) return 0;

  const asymmetries = reps.map((r) => Math.abs(r.asymmetry));
  const avgAsymmetry = asymmetries.reduce((a, b) => a + b, 0) / asymmetries.length;

  let trendPenalty = 0;
  if (asymmetries.length >= 3) {
    const lastThird = asymmetries.slice(Math.floor(asymmetries.length * 0.66));
    const firstThird = asymmetries.slice(0, Math.ceil(asymmetries.length * 0.33));
    const lastAvg = lastThird.reduce((a, b) => a + b, 0) / lastThird.length;
    const firstAvg = firstThird.reduce((a, b) => a + b, 0) / firstThird.length;
    trendPenalty = Math.max(0, lastAvg - firstAvg);
  }

  return Math.max(0, Math.min(100, Math.round(100 - avgAsymmetry * 5 - trendPenalty * 3)));
}

/**
 * Overall Form Score: weighted composite.
 * Curve Consistency 30%, Tempo Control 25%, Fatigue Resistance 25%, Bilateral Balance 20%
 */
export function calculateFormScore(reps: RepMetrics[]): number {
  const cc = calculateCurveConsistency(reps);
  const tc = calculateTempoControl(reps);
  const fr = calculateFatigueResistance(reps);
  const bb = calculateBilateralBalance(reps);
  return Math.round(cc * 0.3 + tc * 0.25 + fr * 0.25 + bb * 0.2);
}

export function getLetterGrade(score: number): string {
  if (score >= 95) return "A+";
  if (score >= 90) return "A";
  if (score >= 85) return "A-";
  if (score >= 80) return "B+";
  if (score >= 75) return "B";
  if (score >= 70) return "B-";
  if (score >= 65) return "C+";
  if (score >= 60) return "C";
  if (score >= 55) return "C-";
  if (score >= 50) return "D";
  return "F";
}
