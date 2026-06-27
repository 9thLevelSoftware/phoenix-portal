# Cycle & Routine Builders Review

Reviewed files:
- `src/app/components/CycleBuilder.tsx`
- `src/app/components/cycle-builder/CycleOverview.tsx`
- `src/app/components/cycle-builder/DayEditor.tsx`
- `src/app/components/cycle-builder/DaySchedule.tsx`
- `src/app/components/cycle-builder/ProgressionRules.tsx`
- `src/app/components/cycle-builder/RoutinePicker.tsx`
- `src/app/components/cycle-builder/types.ts`
- `src/app/components/cycle-builder/WeekOverview.tsx`
- `src/app/components/RoutineBuilder.tsx`
- `src/app/components/RoutineDetail.tsx`
- `src/app/components/routine-builder/SelectionModeBar.tsx`
- `src/app/components/routine-builder/superset-helpers.ts`
- `src/app/components/routine-builder/superset-types.ts`
- `src/app/components/routine-builder/SupersetContainer.tsx`

Verification:
- Read all 14 assigned files in full.
- Ran `npm run typecheck -- --pretty false`; it passed.

Summary:
- Total findings: 28
- Severity breakdown: 0 critical, 2 high, 17 medium, 9 low

## `src/app/components/CycleBuilder.tsx`

### Finding 1
- Category: bug
- Severity: high
- Line numbers: 139, 237, 431-444
- Description: The builder treats `duration` as a number of schedule days in the UI (`Duration (Days)`) but loads and saves the same value as `duration_weeks`. Existing cycles will display week counts as day counts, and new cycles with a 7-day template are saved as 7-week cycles by default. The training cycle list renders `duration_weeks` as weeks, so this produces persisted data that contradicts the UI.
- Suggested fix direction: Split cycle length in weeks from weekly/day-template length. Bind the schedule day count to the `days` array, and bind a separate `durationWeeks` field to `duration_weeks` with week-specific labels and validation.

### Finding 2
- Category: bug
- Severity: high
- Line numbers: 316-333, 438-454, 532-540, 239-248
- Description: Changing the duration input or preset buttons updates only the `duration` state. It does not add/remove entries in `days`, but saving persists `days.map(...)`. Users can set a 3/5/6-day cycle while the stale 7-day schedule is still saved, or set a custom length that does not match the actual schedule.
- Suggested fix direction: Make duration changes reconcile the `days` array atomically, or remove the independent duration control and derive the displayed day-template length from `days.length`.

### Finding 3
- Category: failure-point
- Severity: medium
- Line numbers: 74-77, 342-353
- Description: Edit mode handles only the loading state. If `cycleDetailOptions` fails or returns no cycle, the component falls through into a default blank builder while `isEditing` remains true. The user can then click Save and receive update behavior against an invalid or inaccessible `cycleId` with no clear load error shown.
- Suggested fix direction: Read `isError`/`error` from the query and render a non-editable error/unauthorized state with navigation back to `/cycles`. Consider requiring loaded data before enabling save in edit mode.

### Finding 4
- Category: bug
- Severity: medium
- Line numbers: 326-337, 552-571
- Description: Removing a day reindexes the remaining days but does not clear or remap `selectedDay`. If the selected day is deleted, the editor can immediately point at a different reindexed day, making subsequent edits apply to the wrong day.
- Suggested fix direction: When deleting the selected day, close the editor or explicitly select a predictable adjacent day after reindexing. If deleting a day before the selected one, remap the selected day number to the same logical day.

### Finding 5
- Category: failure-point
- Severity: low
- Line numbers: 327, 824-833
- Description: The day card always renders a remove button, even when only one day remains. `handleRemoveDay` silently returns for the final day, so the UI exposes a destructive control that does nothing.
- Suggested fix direction: Hide or disable the remove button when `days.length <= 1`, and communicate why the final schedule day cannot be removed.

## `src/app/components/cycle-builder/CycleOverview.tsx`

### Finding 1
- Category: bug
- Severity: low
- Line numbers: 31-34, 97-111
- Description: `customMode` is initialized from the first `duration` prop value but never synchronized if the parent later loads or resets the duration. Once Custom is clicked, a subsequent preset duration from the parent can still render the custom input because `customMode` remains true.
- Suggested fix direction: Derive custom mode solely from `duration`, or add an effect that resets `customMode` when `duration` changes to a preset value.

## `src/app/components/cycle-builder/DayEditor.tsx`

### Finding 1
- Category: bug
- Severity: medium
- Line numbers: 108-115
- Description: The `+ Create New Routine` action calls the same `onAssignRoutine` callback as Assign/Change. It opens the routine assignment flow instead of creating a new routine, so the button label and behavior are inconsistent.
- Suggested fix direction: Add a separate `onCreateRoutine` callback that navigates to or opens routine creation, or relabel this button if it is only meant to assign an existing routine.

### Finding 2
- Category: bug
- Severity: medium
- Line numbers: 40-42, 267-275
- Description: Rest-time override state and parsing treat `0` as absent. `restTimeEnabled` is initialized with `!!overrides.restTimeOverride`, and manual input uses `parseInt(...) || 90`, so an explicit 0-second override cannot be displayed or entered even though the decrement button allows `Math.max(0, ...)`.
- Suggested fix direction: Test `overrides.restTimeOverride != null` instead of truthiness, and use `Number.isFinite`/nullish fallback rather than `||` defaults so `0` remains valid.

### Finding 3
- Category: failure-point
- Severity: low
- Line numbers: 136-164, 185-213, 270-275
- Description: Numeric override inputs do not clamp typed values. Users can type very large or negative weight adjustments, negative rep modifiers, or arbitrary rest times; only some button paths clamp values.
- Suggested fix direction: Validate and clamp typed values in each `onChange` path before calling `onUpdateOverrides`, matching the intended domain constraints.

## `src/app/components/cycle-builder/DaySchedule.tsx`

No findings in this file.

## `src/app/components/cycle-builder/ProgressionRules.tsx`

### Finding 1
- Category: bug
- Severity: medium
- Line numbers: 116-133, 454-507
- Description: Several numeric fields use `parseFloat(...) || default` or `parseInt(...) || default`, which makes valid zero values impossible to enter. This conflicts with UI controls/minimums that allow 0 for percentage increases and deload intensity/volume.
- Suggested fix direction: Replace truthy fallbacks with explicit finite-number checks and clamp to allowed ranges. Preserve `0` as a valid value where the UI permits it.

### Finding 2
- Category: failure-point
- Severity: low
- Line numbers: 479-512
- Description: The deload intensity and volume inputs set `min="0"` and `max="100"`, but typed values are not clamped before being stored. Browsers do not reliably prevent invalid typed number input, so values over 100 can be persisted in state.
- Suggested fix direction: Clamp deload percentages to 0-100 in `onChange` before calling `onDeloadConfigChange`.

## `src/app/components/cycle-builder/RoutinePicker.tsx`

### Finding 1
- Category: bug
- Severity: medium
- Line numbers: 208-241, 233-237
- Description: `RoutineItem` renders a `<button>` that contains a shadcn `<Button>` for Select. This creates invalid nested interactive elements and the inner Select click can bubble to the outer button, invoking `onSelect` twice.
- Suggested fix direction: Make the outer container a non-button element with one explicit button, or remove the inner Select button and rely on the outer button only.

### Finding 2
- Category: failure-point
- Severity: low
- Line numbers: 52-68, 75-77
- Description: The custom modal does not implement focus trapping, Escape handling, or explicit dialog semantics. Keyboard and assistive-technology users can tab behind the overlay or may not get a proper modal announcement.
- Suggested fix direction: Use the shared Dialog component or add `role="dialog"`, `aria-modal="true"`, labelled title, Escape close handling, and focus trap/restore behavior.

## `src/app/components/cycle-builder/types.ts`

No findings in this file.

## `src/app/components/cycle-builder/WeekOverview.tsx`

### Finding 1
- Category: stub
- Severity: medium
- Line numbers: 14-22, 97-107
- Description: Muscle group distribution is hard-coded mock data while the UI says it is based on assigned routines. Balance warnings are therefore based on static placeholder percentages, not the actual schedule.
- Suggested fix direction: Compute distribution from assigned routine exercises, or hide this section until real routine volume data is available.

### Finding 2
- Category: bug
- Severity: medium
- Line numbers: 24, 35-36
- Description: The week grid uses `dayNames.slice(0, days.length)`, but `dayNames` has only seven entries. Any cycle/day template longer than seven days silently omits days beyond the first week.
- Suggested fix direction: Iterate over `days` directly and derive labels with modulo weekdays or `Day N` labels for schedules longer than seven days.

## `src/app/components/RoutineBuilder.tsx`

### Finding 1
- Category: bug
- Severity: medium
- Line numbers: 351-355
- Description: Saving a routine always sends `description: ""`. Editing and saving an existing routine will erase its description even if the user did not intend to change it, and there is no field in this builder to preserve or edit the description.
- Suggested fix direction: Initialize and persist a `description` state from `existingRoutine.description`, or omit `description` from update payloads unless the builder exposes a description field.

### Finding 2
- Category: bug
- Severity: medium
- Line numbers: 283-301
- Description: Superset creation overwrites the selected exercises' `supersetId` without checking whether any are already members of other supersets. Selecting exercises from existing groups can split those groups and leave orphaned one-exercise supersets behind.
- Suggested fix direction: Prevent selecting already-supersetted exercises for a new group, or explicitly ungroup/rebalance affected source groups before applying the new superset.

### Finding 3
- Category: failure-point
- Severity: medium
- Line numbers: 263-269, 307-321, 142-168
- Description: Deleting an exercise only removes that exercise. If it was part of a two-exercise superset, the remaining exercise keeps its `supersetId`, so the builder can save an invalid one-exercise superset and continue rendering it as a group.
- Suggested fix direction: After deletion, detect supersets with fewer than two members and automatically clear their superset fields or prompt the user to ungroup.

### Finding 4
- Category: bug
- Severity: medium
- Line numbers: 284, 290-299
- Description: `supersetOrder` is assigned from the order in which exercises were selected, not from their order in the routine. Users who click exercises out of list order get a superset execution order that differs from the displayed routine order.
- Suggested fix direction: Sort selected IDs by their current index in `exercises` before assigning `supersetOrder`, unless the UI explicitly supports manual ordering within the selected set.

### Finding 5
- Category: failure-point
- Severity: medium
- Line numbers: 594-598
- Description: The detail panel uses a non-null assertion on `exercises.find(...)`. If `selectedExercise` ever becomes stale after a state refresh or mutation, the component crashes instead of closing the panel or showing an empty state.
- Suggested fix direction: Resolve the selected exercise into a variable, render `EmptyDetailPanel` when it is missing, and clear stale `selectedExercise` in an effect when `exercises` changes.

### Finding 6
- Category: bug
- Severity: low
- Line numbers: 95-98, 1097-1101
- Description: Kilogram weights are displayed with `Math.round(converted)`, so fractional kg values are lost in the input display. A user opening a 2.5 kg value sees `3`, and editing can persist the rounded value.
- Suggested fix direction: Use the same decimal-preserving formatting as `weightInputValue` for controlled inputs, or preserve the raw input string while editing.

## `src/app/components/RoutineDetail.tsx`

### Finding 1
- Category: failure-point
- Severity: low
- Line numbers: 221-319
- Description: The detail page has no empty-state branch for routines with zero exercises. It renders the header/stat cards and then an empty content area, which looks like a loading or rendering failure.
- Suggested fix direction: Add an explicit empty routine state with a call to edit/add exercises when `routine.routine_exercises.length === 0`.

## `src/app/components/routine-builder/SelectionModeBar.tsx`

No findings in this file.

## `src/app/components/routine-builder/superset-helpers.ts`

### Finding 1
- Category: stub
- Severity: medium
- Line numbers: 1-22
- Description: The file still contains integration-instruction comments such as "Add these interfaces and state to existing RoutineBuilder.tsx" and commented-out state declarations. This reads as a leftover implementation stub rather than finalized production helper code.
- Suggested fix direction: Remove scaffolding comments, keep only the exported helper API, and ensure the helpers are actually integrated or delete the unused module.

### Finding 2
- Category: bug
- Severity: medium
- Line numbers: 62-70
- Description: `addExerciseToSuperset` blindly appends `exerciseId` to the target group. It does not prevent duplicates and does not remove the exercise from any existing superset, so callers can create duplicate membership or cross-superset membership.
- Suggested fix direction: Make the helper idempotent, reject duplicates, and clear the exercise from other groups before adding it to the target group.

### Finding 3
- Category: failure-point
- Severity: low
- Line numbers: 42-49
- Description: `createSuperset` uses `Date.now()` for IDs. Two supersets created in the same millisecond can collide, especially in tests or batched UI actions.
- Suggested fix direction: Use `crypto.randomUUID()` or a monotonic ID generator for client-created superset IDs.

## `src/app/components/routine-builder/superset-types.ts`

### Finding 1
- Category: failure-point
- Severity: low
- Line numbers: 34-56, 59-64
- Description: There are only four superset colors/labels, and `getNextSupersetColor` cycles back to the first color after all are used. A fifth superset becomes visually labelled the same as the first, making groups ambiguous.
- Suggested fix direction: Expand the palette/labels or derive labels from group index so each group remains distinguishable even when colors repeat.

## `src/app/components/routine-builder/SupersetContainer.tsx`

### Finding 1
- Category: bug
- Severity: medium
- Line numbers: 175-180, 221-225
- Description: Rest-after and transition inputs use `parseInt(...) || default`, so users cannot type an explicit `0` even though the decrement buttons clamp down to 0. Clearing or entering 0 jumps back to 90s/10s.
- Suggested fix direction: Preserve zero by using explicit parse validation and nullish/default handling instead of truthy `||` fallbacks.

### Finding 2
- Category: failure-point
- Severity: medium
- Line numbers: 125-131, 148-157
- Description: The container allows removing any exercise from a superset without guarding against leaving fewer than two exercises. That can produce an invalid one-exercise superset while still showing the group UI.
- Suggested fix direction: Disable the remove action at the minimum valid group size, or make removal of the second-to-last exercise automatically ungroup the superset.
