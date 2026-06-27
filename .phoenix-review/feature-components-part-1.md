# Feature Components Part 1 Review

Scope reviewed: workout history, goals, training cycles, pricing, subscription gates, profile, account danger zone, and export components.

Verification performed:
- Read all 15 assigned files in full.
- Ran `npm run typecheck -- --pretty false` successfully.

Findings summary:
- Total findings: 20
- Critical: 0
- High: 2
- Medium: 10
- Low: 8

## src/app/components/WorkoutHistory.tsx

### Finding 1
- Category: failure-point
- Severity: low
- Line numbers: 56-63, 508-520
- Description: Workout cards are clickable `Card`/`div` UI with `onClick`, but they are not keyboard-focusable and do not expose button/link semantics. Keyboard and assistive-technology users cannot open a workout or select workouts for compare mode reliably.
- Suggested fix direction: Render the interactive card as a `button`/`Link`, or add `role="button"`, `tabIndex={0}`, and Enter/Space key handling while preserving visible focus styles.

### Finding 2
- Category: bug
- Severity: medium
- Line numbers: 246-266
- Description: `handleLoadMore` calls `workoutListPageOptions(user.id, nextOffset)` without passing `activeProfileId`. The initial list is profile-filtered, but additional pages are fetched across all profiles, so using a profile filter can append unrelated workouts and corrupt stats, calendar markers, and history contents.
- Suggested fix direction: Pass `activeProfileId` into `workoutListPageOptions`, include it in the callback dependencies, and reset `loadedPages`/`extraWorkouts` when the active profile filter changes.

## src/app/components/WorkoutQuickStats.tsx

No findings.

## src/app/components/SessionDetail.tsx

### Finding 3
- Category: bug
- Severity: medium
- Line numbers: 498-543
- Description: The Session Config card is only rendered when `eccentric_load` or `echo_level` is non-null, but the card also contains `warmup_reps` and `working_reps`. Sessions that only have warmup/working rep configuration silently hide those values.
- Suggested fix direction: Include `warmup_reps != null || working_reps != null` in the outer render condition, or compute a single `hasSessionConfig` boolean covering all fields rendered in the card.

### Finding 4
- Category: stub
- Severity: low
- Line numbers: 720-724
- Description: The Share Summary action is a placeholder that only shows `Session sharing coming in a future update`. This is exposed as an active button, so users can click a feature that has no implementation.
- Suggested fix direction: Hide or disable the button until sharing is implemented, or wire it to the real share/export flow.

## src/app/components/SummaryReport.tsx

### Finding 5
- Category: bug
- Severity: high
- Line numbers: 80-87, 323-329, and src/queries/progress.ts lines 115-130
- Description: `weeklySummaryOptions` fetches only the selected current window (`7` or `30` days), but `computeSummary` tries to split that data at `now - daysInPeriod`. As a result `previous` is always empty for normal query results, so percent-change comparisons show misleading `100%` jumps and all current PRs can be treated as first-time records.
- Suggested fix direction: Fetch two periods of data for comparisons (14 days for week, 60 days for month), or pass separate current/previous datasets into `computeSummary`.

### Finding 6
- Category: bug
- Severity: medium
- Line numbers: 151-162, 481-492
- Description: `dailyWorkoutMap` increments once per `ExerciseProgress` row, not once per workout/session. Days with multiple exercises in one session are displayed as multiple workouts in the frequency sparkline.
- Suggested fix direction: Count unique `session_id`s per day (for example, map day -> `Set<session_id>`) and chart the size of each set.

## src/app/components/Goals.tsx

### Finding 7
- Category: failure-point
- Severity: medium
- Line numbers: 381-399
- Description: Goal completion marks a goal as celebrated before the `updateGoal.mutate` call succeeds. If the mutation fails, `celebratedRef` suppresses future completion attempts for that goal in this component instance, leaving a goal at 100% but still active until reload or remount.
- Suggested fix direction: Add the goal ID to `celebratedRef` only in mutation success handling, or remove it from the set in `onError` so completion can retry.

### Finding 8
- Category: bug
- Severity: medium
- Line numbers: 312-314, 412-443
- Description: The comment and limit logic say `FREE = 1`, but the page returns an upgrade gate for every non-premium user before the one-goal free limit can ever be used. This makes the free-tier goal limit dead code and creates inconsistent product behavior.
- Suggested fix direction: Align the gate with the intended product rule: either allow free users through with `maxGoals = 1`, or remove the free-limit logic/comment if goals are truly paid-only.

## src/app/components/GoalDashboardWidget.tsx

### Finding 9
- Category: failure-point
- Severity: low
- Line numbers: 19-28
- Description: The widget calls `useGoalProgress(activeProfileId)` before returning the non-premium locked card. That hook performs goal/workout/record queries even when the user cannot see goal data, adding avoidable network work on the dashboard.
- Suggested fix direction: Split the paid widget body into a child component rendered only after the premium check, or add enabled gates to the underlying queries used by goal progress.

## src/app/components/GoalProgressRing.tsx

### Finding 10
- Category: failure-point
- Severity: low
- Line numbers: 20-25
- Description: The SVG has an `aria-label`, but no explicit `role="img"`. Some assistive technologies do not announce standalone SVG labels consistently without an image role.
- Suggested fix direction: Add `role="img"` to the SVG, or mark the SVG decorative and expose the percentage in adjacent text.

## src/app/components/TrainingCycles.tsx

### Finding 11
- Category: failure-point
- Severity: medium
- Line numbers: 39-41, 51, 106-140
- Description: Query errors are not handled. If `cycleListOptions` fails, `cycles` is undefined, `allCycles` becomes `[]`, and the UI displays the empty-state "Plan your training cycle" instead of an error/retry state. This can mislead users into thinking their cycles are gone.
- Suggested fix direction: Read `error`/`isError` from `useQuery` and render a distinct error card with retry before falling back to the empty state.

### Finding 12
- Category: failure-point
- Severity: low
- Line numbers: 258-265
- Description: The dropdown trigger is an icon-only button without an accessible label. Screen reader users hear an unlabeled button and cannot tell it opens cycle actions.
- Suggested fix direction: Add `aria-label={`Open actions for ${cycle.name}`}` or visible sr-only text inside the trigger.

## src/app/components/PricingPlans.tsx

### Finding 13
- Category: failure-point
- Severity: medium
- Line numbers: 260-262, 302-388, 607-613
- Description: Direct Subscribe buttons do not set any in-flight state while `openCheckout` is starting. Users can repeatedly click Subscribe and potentially open multiple checkout attempts, unlike plan-change buttons that use `billingActionPriceId`.
- Suggested fix direction: Track the selected checkout price ID in `handleSubscribe`, disable the button while checkout is starting, and clear it on failure/cancel/success as appropriate.

### Finding 14
- Category: failure-point
- Severity: low
- Line numbers: 810-814
- Description: The cancel-subscription confirmation action is not disabled while `isCanceling` is true. Repeated clicks can send duplicate cancel requests before the dialog closes.
- Suggested fix direction: Add `disabled={isCanceling}` to the `AlertDialogAction`, matching the safer pattern used in `Profile.tsx`.

## src/app/components/SubscriptionGate.tsx

### Finding 15
- Category: failure-point
- Severity: low
- Line numbers: 31-32
- Description: Loading always renders a fixed `h-32 w-full` skeleton, even when the caller passed `fallback={null}` or uses the gate around an inline control. This can create large layout jumps or an oversized placeholder where no fallback should appear.
- Suggested fix direction: Allow a dedicated `loadingFallback`, honor `fallback={null}` during loading for inline gates, or size the skeleton based on the gated context.

## src/app/components/UpgradePrompt.tsx

No findings.

## src/app/components/TierBadge.tsx

No findings.

## src/app/components/Profile.tsx

### Finding 16
- Category: bug
- Severity: medium
- Line numbers: 171, 193, 293-295
- Description: The header streak uses `useStreak(workouts)` where `workouts` comes from `workoutListOptions(userId)` with no active profile filter and only the first paginated page. Meanwhile other profile stats use `activeProfileId`. The displayed streak can include other profiles and can be wrong when the streak depends on workouts beyond the first page.
- Suggested fix direction: Use a dedicated streak query that supports `activeProfileId` and fetches enough history for streak computation, rather than the first workout-list page.

### Finding 17
- Category: stub
- Severity: low
- Line numbers: 844-846
- Description: Notification settings are exposed and saved even though the UI states notification delivery is not active yet. Users can change preferences that currently have no effect.
- Suggested fix direction: Keep the notice but disable the controls until delivery is live, or clearly mark the entire section as preparatory/beta with no immediate effect.

### Finding 18
- Category: stub
- Severity: low
- Line numbers: 1023-1045
- Description: Profile visibility and leaderboard participation are labeled "Coming soon -- your preference is saved" while still being interactive. These settings currently do not affect product behavior.
- Suggested fix direction: Disable the switches until enforcement is implemented, or add an explicit beta/inactive state so users do not assume privacy/leaderboard behavior changed immediately.

## src/app/components/profile/DangerZone.tsx

### Finding 19
- Category: failure-point
- Severity: medium
- Line numbers: 161-164
- Description: The final permanent deletion confirmation action is not disabled while `executeDeletion.isPending`. A double-click can send duplicate `delete-account` function invocations for an irreversible operation.
- Suggested fix direction: Disable the final `AlertDialogAction` while `executeDeletion.isPending` and show the existing loading state in the dialog action as well as on the outer button.

## src/app/components/profile/ExportSection.tsx

### Finding 20
- Category: bug
- Severity: high
- Line numbers: 29-30, 51-62, and src/queries/workouts.ts lines 22-39
- Description: "Export Workout History" uses `workoutListOptions`, which is the paginated list query limited to `WORKOUTS_PAGE_SIZE` (50). Users with more than 50 workouts receive an incomplete CSV while the success toast reports only the loaded page count.
- Suggested fix direction: Use an export-specific query/function that pages through all workout sessions, or call the complete data export path for workout CSV generation.
