# Phase 4: Premium Analytics - Research

**Researched:** 2026-02-15
**Domain:** Biomechanics data visualization, time-series downsampling, velocity-based training analytics
**Confidence:** MEDIUM

## Summary

Phase 4 introduces premium biomechanics analytics -- force curves, VBT metrics, asymmetry detection, and exercise progress tracking -- gated behind PHOENIX+ subscription. The core technical challenge is rendering high-fidelity telemetry data (50Hz sensor streams, 3000+ points per set) without browser freezing, which requires both a downsampling utility and a low-level charting library (visx) rather than the existing Recharts setup.

The project already has a solid foundation: TanStack Query for data fetching, Zod schemas with transforms (dual-cable weight multiplier), a `SubscriptionGate` component for tier gating, and an established route/layout pattern with lazy loading. The database schema needs significant extension -- currently no telemetry tables exist for per-rep force/velocity/position data. This phase will add new Supabase tables, new query factories, new Zod transform schemas, and an entirely new visx-based charting layer alongside the existing Recharts charts.

VBT zone classification requires sports-science-validated thresholds (Dr. Bryan Mann's research), and the muscle heatmap requires either a third-party SVG body component or a custom SVG. The LTTB downsampling algorithm has a well-maintained npm package (`downsample`) with TypeScript support and a clean `createLTTB` API for custom point types.

**Primary recommendation:** Install visx individual packages (not the umbrella `@visx/visx`), the `downsample` package for LTTB, and build custom SVG body maps rather than depending on niche third-party body highlighter libraries that may not match the Phoenix dark theme.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@visx/shape` | 3.x | LinePath, AreaClosed, Bar for force curves and charts | Low-level SVG primitives required by BIO-02; Recharts cannot do per-rep gradient fills |
| `@visx/scale` | 3.x | scaleLinear, scaleTime for mapping data to pixels | Required companion to @visx/shape |
| `@visx/gradient` | 3.x | LinearGradient SVG defs for force curve gradient fills | BIO-02 requires gradient fills on force curves |
| `@visx/curve` | 3.x | curveMonotoneX for smooth force curve interpolation | Prevents jagged force curve rendering |
| `@visx/tooltip` | 3.x | useTooltip, TooltipWithBounds for interactive data inspection | Per-rep hover data display |
| `@visx/responsive` | 3.x | ParentSize for responsive chart containers | Matches existing responsive pattern |
| `@visx/axis` | 3.x | AxisBottom, AxisLeft for labeled axes | Time/force axes on force curves |
| `@visx/group` | 3.x | Group SVG element wrapper | Standard visx composition pattern |
| `downsample` | 1.4.x | LTTB algorithm for telemetry downsampling | BIO-01 requires reducing 50Hz data to 500-1000 points |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@visx/grid` | 3.x | GridRows/GridColumns for chart backgrounds | Optional: adds reference lines to force curves |
| `recharts` | 2.15.x (existing) | Bar/Line/Area charts for summary analytics | Exercise progress charts (BIO-10), volume breakdowns -- already in project |
| `date-fns` | 3.6.x (existing) | Date formatting for calendar and time axes | Already installed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| visx (individual packages) | `@visx/visx` umbrella | Umbrella adds ~30 unnecessary packages; individual packages keep bundle small |
| visx | Recharts | Recharts lacks per-rep gradient fills, SVG path-level control needed for force curves |
| `downsample` npm | Hand-rolled LTTB | LTTB is a well-defined algorithm but has edge cases (first/last point preservation, bucket boundary handling); npm package handles these |
| Custom SVG body map | `react-body-highlighter` | Third-party lib has limited styling control, may not match dark theme, adds dependency for what is effectively one SVG |
| Custom calendar heatmap | `react-calendar-heatmap` | Third-party lib reasonable, but the calendar is simple enough to build with visx Heatmap or plain SVG grid; avoids another dependency |

**Installation:**
```bash
npm install @visx/shape @visx/scale @visx/gradient @visx/curve @visx/tooltip @visx/responsive @visx/axis @visx/group @visx/grid downsample
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── telemetry.ts           # LTTB downsampling utility, data normalization
│   ├── vbt.ts                 # VBT zone classification, power calculations
│   └── biomechanics.ts        # Asymmetry %, ROM analysis, 1RM estimation
├── schemas/
│   └── telemetry.ts           # Zod schemas for telemetry data (extends transforms.ts pattern)
├── queries/
│   ├── telemetry.ts           # TanStack Query options for per-rep telemetry
│   ├── biomechanics.ts        # Query options for asymmetry, ROM, VBT data
│   └── progress.ts            # Exercise progress, summary reports
├── app/components/
│   ├── charts/                # NEW: visx-based chart components
│   │   ├── ForceCurve.tsx     # Per-rep force curve with gradient fill
│   │   ├── VelocityProfile.tsx # Mean/peak velocity per rep
│   │   ├── AsymmetryGauge.tsx # Left vs right percentage visualization
│   │   ├── PowerOutput.tsx    # Force x velocity watts display
│   │   └── shared/            # Shared visx utilities (axes, tooltips, theme)
│   ├── Biomechanics.tsx       # Premium dashboard page (BIO-09)
│   ├── ExerciseProgress.tsx   # Exercise-level progress charts (BIO-10)
│   ├── MuscleHeatmap.tsx      # SVG body map with volume coloring (BIO-11)
│   ├── ConsistencyCalendar.tsx # GitHub-style workout calendar (BIO-12)
│   └── SummaryReport.tsx      # Weekly/monthly summary cards (BIO-13)
```

### Pattern 1: LTTB Downsampling Service
**What:** Pure utility that takes raw telemetry arrays and returns visualization-ready data
**When to use:** Before passing telemetry data to any visx chart component
**Example:**
```typescript
// src/lib/telemetry.ts
import { createLTTB } from 'downsample';

interface TelemetryPoint {
  timestamp_ms: number;
  force_n: number;
  velocity_mps: number;
  position_mm: number;
  cable: 'left' | 'right';
}

// Create typed LTTB downsampler for telemetry
const lttb = createLTTB({
  x: (p: TelemetryPoint) => p.timestamp_ms,
  y: (p: TelemetryPoint) => p.force_n,
});

export function downsampleForce(
  raw: TelemetryPoint[],
  targetPoints: number = 750
): TelemetryPoint[] {
  if (raw.length <= targetPoints) return raw;
  return lttb(raw, targetPoints);
}
```

### Pattern 2: visx Force Curve with Gradient Fill
**What:** AreaClosed for gradient fill + LinePath for stroke, layered in SVG
**When to use:** BIO-02 force curve visualization
**Example:**
```typescript
// src/app/components/charts/ForceCurve.tsx
import { AreaClosed, LinePath } from '@visx/shape';
import { LinearGradient } from '@visx/gradient';
import { scaleLinear } from '@visx/scale';
import { curveMonotoneX } from '@visx/curve';
import { ParentSize } from '@visx/responsive';

// Pattern: AreaClosed for fill, LinePath for crisp stroke line
// Both use same data/accessors/scales
<svg>
  <LinearGradient id="force-gradient" from="#FF6B35" to="#FF6B3500" />
  <AreaClosed
    data={downsampledData}
    x={d => xScale(d.timestamp_ms)}
    y={d => yScale(d.force_n)}
    yScale={yScale}
    curve={curveMonotoneX}
    fill="url(#force-gradient)"
  />
  <LinePath
    data={downsampledData}
    x={d => xScale(d.timestamp_ms)}
    y={d => yScale(d.force_n)}
    curve={curveMonotoneX}
    stroke="#FF6B35"
    strokeWidth={2}
  />
</svg>
```

### Pattern 3: Subscription Gating for Biomechanics Page
**What:** Wrap entire page with existing SubscriptionGate component
**When to use:** BIO-09 biomechanics dashboard, any premium-only feature
**Example:**
```typescript
// Already exists: src/app/components/SubscriptionGate.tsx
<SubscriptionGate requiredTier="PHOENIX">
  <BiomechanicsDashboard />
</SubscriptionGate>
```

### Pattern 4: TanStack Query for Telemetry Data
**What:** Query options factory following established project pattern
**When to use:** All new data fetching for telemetry, biomechanics, progress
**Example:**
```typescript
// src/queries/telemetry.ts - follows pattern from queries/analytics.ts
import { queryOptions } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function repTelemetryOptions(setId: string) {
  return queryOptions({
    queryKey: ['telemetry', 'rep', setId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rep_telemetry')
        .select('*')
        .eq('set_id', setId)
        .order('timestamp_ms', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}
```

### Anti-Patterns to Avoid
- **Loading all telemetry at once:** A session with 5 exercises x 4 sets x 10 reps x 3000 points = 600,000 rows. NEVER fetch all telemetry for a session; fetch per-set or per-rep on demand (expand-on-click pattern).
- **Rendering raw telemetry without LTTB:** 3000+ SVG path points will cause jank. ALWAYS downsample before render.
- **Using Recharts for force curves:** Recharts `<Area>` cannot do per-rep overlays, custom gradient defs, or multi-rep path layering. Use visx for force curves, keep Recharts for summary bar/line charts.
- **Storing computed metrics client-side:** Asymmetry %, estimated 1RM, power output should be computed server-side (Supabase Edge Functions or DB triggers) and stored in summary tables. Client only visualizes.
- **Using the `@visx/visx` umbrella package:** It imports ALL visx packages. Use individual packages to keep bundle size manageable.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LTTB downsampling | Custom bucket algorithm | `downsample` npm createLTTB | Edge cases: first/last point preservation, degenerate inputs, bucket boundary selection |
| SVG gradient definitions | Inline SVG `<defs>` management | `@visx/gradient` LinearGradient | Handles unique IDs, SSR compatibility, proper SVG namespace |
| Responsive SVG sizing | Manual ResizeObserver | `@visx/responsive` ParentSize | Debouncing, SSR handling, proper dimension propagation |
| Tooltip positioning | Manual mouse coordinate math | `@visx/tooltip` TooltipWithBounds | Viewport boundary detection, portal rendering, performance |
| Scale calculations | Manual min/max/domain math | `@visx/scale` (wraps d3-scale) | Handles nice ticks, domain padding, band scales correctly |
| 1RM estimation | Custom formula | Epley formula: `weight * (1 + reps / 30)` | Well-validated; but DO hand-roll this simple formula -- no library needed |
| VBT zone classification | N/A | Hand-roll with validated thresholds | Simple mapping function; no library exists for this |

**Key insight:** visx exists precisely because hand-rolling SVG data visualization in React is a maintenance nightmare. Use visx primitives for rendering, hand-roll only domain-specific calculations (1RM, VBT zones, asymmetry %).

## Common Pitfalls

### Pitfall 1: SVG Performance with Large Datasets
**What goes wrong:** Rendering 3000+ SVG path segments causes visible frame drops and scroll jank, especially on mobile.
**Why it happens:** Each SVG element is a DOM node; the browser must layout/paint thousands of nodes on every frame.
**How to avoid:**
1. ALWAYS run LTTB downsampling before rendering (BIO-01, target 500-750 points)
2. Use `shapeRendering="optimizeSpeed"` on SVG path elements for fewer anti-aliasing calculations
3. Load telemetry on demand (click-to-expand per set), never for entire sessions
4. Consider `useMemo` on downsampled data to prevent re-computation on re-renders
**Warning signs:** Force curve charts take >100ms to render, visible repaint during interactions.

### Pitfall 2: Dual-Cable Weight Confusion
**What goes wrong:** Displaying per-cable force as total force, or double-counting already-multiplied values.
**Why it happens:** The Vitruvian Trainer has dual cables. The existing codebase has `WEIGHT_MULTIPLIER = 2` in `src/schemas/transforms.ts`. Telemetry data comes per-cable.
**How to avoid:**
1. Telemetry data (force, velocity) should stay per-cable for asymmetry analysis
2. Total force/power display should sum both cables explicitly
3. Document clearly in Zod schemas whether values are per-cable or total
4. The `cable: 'left' | 'right'` field must be present in telemetry schema
**Warning signs:** Asymmetry showing 50/50 when it should show imbalance; total force values half or double expected.

### Pitfall 3: VBT Zone Thresholds are Exercise-Dependent
**What goes wrong:** Applying squat velocity zones to bench press, showing incorrect zone classifications.
**Why it happens:** Different exercises have different velocity profiles at the same %1RM. A bench press 1RM might move at 0.15 m/s while a squat 1RM at 0.30 m/s.
**How to avoid:**
1. Use Dr. Bryan Mann's general zones as defaults (see Code Examples below)
2. Label zones as "general" not "personalized"
3. Consider exercise category (upper push, upper pull, lower push, lower pull) for zone adjustment
4. Long-term: allow users to set personal velocity thresholds (Phase 6+ feature)
**Warning signs:** All exercises showing "strength zone" regardless of velocity differences.

### Pitfall 4: Inconsistent Time Axes Across Rep Force Curves
**What goes wrong:** Overlaying multiple rep force curves where reps have different durations, making visual comparison meaningless.
**Why it happens:** Each rep has different TUT (time under tension), so raw timestamps don't align.
**How to avoid:**
1. Normalize rep duration to 0-100% for overlay comparisons
2. OR show reps sequentially with time gaps preserved (more accurate but less visually clean)
3. Provide a toggle for "normalized" vs "actual time" view
**Warning signs:** Rep 1 (3.5s TUT) and Rep 10 (5.2s TUT) appear to have same force profile when overlaid.

### Pitfall 5: Body Heatmap Muscle Group Mapping Mismatch
**What goes wrong:** Database has "Chest" but SVG body map expects "pectoralis-major", or vice versa.
**Why it happens:** No standardized muscle group taxonomy between exercise database and visualization.
**How to avoid:**
1. Define a canonical muscle group enum matching the existing database values (Chest, Back, Legs, Shoulders, Arms, Core -- visible in `SessionDetail.tsx` color map)
2. Create a mapping layer between canonical names and SVG path IDs
3. Handle the "Arms" -> biceps + triceps + forearm split for the body map
**Warning signs:** Heatmap showing zero volume for muscle groups that clearly have workout data.

## Code Examples

### LTTB Downsampling with `downsample` Package
```typescript
// src/lib/telemetry.ts
import { createLTTB } from 'downsample';

export interface TelemetryPoint {
  timestamp_ms: number;
  force_n: number;
  velocity_mps: number;
  position_mm: number;
  cable: 'left' | 'right';
}

const forceLTTB = createLTTB<TelemetryPoint>({
  x: (p) => p.timestamp_ms,
  y: (p) => p.force_n,
});

const velocityLTTB = createLTTB<TelemetryPoint>({
  x: (p) => p.timestamp_ms,
  y: (p) => p.velocity_mps,
});

/**
 * Downsample telemetry for visualization.
 * BIO-01: Reduces 50Hz data (e.g. 3000 points for 60s set) to target resolution.
 * Preserves shape-defining points (peaks, valleys) via LTTB algorithm.
 */
export function downsampleTelemetry(
  raw: TelemetryPoint[],
  metric: 'force' | 'velocity',
  targetPoints: number = 750
): TelemetryPoint[] {
  if (raw.length <= targetPoints) return raw;
  const lttb = metric === 'force' ? forceLTTB : velocityLTTB;
  return lttb(raw, targetPoints);
}
```

### VBT Zone Classification (Dr. Bryan Mann's Thresholds)
```typescript
// src/lib/vbt.ts

/**
 * VBT velocity zones based on Dr. Bryan Mann's research.
 * Source: Mann, J.B. (2016). Velocity Based Training.
 * These are GENERAL thresholds for compound barbell movements.
 * Accuracy varies by exercise type -- squat vs bench vs deadlift.
 */
export type VbtZone =
  | 'absolute-strength'
  | 'accelerative-strength'
  | 'strength-speed'
  | 'speed-strength'
  | 'starting-strength';

export interface VbtZoneInfo {
  zone: VbtZone;
  label: string;
  color: string;          // Phoenix theme color
  minVelocity: number;    // m/s inclusive
  maxVelocity: number;    // m/s exclusive (Infinity for top zone)
  description: string;
}

export const VBT_ZONES: VbtZoneInfo[] = [
  {
    zone: 'absolute-strength',
    label: 'Strength',
    color: '#DC2626',          // Flame Red
    minVelocity: 0,
    maxVelocity: 0.5,
    description: '90-100% 1RM — maximal force production',
  },
  {
    zone: 'accelerative-strength',
    label: 'Accel. Strength',
    color: '#FF6B35',          // Ember
    minVelocity: 0.5,
    maxVelocity: 0.75,
    description: '80-90% 1RM — force through sticking point',
  },
  {
    zone: 'strength-speed',
    label: 'Strength-Speed',
    color: '#F59E0B',          // Gold
    minVelocity: 0.75,
    maxVelocity: 1.0,
    description: '60-80% 1RM — moderate load, high intent',
  },
  {
    zone: 'speed-strength',
    label: 'Speed-Strength',
    color: '#10B981',          // Forge Green
    minVelocity: 1.0,
    maxVelocity: 1.3,
    description: '40-60% 1RM — speed dominant',
  },
  {
    zone: 'starting-strength',
    label: 'Starting Strength',
    color: '#3B82F6',          // Blue (extends palette)
    minVelocity: 1.3,
    maxVelocity: Infinity,
    description: '<40% 1RM — explosive/ballistic',
  },
];

export function classifyVbtZone(meanVelocityMps: number): VbtZoneInfo {
  return (
    VBT_ZONES.find(
      (z) => meanVelocityMps >= z.minVelocity && meanVelocityMps < z.maxVelocity
    ) ?? VBT_ZONES[0]
  );
}
```

### 1RM Estimation (Epley Formula)
```typescript
// src/lib/biomechanics.ts

/**
 * Estimate 1RM using Epley formula.
 * Most accurate for 1-10 rep range.
 * Source: Epley, B. (1985). Poundage chart. Boyd Epley Workout.
 *
 * @param weight Weight lifted in kg
 * @param reps Number of repetitions completed (must be > 1)
 * @returns Estimated 1RM in kg
 */
export function estimateOneRepMax(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

/**
 * Calculate asymmetry percentage between left and right cable.
 * Positive = right dominant, Negative = left dominant.
 * BIO-03, BIO-04: Flag when |asymmetry| > 10%.
 */
export function calculateAsymmetry(leftForce: number, rightForce: number): number {
  const total = leftForce + rightForce;
  if (total === 0) return 0;
  return Math.round(((rightForce - leftForce) / total) * 200); // percentage points
}

/**
 * Power output in watts.
 * BIO-07: Force (N) x Velocity (m/s) = Power (W)
 */
export function calculatePower(forceNewtons: number, velocityMps: number): number {
  return Math.round(forceNewtons * velocityMps);
}
```

### Asymmetry Threshold Flagging
```typescript
// BIO-04: Visual flagging when imbalance exceeds 10%
const ASYMMETRY_THRESHOLD = 10; // percent

function AsymmetryBadge({ leftForce, rightForce }: { leftForce: number; rightForce: number }) {
  const asymmetry = calculateAsymmetry(leftForce, rightForce);
  const isImbalanced = Math.abs(asymmetry) > ASYMMETRY_THRESHOLD;

  return (
    <Badge className={isImbalanced ? 'bg-[#DC2626] text-white' : 'bg-[#10B981] text-white'}>
      {asymmetry > 0 ? `R+${asymmetry}%` : asymmetry < 0 ? `L+${Math.abs(asymmetry)}%` : 'Balanced'}
    </Badge>
  );
}
```

## Database Schema Extensions Required

The current `database.types.ts` has NO telemetry tables. Phase 4 requires these new tables:

### New Tables Needed
```sql
-- Per-rep telemetry (the big one -- 50Hz sensor data)
rep_telemetry (
  id uuid PK,
  set_id uuid FK -> sets.id,
  rep_number int,
  timestamp_ms int,           -- milliseconds from rep start
  force_n float,              -- force in Newtons
  velocity_mps float,         -- velocity in m/s
  position_mm float,          -- cable position in mm (for ROM)
  cable text CHECK (cable IN ('left', 'right')),
  created_at timestamptz
)

-- Per-rep computed summary (avoids re-computing from telemetry)
rep_summaries (
  id uuid PK,
  set_id uuid FK -> sets.id,
  rep_number int,
  mean_velocity_mps float,
  peak_velocity_mps float,
  mean_force_n float,
  peak_force_n float,
  power_watts float,          -- mean force x mean velocity
  rom_mm float,               -- range of motion
  tut_ms int,                 -- time under tension
  left_force_avg float,
  right_force_avg float,
  asymmetry_pct float,        -- pre-computed (right-left)/total * 100
  vbt_zone text,              -- classified zone label
  created_at timestamptz
)

-- Exercise-level progress (for BIO-10 charts)
exercise_progress (
  id uuid PK,
  user_id uuid FK -> auth.users,
  exercise_name text,
  session_id uuid FK -> workout_sessions.id,
  recorded_at timestamptz,
  max_weight_kg float,
  total_volume_kg float,      -- weight x reps summed across sets
  estimated_1rm_kg float,     -- Epley formula from best set
  max_reps int,
  set_count int
)
```

### Schema Design Rationale
- **`rep_telemetry`** stores raw sensor data per cable, per rep. This is the largest table by row count. Index on `(set_id, rep_number, cable)`. RLS policy: user must own the parent session.
- **`rep_summaries`** pre-computes metrics so the biomechanics dashboard can load without touching raw telemetry. Only force curves need raw data.
- **`exercise_progress`** denormalizes for BIO-10 charts so we don't need expensive joins across sessions/exercises/sets for trend queries.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Recharts for all charts | visx for low-level viz + Recharts for dashboards | visx 3.x (2023) | visx gives SVG path control; Recharts for convenience |
| Raw data in chart props | LTTB downsampling before render | `downsample` 1.4 | Critical for 50Hz telemetry performance |
| Fixed VBT zones | Exercise-specific MVT (minimum velocity threshold) | Ongoing research | General zones are acceptable for v1; personalized zones are v2 |
| react-body-highlighter | Custom SVG or react-body-highlighter | 2024 | Custom SVG gives full theme control |
| GitHub-style calendar libs | Built-in with visx Heatmap or custom SVG grid | 2024 | Simple enough to hand-roll; avoids dependency |

**Deprecated/outdated:**
- `vx` (old name): Renamed to `visx` in 2020. Do NOT install `@vx/*` packages.
- visx v1/v2: Current is v3.x. Peer dependency on React 16+ (compatible with our React 18).

## Open Questions

1. **Telemetry data ingestion path**
   - What we know: Mobile app controls the Vitruvian Trainer and collects sensor data. Phoenix Portal is view-only.
   - What's unclear: How does telemetry get from the mobile app into Supabase? Direct upload from mobile? Edge function processing? Batch sync?
   - Recommendation: Design the schema and queries assuming data is already in Supabase. The ingestion pipeline is a mobile-app concern, not a portal concern. Use mock data matching the schema during development.

2. **Telemetry volume and Supabase costs**
   - What we know: 50Hz * 2 cables * ~60 seconds per set * 4 sets * 5 exercises = ~120,000 rows per session.
   - What's unclear: Supabase row limits on free/pro tier, RPC function limits for aggregation queries.
   - Recommendation: Use `rep_summaries` pre-computed table for dashboard, only fetch `rep_telemetry` for individual force curve views. Consider Supabase RPC functions for server-side downsampling if client LTTB isn't enough.

3. **Muscle group taxonomy**
   - What we know: Current codebase uses 6 groups (Chest, Back, Legs, Shoulders, Arms, Core) in `SessionDetail.tsx` and `Analytics.tsx`.
   - What's unclear: Whether the body heatmap (BIO-11) needs finer granularity (e.g., Arms -> biceps, triceps, forearm).
   - Recommendation: Keep the 6-group taxonomy for data storage; create a mapping layer for the heatmap SVG that splits composite groups into visual regions.

4. **Summary report delivery (BIO-13)**
   - What we know: Requirement says "weekly/monthly summary reports" with volume, frequency, PRs, consistency score.
   - What's unclear: Is this an in-app view only, or also email/PDF export?
   - Recommendation: Build as in-app cards/views first. Defer email/PDF to a future phase.

## Sources

### Primary (HIGH confidence)
- [visx GitHub repository](https://github.com/airbnb/visx) - Package list, API structure, version 3.x
- [visx official site](https://visx.airbnb.tech/) - Documentation and examples
- [downsample npm](https://www.npmjs.com/package/downsample) - LTTB API: `createLTTB` with custom point types, v1.4.x
- [Airbnb Engineering Blog - Introducing visx](https://medium.com/airbnb-engineering/introducing-visx-from-airbnb-fd6155ac4658) - Design philosophy, React integration approach

### Secondary (MEDIUM confidence)
- [Science for Sport - VBT](https://www.scienceforsport.com/velocity-based-training/) - VBT zone thresholds verified with strength-velocity continuum table
- [VBT Coach - Bryan Mann's 5 Speed Zones](https://www.vbtcoach.com/blog/velocity-zones-part-1) - Dr. Bryan Mann's velocity zone thresholds (0-0.5, 0.5-0.75, 0.75-1.0, 1.0-1.3, 1.3+ m/s)
- [Wikipedia - One-repetition maximum](https://en.wikipedia.org/wiki/One-repetition_maximum) - Epley formula: `weight * (1 + reps / 30)`
- [react-body-highlighter GitHub](https://github.com/giavinh79/react-body-highlighter) - Muscle groups API, SVG body map approach
- [visx GitHub Issue #819](https://github.com/airbnb/visx/issues/819) - Performance optimization (`shapeRendering="optimizeSpeed"`)
- [visx GitHub Discussion #1411](https://github.com/airbnb/visx/discussions/1411) - AreaClosed + LinePath layering pattern for gradient fills

### Tertiary (LOW confidence)
- VBT zone thresholds are validated by multiple sports science sources but are GENERAL -- exercise-specific accuracy requires individual athlete calibration. Acceptable for v1 but should be labeled as "general zones."
- `react-body-highlighter` TypeScript types and muscle group list (18 groups) -- verified via GitHub README, not via direct npm install test.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - visx is the established React low-level viz library, well-documented, active maintenance
- Architecture: MEDIUM - Telemetry schema is logical but untested against actual Vitruvian data format; query patterns follow established project conventions
- Pitfalls: MEDIUM - Performance concerns verified via GitHub issues; dual-cable handling based on existing `WEIGHT_MULTIPLIER` pattern in codebase
- VBT zones: MEDIUM - Based on published sports science, multiple sources agree on Dr. Mann's thresholds, but exercise-specificity is a known limitation
- Body heatmap: LOW - Custom vs third-party decision not fully validated; react-body-highlighter not install-tested

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (visx is stable; VBT thresholds are long-established science)
