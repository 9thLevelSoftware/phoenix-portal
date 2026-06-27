# Session Replay Review

Scope: `src/app/components/session-replay/*`

Reviewed files:
- `src/app/components/session-replay/FatigueSummary.tsx`
- `src/app/components/session-replay/PlaybackControls.tsx`
- `src/app/components/session-replay/QualityBadge.tsx`
- `src/app/components/session-replay/ReplayAnnotationOverlay.tsx`
- `src/app/components/session-replay/ReplayCanvas.tsx`
- `src/app/components/session-replay/ReplayIntelligencePanel.tsx`
- `src/app/components/session-replay/ReplayPhaseAnalyticsPanel.tsx`
- `src/app/components/session-replay/SessionReplay.tsx`
- `src/app/components/session-replay/SetNavigation.tsx`
- `src/app/components/session-replay/TimelineBar.tsx`

Verification performed:
- `npm run typecheck -- --pretty false` passed.
- `npm test -- src/app/components/__tests__/SessionReplay.test.tsx src/lib/__tests__/replay-renderer.test.ts src/lib/__tests__/replay-intelligence.test.ts src/lib/__tests__/replay-phase-analytics.test.ts` passed: 4 files, 39 tests.

Summary:
- Findings: 15
- Severity breakdown: critical 0, high 2, medium 9, low 4

## `src/app/components/session-replay/FatigueSummary.tsx`

No findings in this file.

## `src/app/components/session-replay/PlaybackControls.tsx`

### Finding 1
- Category: failure-point
- Severity: medium
- Line numbers: 22-38
- Description: The global Space shortcut only excludes `INPUT`, `TEXTAREA`, and `SELECT`. Focused buttons, tab triggers, sliders, links, and `contenteditable` elements can still receive Space for their native action while the window handler also toggles playback. For example, pressing Space on the speed tabs or the play/pause button can unexpectedly toggle playback in addition to the focused control's own behavior.
- Suggested fix direction: Restrict the shortcut to non-interactive targets. Ignore `e.defaultPrevented`, `button`, `a`, elements with interactive ARIA roles, `[contenteditable]`, and controls inside replay widgets, or bind the shortcut only when the replay surface itself has focus.

## `src/app/components/session-replay/QualityBadge.tsx`

### Finding 2
- Category: failure-point
- Severity: low
- Line numbers: 87-100
- Description: Factor hints are exposed only through the native `title` attribute on the label. `title` is not reliably available to keyboard, touch, or screen-reader users, so the meaning of "Higher is better" / "Higher is more balanced" can be missed.
- Suggested fix direction: Render the hint as visible text, use an accessible tooltip component, or connect the label to hidden explanatory text with `aria-describedby`.

## `src/app/components/session-replay/ReplayAnnotationOverlay.tsx`

### Finding 3
- Category: bug
- Severity: medium
- Line numbers: 59-83
- Description: The overlay renders every sticking point from `intelligence.stickingPoints` regardless of playback time. The canvas renderer hides future sticking points until `point.timestampMs <= currentTimeMs`, but this SVG overlay has no `currentTimeMs` prop and exposes future annotations immediately. That can reveal later-rep events before the playhead reaches them and clutter the replay with annotations unrelated to the current moment.
- Suggested fix direction: Pass `currentTimeMs` into `ReplayAnnotationOverlay` and filter or dim annotations with timestamps after the current playhead. Keep the SVG overlay behavior consistent with the canvas renderer.

### Finding 4
- Category: failure-point
- Severity: low
- Line numbers: 18-20, 37-41, 73-74
- Description: The x-coordinate calculation clamps plot width to at least 1px, but it does not handle containers narrower than the left/right margins. On very narrow layouts, annotation x values can sit outside the SVG viewBox, and the text x position can become negative through `Math.min(width - 44, x + 6)`.
- Suggested fix direction: Treat tiny widths as a no-render state, clamp label coordinates to `[0, width]`, and/or scale margins down for small containers.

## `src/app/components/session-replay/ReplayCanvas.tsx`

### Finding 5
- Category: bug
- Severity: high
- Line numbers: 40-52
- Description: The canvas renderers receive raw `TelemetryPointRow[]` data even though telemetry rows are per-cable (`cable: "A" | "B"`). A force chart drawn as a single series over raw cable rows can under-report total force and draw duplicate/sawtooth points at the same timestamp instead of the combined force for the rep. This conflicts with phase analytics, which groups rows by timestamp and sums force before calculating energy.
- Suggested fix direction: Aggregate telemetry by timestamp before rendering total force, or render separate clearly-labeled cable series. Keep force/velocity aggregation semantics consistent between replay canvas, intelligence, and phase analytics.

### Finding 6
- Category: failure-point
- Severity: low
- Line numbers: 33-38, 64-71
- Description: The component silently returns when `getContext("2d")` fails and still exposes a canvas with `role="img"`. Users get no visible fallback or accessible data if the browser blocks canvas, canvas creation fails, or rendering is otherwise unsupported.
- Suggested fix direction: Track a render-support/error state and render a fallback message or tabular summary. If using `role="img"`, provide a meaningful textual alternative that describes the current chart data.

## `src/app/components/session-replay/ReplayIntelligencePanel.tsx`

### Finding 7
- Category: failure-point
- Severity: medium
- Line numbers: 42-43, 87-109
- Description: If `currentRepIndex` is out of range, the panel falls back to `intelligence.repInsights[0]`. A stale or malformed index therefore displays Rep 1 details even when the playhead/index is not on Rep 1, which can mislead the athlete about the selected rep's velocity, force, and sticking point.
- Suggested fix direction: Clamp `currentRepIndex` to the valid rep-insight range, prefer the nearest valid rep, or render a neutral "no rep selected" state instead of defaulting to the first rep.

## `src/app/components/session-replay/ReplayPhaseAnalyticsPanel.tsx`

### Finding 8
- Category: failure-point
- Severity: low
- Line numbers: 96-142, 211-223
- Description: The force/velocity scatter plots are rendered only as visual Recharts charts, with no accessible title/description, no tabular equivalent, and no keyboard-readable list of phase points. Screen-reader users can access the energy cards but not the actual force-vs-position or velocity-vs-position analytics.
- Suggested fix direction: Add an accessible summary/table of the plotted phase points, give the chart regions labelled headings/descriptions, and consider hiding purely decorative SVG internals while exposing the underlying data in semantic HTML.

## `src/app/components/session-replay/SessionReplay.tsx`

### Finding 9
- Category: bug
- Severity: high
- Line numbers: 53-56, 76-83, 201-371
- Description: Playback reset on mount does not reset or clamp `currentSetIndex`, and the component directly indexes `allSets[currentSetIndex]`. If the Zustand store retains an index from a prior session with more sets, or if the current session has fewer sets, `currentSet` becomes `undefined`, the telemetry query is disabled, and none of the main, fallback, empty, or error states render. The user can see only the header/freshness strip with no recovery path.
- Suggested fix direction: Reset `currentSetIndex` when `sessionId` changes, add a store action to set/clamp the set index, and clamp the selected index after `allSets` loads. Render an explicit empty/out-of-range state if no current set exists.

### Finding 10
- Category: stub
- Severity: medium
- Line numbers: 98-100, 126-134, 377-413
- Description: Rep boundaries are placeholder logic: `deriveRepBoundaries` ignores `_telemetry`, estimates starts from cumulative `tut_ms + 500`, and the comment explicitly documents that this is inaccurate. These approximate boundaries drive current rep selection, annotation windows, fatigue highlighting, quality badge rep number, and phase/intelligence calculations, so replay can drift from the actual telemetry.
- Suggested fix direction: Derive boundaries from actual telemetry transitions or persisted rep start/end timestamps. If exact boundaries are unavailable, surface the approximation as degraded/partial data and keep it out of features that need precise timing.

### Finding 11
- Category: failure-point
- Severity: medium
- Line numbers: 169-190
- Description: `ResizeObserver` is constructed unconditionally in the effect. Browsers/environments without `ResizeObserver` support will throw at render time for the replay page instead of falling back to a fixed canvas width.
- Suggested fix direction: Guard with `typeof ResizeObserver !== "undefined"`, fall back to `clientWidth`/`window.resize`, and keep the initial 600px width when observation is unavailable.

## `src/app/components/session-replay/SetNavigation.tsx`

### Finding 12
- Category: stub
- Severity: medium
- Line numbers: 53-67
- Description: The Set/Session view-mode toggle updates `viewMode`, but the session replay UI never reads `viewMode` to change playback scope, aggregation, navigation, or charts. The visible "Session" option is therefore a placeholder that promises session-level replay without implementing it.
- Suggested fix direction: Either implement session mode end-to-end or remove/disable the toggle until the mode is supported. Add tests that assert the UI changes when `viewMode` is set to `session`.

### Finding 13
- Category: bug
- Severity: medium
- Line numbers: 28-46
- Description: Previous/Next only call `prevSet`/`nextSet`; they do not pause playback or reset the playhead for the newly selected set. If the user switches from a long set to a shorter set, `currentTimeMs` can be outside the new set's duration, causing the timeline and chart to open at the end or immediately pause on the next animation frame.
- Suggested fix direction: On set changes, pause playback and seek to 0, or provide a single store action that atomically changes the set index and resets playback-derived state.

## `src/app/components/session-replay/TimelineBar.tsx`

### Finding 14
- Category: bug
- Severity: medium
- Line numbers: 29-35, 64-72, 82-89
- Description: `fatigueStartPercent` divides by `durationMs` without checking that duration is positive or that `fatigueStartRepIndex` exists in `repBoundaries`. Zero-duration telemetry or mismatched summary/boundary data can produce `Infinity%`, `NaN%`, or an invalid slider max, leading to broken timeline styling and seek behavior.
- Suggested fix direction: Require `durationMs > 0`, validate the boundary index, clamp the computed percent to `[0, 100]`, and render a disabled/empty timeline when duration is not usable.

### Finding 15
- Category: failure-point
- Severity: medium
- Line numbers: 37-50, 77-81
- Description: Scrubbing pauses playback on pointer down and resumes only on pointer up. If the pointer is canceled, capture is lost, the pointer leaves the control, or the component unmounts during a drag, `handlePointerUp` may never run and playback remains paused while `onScrubEnd` is skipped.
- Suggested fix direction: Handle `onPointerCancel`, `onLostPointerCapture`, and cleanup-on-unmount, or use the slider's committed-value callback if available to restore playback reliably.
