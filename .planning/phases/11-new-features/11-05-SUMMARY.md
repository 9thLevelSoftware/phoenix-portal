---
phase: 11-new-features
plan: 05
subsystem: ui
tags: [comparison, workout, delta, velocity, tier-gate, radix-tabs, dialog]

# Dependency graph
requires:
  - phase: 10-wire-up-mock-purge
    provides: sessionDetailOptions, workoutListOptions, useSubscription, useIsMobile
provides:
  - Pure compareSessions() computation library
  - ComparisonView page at /compare with desktop and mobile layouts
  - ComparisonSessionPicker dialog component
  - WorkoutHistory multi-select compare mode
  - SessionDetail "Compare with..." button
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "comparisonDetailOptions extends sessionDetailOptions with rep_summaries velocity data"
    - "Compare mode toggle pattern with local state selection tracking"
    - "Tier-gated feature with upgrade prompt (ComparisonView) and disabled button (SessionDetail)"

key-files:
  created:
    - src/lib/comparison.ts
    - src/app/components/ComparisonView.tsx
    - src/app/components/ComparisonSessionPicker.tsx
  modified:
    - src/queries/keys.ts
    - src/queries/workouts.ts
    - src/app/components/WorkoutHistory.tsx
    - src/app/components/SessionDetail.tsx
    - src/app/routes/index.tsx

key-decisions:
  - "Velocity data sourced from rep_summaries mean_velocity_mps, averaged per exercise per session"
  - "Compare mode in WorkoutHistory forces list view for selection UX clarity"
  - "SessionDetail: FREE users see disabled Compare button with title tooltip; premium users get full picker dialog"

patterns-established:
  - "Pure computation library: comparison.ts exports compareSessions() with no side effects for testability"
  - "Feature-gated pattern: component-level isPremium check with upgrade prompt redirect to /pricing"

requirements-completed: [COMP-01, COMP-02, COMP-03, COMP-04, COMP-05, COMP-06, COMP-07, COMP-08]

# Metrics
duration: 7min
completed: 2026-02-17
---

# Phase 11 Plan 05: Session Comparison Summary

**Workout comparison with pure delta computation, side-by-side desktop layout, mobile A/B tabs, velocity tracking from rep_summaries, and dual entry points from WorkoutHistory and SessionDetail**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-17T19:32:00Z
- **Completed:** 2026-02-17T19:39:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Pure compareSessions() function computes volume, duration, and per-exercise deltas with velocity tracking
- ComparisonView page with side-by-side desktop layout and A/B tabs on mobile
- Two entry points: WorkoutHistory multi-select compare mode and SessionDetail "Compare with..." picker
- Tier-gated to PHOENIX/ELITE with upgrade prompt for FREE users
- Warning banner when fewer than 2 shared exercises; same-session validation

## Task Commits

Each task was committed atomically:

1. **Task 1: Comparison computation library + ComparisonView page + mobile layout** - `2a8addc` (feat - pre-staged in prior batch)
2. **Task 2: Session picker + WorkoutHistory multi-select + SessionDetail button wire** - `0e50cb7` (feat)

## Files Created/Modified
- `src/lib/comparison.ts` - Pure comparison computation: SessionSummary, ComparisonResult, compareSessions()
- `src/app/components/ComparisonView.tsx` - Full comparison page with desktop/mobile layouts, loading/error/tier-gate states
- `src/app/components/ComparisonSessionPicker.tsx` - Dialog for selecting comparison target with search and session exclusion
- `src/queries/keys.ts` - Added comparison query key to workouts block
- `src/queries/workouts.ts` - Added comparisonDetailOptions with rep_summaries velocity fetching
- `src/app/components/WorkoutHistory.tsx` - Compare toggle button, multi-select mode, "Compare Selected" action
- `src/app/components/SessionDetail.tsx` - Replaced placeholder with working ComparisonSessionPicker integration
- `src/app/routes/index.tsx` - Added /compare route with lazy-loaded ComparisonView

## Decisions Made
- Velocity data sourced from rep_summaries mean_velocity_mps, averaged per exercise per session. Shows em-dash when no velocity data available.
- Compare mode in WorkoutHistory forces list view (calendar cells are too small for selection checkboxes).
- SessionDetail: FREE users see a disabled "Compare with..." button rather than hiding it entirely (discovery/upsell pattern).
- comparisonDetailOptions uses a separate query key from sessionDetailOptions to avoid cache interference, since it fetches additional rep_summaries data.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1 files pre-committed in batch**
- **Found during:** Task 1 (commit step)
- **Issue:** Task 1 files (comparison.ts, ComparisonView.tsx, keys.ts, workouts.ts, index.tsx) were already committed in hash 2a8addc as part of a prior plan batch execution
- **Fix:** Verified file content is correct, proceeded without re-committing
- **Impact:** No functional impact; commit message does not match plan name

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No scope creep. Pre-staged commit contained correct code.

## Issues Encountered
- Pre-existing test failures (10/10 tests fail on HEAD without any changes) due to missing Router/AuthProvider wrappers in test setup. Not caused by this plan's changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Workout comparison feature fully wired with both entry points
- All 8 COMP requirements satisfied
- Ready for visual verification with live data

## Self-Check: PASSED

All 8 created/modified files verified present. Both commit hashes (2a8addc, 0e50cb7) confirmed in git log.

---
*Phase: 11-new-features*
*Completed: 2026-02-17*
