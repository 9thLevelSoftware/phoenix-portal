# Analytics Enhancement Design Spec

## Overview

Redesign the Phoenix Portal Analytics Hub to transform it from a sparse, generic dashboard into a premium, information-dense analytics experience that justifies subscription pricing. The enhancement covers four areas: charting library upgrade (Recharts → Apache ECharts), a rule-based training intelligence engine, community benchmarking, and biomechanics form analysis.

## Goals

- Make the analytics page worth the subscription price at every tier
- Provide actionable insights, not just raw data
- Progressive disclosure: approachable for casual users, deep for power users
- Differentiate from free fitness apps with unique derived metrics
- Zero ongoing tooling costs (all open-source)

## Non-Goals

- LLM-powered coaching (deferred; can be added later as Inferno feature)
- 3D anatomy visualization (out of scope)
- Real-time streaming charts (not needed for post-workout analysis)
- External activities tab as standalone (folded into Overview)

## Constraints

- Budget: under $50/mo in tooling (targeting $0/mo with all open-source)
- Existing visx charts for force curves and biomechanics stay (already built)
- Must work on both desktop and mobile (768px breakpoint)
- Data comes from Vitruvian machine sync via mobile app — portal is read-only for workout data

---

## Architecture

### Charting Stack

| Library | Purpose | Status |
|---------|---------|--------|
| **Apache ECharts** (via `echarts-for-react`) | All new charts: gauges, radar, calendar heatmap, distribution curves, area/bar combos | New |
| **visx** | Force curves, asymmetry gauge (existing specialized charts) | Keep |
| **Recharts** | Incrementally replaced tab-by-tab | Remove over time |

ECharts chosen for: GPU-accelerated Canvas rendering, built-in dark theme, 40+ chart types (gauge, radar, calendar, sunburst), 100K+ datapoint performance, zero cost.

### Shared Theme: `src/app/components/charts/shared/EChartsTheme.ts`

Extends existing `ChartTheme.ts` constants into ECharts theme format:
- Background: `#0D0D0D`
- Card background: `#1a1a1a`
- Border: `#2a2a2a`
- Primary/Ember: `#FF6B35`
- Flame Red: `#DC2626`
- Gold: `#F59E0B`
- Forge Green: `#10B981`
- Accent: `#6366F1`
- Axis/grid: `#333`

### New Dependencies

| Package | Purpose | License | Size |
|---------|---------|---------|------|
| `echarts` | Charting engine | Apache 2.0 | ~800KB (tree-shakeable) |
| `echarts-for-react` | React wrapper | MIT | ~5KB |
| `react-muscle-highlighter` | Anatomical body heatmap (verify npm availability and theming API before implementation) | MIT | ~50KB |

---

## Tab Restructure

Consolidate from 7 tabs → 4 tabs:

| Tab | Merges | Tier | Content |
|-----|--------|------|---------|
| **Overview** | Overview + External | Flame | Hero stats, volume trend, muscle distribution, consistency widget, training load gauge, insights feed |
| **Progress** | Strength Progress + Trends & Insights | Flame | 1RM progression, exercise trends, PR timeline, plateau detection, period comparisons |
| **Body** | Body Part Analysis + Biomechanics (teaser) | Flame (biomechanics = Inferno) | Muscle balance radar, interactive body heatmap, muscle group breakdown table, biomechanics upgrade teaser |
| **Performance** | Performance (expanded) | Inferno | Community rankings, velocity/power/TUT, force curves, L/R asymmetry, ROM, form analysis, training efficiency |

External activities data folds into Overview's Activity Sources card rather than having its own tab.

---

## Tab Designs

### Overview Tab

**Hero Stats Row** — 5 cards, each with:
- Metric value
- Sparkline (inline trend chart)
- Period comparison delta (▲/▼ % vs previous period)
- Cards: Total Volume, Workouts, Training Load, PRs This Period, Streak

**Training Load Gauge** (ECharts gauge chart):
- Resistance Training Load (RTL) score 0-100
- Calculated from: volume × intensity × frequency over the period
- Three zones: Low (green), Optimal (yellow), High (red)
- Contextual label: "You're in the optimal training zone"

**Volume Over Time** (ECharts area + bar combo):
- Dual-axis: area chart for cumulative volume, bar overlay for session count per week
- Gradient fill using ember palette
- Tooltip shows volume, session count, and avg volume per session

**Muscle Distribution** (ECharts donut):
- Percentage breakdown by muscle group
- Uses `MUSCLE_GROUP_COLORS` palette
- Click a segment to filter to that group

**Consistency Widget** — hybrid of goal rings + frequency stats:
- **Weekly Goal Rings**: Apple Watch-style concentric rings (this week, last week, 2 weeks ago) showing progress toward weekly workout target
- **Stats below rings**: avg workouts/week, consistency hit rate (% of weeks meeting goal), most active day

**Insights Feed** — 3-4 contextual cards from the rule engine:
- Color-coded by type: success (green), warning (yellow), info (blue), achievement (ember)
- Each card has: icon, title, 1-2 sentence description with actionable recommendation
- Example insights: "Volume Trending Up", "Leg Day Deficit", "New PR: Bench Press (top 15%)", "12-Day Streak"

### Progress Tab

**Exercise Selector + 1RM Progression** (ECharts line chart):
- Dropdown to pick exercise or "Top 3" auto-selection
- Line chart with estimated 1RM over time per exercise
- Period comparison overlay toggle: ghost previous period's data
- Plateau detection: highlighted range on chart with warning band when a lift has been flat 3+ weeks

**Volume & Frequency Trends** (ECharts area chart):
- Volume trend with moving average line overlay
- Training density metric: volume per minute of training
- Week-over-week comparison cards: delta cards for volume, sets, reps, avg weight

**PR Timeline**:
- Horizontal timeline with PR markers
- Click a PR for exercise, weight, date, and comparison to previous record
- "Days since last PR" counter

### Body Tab

**Muscle Balance Radar** (ECharts radar chart):
- 6-axis hexagonal radar: Chest, Back, Arms, Legs, Core, Shoulders
- Current period fill (ember) + previous period ghost overlay (dashed gray)
- Warning icon on undertrained axes (below threshold relative to strongest group)

**Interactive Body Heatmap** (`react-muscle-highlighter`):
- Anatomical SVG with individual muscle shapes
- Color intensity driven by volume (cold = undertrained, hot = high volume)
- Front/Back toggle
- Click a muscle region to filter the breakdown table
- Themed with Phoenix ember palette

**Muscle Group Breakdown Table**:
- Columns: Group, Volume, Sets, Sessions, % of Total (with inline progress bar), vs Last Period (▲/▼), Status badge (Balanced/Low/High)
- Sortable by any column

**Biomechanics Teaser** (Inferno-gated):
- Blurred preview of L/R asymmetry, avg ROM, and force consistency metrics
- "Unlock Biomechanics" upgrade CTA overlay
- Shows enough to entice without giving away the content

### Performance Tab

**Session/Exercise Selector**:
- Dropdowns for session date, exercise name
- Set selector pills (Set 1, Set 2, ... All Sets)

**Community Rankings** (available to Flame+ users as a conversion driver):
- 4 percentile cards: exercise-specific (e.g., Bench Press), Weekly Volume, Consistency, Strength Score
- Each card shows: percentile ("Top 15%"), actual value, rank number
- ECharts bell curve distribution with "YOU" marker
- Calculated via aggregate Supabase queries (anonymized, opt-in via `leaderboard_participation` profile setting)

**Velocity Profile** (existing visx chart, enhanced):
- Bar chart with VBT zone color-coding (from `lib/vbt.ts`)
- Background zone bands labeled: Absolute Strength, Accelerative, Strength-Speed, Speed-Strength, Starting Strength
- Contextual insight: "Velocity dropped 34% — high fatigue indicator"

**Power Output** (existing visx chart, enhanced):
- Bar chart per rep with glowing peak highlight (box-shadow)
- Fatigue trend line overlay (dashed)
- Contextual insight: "Peak power on rep 2 — typical potentiation pattern"

**Force Curves** (existing visx chart, enhanced):
- Multi-rep overlay with gradient area fills per rep
- Color-coded legend with peak force per rep
- Overlay All Reps / Normalized Time toggles (already exist)
- Contextual insight: force decay percentage + curve shape assessment

**Left/Right Balance**:
- Overall asymmetry gauge (large percentage, green/yellow/red)
- Per-rep diverging bar chart: left (indigo) vs right (ember)
- Center line + ±10% threshold markers
- Warning card when fatigue-induced asymmetry exceeds threshold

**Range of Motion** (existing visx chart, enhanced):
- Per-rep bars with average line overlay
- Color shifts from green → red when ROM drops significantly
- Contextual insight about range shortening

**Form Analysis** (new — derived from telemetry, no AI API):
- Overall Form Score with letter grade (A+, B+, etc.) in a ring gauge
- Four sub-metrics, each scored 0-100%:
  - **Curve Consistency**: normalized cross-correlation of force curve shapes across reps
  - **Tempo Control**: eccentric vs concentric phase duration ratio from velocity data
  - **Fatigue Resistance**: rate of force/velocity/ROM decay across the set
  - **Bilateral Balance**: L/R asymmetry trend across reps (increasing under fatigue = compensation)
- Each sub-metric has: green/yellow/red dot, name, 1-sentence description, percentage
- Rule-based recommendations: "Drop final rep to maintain form quality", "Add single-arm work for right-side dominance"

**Training Efficiency**:
- Volume per minute (lbs/min) with trend sparkline
- Average rest time (derived from gaps between set timestamps) with trend sparkline
- Session Intensity Score: composite 0-100 in ring gauge (volume × avg intensity ÷ duration)

**Biomechanics Trends**:
- 4 historical sparkline cards: Peak Force, Avg Asymmetry, Form Score, ROM Stability
- Each shows current value, delta vs 4 weeks ago, trend direction

---

## Rule-Based Insights Engine

### Architecture

Supabase Edge Function (`generate-insights`) that:
1. Receives `user_id` and `period` parameters
2. Queries workout data for the period + previous period
3. Runs rule checks and generates insight objects
4. Caches results in a `user_insights` table (refreshed on new sync)

### `user_insights` Table Schema

```sql
CREATE TABLE user_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL, -- 'success', 'warning', 'info', 'achievement'
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  recommendation TEXT,
  metric_name TEXT,
  metric_value NUMERIC,
  metric_unit TEXT,
  metric_delta NUMERIC,
  period TEXT NOT NULL DEFAULT '30d',
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ -- null = until next refresh
);

ALTER TABLE user_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own insights"
  ON user_insights FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX idx_user_insights_user ON user_insights(user_id, created_at DESC);
```

### Insight Rules

| Rule | Trigger | Type | Example |
|------|---------|------|---------|
| Volume Trend | Volume ▲ > 10% or ▼ > 15% vs previous period | success / warning | "Weekly volume increased 12%. Progressive overload on track." |
| Muscle Imbalance | Dominant group > 3× weakest group | warning | "Only 8% of volume targets legs. Add 1-2 leg sessions." |
| Consistency | Avg sessions/week < 3 | warning | "Averaging 2.1 sessions/week. Try to hit 3+ for optimal progress." |
| PR Achievement | New PR in current period | achievement | "New PR: Bench Press 225 lbs (+10 lbs). Top 15% of users." |
| Plateau Detection | Exercise 1RM flat for 3+ weeks | warning | "Bench press has plateaued for 3 weeks. Try paused reps or deload." |
| Streak Milestone | Streak reaches 7, 14, 21, 30 days | achievement | "12-day streak! 9 more to beat your best of 21." |
| Fatigue Asymmetry | L/R asymmetry > 10% on final reps | warning | "Right-side dominance increases under fatigue. Consider unilateral work." |
| Training Load | RTL score enters High zone | warning | "Training load is high. Consider a deload week." |
| Recovery | < 48h between sessions targeting same muscle group | info | "You trained chest again after only 36 hours. Allow 48h for recovery." |

### Insight Object Shape

```typescript
interface TrainingInsight {
  id: string;
  type: 'success' | 'warning' | 'info' | 'achievement';
  title: string;
  description: string;
  recommendation?: string;
  metric?: { name: string; value: number; unit: string; delta?: number };
  createdAt: string;
}
```

---

## Community Benchmarks

### Data Model

New table `community_benchmarks` (materialized via scheduled Edge Function):

```sql
CREATE TABLE community_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_type TEXT NOT NULL, -- 'exercise_1rm', 'weekly_volume', 'consistency', 'strength_score'
  metric_key TEXT,           -- exercise name (for exercise_1rm) or null
  percentile_values JSONB,  -- {p10: 100, p25: 135, p50: 185, p75: 225, p90: 275, ...}
  total_users INT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Calculation

- Scheduled Edge Function runs daily via `pg_cron` (or triggered on-demand via API call)
- Aggregates anonymized data across all users with `leaderboard_participation = true`
- Computes percentile distributions for key metrics
- User's rank is calculated client-side by comparing their value against the distribution

### Privacy

- Opt-in only (existing `leaderboard_participation` profile field)
- No individual user data exposed — only aggregate distributions
- User sees their own rank but cannot see other individual users' data

---

## Form Analysis Algorithms

All computed client-side from existing `rep_summaries` and `rep_telemetry` data:

### Curve Consistency (0-100%)
Compare force curve shapes across reps using normalized cross-correlation on downsampled telemetry. Average pairwise correlation × 100.

### Tempo Control (0-100%)
From velocity data, identify eccentric (negative velocity) and concentric (positive velocity) phase durations. Score based on consistency of the ratio across reps. Even, repeatable ratio = high score.

### Fatigue Resistance (0-100%)
Linear regression on peak force, mean velocity, and ROM across rep numbers. Score = 100 - (decay rate × scaling factor). Slow decay = high score.

### Bilateral Balance (0-100%)
Average absolute asymmetry percentage across all reps, plus a penalty for asymmetry that increases across the set (compensation pattern). Score = 100 - (avg_asymmetry + trend_penalty).

### Overall Form Score
Weighted composite: Curve Consistency (30%) + Tempo Control (25%) + Fatigue Resistance (25%) + Bilateral Balance (20%). Letter grade mapping: A+ (95+), A (90+), A- (85+), B+ (80+), B (75+), B- (70+), C+ (65+), C (60+), C- (55+), D (50+), F (<50).

---

## Demo Data Seeding

SQL migration to populate test account with realistic data:

- **30 workout sessions** across 8 weeks with progressive overload
- **6 muscle groups**: Chest, Back, Legs, Shoulders, Arms, Core
- **15 distinct exercises** with proper muscle group classification
- **Varied session structures**: push/pull/legs split, full body days
- **8 personal records** spread across the period
- **Rep summaries** with velocity, force, power, ROM, TUT, asymmetry for ~10 sessions
- **Rep telemetry** (50Hz force curve data) for 3 sessions (enough to demo biomechanics)
- **Progressive patterns**: volume trending up, a bench press plateau in weeks 4-6, a leg day gap

---

## ECharts Migration Strategy

Incremental, tab-by-tab replacement:

1. Create `EChartsTheme.ts` with Phoenix palette
2. Create shared `EChartsWrapper.tsx` component (handles theme registration, responsive sizing, loading state)
3. Replace Overview tab charts first (highest visibility)
4. Replace Progress tab charts
5. Replace Body tab charts (radar, body heatmap uses react-muscle-highlighter)
6. Add new Performance tab charts (community distribution curves, gauges)
7. Remove Recharts dependency once all charts are migrated

Keep visx for: `ForceCurve.tsx`, `AsymmetryGauge.tsx`, `RomTrend.tsx`, `PowerOutput.tsx`, `VelocityProfile.tsx` — these are already built and specialized.

---

## Mobile Considerations

- 4 tabs work on existing horizontal scroll tab bar
- Hero stat cards → horizontal snap carousel (existing `MobileStatCard` pattern)
- ECharts responsive mode handles chart resizing
- Community ranking cards → vertical stack on mobile
- Form Analysis → collapsed to score + grade, expandable for detail
- Training Load gauge → smaller diameter, same functionality
- Consistency widget → rings smaller, stats below

---

## File Impact

### New Files
- `src/app/components/charts/shared/EChartsTheme.ts`
- `src/app/components/charts/shared/EChartsWrapper.tsx`
- `src/app/components/charts/TrainingLoadGauge.tsx`
- `src/app/components/charts/MuscleRadar.tsx`
- `src/app/components/charts/CommunityDistribution.tsx`
- `src/app/components/charts/ConsistencyWidget.tsx`
- `src/app/components/FormAnalysis.tsx`
- `src/app/components/InsightsFeed.tsx`
- `src/app/components/CommunityRankings.tsx`
- `src/lib/insights.ts` (rule engine logic)
- `src/lib/form-analysis.ts` (form scoring algorithms)
- `src/lib/training-load.ts` (RTL calculation)
- `src/queries/insights.ts`
- `src/queries/benchmarks.ts`
- `supabase/functions/generate-insights/index.ts`
- `supabase/migrations/YYYYMMDD_insights_benchmarks.sql`
- `supabase/migrations/YYYYMMDD_demo_data_seed.sql`

### Modified Files
- `src/app/components/Analytics.tsx` (major refactor — tab restructure, new sections)
- `src/app/components/Analytics.tsx` — handle mobile responsiveness within this file using existing `useIsMobile` hook (no separate AnalyticsMobile.tsx exists)
- `src/app/components/MuscleHeatmap.tsx` (replace with react-muscle-highlighter)
- `src/app/components/Biomechanics.tsx` (enhance with form analysis, move to Performance tab)
- `src/app/components/charts/shared/ChartTheme.ts` (extend for ECharts compatibility)
- `src/queries/analytics.ts` (add period comparison queries)
- `package.json` (add echarts, echarts-for-react, react-muscle-highlighter)

### Removed (after full migration)
- Recharts dependency (deferred until all charts migrated)
