# Lib - Analytics & Science Review

Scope reviewed:
- `src/lib/biomechanics.ts`
- `src/lib/body-muscle-analytics.ts`
- `src/lib/fatigue-detection.ts`
- `src/lib/form-analysis.ts`
- `src/lib/freshness.ts`
- `src/lib/insights.ts`
- `src/lib/recovery.ts`
- `src/lib/rep-quality.ts`
- `src/lib/recommendations.ts`
- `src/lib/progression-workbench.ts`
- `src/lib/sra-recovery.ts`
- `src/lib/vbt.ts`
- `src/lib/volume-landmarks.ts`
- `src/lib/workout-phases.ts`
- `src/lib/comparison.ts`
- `src/lib/computeNextWorkout.ts`
- `src/lib/community-atlas.ts`
- `src/lib/challenges.ts`

Summary: 19 findings (critical: 0, high: 1, medium: 8, low: 10). No TODO/FIXME/HACK stubs were found in the assigned files; one internal placeholder-style cast was flagged.

Verification notes:
- `npm run typecheck -- --pretty false` passed.
- `npx biome check <18 assigned files> --no-errors-on-unmatched` passed.

## `src/lib/biomechanics.ts`

### Finding 1
- Category: failure-point
- Severity: low
- Line numbers: 50-52
- Description: `calculateRom` spreads the full `positions` array into `Math.max(...positions)` and `Math.min(...positions)`. Large telemetry arrays can exceed the JavaScript argument limit and throw a `RangeError`, and any `NaN`/non-finite reading will make the returned ROM `NaN`.
- Suggested fix direction: Iterate through the readings while filtering to finite numbers, track min/max incrementally, and return 0 when no finite positions remain.

## `src/lib/body-muscle-analytics.ts`

### Finding 2
- Category: failure-point
- Severity: medium
- Line numbers: 325-335, 345-347, 371-386
- Description: `buildBodyMuscleFocusModel` permits rows with only `setCount`, but reps and volume are computed only from the nested `sets` array. If a query omits nested sets or they fail to hydrate, the model still counts set load through `contributionLoad = Math.max(volumeKg, setCount)` but reports `totalReps`, `totalVolumeKg`, and per-exercise `volumeKg` as zero.
- Suggested fix direction: Either require hydrated sets for this model and treat missing sets as incomplete data, or add explicit fallback fields for reps/volume so the aggregate totals and contribution rows stay consistent when `sets` is absent.

## `src/lib/fatigue-detection.ts`

### Finding 3
- Category: failure-point
- Severity: medium
- Line numbers: 38-58, 81-90
- Description: The fatigue calculation never validates that velocities are finite. A `NaN` first rep bypasses the `<= 0` guard, then every per-rep drop becomes `NaN`; `findIndex` returns `-1` and `createNoFatigueResult` can return `velocityDropPercent: NaN`. A later `NaN` velocity similarly poisons `Math.max(...perRepDrops)`.
- Suggested fix direction: Filter or reject non-finite `mean_velocity_mps` values before computing drops; return a safe no-data result when the baseline is not finite, and avoid propagating `NaN` into UI-facing percentages.

## `src/lib/form-analysis.ts`

### Finding 4
- Category: bug
- Severity: medium
- Line numbers: 45-53, 56-69
- Description: `normalizedDecayRate` uses `Math.abs(slope / values[0])`, so an improving set where force, velocity, or ROM trends upward is treated as decay and penalized in `calculateFatigueResistance`. This can lower fatigue-resistance scores for athletes whose later reps improve rather than deteriorate.
- Suggested fix direction: Only count negative slopes as decay, e.g. return `Math.max(0, -slope / baseline)` after validating the baseline, so upward trends do not reduce the fatigue-resistance score.

## `src/lib/freshness.ts`

### Finding 5
- Category: failure-point
- Severity: medium
- Line numbers: 50-65, 67-90
- Description: `partialTelemetry` is handled before refresh errors. When telemetry is partial and the refresh also failed, the function returns `status: "partial"` and never exposes the reconnecting/stale error state, so users can see a benign partial-data badge while the data source is actually failing.
- Suggested fix direction: Prioritize `hasError`/`isFetching` states over `partialTelemetry`, or combine them explicitly with a status/flag that communicates both partial data and refresh failure.

## `src/lib/insights.ts`

### Finding 6
- Category: failure-point
- Severity: low
- Line numbers: 133-157, 160-169
- Description: Insight IDs for PRs and plateaus are derived by lowercasing exercise names and replacing whitespace only. Punctuation, slashes, duplicate spaces after replacement, and duplicate exercise names can still collide or produce awkward IDs such as `pr-bench/press`, causing downstream de-duplication or React key usage to merge distinct insights.
- Suggested fix direction: Use a shared slug helper that removes non-alphanumeric separators and include a stable discriminator when multiple PRs/plateaus for the same exercise can be emitted.

## `src/lib/recovery.ts`

### Finding 7
- Category: bug
- Severity: medium
- Line numbers: 197-236
- Description: Once `daysSinceFirstSession >= 14`, an empty `sessions` array is treated as a normal recovery input. `computeACWR([])` returns 1.0, rest days score high, and the function can return a moderate/elevated readiness score despite having no session evidence.
- Suggested fix direction: Add a no-session guard after the 14-day gate, or derive the gate from actual session count/coverage so empty data returns an unavailable/gated result instead of a positive readiness score.

## `src/lib/rep-quality.ts`

### Finding 8
- Category: failure-point
- Severity: low
- Line numbers: 124-144
- Description: `calculateTutScore` assumes the target TUT range is ordered and positive. A caller-provided range such as `[5000, 2000]`, `[0, 0]`, or negative bounds can make normal reps score incorrectly or produce divisions by zero in the shortfall/excess math.
- Suggested fix direction: Normalize and validate the target range before scoring; reject non-finite/non-positive bounds or fall back to the default `[2000, 5000]` range.

## `src/lib/recommendations.ts`

No findings.

## `src/lib/progression-workbench.ts`

### Finding 9
- Category: bug
- Severity: medium
- Line numbers: 260-265, 284-287
- Description: Progress rows are grouped by the raw `exercise_name` string and selected with a case-sensitive equality check. The same exercise recorded as `Bench Press`, `bench press`, or with incidental whitespace becomes separate summary cards, while the PR lookup later compares names case-insensitively.
- Suggested fix direction: Normalize exercise names consistently for grouping and selection, preserve a display name from the newest/canonical row, and reuse the same normalization when matching phase PR records.

### Finding 10
- Category: stub
- Severity: low
- Line numbers: 212-219
- Description: `buildExerciseSummary` creates a `placeholder` object cast as `ProgressionExerciseSummary` just to pass `placeholder.plateauRisk` into `buildRecommendation`. The cast is placeholder logic that bypasses the interface contract and can hide future required-field changes from TypeScript.
- Suggested fix direction: Pass the `plateauRisk` value directly to `buildRecommendation` and remove the fake `ProgressionExerciseSummary` object/cast.

## `src/lib/sra-recovery.ts`

### Finding 11
- Category: failure-point
- Severity: low
- Line numbers: 81-105
- Description: Negative `hoursSinceLastTrained` values are accepted. Clock skew or future-dated sessions produce a negative ratio and inflate `hoursRemaining` beyond the expected recovery window, while still reporting the muscle as `FATIGUED`.
- Suggested fix direction: Clamp elapsed hours to `>= 0` or treat negative elapsed time as invalid data with a safe fallback/status flag.

## `src/lib/vbt.ts`

### Finding 12
- Category: failure-point
- Severity: low
- Line numbers: 168-173, 188-193
- Description: Non-finite velocities such as `NaN` fail the zone predicates and silently fall back to the first zone (`GRIND`/`absolute-strength`). Invalid telemetry is therefore displayed as a real slow-rep classification instead of an unavailable/invalid state.
- Suggested fix direction: Validate `Number.isFinite(meanVelocityMps)` before classification and return `null`, throw a controlled validation error, or expose an explicit unknown zone for invalid samples.

## `src/lib/volume-landmarks.ts`

### Finding 13
- Category: failure-point
- Severity: low
- Line numbers: 45-63, 88-101
- Description: Negative or non-finite `setCount`/`weeklySets` values are not sanitized. Bad imported data can reduce a muscle group's weekly volume below zero and then classify it as `below_mev`, hiding the data-quality problem as a training recommendation.
- Suggested fix direction: Clamp set counts to non-negative finite numbers at aggregation and return `null` or an explicit invalid state from `classifyVolumeStatus` for non-finite inputs.

## `src/lib/workout-phases.ts`

### Finding 14
- Category: failure-point
- Severity: low
- Line numbers: 19-24, 32-34
- Description: `normalizeWorkoutPhase` only recognizes exact string keys and does not trim whitespace or normalize case generically. Values like `"CONCENTRIC "`, `" eccentric"`, or API enum variants with incidental whitespace silently fall back to `Combined`.
- Suggested fix direction: Trim the input and normalize to a canonical uppercase key before lookup; make `isWorkoutPhase` use the same normalization path when validating external values.

## `src/lib/comparison.ts`

### Finding 15
- Category: bug
- Severity: medium
- Line numbers: 60-75, 80-105
- Description: Per-session exercise maps are keyed by lowercased name, so duplicate exercises in the same session overwrite earlier entries. If an athlete performs the same exercise in multiple blocks, only the last block contributes to the comparison delta and shared-exercise counts.
- Suggested fix direction: Aggregate duplicate exercise names before comparison by summing volume/sets and computing a weighted average velocity, or preserve repeated blocks as separate rows with unique keys.

## `src/lib/computeNextWorkout.ts`

### Finding 16
- Category: bug
- Severity: high
- Line numbers: 20-26, 48-52
- Description: The next workout is selected with `cycleDays[daysSinceStart % cycleDays.length]`, assuming the input array is already sorted by `day_number`. The `CycleDay` schema does not guarantee ordering, and database/API results can arrive unsorted; an unsorted array assigns the wrong workout/rest day for the current date.
- Suggested fix direction: Sort a copy of `cycleDays` by `day_number` before indexing, or require the caller/query layer to guarantee ordering and assert it here.

### Finding 17
- Category: failure-point
- Severity: medium
- Line numbers: 54-59
- Description: `day.day_type` is cast to `"workout" | "rest"` even though the schema exposes it as a plain string. Unexpected values such as `"deload"`, `"mobility"`, or misspellings leak into `dayType` while `isRestDay` is false, breaking the advertised return type and potentially routing users into a workout flow for non-workout days.
- Suggested fix direction: Validate `day_type` before returning; map known aliases explicitly and return `null` or an unknown/rest-safe state for unsupported values.

## `src/lib/community-atlas.ts`

### Finding 18
- Category: failure-point
- Severity: low
- Line numbers: 90-107, 131-162
- Description: `normalizePercentiles` only accepts one- or two-digit percentile keys (`p0` through `p99`) and drops `p100`. Benchmarks that include a maximum cutoff at `p100` lose their upper boundary, so high outliers are clamped/interpolated against the last lower percentile instead of the true maximum bucket.
- Suggested fix direction: Accept `100` in the percentile key parser, validate the resulting value is between 0 and 100, and include that boundary in interpolation.

## `src/lib/challenges.ts`

### Finding 19
- Category: failure-point
- Severity: low
- Line numbers: 3-12
- Description: `formatChallengeValue` formats `NaN`, `Infinity`, or negative challenge values without validation. Corrupt challenge progress can surface literal `NaN`, `∞`, or negative counts/volumes in the UI.
- Suggested fix direction: Validate `value` with `Number.isFinite`, clamp counters where appropriate, and return an unavailable placeholder for invalid challenge metrics.
