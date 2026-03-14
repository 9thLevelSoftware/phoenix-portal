---
phase: 18-data-visualization-styling
milestone: v1.2
depends_on: [15-navigation-layout-shell]
total_plans: 3
total_waves: 2
requirements: [VIZ-01, VIZ-02, VIZ-03, VIZ-04, VIZ-05, VIZ-06, VIZ-07, VIZ-08, VIZ-09]
---

# Phase 18: Data Visualization Styling — Context

## Phase Goal

Every Recharts chart uses a shared branded tooltip component; axes and gridlines are styled consistently across all chart files; charts animate in on mount; the analytics pie chart is a donut with a center label; the muscle heatmap back regions display correctly.

## Requirements

- **VIZ-01**: Custom branded `<ChartTooltip>` component replaces all inline `contentStyle` tooltip configs
- **VIZ-02**: Chart axes styled: `tickLine={false}`, `axisLine={false}`, consistent font size/color across all charts
- **VIZ-03**: CartesianGrid standardized to `strokeOpacity={0.3}` across all chart files
- **VIZ-04**: All Recharts charts have explicit `animationDuration={800}` and `animationEasing="ease-out"`
- **VIZ-05**: Pie chart converted to donut (`innerRadius={60}`) with center label showing dominant category
- **VIZ-06**: Default `fill="#8884d8"` removed from Analytics pie chart
- **VIZ-07**: Muscle heatmap back regions fixed — proper SVG paths or front/back toggle added
- **VIZ-08**: ExerciseProgress stat values increased to `text-4xl font-bold` with color-coded delta pill
- **VIZ-09**: Chart axis labels specify `fontFamily` and `fontSize` explicitly (not browser default)

## Existing Assets

### Chart infrastructure
- **Recharts 3** — used in Analytics.tsx, Dashboard.tsx, ExerciseProgress.tsx, SummaryReport.tsx, SessionDetail.tsx, WorkoutHistory.tsx
- **visx** — used in premium charts (ForceCurve, PowerOutput, VelocityProfile, AsymmetryGauge, RomTrend) with its own ChartTooltip wrapper
- **ChartTheme.ts** — `src/app/components/charts/shared/ChartTheme.ts` with CHART_COLORS, CHART_MARGINS, FONT_SIZES constants
- **PHOENIX constants** — hex constants used across chart files (ember, gold, flameRed, forgeGreen, mutedForeground)

### Current state (from research)
- **8 inline contentStyle instances** in Analytics.tsx with hardcoded `#374151` border
- **Desktop pie chart** uses `fill="#8884d8"` (default Recharts blue) — no innerRadius, no center label
- **Mobile pie chart** already has `innerRadius={50}` — is already a donut
- **Muscle heatmap** has front view only — no back body SVG paths
- **ExerciseProgress** uses `text-2xl font-semibold` for stats — needs upgrade to `text-4xl font-bold`
- **Axis styling inconsistent** — ExerciseProgress has `tick={{ fontSize: 11 }}`, Dashboard omits it
- **CartesianGrid strokeOpacity** varies across files

### visx charts are OUT OF SCOPE
- visx charts (ForceCurve, PowerOutput, etc.) already have their own ChartTooltip wrapper and CHART_COLORS
- ChartTheme.ts hex constants are permanent — SVG cannot resolve CSS vars in presentation attributes
- Do NOT modify visx chart files in this phase

## Architecture Decisions

- **Shared Recharts tooltip component**: Create at `src/app/components/charts/shared/RechartsTooltip.tsx` — separate from visx ChartTooltip
- **Recharts animation props**: Apply `animationDuration={800} animationEasing="ease-out"` to chart container components (AreaChart, BarChart, PieChart), not individual data series
- **Muscle heatmap**: Add front/back toggle (tab or button) with separate SVG path sets for back body regions
- **Donut center label**: Use Recharts `customizedLabel` or absolute-positioned div inside ResponsiveContainer

## Plan Structure

| Plan | Wave | Name | Requirements | Agent |
|------|------|------|-------------|-------|
| 18-01 | 1 | Branded ChartTooltip & Axis Standardization | VIZ-01, VIZ-02, VIZ-03, VIZ-09 | engineering-frontend-developer |
| 18-02 | 2 | Chart Animations & Donut Conversion | VIZ-04, VIZ-05, VIZ-06 | engineering-frontend-developer |
| 18-03 | 2 | Muscle Heatmap Fix & ExerciseProgress Styling | VIZ-07, VIZ-08 | engineering-frontend-developer |

## Constraints

- visx ChartTheme.ts hex constants are permanent — do NOT replace with var(--primary)
- Bundle gate: main chunk under 150KB (pre-existing; noted in Phase 17)
- Do NOT modify visx chart components — only Recharts charts
- Muscle heatmap SVG paths must be anatomically reasonable (not random shapes)

---
*Generated: 2026-03-13*
