# Charts & Visualization Review

Scope reviewed:
- `src/app/components/charts/AsymmetryGauge.tsx`
- `src/app/components/charts/CommunityDistribution.tsx`
- `src/app/components/charts/ConsistencyWidget.tsx`
- `src/app/components/charts/ForceCurve.tsx`
- `src/app/components/charts/MuscleRadar.tsx`
- `src/app/components/charts/PowerOutput.tsx`
- `src/app/components/charts/TrainingLoadGauge.tsx`
- `src/app/components/charts/VelocityProfile.tsx`
- `src/app/components/charts/shared/ChartTheme.ts`
- `src/app/components/charts/shared/ChartTooltip.tsx`
- `src/app/components/charts/shared/EChartsTheme.ts`
- `src/app/components/charts/shared/EChartsWrapper.tsx`
- `src/app/components/charts/shared/RechartsTooltip.tsx`

Summary: 16 findings (critical: 0, high: 1, medium: 12, low: 3). No TODO/FIXME/HACK stubs were found in the assigned files.

Verification notes:
- `npm run typecheck -- --pretty false` passed.
- `npx biome check <13 assigned files> --no-errors-on-unmatched` passed.

## `src/app/components/charts/AsymmetryGauge.tsx`

### Finding 1
- Category: bug
- Severity: medium
- Line numbers: 298-342
- Description: Summary mode converts signed asymmetry directly into left/right CSS widths with `50 +/- avgAsymmetry / 2` and never clamps the result. The asymmetry formula can legitimately produce values up to +/-200% when one side contributes nearly all force, so the split bar can emit negative widths or widths above 100% (for example, 200% asymmetry yields left -50% and right 150%). That can produce invalid/overflowing visual output for severe but valid imbalances.
- Suggested fix direction: Clamp `leftPct` and `rightPct` into `[0, 100]` before using them as widths, or derive the split from bounded left/right force totals rather than raw asymmetry.

## `src/app/components/charts/CommunityDistribution.tsx`

### Finding 2
- Category: bug
- Severity: medium
- Line numbers: 37-43
- Description: `valueToPercentile` divides by `(val1 - val0)` without guarding equal adjacent percentile values. Flat or tied percentile buckets are common in sparse community datasets; when two neighboring percentiles have the same value, the interpolation denominator is zero and can produce `NaN` density points, which then get passed directly into ECharts.
- Suggested fix direction: Detect `val1 === val0` before interpolation and return a stable percentile (for example the midpoint percentile, `pct0`, or `pct1`) instead of dividing by zero.

### Finding 3
- Category: failure-point
- Severity: medium
- Line numbers: 84-89, 115-119, 149-166
- Description: The x-axis domain is fixed to the generated percentile curve's min/max, while the `YOU` markLine is placed at the raw `userValue`. If the user's value is below the lowest supplied percentile or above the highest supplied percentile, one side of the split can be empty and the marker is outside the axis range, so the chart can hide the user's position entirely for outlier users.
- Suggested fix direction: Expand the axis domain to include `userValue`, clamp the marker to the visible edge with an outlier label, or add synthetic boundary points so out-of-range users still get a visible indicator.

### Finding 4
- Category: failure-point
- Severity: low
- Line numbers: 80-82, 172-177
- Description: When fewer than two valid percentile keys are provided, the component returns an empty ECharts option and still renders a chart container with an aria-label stating the user's value. Visually this is a blank 60px chart with no explanation, which looks like a rendering failure rather than an empty-data state.
- Suggested fix direction: Render an explicit empty-state message such as "Not enough community data" when `generateBellCurvePoints` returns no points, and make the accessible label match that state.

## `src/app/components/charts/ConsistencyWidget.tsx`

### Finding 5
- Category: failure-point
- Severity: low
- Line numbers: 30-32
- Description: `ProgressRing` caps progress at 100% but does not clamp the lower bound. If imported aggregate data ever contains a negative session count, `fill` becomes negative and `strokeDashoffset` exceeds the circumference, producing an invalid/reversed progress arc instead of a safe zero state.
- Suggested fix direction: Clamp `fill` with `Math.max(0, Math.min(sessions / target, 1))` and consider sanitizing displayed counts to non-negative values before rendering.

## `src/app/components/charts/ForceCurve.tsx`

### Finding 6
- Category: bug
- Severity: high
- Line numbers: 105-110, 178-179, 216-229
- Description: Non-normalized curves use an x-domain of `[0, maxTimestamp]` and render each point at its raw `timestamp_ms`. If telemetry timestamps are absolute or set-relative values that do not start near zero, all points are compressed into the far right of the chart because the minimum timestamp is ignored. The normalization helper already treats the first timestamp as the rep start, so this raw mode is inconsistent with normalized mode.
- Suggested fix direction: Use `[minX, maxX]` as the domain and render elapsed time (`timestamp_ms - minX`) when the desired label is time within the rep/set. If absolute timestamps are intentional, format the axis accordingly and include the min bound.

### Finding 7
- Category: failure-point
- Severity: medium
- Line numbers: 191-204, 215-223
- Description: Gradient IDs are built from only `rep.repNumber` (`force-gradient-${rep.repNumber}`). SVG IDs are document-wide, so multiple `ForceCurve` instances on the same page, or duplicate rep numbers in one chart, can collide and cause an area to reference another chart's gradient.
- Suggested fix direction: Generate a component-scoped ID prefix with React `useId()` (or another stable unique prefix) and include it in both the `LinearGradient` `id` and the `fill` URL.

## `src/app/components/charts/MuscleRadar.tsx`

### Finding 8
- Category: failure-point
- Severity: medium
- Line numbers: 74-108
- Description: The radar visualization renders only through `EChartsWrapper`, which ultimately draws to canvas, and this component provides no surrounding `role`, aria summary, or screen-reader table. Users relying on assistive technology cannot access the current/previous muscle-group values.
- Suggested fix direction: Wrap the chart in an accessible summary and add a visually hidden table listing each muscle group's current and previous values, similar to the visx chart components in this folder.

## `src/app/components/charts/PowerOutput.tsx`

### Finding 9
- Category: bug
- Severity: medium
- Line numbers: 44-56, 259-267
- Description: The chart and hidden accessibility table label reps by array position (`i + 1`) instead of the source `rep.rep_number`. If summaries are filtered, sorted differently, or have skipped rep numbers, the displayed bars/tooltips/table rows can identify the wrong rep.
- Suggested fix direction: Use `rep.rep_number` consistently for `PowerRep.repNumber`, x-axis labels, tooltip labels, and the screen-reader table, falling back to `i + 1` only when the source value is absent.

### Finding 10
- Category: bug
- Severity: medium
- Line numbers: 85-97, 120-125
- Description: `maxWatts` is computed as `Math.max(...watts) * 1.2` and can be `0` or negative when data is zero, missing, or represents negative/eccentric velocity. That creates a degenerate or inverted y-domain (`[0, 0]` or `[0, negative]`) and can produce NaN positions or negative bar heights.
- Suggested fix direction: Clamp the y-domain upper bound to a positive minimum (for example `Math.max(100, maxWatts)`) and decide explicitly how negative power should be displayed (separate baseline, absolute value, or filtered empty state).

## `src/app/components/charts/TrainingLoadGauge.tsx`

### Finding 11
- Category: failure-point
- Severity: medium
- Line numbers: 22-25, 94
- Description: The gauge renders only the ECharts canvas with no accessible wrapper, text equivalent, or hidden data table. The TypeScript union protects internal callers at compile time, but at runtime the score/zone are not exposed to screen readers in a reliable way.
- Suggested fix direction: Wrap the gauge in a `role="img"` container with an aria-label such as `Training load: ${clamped}, ${zoneLabel}`, and provide visible or sr-only text for the score and zone.

### Finding 12
- Category: failure-point
- Severity: low
- Line numbers: 22-25, 51-85
- Description: `zoneColor` and `zoneLabel` are looked up directly from the incoming `zone`. If API or persisted data ever supplies an unexpected zone string, ECharts receives `undefined` for pointer color, title color, and series name, leading to a broken or unlabeled gauge instead of a safe fallback.
- Suggested fix direction: Validate `zone` at the boundary or default unknown zones to a neutral color/label before constructing the option.

## `src/app/components/charts/VelocityProfile.tsx`

### Finding 13
- Category: bug
- Severity: medium
- Line numbers: 73-92, 150-165, 172-178
- Description: When all rep velocities are zero, `maxVelocity` becomes `0`, so the y-scale domain is `[0, 0]`. A degenerate scale can produce invalid tick/bar positioning, and the same code path can invert the chart if negative velocities are present.
- Suggested fix direction: Clamp the y-axis upper bound to a positive minimum (for example `Math.max(1, peak * 1.15)`) and handle negative velocity data explicitly if eccentric movement is possible.

### Finding 14
- Category: bug
- Severity: low
- Line numbers: 295-305
- Description: The outer aria summary always computes `peakVelocity` from `mean_velocity_mps`, even when the chart is configured to show peak velocity bars. Screen-reader users can hear a lower "Peak mean velocity" value than the visual chart emphasizes.
- Suggested fix direction: Compute the aria peak from `peak_velocity_mps` when `showPeakVelocity` is true, or rename the label to clarify that it is summarizing mean velocity only.

## `src/app/components/charts/shared/ChartTheme.ts`

No findings.

## `src/app/components/charts/shared/ChartTooltip.tsx`

No findings.

## `src/app/components/charts/shared/EChartsTheme.ts`

No findings.

## `src/app/components/charts/shared/EChartsWrapper.tsx`

### Finding 15
- Category: bug
- Severity: medium
- Line numbers: 8-15, 22-36
- Description: The wrapper uses tree-shakeable ECharts registration but does not register `MarkLineComponent`. `CommunityDistribution` relies on a `markLine` for its "YOU" indicator, so that indicator can fail to render or warn at runtime under modular ECharts builds even though the line-series chart itself is registered.
- Suggested fix direction: Import and register `MarkLineComponent` from `echarts/components` alongside the other required components, or remove the markLine dependency from the consumer.

### Finding 16
- Category: failure-point
- Severity: medium
- Line numbers: 63-68, 70-86
- Description: Responsive behavior listens only to global `window.resize`. Charts inside tabs, cards, sidebars, accordions, or other containers can change size without a window resize, leaving the ECharts canvas at a stale size until the user resizes the browser.
- Suggested fix direction: Use `ResizeObserver` on the wrapper/container or enable the chart library's auto-resize behavior so chart instances resize whenever their own container changes.

## `src/app/components/charts/shared/RechartsTooltip.tsx`

No findings.
