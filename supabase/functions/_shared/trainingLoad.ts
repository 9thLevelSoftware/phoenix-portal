/**
 * Resistance Training Load (RTL), scored 0-100.
 *
 * There is exactly ONE calculator. It used to be copied in
 * `supabase/functions/generate-insights/index.ts` and
 * `src/lib/training-load.ts`. Both sides import this module — the Edge by
 * relative path, the SPA through `src/lib/training-load.ts`, which Vite
 * resolves by relative path too.
 *
 * Hard constraint: this file must stay dependency-free and runtime-neutral
 * (no `jsr:`/`npm:` imports, no `Deno`, no `@/` alias, no DOM), because it is
 * type-checked and bundled by Vite as well as run by the Deno edge runtime.
 *
 * Composite of:
 * - Volume: total volume against a 20,000 kg/week reference (0-33)
 * - Intensity: volume per set against a 400 kg/set reference (0-33)
 * - Frequency: session count against a 5/week reference (0-34)
 *
 * The components are summed and capped at 100.
 *
 * Parity is pinned by `tests/fixtures/rtl-cases.json`, asserted from Deno
 * (`trainingLoad.test.ts`) and from Vitest
 * (`src/lib/__tests__/training-load.test.ts`).
 */

export interface WorkoutLoadInput {
  totalVolume: number;
  setCount: number;
}

export function calculateRTL(sessions: WorkoutLoadInput[]): number {
  if (sessions.length === 0) return 0;

  const totalVolume = sessions.reduce((sum, s) => sum + s.totalVolume, 0);
  const totalSets = sessions.reduce((sum, s) => sum + s.setCount, 0);

  // Volume component (0-33): normalized against 20,000 kg/week reference
  const volumeScore = Math.min(33, (totalVolume / 20000) * 33);

  // Intensity component (0-33): volume per set, reference ~400 kg/set
  const avgVolumePerSet = totalSets > 0 ? totalVolume / totalSets : 0;
  const intensityScore = Math.min(33, (avgVolumePerSet / 400) * 33);

  // Frequency component (0-34): sessions normalized against 5/week
  const frequencyScore = Math.min(34, (sessions.length / 5) * 34);

  return Math.min(
    100,
    Math.round(volumeScore + intensityScore + frequencyScore),
  );
}
