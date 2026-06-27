# Lib - Replay & Export Review

Reviewed files:

- `src/lib/replay-renderer.ts`
- `src/lib/replay-intelligence.ts`
- `src/lib/replay-phase-analytics.ts`
- `src/lib/exercise-demo-media.ts`
- `src/lib/exercise-demo-media-manifest.ts`
- `src/lib/exercise-display.ts`
- `src/lib/exercise-muscles.ts`
- `src/lib/export/analytics-tables.ts`
- `src/lib/export/csv-security.ts`
- `src/lib/export/csv.ts`
- `src/lib/export/data-export.ts`
- `src/lib/build/body-muscles-sourcemaps.ts`
- `src/lib/build/sourcemaps.ts`

Summary: 11 findings (0 critical, 1 high, 6 medium, 4 low).

## `src/lib/replay-renderer.ts`

### Finding 1
- Category: bug
- Severity: medium
- Line numbers: 195-201, 216-218
- Description: `renderVelocityBars` scales the y-axis from `Math.max(...velocity_mps) * 1.1` and assumes all velocity values are positive. Signed replay telemetry is used elsewhere (`replay-phase-analytics.ts` treats negative velocity as eccentric), so a set with eccentric/negative samples can either use a negative scale or draw negative samples below the plot with no zero baseline. An all-zero velocity stream also returns early and hides the replay frame/playhead entirely.
- Suggested fix direction: Compute velocity scale from both min and max, include a zero baseline, and map signed values into the plot range. Only skip the series when the velocity domain has no range after normalization, while still drawing annotations/playhead.

### Finding 2
- Category: failure-point
- Severity: low
- Line numbers: 60-62, 132-137, 207-212
- Description: `currentTimeMs` is not clamped before drawing the playhead. If the player state briefly goes negative or beyond the last telemetry timestamp during seeking or data refresh, the playhead is drawn outside the plot area; when no samples are visible yet, the out-of-bounds playhead is the only thing rendered.
- Suggested fix direction: Clamp `currentTimeMs` to `[0, maxTime]` for rendering, and use the raw value only for playback state if needed.

### Finding 3
- Category: bug
- Severity: low
- Line numbers: 40-49
- Description: `drawRepBands` can only shade intervals between adjacent `repBoundaries`. Other replay code/tests pass `repBoundaries` as rep start times (for example `[0, 1500, 3000, 4500]` for four reps), which leaves the last rep without an end boundary and therefore never shades it. Adding a trailing max-time boundary would help the renderer, but `replay-phase-analytics.ts` currently treats every boundary as a rep start.
- Suggested fix direction: Define one boundary contract shared by renderer/intelligence/analytics. If boundaries are starts, derive each end from the next start or `maxTime` before rendering bands.

## `src/lib/replay-intelligence.ts`

### Finding 4
- Category: bug
- Severity: medium
- Line numbers: 88-93
- Description: `findStickingPoint` flags any point whose velocity is below `mean_velocity * 0.45` and force is high. Negative/eccentric velocity values always satisfy the `<= velocityThreshold` check, so high-force eccentric lowering samples can be mislabeled as sticking points even though sticking points should generally be constrained to the concentric/working phase.
- Suggested fix direction: Filter candidates to the intended phase, e.g. positive/concentric velocity or a phase segment supplied by `replay-phase-analytics`, and handle signed velocity explicitly.

## `src/lib/replay-phase-analytics.ts`

### Finding 5
- Category: failure-point
- Severity: low
- Line numbers: 80-90
- Description: `repNumberForTimestamp` assumes each `repBoundaries` entry is a rep start. If a caller supplies a terminal end boundary (which the renderer would need to shade the final interval), timestamps at or after that terminal boundary advance `index` past `repSummaries.length - 1` and can be labeled as a phantom rep (`index + 1`).
- Suggested fix direction: Treat boundaries as half-open rep windows and cap the resolved index to `repSummaries.length - 1`, or pass explicit `{startMs,endMs}` windows instead of overloading a raw number array.

## `src/lib/exercise-demo-media.ts`

No findings.

## `src/lib/exercise-demo-media-manifest.ts`

### Finding 6
- Category: bug
- Severity: medium
- Line numbers: 964-978, 1070-1084
- Description: Two exercise entries contain duplicate `angle: "FRONT"` media variants: `wgiwmR1yt3QJtiWs` (`Concentration Curl`) and `z70P8xJtRTKpAUbr` (`Crossover Lateral Raise`). Consumers that key tabs/buttons by angle or assume one media item per angle can render duplicate keys, overwrite one item, or show ambiguous primary media.
- Suggested fix direction: Deduplicate generated media per `(exerciseId, angle)` or preserve a distinct angle/label for each variant before writing the manifest. Add a generation-time assertion that angles are unique per exercise.

## `src/lib/exercise-display.ts`

No findings.

## `src/lib/exercise-muscles.ts`

### Finding 7
- Category: failure-point
- Severity: medium
- Line numbers: 801-806, 824-832
- Description: The `dbMuscleGroup` fallback is returned without trimming, canonicalizing, or validating it against the documented parent groups. `classifyMuscleGroup` also compares `dbMuscleGroup !== "General"` before trimming/case-normalizing, so values like `" General "`, `"general"`, or arbitrary database text can be returned as primary groups despite the function comment promising one of `Chest`, `Back`, `Shoulders`, `Arms`, `Legs`, `Core`, or `General`.
- Suggested fix direction: Normalize and validate `dbMuscleGroup` before using it; treat any case/whitespace variant of `General` as no hint, and fall back to `General` for unknown non-canonical values.

## `src/lib/export/analytics-tables.ts`

No findings.

## `src/lib/export/csv-security.ts`

### Finding 8
- Category: failure-point
- Severity: medium
- Line numbers: 1-5
- Description: Formula-injection protection only checks the first character of the raw field. Spreadsheet applications can still interpret values with leading spaces before a dangerous formula prefix (for example `" =SUM(...)"`) or formula text after leading whitespace/control characters. This helper is used by manual CSV generation in `src/lib/integrations/export-csv.ts`, so it is a security boundary rather than dead code.
- Suggested fix direction: Detect formulas after leading spaces and other spreadsheet-ignored control characters, or prefix any field whose left-trimmed value starts with `=`, `+`, `-`, `@`, tab, CR, or LF. Add tests for leading-space and newline-prefixed formulas.

## `src/lib/export/csv.ts`

### Finding 9
- Category: failure-point
- Severity: low
- Line numbers: 80-89
- Description: `downloadCSV` creates an anchor and clicks it without appending it to the document, while the ZIP export helpers append/remove their download anchor. Some browsers and WebViews ignore synthetic clicks on detached anchors, so CSV exports can silently fail in those environments.
- Suggested fix direction: Mirror the ZIP download path: append the anchor to `document.body`, click it, remove it, and consider deferring `URL.revokeObjectURL` to the next task/tick after the click.

## `src/lib/export/data-export.ts`

### Finding 10
- Category: error
- Severity: high
- Line numbers: 267-270
- Description: A `rep_telemetry` page failure is logged with `console.warn` and then the loop breaks, allowing the export to continue and download a partial `telemetry.json` without surfacing the data-loss error to the caller/user. This undermines the GDPR data-portability export because the operation can appear successful while omitting an arbitrary tail of telemetry rows.
- Suggested fix direction: Treat paginated telemetry failures like other table failures: throw an export error, or mark the ZIP/report as explicitly partial and surface that state in the UI. Prefer retrying transient page failures before failing the export.

### Finding 11
- Category: failure-point
- Severity: medium
- Line numbers: 227-234, 286-309
- Description: Nested exports load `exercises`, `routine_exercises`, and `cycle_days` with a single `.in(..., ids)` query containing all parent IDs. Users with many workouts/routines/cycles can exceed URL/query length or PostgREST filter limits, causing the export to fail. `analytics-tables.ts` already has chunked pagination helpers for this exact pattern, but `data-export.ts` does not use them.
- Suggested fix direction: Reuse a chunked/paginated fetch helper for all `.in` filters, with a bounded chunk size and page size, before adding each nested table to the ZIP.

## `src/lib/build/body-muscles-sourcemaps.ts`

No findings.

## `src/lib/build/sourcemaps.ts`

No findings.
