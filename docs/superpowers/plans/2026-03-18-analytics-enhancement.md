# Analytics Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Analytics Hub from a sparse dashboard into a premium, information-dense analytics experience with ECharts visualizations, training intelligence, community benchmarks, and biomechanics form analysis.

**Architecture:** Incremental migration from Recharts → Apache ECharts, with new rule-based insights engine (Supabase Edge Function), community percentile benchmarks, and client-side form analysis algorithms derived from existing telemetry data. Tab structure consolidates from 7 → 4 tabs.

**Tech Stack:** Apache ECharts (echarts-for-react), visx (existing, kept for force curves), react-muscle-highlighter, Supabase Edge Functions, TanStack Query, Zustand, Zod, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-18-analytics-enhancement-design.md`

---

## Phase 1: Foundation & Demo Data

### Task 1: Install Dependencies & Create ECharts Theme

**Files:**
- Modify: `package.json`
- Create: `src/app/components/charts/shared/EChartsTheme.ts`
- Create: `src/app/components/charts/shared/EChartsWrapper.tsx`
- Modify: `src/app/components/charts/shared/ChartTheme.ts`

- [ ] **Step 1: Install ECharts dependencies**

```bash
npm install echarts echarts-for-react react-muscle-highlighter
```

Verify: `npm ls echarts echarts-for-react react-muscle-highlighter` shows installed versions.

If `react-muscle-highlighter` is not available on npm, fall back to `react-body-highlighter` (`npm install react-body-highlighter`).

- [ ] **Step 2: Create ECharts theme file**

Create `src/app/components/charts/shared/EChartsTheme.ts`:

```typescript
import { CHART_COLORS, CHART_MARGINS, REP_COLORS, FONT_SIZES } from "./ChartTheme";

/** ECharts theme object matching the Phoenix dark palette */
export const PHOENIX_ECHARTS_THEME = {
  color: [
    CHART_COLORS.primary,   // #FF6B35 Ember
    CHART_COLORS.secondary,  // #F59E0B Gold
    CHART_COLORS.success,    // #10B981 Forge Green
    CHART_COLORS.danger,     // #DC2626 Flame Red
    "#6366F1",               // Indigo (accent)
    "#EC4899",               // Pink
    "#06B6D4",               // Cyan
    "#8B5CF6",               // Purple
  ],
  backgroundColor: "transparent",
  textStyle: { color: CHART_COLORS.axisText, fontFamily: "system-ui, sans-serif" },
  title: {
    textStyle: { color: "#ffffff", fontSize: FONT_SIZES.title, fontWeight: 600 },
  },
  categoryAxis: {
    axisLine: { lineStyle: { color: "#333" } },
    axisTick: { lineStyle: { color: "#333" } },
    axisLabel: { color: CHART_COLORS.axisText, fontSize: FONT_SIZES.axis },
    splitLine: { lineStyle: { color: "#1a1a2e" } },
  },
  valueAxis: {
    axisLine: { lineStyle: { color: "#333" } },
    axisTick: { lineStyle: { color: "#333" } },
    axisLabel: { color: CHART_COLORS.axisText, fontSize: FONT_SIZES.axis },
    splitLine: { lineStyle: { color: "#1a1a2e", type: "dashed" } },
  },
  tooltip: {
    backgroundColor: CHART_COLORS.tooltipBg,
    borderColor: CHART_COLORS.tooltipBorder,
    textStyle: { color: "#ffffff", fontSize: 12 },
  },
  legend: {
    textStyle: { color: CHART_COLORS.axisText },
  },
  radar: {
    axisLine: { lineStyle: { color: "#333" } },
    splitLine: { lineStyle: { color: "#2a2a2a" } },
    splitArea: { areaStyle: { color: ["transparent"] } },
  },
  gauge: {
    axisLine: { lineStyle: { color: [[0.3, "#10B981"], [0.7, "#F59E0B"], [1, "#DC2626"]] } },
  },
} as const;

/** ECharts-compatible margins */
export const ECHARTS_GRID = {
  top: CHART_MARGINS.top,
  right: CHART_MARGINS.right,
  bottom: CHART_MARGINS.bottom,
  left: CHART_MARGINS.left,
  containLabel: true,
} as const;

export { CHART_COLORS, CHART_MARGINS, REP_COLORS, FONT_SIZES };
```

- [ ] **Step 3: Create ECharts wrapper component**

Create `src/app/components/charts/shared/EChartsWrapper.tsx`:

```tsx
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import {
  BarChart, LineChart, PieChart, RadarChart, GaugeChart,
} from "echarts/charts";
import {
  GridComponent, TooltipComponent, LegendComponent,
  TitleComponent, DataZoomComponent, ToolboxComponent,
} from "echarts/components";
import { useEffect, useRef } from "react";
import { PHOENIX_ECHARTS_THEME } from "./EChartsTheme";

// Register required components (tree-shakeable)
echarts.use([
  CanvasRenderer, BarChart, LineChart, PieChart, RadarChart, GaugeChart,
  GridComponent, TooltipComponent, LegendComponent,
  TitleComponent, DataZoomComponent, ToolboxComponent,
]);

// Register theme once
echarts.registerTheme("phoenix", PHOENIX_ECHARTS_THEME);

interface EChartsWrapperProps {
  option: echarts.EChartsOption;
  height?: string | number;
  className?: string;
  loading?: boolean;
  onEvents?: Record<string, (params: unknown) => void>;
}

export function EChartsWrapper({
  option, height = 300, className, loading, onEvents,
}: EChartsWrapperProps) {
  const chartRef = useRef<ReactEChartsCore>(null);

  // Handle responsive resize
  useEffect(() => {
    const handleResize = () => chartRef.current?.getEchartsInstance()?.resize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <ReactEChartsCore
      ref={chartRef}
      echarts={echarts}
      option={option}
      theme="phoenix"
      style={{ height, width: "100%" }}
      className={className}
      showLoading={loading}
      loadingOption={{
        text: "",
        color: "#FF6B35",
        maskColor: "rgba(13, 13, 13, 0.8)",
      }}
      onEvents={onEvents}
      notMerge
    />
  );
}
```

- [ ] **Step 4: Run typecheck to verify**

```bash
npm run typecheck
```

Expected: No new errors from the chart files.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/app/components/charts/shared/EChartsTheme.ts src/app/components/charts/shared/EChartsWrapper.tsx
git commit -m "feat: add ECharts foundation with Phoenix theme and wrapper component"
```

---

### Task 2: Database Migration — Insights & Benchmarks Tables

**Files:**
- Create: `supabase/migrations/20260318_insights_benchmarks.sql`

- [ ] **Step 1: Write migration SQL**

Create `supabase/migrations/20260318_insights_benchmarks.sql`:

```sql
-- Analytics Enhancement: insights and community benchmarks tables

-- 1. user_insights — cached training insights from rule engine
CREATE TABLE IF NOT EXISTS user_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL CHECK (insight_type IN ('success', 'warning', 'info', 'achievement')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  recommendation TEXT,
  metric_name TEXT,
  metric_value NUMERIC,
  metric_unit TEXT,
  metric_delta NUMERIC,
  period TEXT NOT NULL DEFAULT '30d',
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

ALTER TABLE user_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own insights"
  ON user_insights FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role can manage insights"
  ON user_insights FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE INDEX idx_user_insights_user ON user_insights(user_id, created_at DESC);

-- 2. community_benchmarks — aggregated percentile data
CREATE TABLE IF NOT EXISTS community_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_type TEXT NOT NULL,
  metric_key TEXT,
  percentile_values JSONB NOT NULL DEFAULT '{}',
  total_users INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE community_benchmarks ENABLE ROW LEVEL SECURITY;

-- Benchmarks are public read (anonymized aggregate data)
CREATE POLICY "Anyone can read benchmarks"
  ON community_benchmarks FOR SELECT USING (true);
CREATE POLICY "Service role can manage benchmarks"
  ON community_benchmarks FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE UNIQUE INDEX idx_community_benchmarks_metric
  ON community_benchmarks(metric_type, COALESCE(metric_key, ''));
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__claude_ai_Supabase__apply_migration` to apply the migration to the project.

- [ ] **Step 3: Verify tables exist**

Use `mcp__claude_ai_Supabase__list_tables` to confirm `user_insights` and `community_benchmarks` tables appear.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260318_insights_benchmarks.sql
git commit -m "feat: add user_insights and community_benchmarks tables"
```

---

### Task 3: Demo Data Seed Migration

**Files:**
- Create: `supabase/migrations/20260318_demo_data_seed.sql`

- [ ] **Step 1: Identify test account user ID**

Use `mcp__claude_ai_Supabase__execute_sql` to query:
```sql
SELECT id, email FROM auth.users WHERE email LIKE '%devil%' OR email LIKE '%test%' LIMIT 5;
```

Save the user ID for the seed data.

- [ ] **Step 2: Write demo data seed migration**

Create `supabase/migrations/20260318_demo_data_seed.sql` with:

The migration should be wrapped in a DO block that:
1. Checks if the user already has > 10 workout sessions (skip if so to avoid double-seeding)
2. Inserts 30 workout sessions across 8 weeks (Jan 20 – Mar 16, 2026)
3. Uses a push/pull/legs split pattern with varied session names
4. Inserts 3-5 exercises per session with proper muscle groups (Chest, Back, Legs, Shoulders, Arms, Core)
5. Inserts 3-4 sets per exercise with progressive overload (weights increase ~2.5% per week)
6. Marks ~8 sets as `is_pr = true` spread across the period
7. Inserts personal_records rows for the PRs
8. Inserts rep_summaries for ~10 sessions with realistic velocity (0.3-1.2 m/s), force (200-500N), power (100-600W), ROM (200-400mm), TUT (2000-5000ms), and asymmetry (1-8%)
9. Inserts rep_telemetry for 3 sessions (~50 points per rep at 50Hz) with realistic force curves
10. Creates a bench press plateau in weeks 4-6 (same 1RM estimate)
11. Creates a leg day gap (only 2 leg sessions in the 8 weeks)

Key exercises to include:
- Chest: Bench Press, Incline Press, Cable Fly
- Back: Lat Pulldown, Seated Row, Face Pull
- Legs: Squat, Leg Press, Leg Curl
- Shoulders: Overhead Press, Lateral Raise
- Arms: Bicep Curl, Tricep Extension
- Core: Cable Crunch, Pallof Press

- [ ] **Step 3: Apply migration**

Use `mcp__claude_ai_Supabase__apply_migration` to apply.

- [ ] **Step 4: Verify data**

Use `mcp__claude_ai_Supabase__execute_sql`:
```sql
SELECT
  (SELECT count(*) FROM workout_sessions WHERE user_id = '<USER_ID>') as sessions,
  (SELECT count(*) FROM exercises WHERE session_id IN (SELECT id FROM workout_sessions WHERE user_id = '<USER_ID>')) as exercises,
  (SELECT count(*) FROM personal_records WHERE user_id = '<USER_ID>') as prs,
  (SELECT count(*) FROM rep_summaries WHERE set_id IN (
    SELECT s.id FROM sets s JOIN exercises e ON s.exercise_id = e.id
    JOIN workout_sessions ws ON e.session_id = ws.id WHERE ws.user_id = '<USER_ID>'
  )) as rep_summaries;
```

Expected: sessions ~30, exercises ~120, prs ~8, rep_summaries > 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260318_demo_data_seed.sql
git commit -m "feat: add demo data seed for analytics testing"
```

---

## Phase 2: Computation Libraries

### Task 4: Training Load Calculator

**Files:**
- Create: `src/lib/training-load.ts`
- Create: `src/lib/__tests__/training-load.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/training-load.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  calculateRTL,
  classifyTrainingLoad,
  type WorkoutLoadInput,
} from "../training-load";

describe("calculateRTL", () => {
  it("returns 0 for empty input", () => {
    expect(calculateRTL([])).toBe(0);
  });

  it("returns moderate score for typical week", () => {
    const sessions: WorkoutLoadInput[] = [
      { totalVolume: 5000, durationSeconds: 3600, setCount: 16 },
      { totalVolume: 6000, durationSeconds: 4200, setCount: 20 },
      { totalVolume: 4500, durationSeconds: 3000, setCount: 14 },
    ];
    const score = calculateRTL(sessions);
    expect(score).toBeGreaterThan(30);
    expect(score).toBeLessThan(80);
  });

  it("returns high score for overtraining week", () => {
    const sessions: WorkoutLoadInput[] = Array.from({ length: 7 }, () => ({
      totalVolume: 10000, durationSeconds: 5400, setCount: 30,
    }));
    const score = calculateRTL(sessions);
    expect(score).toBeGreaterThan(80);
  });

  it("caps at 100", () => {
    const sessions: WorkoutLoadInput[] = Array.from({ length: 14 }, () => ({
      totalVolume: 20000, durationSeconds: 7200, setCount: 50,
    }));
    expect(calculateRTL(sessions)).toBeLessThanOrEqual(100);
  });
});

describe("classifyTrainingLoad", () => {
  it("classifies low load", () => {
    expect(classifyTrainingLoad(20)).toBe("low");
  });
  it("classifies optimal load", () => {
    expect(classifyTrainingLoad(55)).toBe("optimal");
  });
  it("classifies high load", () => {
    expect(classifyTrainingLoad(85)).toBe("high");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- src/lib/__tests__/training-load.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement training load calculator**

Create `src/lib/training-load.ts`:

```typescript
export interface WorkoutLoadInput {
  totalVolume: number;
  durationSeconds: number;
  setCount: number;
}

/**
 * Calculate Resistance Training Load (RTL) score 0-100.
 *
 * Composite of:
 * - Volume component: total volume normalized against a reference (15,000 lbs/week)
 * - Intensity component: volume per set (proxy for avg weight × reps)
 * - Frequency component: number of sessions normalized against reference (5/week)
 *
 * Each component is 0-33, summed and capped at 100.
 */
export function calculateRTL(sessions: WorkoutLoadInput[]): number {
  if (sessions.length === 0) return 0;

  const totalVolume = sessions.reduce((sum, s) => sum + s.totalVolume, 0);
  const totalSets = sessions.reduce((sum, s) => sum + s.setCount, 0);

  // Volume component (0-33): normalized against 15,000 lbs/week reference
  const volumeScore = Math.min(33, (totalVolume / 15000) * 33);

  // Intensity component (0-33): volume per set, reference ~300 lbs/set
  const avgVolumePerSet = totalSets > 0 ? totalVolume / totalSets : 0;
  const intensityScore = Math.min(33, (avgVolumePerSet / 300) * 33);

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
```

- [ ] **Step 4: Run tests to verify passing**

```bash
npm test -- src/lib/__tests__/training-load.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/training-load.ts src/lib/__tests__/training-load.test.ts
git commit -m "feat: add training load (RTL) calculator with tests"
```

---

### Task 5: Form Analysis Algorithms

**Files:**
- Create: `src/lib/form-analysis.ts`
- Create: `src/lib/__tests__/form-analysis.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/form-analysis.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  calculateCurveConsistency,
  calculateTempoControl,
  calculateFatigueResistance,
  calculateBilateralBalance,
  calculateFormScore,
  getLetterGrade,
  type RepMetrics,
} from "../form-analysis";

const sampleReps: RepMetrics[] = [
  { peakForce: 400, meanVelocity: 0.8, rom: 350, tut: 3500, asymmetry: 2 },
  { peakForce: 390, meanVelocity: 0.75, rom: 345, tut: 3600, asymmetry: 3 },
  { peakForce: 375, meanVelocity: 0.7, rom: 340, tut: 3800, asymmetry: 4 },
  { peakForce: 360, meanVelocity: 0.63, rom: 330, tut: 4000, asymmetry: 7 },
  { peakForce: 340, meanVelocity: 0.55, rom: 310, tut: 4500, asymmetry: 12 },
];

describe("calculateFatigueResistance", () => {
  it("returns high score for minimal decay", () => {
    const evenReps: RepMetrics[] = Array.from({ length: 5 }, () => ({
      peakForce: 400, meanVelocity: 0.8, rom: 350, tut: 3500, asymmetry: 2,
    }));
    expect(calculateFatigueResistance(evenReps)).toBeGreaterThan(90);
  });

  it("returns lower score for significant decay", () => {
    expect(calculateFatigueResistance(sampleReps)).toBeLessThan(80);
  });

  it("returns 0 for empty input", () => {
    expect(calculateFatigueResistance([])).toBe(0);
  });
});

describe("calculateBilateralBalance", () => {
  it("returns high score for symmetric reps", () => {
    const symmetricReps: RepMetrics[] = Array.from({ length: 5 }, () => ({
      peakForce: 400, meanVelocity: 0.8, rom: 350, tut: 3500, asymmetry: 1,
    }));
    expect(calculateBilateralBalance(symmetricReps)).toBeGreaterThan(90);
  });

  it("penalizes increasing asymmetry (compensation pattern)", () => {
    expect(calculateBilateralBalance(sampleReps)).toBeLessThan(80);
  });
});

describe("getLetterGrade", () => {
  it("returns A+ for 95+", () => {
    expect(getLetterGrade(97)).toBe("A+");
  });
  it("returns B+ for 80-84", () => {
    expect(getLetterGrade(82)).toBe("B+");
  });
  it("returns F for < 50", () => {
    expect(getLetterGrade(40)).toBe("F");
  });
});

describe("calculateFormScore", () => {
  it("returns a weighted composite between 0-100", () => {
    const score = calculateFormScore(sampleReps);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- src/lib/__tests__/form-analysis.test.ts
```

- [ ] **Step 3: Implement form analysis**

Create `src/lib/form-analysis.ts`:

```typescript
export interface RepMetrics {
  peakForce: number;
  meanVelocity: number;
  rom: number;
  tut: number;       // milliseconds
  asymmetry: number; // absolute percentage
}

/**
 * Curve Consistency: how repeatable are the force curves?
 * Uses coefficient of variation of peak force as a proxy
 * (full cross-correlation requires raw telemetry, handled separately).
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
 * Even TUT = controlled eccentric/concentric phases.
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
 * Uses linear regression slope normalized by starting value.
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
  // Normalized: slope as fraction of first value, per rep
  return Math.abs(slope / values[0]);
}

/**
 * Bilateral Balance: penalizes high asymmetry and increasing asymmetry (compensation).
 */
export function calculateBilateralBalance(reps: RepMetrics[]): number {
  if (reps.length === 0) return 0;

  const asymmetries = reps.map((r) => Math.abs(r.asymmetry));
  const avgAsymmetry = asymmetries.reduce((a, b) => a + b, 0) / asymmetries.length;

  // Trend penalty: is asymmetry increasing across the set?
  let trendPenalty = 0;
  if (asymmetries.length >= 3) {
    const lastThird = asymmetries.slice(Math.floor(asymmetries.length * 0.66));
    const firstThird = asymmetries.slice(0, Math.ceil(asymmetries.length * 0.33));
    const lastAvg = lastThird.reduce((a, b) => a + b, 0) / lastThird.length;
    const firstAvg = firstThird.reduce((a, b) => a + b, 0) / firstThird.length;
    trendPenalty = Math.max(0, lastAvg - firstAvg); // Only penalize increases
  }

  // Score: 100 - avgAsymmetry*5 - trendPenalty*3, floored at 0
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
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/lib/__tests__/form-analysis.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/form-analysis.ts src/lib/__tests__/form-analysis.test.ts
git commit -m "feat: add form analysis algorithms with tests"
```

---

### Task 6: Insights Rule Engine

**Files:**
- Create: `src/lib/insights.ts`
- Create: `src/lib/__tests__/insights.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/insights.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { generateInsights, type InsightInput } from "../insights";

const baseInput: InsightInput = {
  currentVolume: 15000,
  previousVolume: 12000,
  muscleGroups: { Chest: 30, Back: 25, Legs: 8, Shoulders: 15, Arms: 14, Core: 8 },
  avgSessionsPerWeek: 4.2,
  currentStreak: 12,
  bestStreak: 21,
  recentPRs: [{ exercise: "Bench Press", value: 225, previousValue: 215 }],
  plateauExercises: ["Overhead Press"],
  trainingLoadScore: 72,
};

describe("generateInsights", () => {
  it("flags volume increase as success", () => {
    const insights = generateInsights(baseInput);
    const volumeInsight = insights.find((i) => i.title.includes("Volume"));
    expect(volumeInsight).toBeDefined();
    expect(volumeInsight?.type).toBe("success");
  });

  it("flags muscle imbalance when ratio > 3x", () => {
    const insights = generateInsights(baseInput);
    const imbalance = insights.find((i) => i.title.includes("Leg"));
    expect(imbalance).toBeDefined();
    expect(imbalance?.type).toBe("warning");
  });

  it("includes PR achievements", () => {
    const insights = generateInsights(baseInput);
    const pr = insights.find((i) => i.type === "achievement" && i.title.includes("PR"));
    expect(pr).toBeDefined();
  });

  it("flags plateau exercises", () => {
    const insights = generateInsights(baseInput);
    const plateau = insights.find((i) => i.title.includes("Plateau"));
    expect(plateau).toBeDefined();
  });

  it("returns empty array for empty input", () => {
    const empty: InsightInput = {
      currentVolume: 0, previousVolume: 0,
      muscleGroups: {}, avgSessionsPerWeek: 0,
      currentStreak: 0, bestStreak: 0,
      recentPRs: [], plateauExercises: [],
      trainingLoadScore: 0,
    };
    expect(generateInsights(empty)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- src/lib/__tests__/insights.test.ts
```

- [ ] **Step 3: Implement insights engine**

Create `src/lib/insights.ts` implementing the `InsightInput` interface and `generateInsights` function. The function should iterate through each rule from the spec (Volume Trend, Muscle Imbalance, Consistency, PR Achievement, Plateau Detection, Streak Milestone, Training Load) and return matching `TrainingInsight` objects.

Each rule is a simple conditional check — no external API calls. See spec section "Insight Rules" for exact trigger conditions and example messages.

The `TrainingInsight` interface:
```typescript
export interface TrainingInsight {
  id: string;
  type: "success" | "warning" | "info" | "achievement";
  title: string;
  description: string;
  recommendation?: string;
  metric?: { name: string; value: number; unit: string; delta?: number };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/lib/__tests__/insights.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/insights.ts src/lib/__tests__/insights.test.ts
git commit -m "feat: add rule-based training insights engine with tests"
```

---

## Phase 3: Query Hooks & Edge Functions

### Task 7: Enhanced Analytics Queries

**Files:**
- Modify: `src/queries/analytics.ts`
- Modify: `src/queries/keys.ts`
- Create: `src/queries/insights.ts`
- Create: `src/queries/benchmarks.ts`

- [ ] **Step 1: Add query keys**

Add to `src/queries/keys.ts` in the `queryKeys` object:

```typescript
insights: {
  all: ["insights"] as const,
  byUser: (userId: string, period: string) =>
    [...queryKeys.insights.all, userId, period] as const,
},
benchmarks: {
  all: ["benchmarks"] as const,
  distribution: (metricType: string, metricKey?: string) =>
    [...queryKeys.benchmarks.all, metricType, metricKey] as const,
},
```

- [ ] **Step 2: Add period comparison to analytics queries**

Add to `src/queries/analytics.ts`:

```typescript
/** Volume trend with previous period comparison */
export function volumeComparisonOptions(userId: string, period: string = "4w") {
  return queryOptions({
    queryKey: queryKeys.analytics.summary(userId, `volume-comparison-${period}`),
    queryFn: async () => {
      const daysBack = periodToDays(period);
      const currentStart = new Date();
      currentStart.setDate(currentStart.getDate() - daysBack);
      const previousStart = new Date();
      previousStart.setDate(previousStart.getDate() - daysBack * 2);

      const [currentData, previousData] = await Promise.all([
        supabase.from("workout_sessions")
          .select("started_at, total_volume, duration_seconds, set_count, exercise_count")
          .eq("user_id", userId)
          .gte("started_at", currentStart.toISOString())
          .order("started_at", { ascending: true }),
        supabase.from("workout_sessions")
          .select("started_at, total_volume, duration_seconds, set_count, exercise_count")
          .eq("user_id", userId)
          .gte("started_at", previousStart.toISOString())
          .lt("started_at", currentStart.toISOString())
          .order("started_at", { ascending: true }),
      ]);

      if (currentData.error) throw currentData.error;
      if (previousData.error) throw previousData.error;
      return { current: currentData.data, previous: previousData.data };
    },
  });
}

function periodToDays(period: string): number {
  if (period === "all") return 3650;
  if (period === "52w") return 365;
  if (period === "12w") return 84;
  if (period === "4w") return 28;
  return 7;
}
```

- [ ] **Step 3: Create insights query**

Create `src/queries/insights.ts`:

```typescript
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "./keys";

export function insightsOptions(userId: string, period: string = "30d") {
  return queryOptions({
    queryKey: queryKeys.insights.byUser(userId, period),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_insights")
        .select("*")
        .eq("user_id", userId)
        .eq("period", period)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });
}
```

- [ ] **Step 4: Create benchmarks query**

Create `src/queries/benchmarks.ts`:

```typescript
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "./keys";

export function benchmarkOptions(metricType: string, metricKey?: string) {
  return queryOptions({
    queryKey: queryKeys.benchmarks.distribution(metricType, metricKey),
    queryFn: async () => {
      let query = supabase
        .from("community_benchmarks")
        .select("*")
        .eq("metric_type", metricType);
      if (metricKey) query = query.eq("metric_key", metricKey);
      const { data, error } = await query.single();
      if (error) throw error;
      return data;
    },
  });
}
```

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/queries/keys.ts src/queries/analytics.ts src/queries/insights.ts src/queries/benchmarks.ts
git commit -m "feat: add insights, benchmarks, and period comparison query hooks"
```

---

### Task 8: Generate Insights Edge Function

**Files:**
- Create: `supabase/functions/generate-insights/index.ts`

- [ ] **Step 1: Create Edge Function**

Create `supabase/functions/generate-insights/index.ts` that:
1. Accepts POST with `{ userId, period }` body
2. Uses service role Supabase client to query workout data
3. Computes insight inputs (volume comparison, muscle groups, PRs, streaks, plateaus)
4. Runs the same insight generation rules as `src/lib/insights.ts`
5. Upserts results into `user_insights` table (delete old, insert new)
6. Returns the generated insights as JSON

The Edge Function should be self-contained — duplicate the insight rules rather than importing from `src/lib/` (Edge Functions can't import from the frontend codebase).

**IMPORTANT:** Add a comment at the top of the Edge Function referencing `src/lib/insights.ts` as the canonical source, and vice versa. Changes to insight rules must be kept in sync across both files.

Reference existing Edge Functions in `supabase/functions/` for the pattern (e.g., `stripe-webhooks/index.ts`).

- [ ] **Step 2: Deploy Edge Function**

Use `mcp__claude_ai_Supabase__deploy_edge_function` with function name `generate-insights`.

- [ ] **Step 3: Test via curl or Supabase dashboard**

Verify the function executes without error and populates `user_insights` for the test account.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/generate-insights/index.ts
git commit -m "feat: add generate-insights Edge Function"
```

---

## Phase 4: ECharts Chart Components

### Task 9: Training Load Gauge Component

**Files:**
- Create: `src/app/components/charts/TrainingLoadGauge.tsx`

- [ ] **Step 1: Create the gauge component**

Create `src/app/components/charts/TrainingLoadGauge.tsx` using EChartsWrapper:

The component accepts `score: number` (0-100) and `zone: TrainingLoadZone` props.

Uses ECharts gauge series with:
- Three color zones: green (0-35), yellow (35-75), red (75-100)
- Pointer needle at the current score
- Center text showing the numeric score
- Bottom label showing zone name ("Low", "Optimal", "High")
- Phoenix-themed dark background

Reference the spec's gauge design and the ECharts gauge documentation.

- [ ] **Step 2: Verify with typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/app/components/charts/TrainingLoadGauge.tsx
git commit -m "feat: add ECharts Training Load gauge component"
```

---

### Task 10: Muscle Balance Radar Component

**Files:**
- Create: `src/app/components/charts/MuscleRadar.tsx`

- [ ] **Step 1: Create the radar component**

Create `src/app/components/charts/MuscleRadar.tsx` using EChartsWrapper:

Props: `currentData: Record<string, number>`, `previousData?: Record<string, number>`

ECharts radar series with:
- 6-axis hexagonal radar (Chest, Back, Arms, Legs, Core, Shoulders)
- Current period as filled area with ember color
- Previous period as dashed outline (ghost overlay)
- Warning indicators on axes where value is below threshold (< 33% of max axis value)
- Tooltip on hover showing exact values

- [ ] **Step 2: Verify with typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/app/components/charts/MuscleRadar.tsx
git commit -m "feat: add ECharts Muscle Balance radar component"
```

---

### Task 11: Community Distribution Chart Component

**Files:**
- Create: `src/app/components/charts/CommunityDistribution.tsx`

- [ ] **Step 1: Create the distribution component**

Create `src/app/components/charts/CommunityDistribution.tsx` using EChartsWrapper:

Props: `percentiles: Record<string, number>`, `userValue: number`, `color: string`, `label: string`

ECharts line/area series rendering a bell curve from percentile data, with:
- Area fill showing the distribution
- A vertical markLine at the user's position labeled "YOU"
- Colored region from user's position to the right edge (showing their percentile)
- Compact sizing for use inside stat cards

- [ ] **Step 2: Verify with typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/app/components/charts/CommunityDistribution.tsx
git commit -m "feat: add ECharts community percentile distribution component"
```

---

### Task 12: Consistency Widget Component

**Files:**
- Create: `src/app/components/charts/ConsistencyWidget.tsx`

- [ ] **Step 1: Create the consistency widget**

Create `src/app/components/charts/ConsistencyWidget.tsx`:

This is a composite component (not pure ECharts) combining:
- **Weekly Goal Rings**: SVG-based concentric rings (3 weeks) showing progress toward weekly workout target. Use raw SVG `<circle>` elements with `stroke-dasharray` for ring fill animation.
- **Stats row below**: avg workouts/week, consistency hit rate (%), most active day of the week

Props: `weeklyData: { current: number; target: number; lastWeek: number; twoWeeksAgo: number }`, `avgPerWeek: number`, `hitRate: number`, `mostActiveDay: string`

- [ ] **Step 2: Verify with typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/app/components/charts/ConsistencyWidget.tsx
git commit -m "feat: add Consistency Widget with goal rings and frequency stats"
```

---

## Phase 5: UI Components

### Task 13: Insights Feed Component

**Files:**
- Create: `src/app/components/InsightsFeed.tsx`

- [ ] **Step 1: Create insights feed**

Create `src/app/components/InsightsFeed.tsx`:

Renders a vertical stack of insight cards from the `user_insights` query. Each card has:
- Color-coded left border and icon based on `insight_type` (success=green, warning=yellow, info=blue, achievement=ember)
- Title, description, and optional recommendation
- Metric value with delta if available
- Uses shadcn Card component for consistent styling

Props: `insights: TrainingInsight[]`, `loading?: boolean`

- [ ] **Step 2: Commit**

```bash
git add src/app/components/InsightsFeed.tsx
git commit -m "feat: add InsightsFeed component for training insights"
```

---

### Task 14: Community Rankings Component

**Files:**
- Create: `src/app/components/CommunityRankings.tsx`

- [ ] **Step 1: Create community rankings**

Create `src/app/components/CommunityRankings.tsx`:

Renders 4 percentile cards in a grid. Each card shows:
- Metric label (e.g., "Bench Press", "Weekly Volume")
- Percentile text (e.g., "Top 15%")
- Actual value and rank
- CommunityDistribution chart (mini bell curve from Task 11)

Props: `rankings: Array<{ label: string; percentile: number; value: number; rank: number; totalUsers: number; color: string; percentiles: Record<string, number> }>`

Uses responsive grid: 4 columns desktop, 2 columns mobile.

- [ ] **Step 2: Commit**

```bash
git add src/app/components/CommunityRankings.tsx
git commit -m "feat: add CommunityRankings component with percentile cards"
```

---

### Task 15: Form Analysis Component

**Files:**
- Create: `src/app/components/FormAnalysis.tsx`

- [ ] **Step 1: Create form analysis display**

Create `src/app/components/FormAnalysis.tsx`:

Renders the form analysis section from the Performance tab. Includes:
- Overall Form Score ring (SVG circle with stroke-dasharray) + letter grade
- Four sub-metric rows: dot (green/yellow/red based on score), name, description, percentage
- Rule-based recommendations section at bottom
- Uses `calculateFormScore` and `getLetterGrade` from `src/lib/form-analysis.ts`

Props: `reps: RepMetrics[]`

Thresholds for dot color: >= 80 green, >= 60 yellow, < 60 red.

- [ ] **Step 2: Commit**

```bash
git add src/app/components/FormAnalysis.tsx
git commit -m "feat: add FormAnalysis component with scoring and recommendations"
```

---

## Phase 6: Analytics Tab Restructure

### Task 16: Refactor Analytics.tsx — Tab Structure & Overview Tab

**Files:**
- Modify: `src/app/components/Analytics.tsx`

This is the largest task. It refactors the 1,628-line `Analytics.tsx` to:
1. Change tab structure from 7 → 4 tabs (Overview, Progress, Body, Performance)
2. Replace Overview tab's Recharts charts with ECharts equivalents
3. Add new Overview components (Training Load gauge, Consistency widget, Insights feed)
4. Add hero stat cards with sparklines and period comparison deltas

- [ ] **Step 1: Update tab definitions and imports**

Replace the 7-tab structure with 4 tabs. Update the `TabsList` and `TabsTrigger` components. Add new imports for ECharts components and new query hooks.

- [ ] **Step 2: Implement new hero stats row**

Replace the existing 4 stat cards with 5 cards that include sparklines and period deltas (Total Volume, Workouts, Training Load, PRs, Streak).

Use `volumeComparisonOptions` query for delta calculation.

- [ ] **Step 3: Replace Overview charts**

Replace Recharts `AreaChart` (Volume Over Time) with EChartsWrapper using a combined area+bar option.
Replace Recharts `PieChart` (Muscle Distribution) with EChartsWrapper using a donut series.
Add `TrainingLoadGauge`, `ConsistencyWidget`, and `InsightsFeed` components.

- [ ] **Step 4: Fold External activities into Overview**

Move the Activity Sources card (Phoenix Workouts, External Activities, Total, Calories) into the Overview tab. Remove the standalone External tab.

- [ ] **Step 5: Run typecheck and dev server test**

```bash
npm run typecheck
npm run dev
```

Manually verify the Overview tab renders correctly with demo data in the browser.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/Analytics.tsx
git commit -m "feat: restructure Analytics to 4 tabs, implement enhanced Overview tab"
```

---

### Task 17: Progress Tab Implementation

**Files:**
- Modify: `src/app/components/Analytics.tsx`

- [ ] **Step 1: Implement Progress tab content**

Build the Progress tab section in `Analytics.tsx`:
- Exercise selector dropdown + ECharts line chart for 1RM progression (replace Recharts LineChart)
- Period comparison toggle (ghost overlay of previous period data)
- Volume & frequency trends ECharts area chart with moving average
- Week-over-week comparison delta cards
- PR timeline (horizontal list of PR markers)
- "Days since last PR" counter

- [ ] **Step 2: Add plateau detection visualization**

When `plateauExercises` data is available (from insights), highlight flat ranges on the 1RM chart using ECharts `markArea` with a subtle warning color band.

- [ ] **Step 3: Test and commit**

```bash
npm run typecheck
git add src/app/components/Analytics.tsx
git commit -m "feat: implement Progress tab with 1RM progression and plateau detection"
```

---

### Task 18: Body Tab Implementation

**Files:**
- Modify: `src/app/components/Analytics.tsx`
- Modify: `src/app/components/MuscleHeatmap.tsx` (or replace)

- [ ] **Step 1: Add Muscle Balance Radar**

Add the `MuscleRadar` component to the Body tab with current vs previous period data.

- [ ] **Step 2: Integrate react-muscle-highlighter (or react-body-highlighter)**

Replace the existing `MuscleHeatmap.tsx` SVG with the `react-muscle-highlighter` component. Map muscle group volumes to intensity levels. Add Front/Back toggle. Wire click handler to filter the breakdown table.

If the package API doesn't support custom Phoenix colors, wrap it and apply CSS overrides.

- [ ] **Step 3: Build muscle group breakdown table**

Create a sortable table with: Group, Volume, Sets, Sessions, % of Total (inline progress bar), vs Last Period delta, Status badge.

- [ ] **Step 4: Add biomechanics teaser (Inferno-gated)**

Add a blurred preview section at the bottom using the existing `SubscriptionGate` component. Show placeholder metrics (L/R Asymmetry, ROM, Force Consistency) behind a blur filter with an "Upgrade to Inferno" CTA button.

- [ ] **Step 5: Test and commit**

```bash
npm run typecheck
git add src/app/components/Analytics.tsx src/app/components/MuscleHeatmap.tsx
git commit -m "feat: implement Body tab with radar chart, body heatmap, and biomechanics teaser"
```

---

### Task 19: Performance Tab Implementation

**Files:**
- Modify: `src/app/components/Analytics.tsx`
- Modify: `src/app/components/Biomechanics.tsx`

- [ ] **Step 1: Add session/exercise selector and Community Rankings**

Add the session date dropdown, exercise dropdown, and set selector pills at the top. Add the `CommunityRankings` component below (gated to Flame+ but visible as an upgrade driver).

- [ ] **Step 2: Enhance existing visx charts**

Modify `Biomechanics.tsx` to add:
- VBT zone background bands to `VelocityProfile`
- Glowing peak highlight to `PowerOutput`
- Contextual insight text below each chart (derived from data)

- [ ] **Step 3: Add Form Analysis section**

Add the `FormAnalysis` component, fed by `rep_summaries` data transformed into `RepMetrics[]`.

- [ ] **Step 4: Add Training Efficiency section**

Add volume/min, avg rest time, and Session Intensity Score cards with sparklines.

- [ ] **Step 5: Add Biomechanics Trends section**

Add 4 historical sparkline cards at the bottom (Peak Force, Avg Asymmetry, Form Score, ROM Stability).

- [ ] **Step 6: Wrap in SubscriptionGate**

Ensure the entire Performance tab content is wrapped with `SubscriptionGate` requiring Inferno tier (except Community Rankings which is Flame+).

- [ ] **Step 7: Test and commit**

```bash
npm run typecheck
git add src/app/components/Analytics.tsx src/app/components/Biomechanics.tsx
git commit -m "feat: implement Performance tab with community rankings, form analysis, and biomechanics"
```

---

## Phase 7: Polish & Verification

### Task 20: Mobile Responsiveness

**Files:**
- Modify: `src/app/components/Analytics.tsx`

- [ ] **Step 1: Test all 4 tabs at mobile viewport (< 768px)**

Use browser dev tools or `useIsMobile` hook behavior to verify each tab renders correctly on mobile.

- [ ] **Step 2: Fix mobile layout issues**

Apply mobile-specific layouts:
- Hero stat cards → horizontal snap carousel
- Community ranking cards → 2-column or vertical stack
- Form Analysis → collapsed to score + grade with expandable detail
- Charts → full-width, reduced height via ECharts responsive option

- [ ] **Step 3: Test and commit**

```bash
npm run typecheck
git add src/app/components/Analytics.tsx
git commit -m "fix: ensure mobile responsiveness for all analytics tabs"
```

---

### Task 21: Run Full Test Suite & Final Verification

- [ ] **Step 1: Run all tests**

```bash
npm test
npm run typecheck
```

Fix any failures.

- [ ] **Step 2: Manual browser verification**

Open `http://localhost:5173/analytics` in browser. Verify:
- All 4 tabs render with demo data
- Charts are interactive (hover, click)
- Period selector changes data
- Training Load gauge displays correct zone
- Insights feed shows relevant insights
- Body heatmap is clickable and themed
- Performance tab shows form analysis scores
- Mobile viewport renders correctly

- [ ] **Step 3: Build verification**

```bash
npm run build
```

Verify production build succeeds with no errors.

- [ ] **Step 4: Final commit (if any fixes)**

Stage only the specific files that were changed, then commit:

```bash
git add <changed-files>
git commit -m "fix: address test failures and build issues from analytics enhancement"
```
