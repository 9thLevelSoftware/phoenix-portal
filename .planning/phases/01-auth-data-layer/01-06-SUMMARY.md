---
phase: 01-auth-data-layer
plan: 06
subsystem: database
tags: [supabase-realtime, tanstack-query, broadcast, session-detail, zod]

# Dependency graph
requires:
  - phase: 01-auth-data-layer/02
    provides: AuthProvider with user.id for realtime channel subscription
  - phase: 01-auth-data-layer/03
    provides: QueryClientProvider, query key factory, Zod schemas with transforms
  - phase: 01-auth-data-layer/04
    provides: workoutListOptions pattern and test utility wrapper
provides:
  - useRealtimeSync hook subscribing to Supabase Broadcast channel for live data sync
  - sessionDetailOptions queryOptions for fetching session with nested exercises and sets
  - SessionDetail page loading real data from Supabase with loading/error states
  - All page components now use Supabase data via TanStack Query (zero mock data)
affects: [02-dashboard-ux, 04-biomechanics]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Supabase Broadcast channel for cross-device sync (not postgres_changes)
    - Invalidate all query domains on sync event for broad cache refresh
    - Nested query pattern (session -> exercises -> sets) with Zod validation at each level
    - Auto-expand first item pattern for exercise accordion

key-files:
  created:
    - src/hooks/useRealtimeSync.ts
  modified:
    - src/app/App.tsx
    - src/queries/workouts.ts
    - src/app/components/SessionDetail.tsx

key-decisions:
  - "Broadcast channel (not postgres_changes) for realtime sync -- matches mobile app architecture"
  - "Invalidate all 5 query domains on sync_complete -- sync could affect any data"
  - "Removed Performance Metrics section from SessionDetail -- requires real sensor data (Phase 4)"
  - "SessionDetail computes totalSets and prCount from nested exercise/set data"

patterns-established:
  - "useRealtimeSync mounted once in App shell, not per-page"
  - "Channel cleanup via supabase.removeChannel in useEffect return"
  - "Nested fetch pattern: session -> exercises -> sets with Zod parse at each level"

# Metrics
duration: 3min
completed: 2026-02-15
---

# Phase 01 Plan 06: Realtime Sync Bridge & SessionDetail Migration Summary

**Supabase Broadcast channel sync bridge invalidating all query caches on mobile sync, plus SessionDetail migrated from mock data to nested Supabase queries with Zod transforms**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-15T23:06:52Z
- **Completed:** 2026-02-15T23:09:29Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created useRealtimeSync hook subscribing to `sync:{userId}` Broadcast channel that invalidates all 5 query domains on sync_complete
- Added sessionDetailOptions query fetching session metadata, exercises, and sets with Zod validation
- Migrated SessionDetail from hardcoded mock data to useQuery with loading skeletons and error state
- Phase 1 complete: all page components now use Supabase data via TanStack Query

## Task Commits

Each task was committed atomically:

1. **Task 1: Create realtime sync bridge and mount in App.tsx** - `cb47ad7` (feat)
2. **Task 2: Migrate SessionDetail to real Supabase data** - `8e9a218` (feat)

## Files Created/Modified
- `src/hooks/useRealtimeSync.ts` - Broadcast channel subscription with cache invalidation on sync events
- `src/app/App.tsx` - Mounted useRealtimeSync hook in app shell before conditional returns
- `src/queries/workouts.ts` - Added sessionDetailOptions with nested session/exercise/set fetching
- `src/app/components/SessionDetail.tsx` - Replaced all mock data with useQuery, added loading/error states

## Decisions Made

**Broadcast channel (not postgres_changes) for realtime sync**
- Rationale: Matches the mobile app architecture where the mobile app sends a broadcast event after sync completes. More efficient than watching individual table changes.

**Invalidate all 5 query domains on sync_complete**
- Rationale: A mobile sync could affect workouts, records, analytics, routines, or cycles. Broad invalidation is simpler and safer than trying to determine which specific queries changed.

**Removed Performance Metrics section from SessionDetail**
- Rationale: The mock data included sensor metrics (peak power, avg power, time under tension, force distribution) that require real Vitruvian sensor data. These are Phase 4 (biomechanics) features. Keeping mock metrics in a real-data component would be misleading.

**SessionDetail computes totalSets and prCount from nested data**
- Rationale: These stats are derived from the exercises and sets arrays rather than stored separately, ensuring consistency with displayed data.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Phase 1 Complete:**
- All page components use Supabase data via TanStack Query (zero mock data in any page)
- Realtime sync bridge ensures portal auto-updates when mobile app syncs
- Query patterns established for all 5 data domains
- Auth, data layer, and sync infrastructure fully operational

**Ready for Phase 2 (Dashboard UX):**
- Dashboard data flows from Supabase through Zod transforms
- Realtime updates will refresh dashboard automatically
- Loading skeletons and error states in place across all pages

**Blockers:**
- None

## Self-Check: PASSED

All files and commits verified:
- FOUND: src/hooks/useRealtimeSync.ts
- FOUND: src/app/App.tsx
- FOUND: src/queries/workouts.ts
- FOUND: src/app/components/SessionDetail.tsx
- Commit cb47ad7 exists (Task 1)
- Commit 8e9a218 exists (Task 2)

---
*Phase: 01-auth-data-layer*
*Completed: 2026-02-15*
