# Feature Components Part 2 Review

Scope: recovery, biomechanics, form analysis, integrations, and calendar components.

Reviewed files:
- `src/app/components/Recovery.tsx`
- `src/app/components/RecoveryDashboardWidget.tsx`
- `src/app/components/RecoveryScore.tsx`
- `src/app/components/Biomechanics.tsx`
- `src/app/components/FormAnalysis.tsx`
- `src/app/components/ExerciseProgress.tsx`
- `src/app/components/Integrations.tsx`
- `src/app/components/integrations/ExternalActivityList.tsx`
- `src/app/components/integrations/HevyConnect.tsx`
- `src/app/components/integrations/LiftosaurConnect.tsx`
- `src/app/components/integrations/MobileOnlyProvider.tsx`
- `src/app/components/integrations/StravaConnect.tsx`
- `src/app/components/integrations/StrongConnect.tsx`
- `src/app/components/integrations/SyncStatus.tsx`
- `src/app/components/CalendarWidget.tsx`
- `src/app/components/CalendarWidgetMobile.tsx`

Verification performed:
- `npx biome check <16 assigned files>`: passed.
- `npm run typecheck -- --pretty false`: passed, but this root script only runs the root `tsconfig.json` and did not surface app-reference errors.
- `npx tsc -p tsconfig.app.json --noEmit --pretty false --noErrorTruncation`: failed with existing broader project errors; assigned-file errors were observed in `ExternalActivityList.tsx` and `SyncStatus.tsx`.

Summary:
- Findings: 21
- Severity breakdown: critical 0, high 4, medium 10, low 7

## `src/app/components/Recovery.tsx`

### Finding 1
- Category: failure-point
- Severity: medium
- Line numbers: 195-207, 315-550
- Description: The premium page only handles `isLoading`, `recovery?.isGated`, and `recovery && !recovery.isGated`. If `useRecoveryScore()` finishes with `recovery === null` because the query failed, the user sees the header/disclaimer area with no score, no empty state, and no error or retry path.
- Suggested fix direction: Have `useRecoveryScore()` expose query errors, and render a dedicated error/empty state when loading is false and `recovery` is null.

## `src/app/components/RecoveryDashboardWidget.tsx`

### Finding 2
- Category: failure-point
- Severity: medium
- Line numbers: 43-57, 104-108
- Description: A failed recovery-score query is indistinguishable from a user having no training data. After loading, `recovery` can be null and the widget renders `No training data yet`, hiding backend/auth/network failures from the user.
- Suggested fix direction: Expose the recovery query error from the hook and render a compact error state with retry instead of reusing the no-data state.

## `src/app/components/RecoveryScore.tsx`

### Finding 3
- Category: failure-point
- Severity: low
- Line numbers: 34-35, 73-76, 87
- Description: The component trusts `result.score` to be a valid 0-100 value. If an upstream change or bad server result passes a negative score, a score above 100, or `NaN`, the SVG dash offset and displayed value can overdraw or render invalid gauge output.
- Suggested fix direction: Clamp and validate the display score inside the component, e.g. `const score = Number.isFinite(result.score) ? Math.min(100, Math.max(0, result.score)) : 0`.

## `src/app/components/Biomechanics.tsx`

### Finding 4
- Category: bug
- Severity: high
- Line numbers: 193-210
- Description: Rep force curves are split by evenly slicing the telemetry array across `repSummaries.length`. The comment notes this is an approximation because telemetry has no `rep_number`. If real reps have different durations, pauses, or dropped telemetry samples, points are assigned to the wrong rep and the force-curve analysis becomes misleading.
- Suggested fix direction: Use explicit rep boundary data from telemetry/rep summaries, or keep the data as a single trace until reliable per-rep boundaries are available. Avoid labeling approximate slices as actual reps.

### Finding 5
- Category: stub
- Severity: medium
- Line numbers: 213-214, 371-407
- Description: Turning off `Overlay All Reps` always sets `selectedRep` to `1`; there is no UI state or selector for any other rep. The switch implies single-rep selection, but the implementation only supports rep 1.
- Suggested fix direction: Add selected-rep state and a rep selector when overlay is disabled, or remove the single-rep mode until it can select all valid reps.

### Finding 6
- Category: failure-point
- Severity: medium
- Line numbers: 180-189, 399-411, 416-445, 467-480, 530-547
- Description: Telemetry and rep-summary query errors are not read or rendered. A failed query is shown as `No telemetry data`, empty charts, or `Need at least 2 reps`, which misdiagnoses failures as missing data and gives no retry path.
- Suggested fix direction: Destructure `error`/`refetch` from `repTelemetryOptions` and `repSummariesOptions`; render an error card or inline retry state before falling back to empty-data messages.

## `src/app/components/FormAnalysis.tsx`

No findings.

## `src/app/components/ExerciseProgress.tsx`

### Finding 7
- Category: failure-point
- Severity: medium
- Line numbers: 216-227, 290-367
- Description: The exercise list, profile, and progress queries ignore `error`. Once `isPending` is false, request failures are rendered as `No progress data yet` or `No progress data for this exercise`, which hides backend/auth/schema failures.
- Suggested fix direction: Read `error` and `refetch` from each query and render explicit error states before no-data states.

### Finding 8
- Category: bug
- Severity: medium
- Line numbers: 206-234
- Description: `selectedExercise` is initialized from `initialExercise` once, but never updates if the prop changes later. `BiomechanicsContent` passes the selected exercise name into this component, so changing the parent exercise can leave the progress charts showing the old exercise.
- Suggested fix direction: Add an effect that synchronizes `selectedExercise` when `initialExercise` changes, while preserving manual user selection intentionally if needed.

### Finding 9
- Category: failure-point
- Severity: medium
- Line numbers: 216-227
- Description: `exerciseListOptions(userId, activeProfileId)` and `profileOptions(userId)` are called without guarding on a non-empty `userId`, and the progress query is only guarded by `!!selectedExercise`. During auth initialization this can issue queries with an empty user id.
- Suggested fix direction: Use object-form `useQuery` with `enabled: !!userId` for all user-scoped queries, and `enabled: !!userId && !!selectedExercise` for the progress query.

## `src/app/components/Integrations.tsx`

### Finding 10
- Category: failure-point
- Severity: medium
- Line numbers: 33-37, 102-115, 118-132, 135-149, 155-180, 203-205
- Description: The page derives `userId` and `accessToken` as empty strings while auth/session data is unavailable, but connect/sync/disconnect/import child handlers can still be rendered and invoked with those empty values. OAuth connect calls with an empty token fail after the user clicks, and mutation calls can be sent with an empty user id.
- Suggested fix direction: Gate the integration UI behind an authenticated/session-ready state, disable provider actions until `userId` and `accessToken` are present, and show a loading or sign-in-required state while auth is unresolved.

## `src/app/components/integrations/ExternalActivityList.tsx`

### Finding 11
- Category: error
- Severity: high
- Line numbers: 23-39
- Description: `PROVIDER_ICON` and `PROVIDER_LABEL` are typed as `Record<IntegrationProvider, ...>` but omit the `strong` and `liftosaur` providers that are part of `IntegrationProvider`. A real app typecheck (`npx tsc -p tsconfig.app.json`) reports TS2739 errors for this file.
- Suggested fix direction: Add `strong` and `liftosaur` entries to both maps, or derive labels/icons from the shared `PROVIDER_METADATA` to keep the UI in sync with the provider union.

### Finding 12
- Category: failure-point
- Severity: low
- Line numbers: 54-60, 84-87, 143-145
- Description: Dates are parsed with `new Date(...)` and rendered without validating the result. Malformed provider data can render `Invalid Date`, and invalid timestamps sort unpredictably because `getTime()` returns `NaN`.
- Suggested fix direction: Add a safe date parser/formatter that detects invalid dates, renders a fallback, and sorts invalid values deterministically at the end.

## `src/app/components/integrations/HevyConnect.tsx`

### Finding 13
- Category: failure-point
- Severity: low
- Line numbers: 146-149, 151-178
- Description: CSV validation is a case-sensitive filename suffix check. Valid exports named with uppercase or mixed-case extensions, such as `HEVY_EXPORT.CSV`, are rejected before parsing. Read/parse failures also leave the selected file in the input unless the user manually clears it.
- Suggested fix direction: Normalize the filename before checking the extension, and clear/reset the file input plus preview state on parse/read failure.

## `src/app/components/integrations/LiftosaurConnect.tsx`

### Finding 14
- Category: failure-point
- Severity: low
- Line numbers: 24-28, 40-50, 147-160
- Description: The component documents the Liftosaur API key format as `lftsk_*`, but only validates that the field is non-empty. Obvious bad keys are sent to the edge function, producing unnecessary network calls and delayed feedback.
- Suggested fix direction: Add lightweight client-side format validation before invoking `liftosaur-sync`, while keeping the server-side validation authoritative.

## `src/app/components/integrations/MobileOnlyProvider.tsx`

### Finding 15
- Category: failure-point
- Severity: low
- Line numbers: 20-34, 63-65
- Description: `formatRelative` does not validate parsed dates and treats future timestamps as `Just now` because negative minute deltas satisfy `diffMin < 1`. Clock skew or bad provider data can mislead users about last sync freshness.
- Suggested fix direction: Check `Number.isFinite(date.getTime())`, handle future timestamps explicitly, and render a safe fallback for invalid dates.

## `src/app/components/integrations/StravaConnect.tsx`

### Finding 16
- Category: bug
- Severity: medium
- Line numbers: 28-38
- Description: `handleConnect` awaits `initiateStravaConnect(accessToken)` without `try/catch/finally`. If the OAuth initiation rejects, the button remains in the `Connecting...` state and the user gets no toast or recoverable error UI.
- Suggested fix direction: Wrap the call in `try/catch/finally`, show a user-facing error, and reset `isRedirecting` if the browser does not redirect.

## `src/app/components/integrations/StrongConnect.tsx`

### Finding 17
- Category: bug
- Severity: high
- Line numbers: 63-64, 74-114, 116-139, 334-338, 386-395
- Description: Strong CSV rows are parsed immediately using the current `importWeightUnit`, but the user can change the weight-unit toggle after the preview is generated. The preview remains visible and `handleImport` imports the already-parsed values, so changing the unit after file selection does not reparse and can import weights in the wrong unit.
- Suggested fix direction: Clear the parsed preview when `importWeightUnit` changes, or store the raw CSV and reparse whenever the selected import unit changes before enabling import.

## `src/app/components/integrations/SyncStatus.tsx`

### Finding 18
- Category: failure-point
- Severity: high
- Line numbers: 25-35, 74-79
- Description: The sync-queue query ignores the Supabase `error` return value and falls back to `data ?? []`. A database/RLS/network failure is rendered as `All synced`, which is the opposite of the real state.
- Suggested fix direction: Destructure `{ data, error }`, throw on `error`, and render an explicit error/retry state from `useQuery` instead of reporting success.

### Finding 19
- Category: error
- Severity: medium
- Line numbers: 37-45, 86-97
- Description: The generated sync queue row type allows `status: string | null`, but the component assumes non-null status in `some((q: { status: string }) => ...)` and in `STATUS_BADGE_CLASS[item.status]`. A real app typecheck reports TS2345 and TS2538 errors for these lines.
- Suggested fix direction: Normalize nullable statuses before use, e.g. `const status = item.status ?? "unknown"`, and type predicates against the actual row type.

## `src/app/components/CalendarWidget.tsx`

### Finding 20
- Category: failure-point
- Severity: low
- Line numbers: 131-155
- Description: Calendar day buttons expose the day number, selected state, and current date, but the workout dot is visual-only and locked dates rely on disabled styling. Screen reader users are not told which dates have workouts or why a date is unavailable.
- Suggested fix direction: Add an `aria-label` that includes the full date plus states such as `selected`, `today`, `has workout`, and `locked/unavailable`.

## `src/app/components/CalendarWidgetMobile.tsx`

### Finding 21
- Category: failure-point
- Severity: low
- Line numbers: 110-136
- Description: The mobile calendar has the same accessibility gap as the desktop calendar: workout indicators and locked-date status are communicated only visually.
- Suggested fix direction: Add full stateful `aria-label` text for each day button and ensure locked dates expose a reason when available.
