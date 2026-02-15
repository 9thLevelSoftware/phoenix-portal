---
phase: 01-auth-data-layer
plan: 04
subsystem: database
tags: [tanstack-query, supabase, zod, react-query, data-migration]

# Dependency graph
requires:
  - phase: 01-auth-data-layer/02
    provides: AuthProvider with user.id for data queries
  - phase: 01-auth-data-layer/03
    provides: QueryClientProvider, query key factory, Zod schemas with transforms
provides:
  - workoutListOptions queryOptions for paginated workout session list
  - dashboardStatsOptions queryOptions for 7-day dashboard aggregations
  - recentPRsOptions queryOptions for recent personal records
  - Dashboard, DashboardMobile, WorkoutHistory using real Supabase data via useQuery
  - Loading skeleton states for all data-dependent sections
  - Empty states guiding users to sync from mobile app
  - Test utility wrapper (renderWithProviders) for auth-gated component tests
affects: [01-05-routine-sync, 01-06-analytics-sync]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - queryOptions functions in src/queries/ return configured TanStack Query options
    - Components derive chart data from raw query results (no server-side aggregation)
    - Loading skeletons from ui/skeleton.tsx used during isPending state
    - Empty states with guidance text when query returns zero results
    - formatRelativeTime utility for human-readable date display
    - vi.hoisted + vi.mock pattern for auth mocking in component tests

key-files:
  created:
    - src/queries/workouts.ts
    - src/test/test-utils.tsx
  modified:
    - src/app/components/Dashboard.tsx
    - src/app/components/DashboardMobile.tsx
    - src/app/components/WorkoutHistory.tsx
    - src/app/components/__tests__/Dashboard.test.tsx
    - src/app/components/__tests__/WorkoutHistory.test.tsx
    - src/app/components/__tests__/Analytics.test.tsx
    - src/app/components/__tests__/PersonalRecords.test.tsx
    - src/app/components/__tests__/RoutinesEnhanced.test.tsx
    - src/app/components/__tests__/TrainingCycles.test.tsx

key-decisions:
  - "Dashboard derives weekly volume chart data client-side from raw query results"
  - "Challenges and badges remain as TODO mock data for future phases (3 and 5)"
  - "WorkoutHistory computes streak from actual workout dates instead of hardcoding"
  - "DashboardMobile pull-to-refresh invalidates query cache instead of simulating API call"
  - "Test utility with vi.hoisted pattern for auth mocking across all component tests"

patterns-established:
  - "queryOptions pattern: src/queries/{domain}.ts exports functions returning queryOptions objects"
  - "Components use useAuth().user!.id to parameterize queries"
  - "Loading state: isPending renders skeleton components; empty array renders guidance message"
  - "renderWithProviders wraps components with QueryClientProvider for testing"

# Metrics
duration: 9min
completed: 2026-02-15
---

# Phase 01 Plan 04: Dashboard & WorkoutHistory Data Migration Summary

**Dashboard and WorkoutHistory migrated from mock arrays to real Supabase queries with Zod-validated transforms, loading skeletons, and empty state guidance**

## Performance

- **Duration:** 9 min
- **Started:** 2026-02-15T22:55:14Z
- **Completed:** 2026-02-15T23:04:19Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Created workout query options (workoutListOptions, dashboardStatsOptions, recentPRsOptions) with Supabase queries and Zod validation
- Migrated Dashboard, DashboardMobile, and WorkoutHistory from hardcoded mock arrays to useQuery with real data
- Added loading skeletons and empty states to all three components
- Fixed all 10 smoke tests by creating test-utils with auth mock wrapper and QueryClientProvider

## Task Commits

Each task was committed atomically:

1. **Task 1: Create workout query options** - `a1c5ba2` (feat)
2. **Task 2: Migrate Dashboard, DashboardMobile, WorkoutHistory to real data** - `872522c` (feat)

## Files Created/Modified
- `src/queries/workouts.ts` - queryOptions for workout list, dashboard stats, and recent PRs
- `src/test/test-utils.tsx` - renderWithProviders wrapper with QueryClient for component tests
- `src/app/components/Dashboard.tsx` - Replaced mock data with useQuery, added skeletons and empty states
- `src/app/components/DashboardMobile.tsx` - Same migration with mobile-optimized layout
- `src/app/components/WorkoutHistory.tsx` - Replaced mockWorkouts with useQuery, computed streak from real data
- `src/app/components/__tests__/*.test.tsx` - Updated 6 test files with auth mocks and provider wrappers

## Decisions Made

**Dashboard derives weekly volume chart data client-side**
- Rationale: dashboardStatsOptions returns raw 7-day workout rows. Dashboard aggregates by day-of-week to produce the { day, volume } chart format. Avoids a separate server-side aggregation query.

**Challenges and badges remain as TODO mock data**
- Rationale: These are Phase 5 (Community) and Phase 3 (Subscriptions) features. Marked with TODO comments for future migration.

**WorkoutHistory computes streak from actual workout dates**
- Rationale: Previously hardcoded to 7. Now uses useMemo to count consecutive days with workouts from real data.

**DashboardMobile pull-to-refresh invalidates query cache**
- Rationale: Replaced setTimeout mock with queryClient.invalidateQueries for real cache invalidation.

**Test utility with vi.hoisted pattern**
- Rationale: vi.mock factory functions are hoisted before imports, so mock values must use vi.hoisted() to be available. Created shared test-utils.tsx for reuse.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed all smoke tests broken by auth/query integration**
- **Found during:** Task 2 (verification step)
- **Issue:** 4 tests (Dashboard, WorkoutHistory, Analytics, PersonalRecords) failed because components now require AuthProvider and QueryClientProvider contexts. Additionally TrainingCycles and RoutinesEnhanced had same issue from prior plan migrations.
- **Fix:** Created src/test/test-utils.tsx with renderWithProviders wrapper and vi.hoisted auth mocks. Updated 6 test files to use the wrapper and match loading state expectations.
- **Files modified:** src/test/test-utils.tsx, 6 test files in __tests__/
- **Verification:** All 10 tests pass
- **Committed in:** 872522c (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Test infrastructure fix was necessary for verification. Analytics, PersonalRecords, RoutinesEnhanced, and TrainingCycles test failures were pre-existing from prior plan auth migrations but fixed here for correctness.

## Issues Encountered

None beyond the test fixes documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for 01-05 (Routine Sync):**
- Query pattern established (queryOptions in src/queries/, components use useQuery)
- Test utility available for auth-gated component testing
- Zod schemas handle all data transforms

**Ready for 01-06 (Analytics Sync):**
- dashboardStatsOptions pattern can be extended for analytics queries
- Loading/empty state patterns established for reuse

**Blockers:**
- None

## Self-Check: PASSED

All files and commits verified:
- FOUND: src/queries/workouts.ts
- FOUND: src/test/test-utils.tsx
- FOUND: src/app/components/Dashboard.tsx
- FOUND: src/app/components/DashboardMobile.tsx
- FOUND: src/app/components/WorkoutHistory.tsx
- Commit a1c5ba2 exists (Task 1)
- Commit 872522c exists (Task 2)

---
*Phase: 01-auth-data-layer*
*Completed: 2026-02-15*
