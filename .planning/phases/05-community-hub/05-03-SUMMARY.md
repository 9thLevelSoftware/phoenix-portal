---
phase: 05-community-hub
plan: 03
subsystem: mutations, ui
tags: [tanstack-query, optimistic-updates, realtime, community, voting, sharing]

requires:
  - phase: 05-community-hub
    provides: "Community Zod schemas, query options, query keys, realtime hook, Zustand store"
provides:
  - "Mutation hooks for voting (optimistic toggle), sharing, and saving community content"
  - "VoteButton component with optimistic toggle and Ember visual feedback"
  - "ShareContentDialog for publishing routines/cycles to community feed"
  - "voteMutedRef coordination between optimistic updates and realtime subscription"
affects: [05-02-community-feed, 05-04-community-pages]

tech-stack:
  added: []
  patterns: [optimistic-mutation-with-mute-window, module-level-ref-for-cross-hook-coordination, toggle-mutation-pattern]

key-files:
  created:
    - src/mutations/community.ts
    - src/app/components/community/VoteButton.tsx
    - src/app/components/community/ShareContentDialog.tsx
  modified:
    - src/hooks/useCommunityRealtime.ts

key-decisions:
  - "voteMutedRef as module-level ref (not React ref) for cross-hook coordination between mutations and realtime"
  - "3-second mute window prevents realtime invalidation from overwriting optimistic vote updates"
  - "onSettled intentionally omitted from useVote -- realtime handles eventual consistency"
  - "useSaveItem creates linked FK reference (not data copy) per user decision"
  - "ShareContentDialog uses Tabs for content type toggle and Badge click for tag selection"

patterns-established:
  - "Optimistic mutation with mute window: update cache immediately, suppress realtime for N ms"
  - "Toggle mutation pattern: check-exists then insert-or-delete for votes and saves"
  - "Module-level ref export for cross-hook state sharing without React context"

duration: 3min
completed: 2026-02-16
---

# Phase 05 Plan 03: Community Voting, Sharing, and Mutations Summary

**Optimistic vote toggle with mute-window realtime coordination, share dialog for routines/cycles, and linked-save mutations**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-16T03:00:57Z
- **Completed:** 2026-02-16T03:03:46Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Three mutation hooks (useVote, useShareContent, useSaveItem) with optimistic updates and proper cache management
- VoteButton with Ember-colored fill state, scale animation, and compact variant for feed cards
- ShareContentDialog with type tabs, source selector, tags, difficulty, and auto-populated metadata
- Mute window coordination between optimistic votes and realtime subscription prevents flicker

## Task Commits

Each task was committed atomically:

1. **Task 1: Create mutation hooks for voting, sharing, and saving** - `86e2452` (feat)
2. **Task 2: Create VoteButton and ShareContentDialog components** - `7ed2b6e` (feat)

## Files Created/Modified
- `src/mutations/community.ts` - useVote (optimistic toggle + mute window), useShareContent, useSaveItem hooks
- `src/app/components/community/VoteButton.tsx` - Upvote button with Ember fill, scale animation, compact variant
- `src/app/components/community/ShareContentDialog.tsx` - Share dialog with type tabs, source selector, tags, difficulty
- `src/hooks/useCommunityRealtime.ts` - Updated to use voteMutedRef instead of muted prop parameter

## Decisions Made
- Used module-level `voteMutedRef` object instead of React ref for cross-hook coordination -- mutations and realtime hook are in different component trees, so React refs would not work
- Intentionally omitted `onSettled` invalidation from useVote to prevent double-update with realtime subscription
- 3-second mute window balances optimistic responsiveness with eventual consistency
- ShareContentDialog auto-populates exercise count, duration, and exercises snapshot from selected source
- Save mutation creates linked reference (FK) not a data copy, per user decision from research phase

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed muted parameter from useCommunityRealtime**
- **Found during:** Task 2 (realtime hook update)
- **Issue:** The hook previously accepted a `muted` boolean prop, but with `voteMutedRef` the mute state is now module-level and doesn't need to be passed as a prop. The existing call site in Community.tsx was already calling without arguments.
- **Fix:** Removed `muted` parameter, switched to checking `voteMutedRef.current` directly, removed `muted` from useEffect dependency array
- **Files modified:** src/hooks/useCommunityRealtime.ts
- **Verification:** Build passes, existing call site compatible
- **Committed in:** 7ed2b6e (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** API simplification aligned with the plan's intent. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- VoteButton and ShareContentDialog ready for integration into community feed cards (05-02/05-04)
- Mutation hooks ready for import by any community component
- Realtime mute window active and coordinated with optimistic votes

## Self-Check: PASSED

All 4 files verified on disk. Both task commits (86e2452, 7ed2b6e) verified in git log.
