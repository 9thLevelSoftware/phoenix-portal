---
phase: 05-community-hub
plan: 04
subsystem: ui
tags: [react, community, creators, save-to-library, avatar, tanstack-query]

requires:
  - phase: 05-02
    provides: Community feed page with CommunityFeedCard, infinite scroll, detail drawer
  - phase: 05-03
    provides: Vote/save mutations, share content dialog, realtime sync
provides:
  - Featured creators horizontal scroll with auto-calculated trending
  - Creator profile view with stats banner and content list
  - Save-to-library with linked references in detail drawer
  - Author name click-to-profile on feed cards
affects: [06-session-replay, 07-integrations]

tech-stack:
  added: []
  patterns:
    - "userId filter param on communityFeedOptions for creator-scoped queries"
    - "onAuthorClick prop pattern for navigating to creator profiles from feed cards"
    - "useMemo for derived saved state from savedItemsOptions query"

key-files:
  created:
    - src/app/components/community/FeaturedCreators.tsx
    - src/app/components/community/CreatorProfile.tsx
  modified:
    - src/app/components/Community.tsx
    - src/app/components/mobile/CommunityMobile.tsx
    - src/app/components/community/CommunityDetailDrawer.tsx
    - src/app/components/community/CommunityFeedCard.tsx
    - src/queries/community.ts
    - src/queries/keys.ts

key-decisions:
  - "userId filter added to existing communityFeedOptions (avoids separate query function)"
  - "CreatorProfile fetches both routines and cycles tabs to show all creator content"
  - "Save toggle checks savedItemsOptions cache for current saved state"

patterns-established:
  - "viewingCreatorId state pattern for switching between feed and creator profile views"

duration: 4min
completed: 2026-02-16
---

# Phase 5 Plan 4: Featured Creators & Save-to-Library Summary

**Featured creators horizontal scroll with auto-calculated trending, creator profile with stats banner, and save-to-library toggle in detail drawer**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-16T03:06:33Z
- **Completed:** 2026-02-16T03:10:38Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Featured creators section with horizontal scrollable avatars, ember glow ring, and auto-calculated trending threshold
- Creator profile view with stats banner (shares in ember, upvotes in gold, featured in green) and shared content grid
- Save-to-library button in detail drawer with filled/outline toggle and "Linked to original" indicator
- Author name clickable on feed cards to navigate to creator profile on both desktop and mobile

## Task Commits

Each task was committed atomically:

1. **Task 1: Create FeaturedCreators and CreatorProfile components** - `675adcc` (feat)
2. **Task 2: Integrate FeaturedCreators, CreatorProfile, and save-to-library into Community pages** - `41563bd` (feat)

## Files Created/Modified
- `src/app/components/community/FeaturedCreators.tsx` - Horizontal scrollable featured creators row with avatar, skeleton loading, glow ring
- `src/app/components/community/CreatorProfile.tsx` - Creator stats banner with three stat cards and shared content grid
- `src/app/components/Community.tsx` - Added viewingCreatorId state, FeaturedCreators above feed, CreatorProfile as alternate view
- `src/app/components/mobile/CommunityMobile.tsx` - Same creator integration for mobile with touch scroll
- `src/app/components/community/CommunityDetailDrawer.tsx` - Wired vote/save mutations, saved state toggle, linked reference indicator
- `src/app/components/community/CommunityFeedCard.tsx` - Added onAuthorClick prop for navigating to creator profile
- `src/queries/community.ts` - Added userId filter param to communityFeedOptions
- `src/queries/keys.ts` - Added userId to feed query key type

## Decisions Made
- Added userId filter to existing communityFeedOptions rather than creating a separate query function (consistent with existing filter pattern)
- CreatorProfile fetches both routines and cycles tabs separately to show all creator content
- Save toggle state derived from savedItemsOptions query via useMemo (not local state) for consistency with server

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 5 (Community Hub) fully complete: browse, search, filter, sort, vote, share, save, creator profiles
- Ready for Phase 6 (Session Replay) or Phase 7 (Integrations)

---
*Phase: 05-community-hub*
*Completed: 2026-02-16*
