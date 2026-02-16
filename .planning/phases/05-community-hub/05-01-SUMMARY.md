---
phase: 05-community-hub
plan: 01
subsystem: database, state
tags: [zod, tanstack-query, zustand, supabase-realtime, community]

requires:
  - phase: 01-auth-data-layer
    provides: "Supabase client, Zod transform patterns, TanStack Query key factory, Zustand store pattern"
provides:
  - "Community database type stubs (shared_routines, shared_cycles, community_votes, saved_community_items, creator_stats)"
  - "Zod schemas for all community data shapes with date transforms"
  - "Paginated infinite query options for community feed"
  - "Query options for creator stats, featured creators, saved items, user votes"
  - "Zustand store for community UI state (tab, sort, search, filters)"
  - "Realtime vote subscription hook with debounced invalidation"
  - "Generic useDebounce hook"
affects: [05-02-community-feed, 05-03-community-detail, 05-04-community-sharing]

tech-stack:
  added: []
  patterns: [infinite-query-pagination, realtime-debounced-invalidation, generic-debounce-hook]

key-files:
  created:
    - src/schemas/community.ts
    - src/queries/community.ts
    - src/stores/useCommunityStore.ts
    - src/hooks/useCommunityRealtime.ts
    - src/hooks/useDebounce.ts
  modified:
    - src/lib/database.types.ts
    - src/queries/keys.ts

key-decisions:
  - "Added display_name and avatar_url to profiles table stub for community author display"
  - "Profiles field optional in Zod schemas (present when joined, absent in raw queries)"
  - "300ms default debounce for search input, 2500ms for realtime vote invalidation"
  - "Muted parameter on realtime hook to skip invalidation during optimistic votes"

patterns-established:
  - "infiniteQueryOptions with range-based pagination for feed queries"
  - "Realtime subscription with debounced invalidation to prevent refetch storms"
  - "Generic useDebounce hook for reuse across search inputs"

duration: 2min
completed: 2026-02-16
---

# Phase 05 Plan 01: Community Data Layer Summary

**Community data layer with Zod schemas, paginated TanStack Query options, Zustand UI store, and realtime vote subscription hook**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-16T02:56:02Z
- **Completed:** 2026-02-16T02:58:18Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Database type stubs for 5 community tables/views with full Row/Insert/Update patterns
- Zod schemas validate all community data shapes with ISO date transforms
- Paginated infinite query for community feed supporting tab/sort/filter/search
- Zustand store manages community UI state with resetAll for clean navigation
- Realtime hook debounces vote invalidation at 2.5s to prevent refetch storms

## Task Commits

Each task was committed atomically:

1. **Task 1: Add community table types and create Zod schemas** - `3d8e908` (feat)
2. **Task 2: Create query options, key factory, Zustand store, realtime hook, and debounce hook** - `e993b93` (feat)

## Files Created/Modified
- `src/lib/database.types.ts` - Added 5 community table/view type stubs, display_name/avatar_url to profiles
- `src/schemas/community.ts` - Zod schemas for all community data shapes with inferred types
- `src/queries/keys.ts` - Extended with community key factory (feed, creators, saves, votes)
- `src/queries/community.ts` - Infinite query for feed, query options for creators/saves/votes
- `src/stores/useCommunityStore.ts` - Zustand store for community UI state with resetAll
- `src/hooks/useCommunityRealtime.ts` - Realtime vote subscription with debounced invalidation
- `src/hooks/useDebounce.ts` - Generic debounce hook (300ms default)

## Decisions Made
- Added display_name and avatar_url to profiles table stub -- needed for community author info joins
- Made profiles field optional in Zod schemas since it's only present when using inner join queries
- Set 2500ms debounce on realtime vote invalidation per research pitfall guidance
- Added muted parameter to realtime hook for optimistic vote scenarios

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added display_name and avatar_url to profiles table**
- **Found during:** Task 1 (database types)
- **Issue:** Community feed query needs `profiles!inner(display_name, avatar_url)` but profiles table lacked those fields
- **Fix:** Added display_name (string) and avatar_url (string | null) to profiles Row/Insert/Update
- **Files modified:** src/lib/database.types.ts
- **Verification:** Build succeeds, query types align
- **Committed in:** 3d8e908 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for community queries to join profile data. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All community data modules ready for import by plans 05-02 through 05-04
- Feed query supports all parameters needed for UI components
- Store pattern ready for component binding
- Realtime hook ready to mount in community page shell

## Self-Check: PASSED

All 7 files verified on disk. Both task commits (3d8e908, e993b93) verified in git log.
