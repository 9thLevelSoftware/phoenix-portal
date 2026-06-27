# Analytics Dashboard Review

Scope: static review of the 20 assigned analytics dashboard files for data accuracy bugs, stubs, errors, and failure points.

Validation performed: `npm run typecheck` completed successfully.

Summary:
- Findings: 13
- Critical: 0
- High: 5
- Medium: 6
- Low: 2

## src/app/components/Analytics.tsx

### Finding 1
- Category: bug
- Severity: high
- Line numbers: 760-771, 1397-1400, 1629-1632
- Description: The phase filter is presented as controlling the Progress tab phase metrics, but `phaseMetricSummary` is always built from all `phaseStatsRaw` rows and does not depend on `phaseFilter`. Changing Concentric/Eccentric/Combined only affects strength PRs/workbench, while the "Phase Load, Speed & Power" values remain aggregated across all phase statistics.
- Suggested fix direction: Include the workout phase in `phaseStatisticsTrendOptions`, filter phase statistics before calling `buildPhaseMetricSummary`, and include `phaseFilter` in the memo dependencies. If `session_phase_statistics` cannot be phase-specific, remove or relabel the phase filter for this panel.

### Finding 2
- Category: failure-point
- Severity: medium
- Line numbers: 1369-1375, 1490-1496
- Description: The page-level empty states are gated only on volume/muscle/external summary data (`mobileHasData` and `hasData`). If a user has records, phase stats, progression data, performance benchmark data, or detailed body intelligence but no volume/muscle summary rows for the selected period, the entire tab content is replaced by the empty state and those valid tabs become inaccessible.
- Suggested fix direction: Gate empty states per tab, or include all tab-specific data sources in the global availability check. Records/performance/progression/body detail views should be reachable even when the overview charts are empty.

### Finding 3
- Category: bug
- Severity: low
- Line numbers: 1680-1683
- Description: A stray semicolon is rendered inside the JSX tree after the desktop `PageShell`. TypeScript accepts it as a text child, so the dashboard can display an unintended `;` at the bottom of the page.
- Suggested fix direction: Remove the standalone semicolon from inside the JSX return.

## src/app/components/analytics/BodyMuscleHeatmap.tsx

No findings.

## src/app/components/analytics/BodyTab.tsx

### Finding 4
- Category: bug
- Severity: medium
- Line numbers: 78-80, 262-281, 325-334
- Description: `toCanonicalMuscleGroup` maps `Abdominals` to `Core` but does not accept `Core` itself. If the heatmap model returns a selected muscle with group `Core`, the selected muscle still appears in the side panel, but `selectedMuscleGroup` becomes `null`, hiding the clear-selection shortcut, `ExerciseDeepDive`, and selected-group highlighting in volume landmarks.
- Suggested fix direction: Add `Core: "Core"` to the canonical map and consider normalizing all known six-group names as pass-through values.

## src/app/components/analytics/CommunityPercentileAtlas.tsx

No findings.

## src/app/components/analytics/DataFreshnessStrip.tsx

No findings.

## src/app/components/analytics/ExerciseDeepDive.tsx

### Finding 5
- Category: bug
- Severity: medium
- Line numbers: 147-155, 159-162, 229-233
- Description: `selectedExercise` is initialized from the first exercise only once. When the parent changes to a different muscle group/exercise list, the previous exercise can remain selected even if it is not in the new list; the component then queries progress for the stale exercise, shows an activation profile using the new muscle group hint, and reports `0` sessions from the new list.
- Suggested fix direction: Add an effect that resets `selectedExercise` to `sortedExercises[0]?.name ?? ""` whenever `muscleGroup` or the exercise list changes, or make selection controlled by the parent.

## src/app/components/analytics/MobileBodyTab.tsx

### Finding 6
- Category: failure-point
- Severity: medium
- Line numbers: 55-65, 72-83, 151-163, 208-241
- Description: The mobile Body tab returns early when `muscleGroupData.length === 0`, before rendering `BodyMuscleHeatmap`, volume landmarks, SRA recovery, and recommendations. Those sections are driven by `bodyMuscleModel`, `weeklyVolume`, `muscleRecoveries`, and `recommendations`, so valid detailed body intelligence can be hidden just because the summary muscle-group distribution query is empty.
- Suggested fix direction: Replace the whole-tab early return with per-widget empty states. Render detailed body, landmarks, SRA, and recommendations based on their own data availability.

## src/app/components/analytics/MobileOverviewTab.tsx

No findings.

## src/app/components/analytics/MobilePerformanceTab.tsx

No findings.

## src/app/components/analytics/MobileProgressTab.tsx

No additional findings beyond the shared phase-metric filtering issue reported in `Analytics.tsx`.

## src/app/components/analytics/OverviewTab.tsx

No findings.

## src/app/components/analytics/PerformanceTab.tsx

### Finding 7
- Category: bug
- Severity: high
- Line numbers: 116-128
- Description: Training Efficiency computes `totalVol` from `volumeComparison.current.total_volume` and passes `totalVol / totalMin` directly to `convertWeight`. Elsewhere in Analytics, the same `total_volume` values are multiplied by `WEIGHT_MULTIPLIER` before unit conversion. This makes Volume / Minute inconsistent with the rest of the dashboard and likely underreports/overreports load by the configured multiplier.
- Suggested fix direction: Apply the same canonical conversion used in `Analytics.tsx` (`total_volume * WEIGHT_MULTIPLIER`) before calling `convertWeight`, or ensure the query returns already-normalized kg and remove the multiplier from all consumers consistently.

## src/app/components/analytics/phaseStatisticsTransforms.ts

### Finding 8
- Category: bug
- Severity: medium
- Line numbers: 41-70, 74-98
- Description: The transform averages per-row average metrics with equal weight. If `session_phase_statistics` rows represent sessions with different sample counts, set counts, or rep counts, a one-sample session contributes as much as a high-volume session, skewing load/velocity/power averages.
- Suggested fix direction: Include sample counts or set counts in `PhaseStatisticsTrendRow` and compute weighted averages. If weighted data is unavailable, label the output as an unweighted session average.

## src/app/components/analytics/ProgressionWorkbench.tsx

No findings.

## src/app/components/analytics/ProgressTab.tsx

No additional findings beyond the shared phase-metric filtering issue reported in `Analytics.tsx`.

## src/app/components/analytics/RecommendationsPanel.tsx

No findings.

## src/app/components/analytics/RecordsTab.tsx

### Finding 9
- Category: bug
- Severity: high
- Line numbers: 154-190, 415-423, 453-460, 549-577
- Description: Records are grouped only by exercise (`exercise_id ?? exercise_name`) and the latest record of any type becomes the current value. The history and bar chart can mix `MAX_WEIGHT`, `1RM`, `MAX_VOLUME`, `MAX_REPS`, and other units in the same exercise card, scaling raw values against each other and displaying a single "current" measurement that may be a different metric from older bars.
- Suggested fix direction: Group records by exercise plus `record_type` (and unit where relevant), or render separate metric subgroups within each exercise. Compute progression bars only from comparable values.

### Finding 10
- Category: bug
- Severity: medium
- Line numbers: 146-152, 200-209, 325-364, 610-715
- Description: The phase filter is applied to grouped exercise records, but timeline mode, milestones, total PR count, and "This Month" summary all continue to use unfiltered `records`. Users selecting a phase see counts and timeline entries that contradict the active phase filter.
- Suggested fix direction: Base timeline, milestone, and summary computations on `phaseFiltered` when a phase is selected, or visually label those widgets as all-phase totals.

## src/app/components/analytics/SRARecoveryMatrix.tsx

### Finding 11
- Category: failure-point
- Severity: low
- Line numbers: 101-105, 127-135
- Description: The display treats `hoursSinceLastTrained === 0` as "No data". The SRA model also uses `0` as the sentinel for never-trained muscles, but `0` can also represent a muscle trained just now. In that edge case, a freshly trained muscle is shown as no data instead of fatigued/recovering.
- Suggested fix direction: Carry an explicit `hasTrainingData` or nullable `hoursSinceLastTrained` field through `MuscleRecovery` rather than overloading `0` as a sentinel.

## src/app/components/analytics/strengthPhaseTransforms.ts

### Finding 12
- Category: bug
- Severity: high
- Line numbers: 68-90, 106-128, 131-143
- Description: Strength phase series combine all strength record types (`MAX_WEIGHT` and `1RM`) into the same exercise/phase key and use raw `item.value` for chart points and latest values. A max-weight PR and an estimated-1RM PR are different metrics, but they can overwrite each other in the same monthly bucket and be ranked together in desktop and mobile charts.
- Suggested fix direction: Either filter to a single metric for the chart or include `record_type` in the series key/name and label axes accordingly.

### Finding 13
- Category: bug
- Severity: high
- Line numbers: 73-82, 118-126
- Description: Date buckets are formatted as month name only (`"Jan"`, `"Feb"`, etc.). Histories spanning more than one year collapse records from the same month across different years into one bucket, causing old and new PRs to overwrite each other and making the chart chronology incorrect.
- Suggested fix direction: Bucket by a stable year-month key (for example `YYYY-MM`) and use a separate display label that includes the year when needed.

## src/app/components/analytics/VolumeLandmarks.tsx

No findings.
