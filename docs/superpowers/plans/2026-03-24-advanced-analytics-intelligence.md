# Advanced Analytics & Training Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Analytics Hub Body tab from a passive visualization dashboard into an interactive training intelligence system with exercise deep-dives, scientific volume landmarks, SRA recovery tracking, and actionable recommendations.

**Architecture:** The Body tab becomes the central muscle-level intelligence hub. Clicking a muscle group on the existing body map opens an Exercise Deep-Dive panel. Volume Landmarks (MEV/MAV/MRV) and SRA Recovery Matrix sections are added below. A Recommendation Engine generates inline callouts and an aggregated panel. FLAME tier gets Exercise Deep-Dive + Volume Landmarks; INFERNO tier adds SRA + Recommendations (with blurred preview upsell for FLAME users).

**Tech Stack:** React 19, TypeScript, TanStack Query 5, Recharts 3, Tailwind v4, Zod 4, Supabase (PostgREST joins), Vitest + Testing Library, existing shadcn/ui components.

**Spec:** `docs/superpowers/specs/2026-03-24-advanced-analytics-intelligence-design.md`

**Branch:** Create `feat/advanced-analytics-intelligence` before starting work.

---

## File Map

### New Files (9)

| File | Responsibility |
|---|---|
| `src/lib/exercise-muscles.ts` | Static exercise-to-muscle activation mapping with name normalization + fuzzy matching |
| `src/lib/volume-landmarks.ts` | MEV/MAV/MRV thresholds + weekly volume computation per muscle group |
| `src/lib/sra-recovery.ts` | SRA recovery status computation from session history |
| `src/lib/recommendations.ts` | Client-side recommendation aggregation from volume, SRA, and ACWR signals |
| `src/queries/body-intelligence.ts` | TanStack Query hooks for exercise/set-level data needed by body intelligence features |
| `src/app/components/analytics/ExerciseDeepDive.tsx` | Exercise drill-down panel with activation profile, 1RM trend, stats |
| `src/app/components/analytics/VolumeLandmarks.tsx` | Volume threshold bar chart with inline recommendation callouts |
| `src/app/components/analytics/SraRecoveryMatrix.tsx` | Per-muscle recovery status grid with INFERNO gating |
| `src/app/components/analytics/RecommendationsPanel.tsx` | Aggregated prioritized recommendations with INFERNO gating |

### New Test Files (4)

| File | Tests |
|---|---|
| `src/lib/__tests__/exercise-muscles.test.ts` | Mapping lookup, normalization, fuzzy matching, fallback |
| `src/lib/__tests__/volume-landmarks.test.ts` | Volume computation, threshold classification, edge cases |
| `src/lib/__tests__/sra-recovery.test.ts` | Status transitions, modifier calculations, missing data handling |
| `src/lib/__tests__/recommendations.test.ts` | Signal aggregation, priority sorting, deduplication |

### Modified Files (7)

| File | Changes |
|---|---|
| `src/queries/keys.ts:21-31` | Add `bodyIntelligence` and `sessionSetWeights` keys to `analytics` namespace |
| `src/schemas/transforms.ts` | Add Zod schemas for body intelligence query results |
| `src/app/components/analytics/BodyTab.tsx` | Add muscle selection state, integrate 4 new components, pass new props |
| `src/app/components/analytics/MobileBodyTab.tsx:79-87` | Remove INFERNO gate on Biomechanics section |
| `src/app/components/Analytics.tsx` | Add `bodyIntelligenceOptions` query, compute new props, pass to BodyTab |
| `supabase/functions/generate-insights/index.ts` | Enhance existing rules with granular thresholds |
| `supabase/functions/mobile-sync-push/index.ts` | Add generate-insights call after successful push |

---

## Task 1: Exercise-Muscle Activation Map

**Files:**
- Create: `src/lib/exercise-muscles.ts`
- Test: `src/lib/__tests__/exercise-muscles.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/__tests__/exercise-muscles.test.ts
import { describe, expect, it } from "vitest";
import {
  getExerciseProfile,
  normalizeExerciseName,
  type ExerciseProfile,
} from "@/lib/exercise-muscles";

describe("normalizeExerciseName", () => {
  it("lowercases and trims", () => {
    expect(normalizeExerciseName("  Bench Press  ")).toBe("bench press");
  });

  it("strips common prefixes", () => {
    expect(normalizeExerciseName("DB Curl")).toBe("curl");
    expect(normalizeExerciseName("BB Curl")).toBe("curl");
    expect(normalizeExerciseName("Cable Fly")).toBe("fly");
    expect(normalizeExerciseName("Machine Row")).toBe("row");
  });

  it("strips stacked prefixes iteratively", () => {
    expect(normalizeExerciseName("Seated Cable Fly")).toBe("fly");
    expect(normalizeExerciseName("Incline DB Bench Press")).toBe("bench press");
  });

  it("strips parenthetical suffixes", () => {
    expect(normalizeExerciseName("Incline Press (Dumbbell)")).toBe(
      "incline press",
    );
  });
});

describe("getExerciseProfile", () => {
  it("returns exact match for known exercise", () => {
    const profile = getExerciseProfile("Bench Press");
    expect(profile.primary.group).toBe("Chest");
    expect(profile.primary.activation).toBe(1.0);
    expect(profile.secondary.length).toBeGreaterThan(0);
  });

  it("returns match via normalization", () => {
    const profile = getExerciseProfile("DB Bench Press");
    expect(profile.primary.group).toBe("Chest");
  });

  it("falls back to dbMuscleGroup when no match", () => {
    const profile = getExerciseProfile("Some Unknown Exercise", "Back");
    expect(profile.primary.group).toBe("Back");
    expect(profile.primary.activation).toBe(1.0);
    expect(profile.secondary).toEqual([]);
  });

  it("falls back to General when no match and no dbMuscleGroup", () => {
    const profile = getExerciseProfile("Totally Unknown");
    expect(profile.primary.group).toBe("General");
  });

  it("uses token overlap for fuzzy match", () => {
    // "Incline Bench Press" should match "Bench Press" or "Incline Press"
    const profile = getExerciseProfile("Incline Bench Press");
    expect(profile.primary.group).toBe("Chest");
  });

  it("all profiles use the 6 parent groups", () => {
    const validGroups = new Set([
      "Chest",
      "Back",
      "Shoulders",
      "Arms",
      "Legs",
      "Core",
    ]);
    // Test a sampling of known exercises
    for (const name of [
      "Bench Press",
      "Squat",
      "Bicep Curl",
      "Overhead Press",
      "Deadlift",
      "Plank",
    ]) {
      const p = getExerciseProfile(name);
      expect(validGroups.has(p.primary.group)).toBe(true);
      for (const s of p.secondary) {
        expect(validGroups.has(s.group)).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd phoenix-portal && npx vitest run src/lib/__tests__/exercise-muscles.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement exercise-muscles.ts**

Create `src/lib/exercise-muscles.ts` with:
- `MuscleActivation` interface (`group`, `displayName?`, `activation`)
- `ExerciseProfile` interface (`primary`, `secondary[]`)
- `EXERCISE_MAP: Record<string, ExerciseProfile>` — static map keyed by normalized name. Include all Vitruvian exercises and common free-weight exercises (~80 total). Representative entries:

```typescript
export interface MuscleActivation {
  group: string;
  displayName?: string;
  activation: number;
}

export interface ExerciseProfile {
  primary: MuscleActivation;
  secondary: MuscleActivation[];
}

const STRIP_PREFIXES = /^(db|bb|cable|machine|seated|standing|incline|decline)\s+/i;
const STRIP_PARENS = /\s*\(.*\)\s*$/;

export function normalizeExerciseName(name: string): string {
  let result = name.trim().toLowerCase().replace(STRIP_PARENS, "").trim();
  // Apply prefix stripping iteratively to handle stacked prefixes
  // e.g., "seated cable fly" -> "cable fly" -> "fly"
  let prev = "";
  while (prev !== result) {
    prev = result;
    result = result.replace(STRIP_PREFIXES, "").trim();
  }
  return result;
}

// Keyed by normalized name
const EXERCISE_MAP: Record<string, ExerciseProfile> = {
  "bench press": {
    primary: { group: "Chest", activation: 1.0 },
    secondary: [
      { group: "Arms", displayName: "Triceps", activation: 0.35 },
      { group: "Shoulders", displayName: "Front Delts", activation: 0.25 },
    ],
  },
  "press": {
    primary: { group: "Chest", activation: 1.0 },
    secondary: [
      { group: "Arms", displayName: "Triceps", activation: 0.35 },
      { group: "Shoulders", displayName: "Front Delts", activation: 0.25 },
    ],
  },
  "fly": {
    primary: { group: "Chest", activation: 1.0 },
    secondary: [
      { group: "Shoulders", displayName: "Front Delts", activation: 0.15 },
    ],
  },
  "curl": {
    primary: { group: "Arms", displayName: "Biceps", activation: 1.0 },
    secondary: [
      { group: "Arms", displayName: "Forearms", activation: 0.2 },
    ],
  },
  "squat": {
    primary: { group: "Legs", displayName: "Quads", activation: 1.0 },
    secondary: [
      { group: "Legs", displayName: "Glutes", activation: 0.6 },
      { group: "Core", activation: 0.2 },
    ],
  },
  "deadlift": {
    primary: { group: "Back", displayName: "Lower Back", activation: 1.0 },
    secondary: [
      { group: "Legs", displayName: "Hamstrings", activation: 0.7 },
      { group: "Legs", displayName: "Glutes", activation: 0.5 },
    ],
  },
  "overhead press": {
    primary: { group: "Shoulders", activation: 1.0 },
    secondary: [
      { group: "Arms", displayName: "Triceps", activation: 0.4 },
    ],
  },
  "row": {
    primary: { group: "Back", activation: 1.0 },
    secondary: [
      { group: "Arms", displayName: "Biceps", activation: 0.35 },
    ],
  },
  "plank": {
    primary: { group: "Core", activation: 1.0 },
    secondary: [],
  },
  "lunge": {
    primary: { group: "Legs", displayName: "Quads", activation: 1.0 },
    secondary: [
      { group: "Legs", displayName: "Glutes", activation: 0.5 },
    ],
  },
  // ... ~70 more entries covering all Vitruvian exercises + common movements
};
```

- `normalizeExerciseName(name)` — strip prefixes, parens, lowercase, trim
- `tokenOverlapMatch(normalized)` — compute overlap ratio between tokens of input and each key in map; return first match above 0.7 threshold
- `getExerciseProfile(exerciseName, dbMuscleGroup?)` — try exact normalized lookup → fuzzy match → fallback to dbMuscleGroup at 100% → fallback to "General"

The full ~80 exercise entries should be populated during implementation using exercise science references. Cover: all chest presses/flies, rows/pulldowns, shoulder presses/raises, curls/extensions, squats/lunges/leg presses, deadlifts, core exercises, and Vitruvian-specific movements.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd phoenix-portal && npx vitest run src/lib/__tests__/exercise-muscles.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
cd phoenix-portal
git add src/lib/exercise-muscles.ts src/lib/__tests__/exercise-muscles.test.ts
git commit -m "feat: add exercise-muscle activation mapping with fuzzy matching"
```

---

## Task 2: Volume Landmarks Computation

**Files:**
- Create: `src/lib/volume-landmarks.ts`
- Test: `src/lib/__tests__/volume-landmarks.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/__tests__/volume-landmarks.test.ts
import { describe, expect, it } from "vitest";
import {
  VOLUME_LANDMARKS,
  computeWeeklyVolume,
  classifyVolumeStatus,
  type VolumeStatus,
  type ExerciseSessionData,
} from "@/lib/volume-landmarks";

describe("VOLUME_LANDMARKS", () => {
  it("has entries for all 6 muscle groups", () => {
    const groups = VOLUME_LANDMARKS.map((l) => l.muscleGroup);
    expect(groups).toContain("Chest");
    expect(groups).toContain("Back");
    expect(groups).toContain("Shoulders");
    expect(groups).toContain("Legs");
    expect(groups).toContain("Arms");
    expect(groups).toContain("Core");
  });

  it("has mev <= mavLow <= mavHigh <= mrv for all entries", () => {
    for (const l of VOLUME_LANDMARKS) {
      expect(l.mev).toBeLessThanOrEqual(l.mavLow);
      expect(l.mavLow).toBeLessThanOrEqual(l.mavHigh);
      expect(l.mavHigh).toBeLessThanOrEqual(l.mrv);
    }
  });
});

describe("computeWeeklyVolume", () => {
  it("counts primary muscle group sets only", () => {
    const exercises: ExerciseSessionData[] = [
      { name: "Bench Press", muscleGroup: "Chest", setCount: 4 },
      { name: "Bench Press", muscleGroup: "Chest", setCount: 4 },
      { name: "Cable Fly", muscleGroup: "Chest", setCount: 3 },
    ];
    const result = computeWeeklyVolume(exercises);
    expect(result.Chest).toBe(11); // 4+4+3
  });

  it("uses exercise-muscle map primary group over DB muscle_group", () => {
    const exercises: ExerciseSessionData[] = [
      { name: "Bench Press", muscleGroup: "Upper Body", setCount: 4 },
    ];
    const result = computeWeeklyVolume(exercises);
    // Bench Press maps to Chest via exercise-muscles.ts, ignoring DB "Upper Body"
    expect(result.Chest).toBe(4);
    expect(result["Upper Body"]).toBeUndefined();
  });

  it("falls back to DB muscle_group for unknown exercises", () => {
    const exercises: ExerciseSessionData[] = [
      { name: "Vitruvian Special Move", muscleGroup: "Back", setCount: 5 },
    ];
    const result = computeWeeklyVolume(exercises);
    expect(result.Back).toBe(5);
  });

  it("returns empty object for empty input", () => {
    expect(computeWeeklyVolume([])).toEqual({});
  });

  it("excludes General group from volume", () => {
    const exercises: ExerciseSessionData[] = [
      { name: "Unknown", muscleGroup: null, setCount: 3 },
    ];
    const result = computeWeeklyVolume(exercises);
    expect(result.General).toBeUndefined();
  });
});

describe("classifyVolumeStatus", () => {
  it("returns below_mev when sets < mev", () => {
    expect(classifyVolumeStatus("Chest", 8)).toBe("below_mev");
  });

  it("returns in_mav when sets in MAV range", () => {
    expect(classifyVolumeStatus("Chest", 16)).toBe("in_mav");
  });

  it("returns above_mav when above MAV but below MRV", () => {
    expect(classifyVolumeStatus("Chest", 20)).toBe("above_mav");
  });

  it("returns above_mrv when sets >= mrv", () => {
    expect(classifyVolumeStatus("Chest", 22)).toBe("above_mrv");
  });

  it("returns between_mev_mav for sets between MEV and MAV", () => {
    expect(classifyVolumeStatus("Chest", 12)).toBe("between_mev_mav");
  });

  it("returns null for unknown muscle group", () => {
    expect(classifyVolumeStatus("Nonexistent", 10)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd phoenix-portal && npx vitest run src/lib/__tests__/volume-landmarks.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement volume-landmarks.ts**

Create `src/lib/volume-landmarks.ts` with:
- `VolumeLandmark` interface and `VOLUME_LANDMARKS` array (6 entries from spec)
- `VolumeStatus` type: `"below_mev" | "between_mev_mav" | "in_mav" | "above_mav" | "above_mrv"` (Note: `between_mev_mav` is a plan enhancement — the spec defines 4 bar colors but the data has a gap between MEV and MAV-low that needs a distinct status. This maps to blue in the UI, same as `above_mav`.)
- `ExerciseSessionData` interface: `{ name: string; muscleGroup: string | null; setCount: number }`
- `computeWeeklyVolume(exercises: ExerciseSessionData[]): Record<string, number>` — uses `getExerciseProfile` from exercise-muscles.ts, counts primary group sets only, excludes "General"
- `classifyVolumeStatus(muscleGroup: string, weeklysets: number): VolumeStatus | null`
- `getVolumeLandmark(muscleGroup: string): VolumeLandmark | undefined`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd phoenix-portal && npx vitest run src/lib/__tests__/volume-landmarks.test.ts`
Expected: PASS (all 10 tests)

- [ ] **Step 5: Commit**

```bash
cd phoenix-portal
git add src/lib/volume-landmarks.ts src/lib/__tests__/volume-landmarks.test.ts
git commit -m "feat: add volume landmarks computation with RP research defaults"
```

---

## Task 3: SRA Recovery Computation

**Files:**
- Create: `src/lib/sra-recovery.ts`
- Test: `src/lib/__tests__/sra-recovery.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/__tests__/sra-recovery.test.ts
import { describe, expect, it } from "vitest";
import {
  computeSraStatus,
  computeRecoveryHours,
  type SraStatus,
  type MuscleRecovery,
  type MuscleSessionInput,
} from "@/lib/sra-recovery";

describe("computeRecoveryHours", () => {
  it("returns base hours for normal session", () => {
    const hours = computeRecoveryHours("Chest", {
      isHeavy: false,
      isHighVolume: false,
    });
    expect(hours).toBe(60); // Chest base
  });

  it("adds heavy modifier", () => {
    const hours = computeRecoveryHours("Chest", {
      isHeavy: true,
      isHighVolume: false,
    });
    expect(hours).toBe(72); // 60 + 12
  });

  it("adds both modifiers when heavy and high volume", () => {
    const hours = computeRecoveryHours("Legs", {
      isHeavy: true,
      isHighVolume: true,
    });
    expect(hours).toBe(112); // 84 + 16 + 12
  });

  it("returns 48 as default for unknown muscle group", () => {
    const hours = computeRecoveryHours("Unknown", {
      isHeavy: false,
      isHighVolume: false,
    });
    expect(hours).toBe(48);
  });
});

describe("computeSraStatus", () => {
  it("returns FATIGUED when < 33% elapsed", () => {
    const result = computeSraStatus("Chest", {
      hoursSinceLastTrained: 10, // 10/60 = 17%
      isHeavy: false,
      isHighVolume: false,
    });
    expect(result.status).toBe("FATIGUED");
    expect(result.hoursRemaining).toBeGreaterThan(0);
  });

  it("returns RECOVERING when 33-80% elapsed", () => {
    const result = computeSraStatus("Chest", {
      hoursSinceLastTrained: 30, // 30/60 = 50%
      isHeavy: false,
      isHighVolume: false,
    });
    expect(result.status).toBe("RECOVERING");
  });

  it("returns RECOVERED when 80-120% elapsed", () => {
    const result = computeSraStatus("Chest", {
      hoursSinceLastTrained: 55, // 55/60 = 92%
      isHeavy: false,
      isHighVolume: false,
    });
    expect(result.status).toBe("RECOVERED");
    expect(result.hoursRemaining).toBeNull();
  });

  it("returns SUPERCOMPENSATED when > 120% elapsed", () => {
    const result = computeSraStatus("Chest", {
      hoursSinceLastTrained: 80, // 80/60 = 133%
      isHeavy: false,
      isHighVolume: false,
    });
    expect(result.status).toBe("SUPERCOMPENSATED");
    expect(result.hoursRemaining).toBeNull();
  });

  it("accounts for heavy modifier in status calculation", () => {
    // Heavy chest: recovery = 72h. At 30h that's 42% -> RECOVERING
    const result = computeSraStatus("Chest", {
      hoursSinceLastTrained: 30,
      isHeavy: true,
      isHighVolume: false,
    });
    expect(result.status).toBe("RECOVERING");
    expect(result.estimatedRecoveryHours).toBe(72);
  });

  it("handles muscle group never trained", () => {
    const result = computeSraStatus("Chest", {
      hoursSinceLastTrained: null,
      isHeavy: false,
      isHighVolume: false,
    });
    expect(result.status).toBe("RECOVERED");
    expect(result.hoursSinceLastTrained).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd phoenix-portal && npx vitest run src/lib/__tests__/sra-recovery.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement sra-recovery.ts**

Create `src/lib/sra-recovery.ts` with:
- `SraStatus` type: `"FATIGUED" | "RECOVERING" | "RECOVERED" | "SUPERCOMPENSATED"`
- `MuscleRecovery` interface (from spec)
- `RECOVERY_WINDOWS` constant: base hours and modifiers per muscle group (from spec table)
- `MuscleSessionInput` interface: `{ hoursSinceLastTrained: number | null; isHeavy: boolean; isHighVolume: boolean }`
- `computeRecoveryHours(muscleGroup, modifiers)` — base + conditional modifiers
- `computeSraStatus(muscleGroup, input)` — returns `MuscleRecovery` with status based on percentage thresholds (33%, 80%, 120%)

The percentage thresholds determine status:
- `elapsed / estimated < 0.33` → FATIGUED
- `0.33 <= ratio < 0.80` → RECOVERING
- `0.80 <= ratio < 1.20` → RECOVERED
- `ratio >= 1.20` → SUPERCOMPENSATED

When `hoursSinceLastTrained` is null (never trained), return RECOVERED with 0 hours.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd phoenix-portal && npx vitest run src/lib/__tests__/sra-recovery.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
cd phoenix-portal
git add src/lib/sra-recovery.ts src/lib/__tests__/sra-recovery.test.ts
git commit -m "feat: add SRA recovery status computation per muscle group"
```

---

## Task 4: Recommendation Engine

**Files:**
- Create: `src/lib/recommendations.ts`
- Test: `src/lib/__tests__/recommendations.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/__tests__/recommendations.test.ts
import { describe, expect, it } from "vitest";
import {
  generateVolumeRecommendations,
  generateSraRecommendations,
  mergeRecommendations,
  type Recommendation,
} from "@/lib/recommendations";

describe("generateVolumeRecommendations", () => {
  it("generates critical recommendation when above MRV", () => {
    const recos = generateVolumeRecommendations({ Back: 25 });
    const critical = recos.find((r) => r.signal === "volume_above_mrv");
    expect(critical).toBeDefined();
    expect(critical!.priority).toBe("critical");
    expect(critical!.muscleGroup).toBe("Back");
  });

  it("generates actionable recommendation when below MEV", () => {
    const recos = generateVolumeRecommendations({ Shoulders: 5 });
    const actionable = recos.find((r) => r.signal === "volume_below_mev");
    expect(actionable).toBeDefined();
    expect(actionable!.priority).toBe("actionable");
  });

  it("generates no recommendation when in optimal range", () => {
    const recos = generateVolumeRecommendations({ Chest: 16 });
    expect(recos).toHaveLength(0);
  });
});

describe("generateSraRecommendations", () => {
  it("generates positive recommendation for supercompensated muscle", () => {
    const recos = generateSraRecommendations([
      {
        muscleGroup: "Chest",
        status: "SUPERCOMPENSATED",
        hoursSinceLastTrained: 80,
        estimatedRecoveryHours: 60,
        hoursRemaining: null,
        lastSessionVolume: 12,
        lastSessionIntensity: 0.75,
      },
    ]);
    expect(recos.some((r) => r.signal === "sra_supercompensated")).toBe(true);
  });

  it("generates info recommendation for fatigued muscle", () => {
    const recos = generateSraRecommendations([
      {
        muscleGroup: "Back",
        status: "FATIGUED",
        hoursSinceLastTrained: 5,
        estimatedRecoveryHours: 60,
        hoursRemaining: 55,
        lastSessionVolume: 20,
        lastSessionIntensity: 0.9,
      },
    ]);
    const info = recos.find((r) => r.signal === "sra_fatigued");
    expect(info).toBeDefined();
    expect(info!.priority).toBe("info");
  });
});

describe("mergeRecommendations", () => {
  it("sorts by priority: critical > actionable > info > positive", () => {
    const recos: Recommendation[] = [
      {
        id: "1",
        priority: "positive",
        signal: "a",
        title: "a",
        action: "a",
      },
      {
        id: "2",
        priority: "critical",
        signal: "b",
        title: "b",
        action: "b",
      },
      { id: "3", priority: "info", signal: "c", title: "c", action: "c" },
      {
        id: "4",
        priority: "actionable",
        signal: "d",
        title: "d",
        action: "d",
      },
    ];
    const sorted = mergeRecommendations(recos);
    expect(sorted.map((r) => r.priority)).toEqual([
      "critical",
      "actionable",
      "info",
      "positive",
    ]);
  });

  it("deduplicates by signal + muscleGroup", () => {
    const recos: Recommendation[] = [
      {
        id: "1",
        priority: "critical",
        signal: "volume_above_mrv",
        muscleGroup: "Back",
        title: "a",
        action: "a",
      },
      {
        id: "2",
        priority: "critical",
        signal: "volume_above_mrv",
        muscleGroup: "Back",
        title: "b",
        action: "b",
      },
    ];
    expect(mergeRecommendations(recos)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd phoenix-portal && npx vitest run src/lib/__tests__/recommendations.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement recommendations.ts**

Create `src/lib/recommendations.ts` with:
- `Recommendation` interface (from spec — `id`, `priority`, `signal`, `muscleGroup?`, `title`, `action`, `metric?`)
- `PRIORITY_ORDER` map: `{ critical: 0, actionable: 1, info: 2, positive: 3 }`
- `generateVolumeRecommendations(weeklyVolume: Record<string, number>): Recommendation[]` — check each muscle group against landmarks, generate recommendations for below_mev and above_mrv
- `generateSraRecommendations(recoveries: MuscleRecovery[]): Recommendation[]` — generate recommendations for supercompensated (positive: "prioritize today") and fatigued (info: "wait X hours")
- `mergeRecommendations(recos: Recommendation[]): Recommendation[]` — deduplicate by `signal+muscleGroup`, sort by priority order

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd phoenix-portal && npx vitest run src/lib/__tests__/recommendations.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
cd phoenix-portal
git add src/lib/recommendations.ts src/lib/__tests__/recommendations.test.ts
git commit -m "feat: add client-side recommendation engine for volume and SRA signals"
```

---

## Task 5: Query Keys + Data Access Layer

**Files:**
- Modify: `src/queries/keys.ts:21-31`
- Create: `src/queries/body-intelligence.ts`
- Modify: `src/schemas/transforms.ts`

- [ ] **Step 1: Add query keys to keys.ts**

In `src/queries/keys.ts`, expand the `analytics` namespace (currently lines 21-31) to add:

```typescript
analytics: {
  all: ["analytics"] as const,
  summary: (userId: string, period: string, profileId?: string | null) =>
    [
      ...queryKeys.analytics.all,
      "summary",
      userId,
      period,
      profileId ?? "all",
    ] as const,
  bodyIntelligence: (userId: string, days: number, profileId?: string | null) =>
    [
      ...queryKeys.analytics.all,
      "body-intelligence",
      userId,
      String(days),
      profileId ?? "all",
    ] as const,
  sessionSetWeights: (sessionId: string) =>
    [
      ...queryKeys.analytics.all,
      "session-set-weights",
      sessionId,
    ] as const,
},
```

- [ ] **Step 2: Create body-intelligence.ts query file**

Create `src/queries/body-intelligence.ts`:

```typescript
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "./keys";

/**
 * Fetches exercises with set counts for sessions in the last N days.
 * Used by: Volume Landmarks, SRA Recovery, Exercise Deep-Dive.
 */
export function bodyIntelligenceOptions(
  userId: string,
  days: number = 7,
  profileId?: string | null,
) {
  return queryOptions({
    queryKey: queryKeys.analytics.bodyIntelligence(userId, days, profileId),
    staleTime: 5 * 60 * 1000, // 5 minutes
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - days);

      let query = supabase
        .from("exercises")
        .select(
          "id, name, muscle_group, session_id, sets(count), workout_sessions!inner(id, started_at, user_id)",
        )
        .eq("workout_sessions.user_id", userId)
        .gte("workout_sessions.started_at", since.toISOString());

      if (profileId) {
        query = query.eq("workout_sessions.local_profile_id", profileId);
      }

      const { data, error } = await query;
      if (error) throw error;
      // Note: Supabase PostgREST returns sets(count) as [{ count: N }]
      // Transform to flat shape for consumers
      return (data ?? []).map((row) => ({
        ...row,
        setCount: Array.isArray(row.sets) ? (row.sets[0]?.count ?? 0) : 0,
      }));
    },
  });
}

/**
 * Fetches per-set weight data for a specific session.
 * Used by: SRA intensity calculation.
 */
export function sessionSetWeightsOptions(sessionId: string) {
  return queryOptions({
    queryKey: queryKeys.analytics.sessionSetWeights(sessionId),
    staleTime: 30 * 60 * 1000, // 30 minutes (session data doesn't change)
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sets")
        .select(
          "id, exercise_id, weight_kg, actual_reps, exercises!inner(name, muscle_group, session_id)",
        )
        .eq("exercises.session_id", sessionId);

      if (error) throw error;
      return data ?? [];
    },
  });
}
```

- [ ] **Step 3: Add Zod schemas to transforms.ts**

In `src/schemas/transforms.ts`, add validation schemas for the body intelligence query results. This follows the existing codebase pattern where all query results are validated through Zod:

```typescript
// --- Body Intelligence ---

export const bodyIntelligenceRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  muscle_group: z.string().nullable(),
  session_id: z.string(),
  setCount: z.number(),
  workout_sessions: z.object({
    id: z.string(),
    started_at: z.coerce.date(),
    user_id: z.string(),
  }),
});

export const bodyIntelligenceSchema = z.array(bodyIntelligenceRowSchema);
```

- [ ] **Step 4: Run typecheck to verify queries compile**

Run: `cd phoenix-portal && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors in the new files

- [ ] **Step 5: Commit**

```bash
cd phoenix-portal
git add src/queries/keys.ts src/queries/body-intelligence.ts src/schemas/transforms.ts
git commit -m "feat: add body intelligence query layer with Zod schemas"
```

---

## Task 6: Volume Landmarks Component

**Files:**
- Create: `src/app/components/analytics/VolumeLandmarks.tsx`

- [ ] **Step 1: Create VolumeLandmarks component**

Build `src/app/components/analytics/VolumeLandmarks.tsx`:
- Props: `weeklyVolume: Record<string, number>`, `selectedMuscleGroup: string | null`, `recommendations?: Recommendation[]`
- For each muscle group in `VOLUME_LANDMARKS`, render a horizontal bar:
  - Muscle group name (left, 70px fixed width)
  - Bar container with MEV/MAV/MRV threshold markers (vertical lines)
  - Green-shaded MAV zone
  - Filled bar representing current sets (color based on `classifyVolumeStatus`)
  - Set count (right)
  - Status icon (checkmark/warning)
- When `selectedMuscleGroup` is set, highlight that row and dim others (`opacity-50`)
- Below the bars, render inline recommendation callouts from the `recommendations` prop (filtered to volume signals)
- Empty state: "No workouts this week -- train to see your volume status"
- Disclaimer banner when total sessions < 3: "Accuracy improves with more training history"

Color mapping for bar fill:
- `below_mev`: `#F59E0B` (amber)
- `between_mev_mav`: `#60A5FA` (blue)
- `in_mav`: `#10B981` (green)
- `above_mav`: `#60A5FA` (blue)
- `above_mrv`: `#DC2626` (red)

Use existing `Card` component from `@/app/components/ui/card`. Use `motion.div` from `motion/react` for bar width animation.

- [ ] **Step 2: Write basic component smoke test**

Create `src/app/components/__tests__/VolumeLandmarks.test.tsx` with a render test:
- Renders without crashing with valid props
- Shows "No workouts this week" when `weeklyVolume` is empty
- Renders correct number of muscle group bars when data is present
- Shows inline recommendation callouts when provided

Pattern: follow existing component tests in `src/app/components/__tests__/`.

- [ ] **Step 3: Run tests**

Run: `cd phoenix-portal && npx vitest run src/app/components/__tests__/VolumeLandmarks.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd phoenix-portal
git add src/app/components/analytics/VolumeLandmarks.tsx src/app/components/__tests__/VolumeLandmarks.test.tsx
git commit -m "feat: add VolumeLandmarks component with MEV/MAV/MRV visualization"
```

---

## Task 7: Exercise Deep-Dive Component

**Files:**
- Create: `src/app/components/analytics/ExerciseDeepDive.tsx`

- [ ] **Step 1: Create ExerciseDeepDive component**

Build `src/app/components/analytics/ExerciseDeepDive.tsx`:
- Props: `muscleGroup: string`, `exercises: Array<{ name: string; sessionCount: number }>`, `userId: string`, `unit: WeightUnit`, `profileId?: string | null`
- State: `selectedExercise: string` (defaults to first exercise)
- Layout: flex row with exercise list (left, 160px) and detail panel (right)

**Exercise list (left):**
- Filtered to exercises for the selected muscle group (passed as prop)
- Sorted by session count descending
- Active exercise has ember highlight with left border
- Each item clickable to swap detail

**Detail panel (right):**
- **Activation Profile**: uses `getExerciseProfile(selectedExercise)` to show primary/secondary dots with percentage
- **1RM Trend Chart**: uses existing `exerciseProgressOptions(userId, selectedExercise, profileId)` query. Render with Recharts `AreaChart` + `Area` in the ember gradient. Time range toggles: 3M/6M/1Y/All (filter data client-side).
- **Stats Row**: 4 stat cards — current 1RM (with `formatWeight`), period change %, total sessions, PRs in period. Use `personalRecordsOptions` for PR count.

Empty state for exercise with no 1RM data: "Not enough data for 1RM estimate"

Use `AnimatePresence` + `motion.div` for slide-in animation when muscle group selection changes.

- [ ] **Step 2: Write basic component smoke test**

Create `src/app/components/__tests__/ExerciseDeepDive.test.tsx`:
- Renders without crashing with valid props
- Shows exercise list sorted by session count
- Shows activation profile for selected exercise
- Shows "Not enough data" when no 1RM data exists

Note: Mock `exerciseProgressOptions` and `personalRecordsOptions` queries (from `@/queries/progress` and `@/queries/records` respectively) using TanStack Query's test utilities.

- [ ] **Step 3: Run tests**

Run: `cd phoenix-portal && npx vitest run src/app/components/__tests__/ExerciseDeepDive.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd phoenix-portal
git add src/app/components/analytics/ExerciseDeepDive.tsx src/app/components/__tests__/ExerciseDeepDive.test.tsx
git commit -m "feat: add ExerciseDeepDive component with activation profile and 1RM trends"
```

---

## Task 8: SRA Recovery Matrix Component

**Files:**
- Create: `src/app/components/analytics/SraRecoveryMatrix.tsx`

- [ ] **Step 1: Create SraRecoveryMatrix component**

Build `src/app/components/analytics/SraRecoveryMatrix.tsx`:
- Props: `recoveries: MuscleRecovery[]`, `recommendations?: Recommendation[]`
- Layout: 2-column CSS grid of muscle group cards
- Each card shows:
  - Status dot (colored circle, 8px) with `aria-label` describing state
  - Muscle group name
  - Status label text (colored to match state)
  - "Xh since last session" in muted text
  - "~Xh remaining" for FATIGUED/RECOVERING states
- Below the grid, inline recommendation callouts (filtered to SRA signals)
- SRA status color map: FATIGUED → `#DC2626`, RECOVERING → `#F59E0B`, RECOVERED → `#10B981`, SUPERCOMPENSATED → `#60A5FA`

**Subscription gating wrapper:**
- Import `useSubscription` from `@/hooks/useSubscription`
- Always render the full component (even for non-INFERNO users — data powers the blurred preview)
- Wrap in a `relative` container. When `!isInferno`, overlay with `absolute inset-0 backdrop-blur-[8px] bg-surface-2/60` + upgrade CTA card with `role="region" aria-label="Premium feature preview"`

Empty state for never-trained muscle group: show "No data" with muted styling.

- [ ] **Step 2: Write basic component smoke test**

Create `src/app/components/__tests__/SraRecoveryMatrix.test.tsx`:
- Renders without crashing with valid recovery data
- Shows status dots with correct colors for each state
- Renders blurred overlay for non-INFERNO users (mock `useSubscription`)
- Shows "No data" for never-trained muscle groups

- [ ] **Step 3: Run tests**

Run: `cd phoenix-portal && npx vitest run src/app/components/__tests__/SraRecoveryMatrix.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd phoenix-portal
git add src/app/components/analytics/SraRecoveryMatrix.tsx src/app/components/__tests__/SraRecoveryMatrix.test.tsx
git commit -m "feat: add SRA Recovery Matrix component with INFERNO gating"
```

---

## Task 9: Recommendations Panel Component

**Files:**
- Create: `src/app/components/analytics/RecommendationsPanel.tsx`

- [ ] **Step 1: Create RecommendationsPanel component**

Build `src/app/components/analytics/RecommendationsPanel.tsx`:
- Props: `recommendations: Recommendation[]`
- Collapsible section (default collapsed) with "Training Recommendations" header
- Shows max 8 recommendations; "Show all" button expands if more exist
- Each recommendation card:
  - Icon based on priority (AlertTriangle for critical, TrendingUp for actionable, Info for info, CheckCircle for positive)
  - Color based on priority (red/amber/blue/green)
  - Title + action text
  - Optional metric display (current/threshold with unit)
  - `role="alert"` for screen reader accessibility
- Same INFERNO blurred preview gating pattern as SRA
- Empty state: "All looking good -- keep up the consistent training!"

Priority colors: critical → `#DC2626`, actionable → `#F59E0B`, info → `#60A5FA`, positive → `#10B981`

- [ ] **Step 2: Write basic component smoke test**

Create `src/app/components/__tests__/RecommendationsPanel.test.tsx`:
- Renders without crashing with recommendations
- Sorts by priority (critical first)
- Shows max 8 items with "Show all" when more exist
- Renders blurred overlay for non-INFERNO users
- Shows empty state when no recommendations

- [ ] **Step 3: Run tests**

Run: `cd phoenix-portal && npx vitest run src/app/components/__tests__/RecommendationsPanel.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd phoenix-portal
git add src/app/components/analytics/RecommendationsPanel.tsx src/app/components/__tests__/RecommendationsPanel.test.tsx
git commit -m "feat: add aggregated RecommendationsPanel with INFERNO gating"
```

---

## Task 10a: Wire Analytics.tsx Data Computation

**Files:**
- Modify: `src/app/components/Analytics.tsx`

- [ ] **Step 1: Add bodyIntelligenceOptions query and compute new props**

Modify `src/app/components/analytics/BodyTab.tsx`:

1. Add `selectedMuscleGroup` state: `useState<string | null>(null)`
2. Update `MuscleHighlighter.onBodyPartPress` to set `selectedMuscleGroup` instead of showing a toast (line 166-172). Map the slug back to a parent group using `muscleSlugToGroup`.
3. Add a "Clear selection" button that sets `selectedMuscleGroup` to null (visible when a group is selected)
4. After the Body Heatmap card (line 190), add:
   - `<AnimatePresence>` block: when `selectedMuscleGroup` is set, render `<ExerciseDeepDive>` with `motion.div` slide-in
   - `<VolumeLandmarks>` component (always visible)
   - `<SraRecoveryMatrix>` component (always visible, self-gates for INFERNO)
   - `<RecommendationsPanel>` component (always visible, self-gates)
5. Lazy-load new components: `const ExerciseDeepDive = lazy(() => import("./ExerciseDeepDive"))` etc.
6. Add skeleton loading states via `<Suspense fallback={...}>` wrappers

Update `BodyTabProps` interface to include new props:
```typescript
export interface BodyTabProps {
  // ... existing props
  weeklyVolume: Record<string, number>;
  totalSessions: number;
  muscleRecoveries: MuscleRecovery[];
  recommendations: Recommendation[];
  exercisesByMuscle: Record<string, Array<{ name: string; sessionCount: number }>>;
  userId: string;
  unit: WeightUnit;
  profileId?: string | null;
}
```

In `src/app/components/Analytics.tsx`:

1. Import `bodyIntelligenceOptions` from `@/queries/body-intelligence`
2. Add the query: `const { data: bodyIntelData } = useQuery(bodyIntelligenceOptions(userId, 7, activeProfileId))`
3. Compute `weeklyVolume` via `computeWeeklyVolume()` from bodyIntelData (transform query result to `ExerciseSessionData[]`)
4. Compute `exercisesByMuscle` — group exercises by their primary muscle group, count sessions per exercise
5. Compute `muscleRecoveries` via `computeSraStatus()` for each muscle group (using last session timestamps from bodyIntelData)
6. Compute `recommendations` via `generateVolumeRecommendations()` + `generateSraRecommendations()` + `mergeRecommendations()`
7. Pass all new props to `BodyTab` and `MobileBodyTab`

Wrap all computations in `useMemo` with dependency on `bodyIntelData`.

- [ ] **Step 2: Run typecheck**

Run: `cd phoenix-portal && npm run typecheck`
Expected: Type errors expected in BodyTab (props not yet updated) — verify Analytics.tsx itself has no errors

- [ ] **Step 3: Commit**

```bash
cd phoenix-portal
git add src/app/components/Analytics.tsx
git commit -m "feat: wire body intelligence data computation in Analytics.tsx"
```

---

## Task 10b: Integrate New Components into BodyTab

**Files:**
- Modify: `src/app/components/analytics/BodyTab.tsx`

- [ ] **Step 1: Update BodyTab to accept new props and integrate components**

Modify `src/app/components/analytics/BodyTab.tsx`:

1. Add `selectedMuscleGroup` state: `useState<string | null>(null)`
2. Update `MuscleHighlighter.onBodyPartPress` (line 166-172) to set `selectedMuscleGroup` instead of showing a toast. Map slug to parent group via `muscleSlugToGroup`.
3. Add a "Clear selection" button (visible when group selected) that resets to null
4. After Body Heatmap card (line 190), add in order:
   - `<AnimatePresence>` + `<ExerciseDeepDive>` (slide-in when muscle selected)
   - `<VolumeLandmarks>` (always visible)
   - `<SraRecoveryMatrix>` (always visible, self-gates for INFERNO)
   - `<RecommendationsPanel>` (always visible, self-gates)
5. Lazy-load: `const ExerciseDeepDive = lazy(() => import("./ExerciseDeepDive"))` etc.
6. Wrap lazy components in `<Suspense fallback={<Skeleton />}>` for loading states

Update `BodyTabProps` interface:
```typescript
export interface BodyTabProps {
  // ... existing 5 props remain unchanged
  weeklyVolume: Record<string, number>;
  totalSessions: number;
  muscleRecoveries: MuscleRecovery[];
  recommendations: Recommendation[];
  exercisesByMuscle: Record<string, Array<{ name: string; sessionCount: number }>>;
  userId: string;
  unit: WeightUnit;
  profileId?: string | null;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd phoenix-portal && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run existing tests**

Run: `cd phoenix-portal && npm test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
cd phoenix-portal
git add src/app/components/analytics/BodyTab.tsx
git commit -m "feat: integrate new analytics components into Body tab with muscle selection"
```

---

## Task 11: Fix MobileBodyTab INFERNO Gate

**Files:**
- Modify: `src/app/components/analytics/MobileBodyTab.tsx:79-87`

- [ ] **Step 1: Remove incorrect INFERNO gate**

In `src/app/components/analytics/MobileBodyTab.tsx`, remove the `<SubscriptionGate>` wrapper around the Biomechanics section (lines 79-87). The Biomechanics page has its own gate. Replace with just the Card + BiomechanicsContent directly.

Before (lines 79-87):
```tsx
{/* Biomechanics -- gated for Inferno */}
<SubscriptionGate
  requiredTier="INFERNO"
  featureName="Biomechanics Analysis"
>
  <Card className="p-4 border-secondary">
    <BiomechanicsContent view="biomechanics" />
  </Card>
</SubscriptionGate>
```

After:
```tsx
<Card className="p-4 border-secondary">
  <BiomechanicsContent view="biomechanics" />
</Card>
```

- [ ] **Step 2: Add mobile-responsive versions of new components**

Update `MobileBodyTabProps` to accept the same new props as `BodyTab`. Add the new sections below the existing content:
- `VolumeLandmarks` (rendered in single-column mobile layout)
- `SraRecoveryMatrix` (1-column grid instead of 2-column on mobile)
- `RecommendationsPanel` (full width)

These components should already be responsive via Tailwind breakpoints. If not, add mobile-specific overrides.

- [ ] **Step 3: Verify build**

Run: `cd phoenix-portal && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
cd phoenix-portal
git add src/app/components/analytics/MobileBodyTab.tsx
git commit -m "fix: remove incorrect INFERNO gate from MobileBodyTab, add new analytics sections"
```

---

## Task 12: Run Full Test Suite + Build Verification

- [ ] **Step 1: Run all unit tests**

Run: `cd phoenix-portal && npm test`
Expected: All tests pass (existing + 4 new test files)

- [ ] **Step 2: Run typecheck**

Run: `cd phoenix-portal && npm run typecheck`
Expected: No errors

- [ ] **Step 3: Run production build**

Run: `cd phoenix-portal && npm run build`
Expected: Build succeeds, check bundle size didn't explode

- [ ] **Step 4: Run lint**

Run: `cd phoenix-portal && npx biome check src/lib/exercise-muscles.ts src/lib/volume-landmarks.ts src/lib/sra-recovery.ts src/lib/recommendations.ts src/queries/body-intelligence.ts src/app/components/analytics/ExerciseDeepDive.tsx src/app/components/analytics/VolumeLandmarks.tsx src/app/components/analytics/SraRecoveryMatrix.tsx src/app/components/analytics/RecommendationsPanel.tsx`
Expected: No lint errors (or fix with `--write`)

- [ ] **Step 5: Final commit if any lint fixes**

```bash
cd phoenix-portal
git add -A
git commit -m "fix: lint and format new analytics intelligence files"
```

---

## Task 13: Edge Function Enhancements (Deferred)

> **Note:** This task modifies Supabase Edge Functions which require deployment and cannot be fully tested locally. It can be implemented in a follow-up session.

**Files:**
- Modify: `supabase/functions/generate-insights/index.ts`
- Modify: `supabase/functions/mobile-sync-push/index.ts`

- [ ] **Step 1: Enhance generate-insights rules**

In `supabase/functions/generate-insights/index.ts`, enhance existing plateau detection and muscle imbalance rules with more granular thresholds. Add new signals:
- Velocity decline detection (check `velocity_loss_pct` > 25% across last 3 sessions)
- Consistency drop (frequency decline >30% vs 4-week average)

Keep existing 6 rules. Enhance threshold sensitivity.

- [ ] **Step 2: Add generate-insights trigger to mobile-sync-push**

In `supabase/functions/mobile-sync-push/index.ts`, after the successful sync broadcast, add an invocation of `generate-insights` for the user. Use Supabase Edge Function invocation:

```typescript
// After broadcast, trigger insights generation
await supabase.functions.invoke("generate-insights", {
  body: { userId, period: "7d" },
});
```

- [ ] **Step 3: Commit**

```bash
cd phoenix-portal
git add supabase/functions/generate-insights/index.ts supabase/functions/mobile-sync-push/index.ts
git commit -m "feat: enhance generate-insights rules and trigger on mobile sync"
```
