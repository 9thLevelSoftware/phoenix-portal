---
phase: 12-schedule-dependent-features-delivery
plan: 01
subsystem: ui
tags: [react, tdd, dashboard, training-cycle, pure-function, tanstack-query]

# Dependency graph
requires:
  - phase: 10-wire-up-mock-purge
    provides: "cycleListOptions, cycleDetailOptions query infrastructure"
provides:
  - "computeNextWorkout pure function for mapping cycle data + date to workout day"
  - "NextWorkoutWidget component for Dashboard and DashboardMobile"
  - "Smart workout day display replacing generic cycle info"
affects: [12-schedule-dependent-features-delivery]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Pure function with explicit date parameter for testability", "Nested query pattern (widget fetches its own detail data by ID)"]

key-files:
  created:
    - src/lib/computeNextWorkout.ts
    - src/lib/computeNextWorkout.test.ts
    - src/app/components/NextWorkoutWidget.tsx
  modified:
    - src/app/components/Dashboard.tsx
    - src/app/components/DashboardMobile.tsx

key-decisions:
  - "computeNextWorkout normalizes dates to midnight local time to avoid timezone drift across day boundaries"
  - "NextWorkoutWidget fetches cycle detail and routine name independently via nested queries rather than prop-drilling from Dashboard"
  - "Rest day card uses green success accent to distinguish from workout days (primary/ember)"

patterns-established:
  - "Pure function with explicit `today` parameter for deterministic testing"
  - "Widget component that owns its own data fetching (cycleDetailOptions + routineDetailOptions)"

requirements-completed: []

# Metrics
duration: 4min
completed: 2026-02-17
---

# Phase 12 Plan 01: Smart Workout Widget Summary

**TDD-built computeNextWorkout pure function with NextWorkoutWidget replacing Dashboard placeholder cards to show today's specific workout day or rest day**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-17T20:50:23Z
- **Completed:** 2026-02-17T20:54:48Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Pure function `computeNextWorkout` with 8 test cases covering all edge cases (empty, before start, after end, wraparound, rest days, week computation)
- `NextWorkoutWidget` component with workout day, rest day, loading, and error states
- Dashboard and DashboardMobile now show today's specific workout day name and routine instead of generic cycle info

## Task Commits

Each task was committed atomically:

1. **Task 1: TDD computeNextWorkout pure function** - `ced4d3c` (feat)
2. **Task 2: NextWorkoutWidget component and Dashboard integration** - `2950938` (feat)

## Files Created/Modified
- `src/lib/computeNextWorkout.ts` - Pure function mapping cycle data + today's date to NextWorkoutResult
- `src/lib/computeNextWorkout.test.ts` - 8 unit tests covering all edge cases
- `src/app/components/NextWorkoutWidget.tsx` - Dashboard card showing today's workout/rest day with routine name
- `src/app/components/Dashboard.tsx` - Replaced Scheduled Workout card with NextWorkoutWidget
- `src/app/components/DashboardMobile.tsx` - Replaced Scheduled Workout section with NextWorkoutWidget

## Decisions Made
- computeNextWorkout normalizes dates to midnight local time to avoid timezone drift across day boundaries
- NextWorkoutWidget fetches cycle detail and routine name independently via nested queries rather than prop-drilling from Dashboard
- Rest day card uses green success accent to distinguish from workout days (primary/ember)
- Removed unused `Clock` import from both Dashboard files as part of cleanup

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused Clock import**
- **Found during:** Task 2 (Dashboard integration)
- **Issue:** After replacing the Scheduled Workout card, `Clock` icon import was no longer used in Dashboard.tsx and DashboardMobile.tsx
- **Fix:** Removed unused import to prevent build warnings
- **Files modified:** src/app/components/Dashboard.tsx, src/app/components/DashboardMobile.tsx
- **Verification:** Build passes with no warnings
- **Committed in:** 2950938 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug/cleanup)
**Impact on plan:** Trivial cleanup, no scope creep.

## Issues Encountered
- 10 pre-existing component smoke test failures (Analytics, Challenges, Community, Dashboard, LandingPage, PersonalRecords, Profile, RoutinesEnhanced, TrainingCycles, WorkoutHistory) all fail due to missing Router context wrapper -- not caused by our changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- computeNextWorkout is available for reuse in any component that needs workout day computation
- NextWorkoutWidget pattern can be extended for notifications or scheduling features
- Dashboard integration complete for both desktop and mobile

## Self-Check: PASSED

- All 4 created files exist on disk
- Both task commits (ced4d3c, 2950938) verified in git log
- 8/8 unit tests pass
- Build succeeds with zero TypeScript errors

---
*Phase: 12-schedule-dependent-features-delivery*
*Completed: 2026-02-17*
