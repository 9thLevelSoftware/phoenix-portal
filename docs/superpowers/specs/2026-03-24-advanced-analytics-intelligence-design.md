# Advanced Analytics & Training Intelligence — Design Spec

**Date:** 2026-03-24
**Status:** Draft
**Scope:** Phoenix Portal — Analytics Hub Body Tab enhancement + Recommendation Engine

## Problem Statement

The portal's analytics are data-rich but passive. Users see charts but aren't told what to do with the data. Competing dashboards (community-built alternatives) offer features like exercise-level muscle activation maps, per-muscle-group recovery tracking, and scientific volume threshold visualizations that make training data actionable. The portal needs to evolve from a visualization dashboard into a training intelligence system to justify subscription value.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | Body Tab as Intelligence Hub (Approach A) | Co-locates intelligence with the data it describes; strongest "aha" moment for users |
| Tier strategy | Exercise Deep-Dive + Volume Landmarks = FLAME; SRA + Recommendations = INFERNO | Data visualization at FLAME, AI-driven intelligence at INFERNO |
| Exercise-muscle data | Static TypeScript lookup table | Fast, no migration needed, no additional query per page load, easy to maintain |
| Volume landmark values | Hardcoded RP research defaults | Phase 1 ships population averages; user-adjustable thresholds deferred |
| Recommendation UX | Inline contextual callouts + aggregated panel | Inline hints drive discovery; panel is the action center |
| Computation split | Client-side for real-time (SRA, volume); edge function for trend analysis (plateaus, imbalances) | Time-sensitive data computed on load; heavy analysis runs periodically |
| AI Coach | Out of scope | Deferred to a future phase when INFERNO tier has enough foundational value |

## Feature 1: Exercise Deep-Dive (FLAME)

### Interaction Flow

1. User opens Analytics > Body tab
2. Body map displays with existing heatmap coloring + new prompt: "Select a muscle group to explore"
3. User clicks a muscle group on the body map (e.g., Chest)
4. An Exercise Deep-Dive panel slides in below the body map
5. Panel shows exercises the user has actually performed for that muscle group
6. First exercise auto-selected; user can click others in the list
7. "Clear selection" button collapses the panel

### Exercise Deep-Dive Panel Contents

**Exercise List** (left column):
- Filtered to exercises the user has performed that target the selected muscle group
- Uses the exercise-muscle activation map to determine which exercises belong
- Sorted by frequency (most performed first)
- Clicking an exercise swaps the detail view

**Activation Profile** (top right):
- Shows primary and secondary muscle groups for the selected exercise
- Color-coded dots with percentage labels (e.g., Chest 100%, Triceps 35%, Shoulders 25%)
- Data from the static exercise-muscle map

**Estimated 1RM Trend** (mid right):
- Recharts area chart showing 1RM progression over time
- Time range toggles: 3M, 6M, 1Y, All
- Delta indicator showing % change over selected period
- Uses existing `exerciseProgressOptions` query with 1RM data

**Stats Row** (bottom right):
- Current estimated 1RM (latest value)
- Period change % (positive/negative with color)
- Total sessions including this exercise
- PRs achieved in current period

### Volume Landmarks Integration

When a muscle group is selected on the body map, the Volume Landmarks section below highlights that muscle group's row and dims others. This creates a visual connection between the drill-down and the volume status.

## Feature 2: Volume Landmarks (FLAME)

### Visualization

A section below the body map showing weekly set volume per muscle group relative to MEV/MAV/MRV thresholds.

**Per-muscle-group bar:**
- Horizontal bar representing current weekly sets
- Three vertical threshold markers: MEV (amber), MAV zone (green shaded region), MRV (red)
- Bar color indicates status:
  - Below MEV: amber (insufficient volume)
  - In MAV zone: green (optimal)
  - Between MAV and MRV: blue (high but recoverable)
  - Above MRV: red (overtraining risk)
- Set count displayed at right
- Status icon: checkmark (optimal), warning (too high/low)

**Inline recommendations** (below the chart):
- Colored callout bars with specific actions
- Example: "Back volume exceeds MRV (22/20 sets) — reduce by 4 sets next week"
- Example: "Shoulders below MEV (6/8 sets) — add 2-4 sets to maintain progress"
- Only shown when volume is outside MEV-MRV range

### Volume Computation

Weekly **direct set count** per muscle group, computed client-side from data fetched by the new `bodyIntelligenceOptions` query (see Data Access Layer section below).

**Important: Only primary muscle activation counts toward volume landmarks.** RP research defines MEV/MAV/MRV in terms of *direct sets* — sets where the muscle is a primary mover. Secondary activation (e.g., triceps during bench press) does not count. This ensures the computed volumes are comparable to published RP thresholds. Secondary activation data is still displayed in the Exercise Deep-Dive's activation profile but does not inflate volume numbers.

1. Fetch exercises + set counts for sessions in the last 7 days (via `bodyIntelligenceOptions` query)
2. For each exercise, look up its primary muscle group in the activation map
3. Count the exercise's sets toward the primary muscle group only
4. Exercises not in the activation map use their DB `muscle_group` field
5. Sum per muscle group across all sessions in the 7-day window

### Data Module: `src/lib/volume-landmarks.ts`

```typescript
interface VolumeLandmark {
  muscleGroup: string;
  mev: number;      // Minimum Effective Volume (sets/week)
  mavLow: number;   // MAV range start
  mavHigh: number;  // MAV range end
  mrv: number;      // Maximum Recoverable Volume (sets/week)
}

// Research-derived defaults (Renaissance Periodization)
const VOLUME_LANDMARKS: VolumeLandmark[] = [
  { muscleGroup: "Chest",     mev: 10, mavLow: 14, mavHigh: 18, mrv: 22 },
  { muscleGroup: "Back",      mev: 10, mavLow: 14, mavHigh: 20, mrv: 24 },
  { muscleGroup: "Shoulders", mev: 8,  mavLow: 12, mavHigh: 16, mrv: 22 },
  { muscleGroup: "Legs",      mev: 8,  mavLow: 12, mavHigh: 16, mrv: 20 },
  { muscleGroup: "Arms",      mev: 6,  mavLow: 10, mavHigh: 14, mrv: 20 },
  { muscleGroup: "Core",      mev: 0,  mavLow: 6,  mavHigh: 12, mrv: 18 },
];
```

## Feature 3: SRA Recovery Matrix (INFERNO)

### Recovery Model

Per-muscle-group recovery estimation computed client-side on each page load.

**Inputs:**
- Time since last trained (hours) — from most recent workout session containing exercises for that muscle group
- Volume in last session — set count for that muscle group (weighted by activation %)
- Intensity proxy — average weight as % of estimated 1RM for exercises in that group
- Base recovery window — exercise-science defaults per muscle group

**Base Recovery Windows:**

Each muscle group has a single base recovery value (midpoint of the exercise-science range). Modifiers are additive.

| Muscle Group | Base Recovery (hours) | Heavy Modifier | High Volume Modifier |
|---|---|---|---|
| Chest | 60 | +12h | +8h |
| Back | 60 | +12h | +8h |
| Shoulders | 42 | +8h | +6h |
| Legs (Quads/Glutes) | 84 | +16h | +12h |
| Arms | 36 | +6h | +4h |
| Core | 30 | +4h | +4h |

**Recovery calculation:** `estimatedRecoveryHours = base + (isHeavy ? heavyMod : 0) + (isHighVolume ? volumeMod : 0)`

**Heavy** = average working weight > 85% of estimated 1RM for exercises in that group
**High Volume** = direct sets exceeded MAV for that muscle group

**Intensity computation:** Requires per-set weight data from the `sessionSetWeightsOptions` query (see Data Access Layer). For each exercise in the last session targeting a muscle group, compute `avgWeight / estimated1RM`. If no 1RM data exists for an exercise (common for new exercises or external syncs), the intensity modifier is skipped (conservative default: not heavy).

**Output States:**

| State | Condition | Color | Description |
|---|---|---|---|
| FATIGUED | < 33% of estimated recovery elapsed | Red (#DC2626) | Still accumulating fatigue |
| RECOVERING | 33-80% of recovery elapsed | Amber (#F59E0B) | Actively recovering, not ready |
| RECOVERED | 80-120% of recovery elapsed | Green (#10B981) | Recovered, can train productively |
| SUPERCOMPENSATED | > 120% of recovery elapsed | Blue (#60A5FA) | Peak adaptation window, ideal to train |

### Visualization

A 2-column grid of muscle group cards, each showing:
- Status dot (colored by state)
- Muscle group name
- Status label ("Fatigued", "Recovering", "Recovered", "Supercompensated")
- Time since last session
- Estimated time remaining (for FATIGUED and RECOVERING states)

Below the grid, inline recommendations:
- "Chest is in its optimal training window — prioritize today for maximum adaptation"
- "Next optimal session: Chest + Legs (both recovered). Avoid Back for ~40 more hours."

### Subscription Gating

FLAME users see the SRA section with a blurred overlay (`backdrop-filter: blur(8px)`) and a semi-transparent CTA card: "Unlock Training Intelligence — Upgrade to Inferno". The section renders with real data structure so the blur reveals the shape of actual content, demonstrating value.

### Data Module: `src/lib/sra-recovery.ts`

```typescript
type SraStatus = "FATIGUED" | "RECOVERING" | "RECOVERED" | "SUPERCOMPENSATED";

interface MuscleRecovery {
  muscleGroup: string;
  status: SraStatus;
  hoursSinceLastTrained: number;
  estimatedRecoveryHours: number;
  hoursRemaining: number | null;  // null when recovered/supercompensated
  lastSessionVolume: number;      // sets
  lastSessionIntensity: number;   // % of 1RM
}
```

## Feature 4: Recommendation Engine (INFERNO)

### Signal Sources

| Signal | Data Source | Computation | Priority |
|---|---|---|---|
| Volume vs MRV | Volume Landmarks calc | Client-side | Critical (red) |
| Volume below MEV | Volume Landmarks calc | Client-side | Actionable (amber) |
| SRA: muscle ready | SRA Recovery calc | Client-side | Actionable (amber) |
| SRA: muscle fatigued | SRA Recovery calc | Client-side | Info (blue) |
| Velocity decline | `velocity_loss_pct` from sessions | Client-side | Actionable (amber) |
| ACWR overreach | Existing ACWR from Recovery | Client-side | Critical (red) |
| Plateau detected | 1RM stalled >3 weeks | Edge function | Actionable (amber) |
| Muscle imbalance | Volume distribution skew | Edge function | Actionable (amber) |
| Consistency drop | Workout frequency decline | Edge function | Actionable (amber) |
| PR achievement | New records | Edge function | Positive (green) |
| Streak milestone | Streak days | Edge function | Positive (green) |
| Optimal next session | SRA + recovery combined | Client-side | Positive (green) |

### Recommendation Structure

```typescript
interface Recommendation {
  id: string;
  priority: "critical" | "actionable" | "info" | "positive";
  signal: string;           // e.g., "volume_above_mrv"
  muscleGroup?: string;     // if muscle-specific
  title: string;            // one-line summary
  action: string;           // specific instruction
  metric?: {
    current: number;
    threshold: number;
    unit: string;
  };
}
```

### Display Locations

**Inline callouts:** Rendered directly beneath the relevant section:
- Volume Landmark callouts appear below the Volume Landmarks chart
- SRA callouts appear below the SRA Recovery Matrix
- Styled as colored left-border bars with icon, message, and action

**Aggregated Recommendations Panel:** Collapsible section at the bottom of the Body tab:
- Sorted by priority: Critical > Actionable > Info > Positive
- Each recommendation is a card with title, action, and optional metric
- Max 8 recommendations shown; "Show all" expands if more exist
- INFERNO-gated with the same blurred preview pattern as SRA

### Edge Function Expansion

The existing `generate-insights` edge function (`supabase/functions/generate-insights/index.ts`) is expanded:
- Current 6 rules remain
- New rules added for plateau detection, muscle imbalance, and cross-session trend analysis
- Output format unchanged (`user_insights` table)
- Triggered by: (1) the `mobile-sync-push` edge function calls `generate-insights` after a successful push, and (2) a Supabase pg_cron job runs it daily at 04:00 UTC for all active users
- Client-side recommendations (volume, SRA, ACWR) are computed fresh on each page load and merged with cached edge function results from the `user_insights` table
- The existing `generate-insights` already has plateau detection and muscle imbalance rules; these are enhanced with more granular thresholds, not replaced

## Feature 5: Exercise-Muscle Activation Map

### Data Module: `src/lib/exercise-muscles.ts`

Static TypeScript module with ~80 exercise mappings.

```typescript
interface MuscleActivation {
  group: string;          // MUST use the 6 parent groups: Chest, Back, Shoulders, Arms, Legs, Core
  displayName?: string;   // Optional display label (e.g., "Triceps", "Biceps") for UI; group is used for computation
  activation: number;     // 0.0 - 1.0 (display only; volume landmarks use primary group at 100%)
}

interface ExerciseProfile {
  primary: MuscleActivation;
  secondary: MuscleActivation[];
}

// Fallback: exercises not in the map use their DB muscle_group at 100%
function getExerciseProfile(exerciseName: string, dbMuscleGroup?: string): ExerciseProfile
```

**Coverage:**
- All standard Vitruvian Trainer exercises
- Common free-weight and bodyweight exercises synced from external integrations
- Name normalization for matching: lowercase, trim whitespace, strip common prefixes ("db ", "bb ", "cable ", "machine ", "seated ", "standing "), strip parenthetical suffixes. Token-overlap matching as fallback (if >70% of tokens match a known exercise, use that profile). If no match found, fall back to the exercise's DB `muscle_group` field at 100% activation with no secondaries.

**Muscle group taxonomy** (6 parent groups, matches existing `muscleSlugToGroup` mapping):
- Chest, Back, Shoulders, Arms (Biceps + Triceps + Forearms), Legs (Quads + Hamstrings + Calves + Glutes), Core
- All `MuscleActivation.group` values MUST use these 6 parent groups, not sub-groups
- The activation map's `secondary` entries use the parent `group` for computation but can set `displayName` for UI specificity (e.g., `{ group: "Arms", displayName: "Triceps", activation: 0.35 }`)

## Data Access Layer

### New Query: `src/queries/body-intelligence.ts`

A dedicated query file providing the data foundation for Volume Landmarks, SRA Recovery, and Exercise Deep-Dive. The existing analytics queries return session-level aggregates; these features need exercise-level and set-level data.

```typescript
// Fetches exercises with set counts and avg weight for sessions in a date range
// Used by: Volume Landmarks (set counts per muscle group), SRA (intensity calc), Exercise Deep-Dive (exercise list)
export function bodyIntelligenceOptions(userId: string, days: number, profileId?: string) {
  return queryOptions({
    queryKey: queryKeys.analytics.bodyIntelligence(userId, days, profileId),
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - days);
      // Join: workout_sessions -> exercises -> sets (aggregated)
      const { data } = await supabase
        .from("exercises")
        .select(`
          id, name, muscle_group, session_id,
          sets(count),
          workout_sessions!inner(started_at, user_id)
        `)
        .eq("workout_sessions.user_id", userId)
        .gte("workout_sessions.started_at", since.toISOString())
        .order("workout_sessions.started_at", { ascending: false });
      return data;
    },
  });
}

// Fetches per-set weight data for a specific session (for SRA intensity calculation)
export function sessionSetWeightsOptions(sessionId: string) {
  return queryOptions({
    queryKey: queryKeys.analytics.sessionSetWeights(sessionId),
    queryFn: async () => {
      const { data } = await supabase
        .from("sets")
        .select("id, exercise_id, weight_kg, actual_reps, exercises!inner(name, muscle_group)")
        .eq("exercises.session_id", sessionId);
      return data;
    },
  });
}
```

### Query Key Additions (`src/queries/keys.ts`)

New keys added under the `analytics` namespace:

```typescript
analytics: {
  // ... existing keys
  bodyIntelligence: (userId: string, days: number, profileId?: string) =>
    [...queryKeys.analytics.all, "body-intelligence", userId, days, profileId] as const,
  sessionSetWeights: (sessionId: string) =>
    [...queryKeys.analytics.all, "session-set-weights", sessionId] as const,
}
```

### Weight Unit Handling

All weight values displayed in the Exercise Deep-Dive (current 1RM, stats) use the existing `convertWeight(value, unit)` utility from `src/lib/units.ts`, reading the user's preferred unit from their profile (`profile.weight_unit`). Volume Landmark thresholds are in **sets per week** (unit-agnostic). SRA intensity computation uses raw `weight_kg` from the database (per-cable, matching the `WEIGHT_MULTIPLIER` convention in `transforms.ts`).

## Subscription Gating UX

### All Tiers (Body Tab)

| Section | FREE/EMBER | FLAME | INFERNO |
|---|---|---|---|
| Muscle Balance Radar | Not accessible (route is FLAME-gated) | Yes | Yes |
| Muscle Distribution Donut | Not accessible | Yes | Yes |
| Muscle Group Breakdown | Not accessible | Yes | Yes |
| Body Map (clickable) | Not accessible | Yes | Yes |
| Exercise Deep-Dive | Not accessible | Yes | Yes |
| Volume Landmarks | Not accessible | Yes (with inline callouts) | Yes |
| SRA Recovery Matrix | Not accessible | Blurred preview + upgrade CTA | Yes |
| Recommendations Panel | Not accessible | Blurred preview + upgrade CTA | Yes |

FREE and EMBER users never see the Body tab because the entire `/analytics` route is FLAME-gated (in `routes/index.tsx`).

### INFERNO Users (Body Tab)

All sections fully visible and interactive.

### Blurred Preview Pattern

```tsx
<div className="relative">
  {/* Render with real data, always */}
  <SraRecoveryMatrix data={sraData} />

  {/* Overlay for non-INFERNO users */}
  {!isInferno && (
    <div className="absolute inset-0 backdrop-blur-[8px] bg-surface-2/60 flex items-center justify-center rounded-lg">
      <Card className="p-6 text-center max-w-sm">
        <h3>Unlock Training Intelligence</h3>
        <p>SRA Recovery tracking tells you exactly when each muscle group is ready to train again.</p>
        <Button variant="cta" asChild>
          <Link to="/pricing">Upgrade to Inferno</Link>
        </Button>
      </Card>
    </div>
  )}
</div>
```

### Mobile Body Tab Fix

The current `MobileBodyTab.tsx` wraps the Biomechanics link section in `<SubscriptionGate requiredTier="INFERNO">` (lines 80-87). This gate is removed — the Biomechanics page has its own gate. The mobile Body tab follows the same FLAME/INFERNO split as desktop — Exercise Deep-Dive and Volume Landmarks are visible, SRA and Recommendations show blurred previews.

## File Changes Summary

### New Files (9)

| File | Purpose |
|---|---|
| `src/lib/exercise-muscles.ts` | Static exercise→muscle activation mapping (~80 exercises) |
| `src/lib/volume-landmarks.ts` | MEV/MAV/MRV defaults + volume computation logic |
| `src/lib/sra-recovery.ts` | SRA recovery status computation |
| `src/lib/recommendations.ts` | Client-side recommendation aggregation engine |
| `src/queries/body-intelligence.ts` | New TanStack Query hooks for exercise/set-level data |
| `src/app/components/analytics/ExerciseDeepDive.tsx` | Exercise drill-down panel |
| `src/app/components/analytics/VolumeLandmarks.tsx` | Volume threshold visualization |
| `src/app/components/analytics/SraRecoveryMatrix.tsx` | Per-muscle recovery grid |
| `src/app/components/analytics/RecommendationsPanel.tsx` | Aggregated recommendations |

### Modified Files (7)

| File | Changes |
|---|---|
| `src/app/components/analytics/BodyTab.tsx` | Integrate new components, add muscle selection state, pass new props |
| `src/app/components/analytics/MobileBodyTab.tsx` | Remove Biomechanics INFERNO gate, add responsive versions of new components |
| `src/app/components/Analytics.tsx` | Add bodyIntelligenceOptions query, compute props for new sections |
| `src/queries/keys.ts` | Add `bodyIntelligence` and `sessionSetWeights` query keys under analytics namespace |
| `src/schemas/transforms.ts` | Add Zod schemas for volume landmarks + SRA data validation |
| `supabase/functions/generate-insights/index.ts` | Enhance existing rules with granular thresholds + new cross-session signals |
| `supabase/functions/mobile-sync-push/index.ts` | Add call to generate-insights after successful push |

## Error & Empty States

| Scenario | Behavior |
|---|---|
| No sessions in last 7 days | Volume Landmarks shows all bars at 0 with message: "No workouts this week — train to see your volume status" |
| Muscle group never trained | SRA shows "No data" with muted styling; Exercise Deep-Dive shows empty list with prompt |
| No 1RM data for an exercise | Exercise Deep-Dive shows "Not enough data for 1RM estimate" instead of chart; SRA skips intensity modifier (assumes not heavy) |
| Exercise not in activation map, DB `muscle_group` is null | Exercise attributed to "General" category; excluded from Volume Landmarks; still appears in Exercise Deep-Dive under a "General" group |
| All muscle groups recovered | SRA shows all green; recommendations panel shows "All muscle groups recovered — great time for a full-body session" |
| User has <3 sessions total | Volume Landmarks and SRA show with a disclaimer banner: "Accuracy improves with more training history" |

## Accessibility

- All color-coded status indicators include text labels (not color alone)
- SRA status dots have `aria-label` attributes describing the state
- Body map muscle selection is keyboard-accessible (tab + enter to select)
- Blurred preview overlay has `role="region"` and `aria-label="Premium feature preview"`
- Inline recommendation callouts use `role="alert"` for screen readers

## Performance Considerations

- Exercise activation map is a static import (~5KB gzipped for 80 exercises); no runtime fetch
- `bodyIntelligenceOptions` query is memoized via TanStack Query with a 5-minute stale time
- SRA and volume computations are wrapped in `useMemo` with dependency on query data
- New components (ExerciseDeepDive, SraRecoveryMatrix, RecommendationsPanel) are lazy-loaded within BodyTab
- Skeleton loading states for each new section while queries are pending

## Testing Strategy

- Unit tests for `exercise-muscles.ts` (mapping coverage, fuzzy matching, fallback behavior)
- Unit tests for `volume-landmarks.ts` (volume computation, threshold classification)
- Unit tests for `sra-recovery.ts` (status transitions, modifier calculations)
- Unit tests for `recommendations.ts` (signal aggregation, priority sorting, deduplication)
- Component tests for ExerciseDeepDive, VolumeLandmarks, SraRecoveryMatrix
- Integration test for the full Body tab with mocked query data
- E2E test for the drill-down interaction flow (click muscle → see exercises → click exercise → see detail)

## Out of Scope

- AI Training Coach (conversational chat interface) — deferred to future phase
- User-adjustable volume landmark thresholds — deferred; hardcoded defaults for Phase 1
- Wearable data integration into SRA model (HRV, sleep) — future enhancement
- Community-contributed exercise-muscle mappings — future enhancement
- Exercise comparison (side-by-side two exercises) — future enhancement

## Open Questions

None — all design decisions resolved during brainstorming. Review issues addressed in revision 2.
