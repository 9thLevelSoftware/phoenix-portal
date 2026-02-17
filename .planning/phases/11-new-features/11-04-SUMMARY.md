---
phase: 11-new-features
plan: 04
subsystem: community
tags: [supabase, rls, realtime, react, tanstack-query, zod, comments]

# Dependency graph
requires:
  - phase: 10-wire-up-mock-purge
    provides: "Community feed, votes, saves, CommunityDetailDrawer, CommunityFeedCard"
provides:
  - "community_comments table with RLS and rate limiting"
  - "Comment CRUD mutations (create, update, delete)"
  - "Realtime comment subscription scoped per item"
  - "CommentThread UI component with tier gating"
  - "comment_count on shared_routines/shared_cycles"
affects: [community, subscriptions, pricing]

# Tech tracking
tech-stack:
  added: []
  patterns: [flat-list comments, 5-min edit window, soft-delete, per-item realtime subscription, tier-gated UI input]

key-files:
  created:
    - "supabase/migrations/20260217_phase11_comments.sql"
    - "src/schemas/comments.ts"
    - "src/queries/comments.ts"
    - "src/mutations/comments.ts"
    - "src/hooks/useCommentRealtime.ts"
    - "src/app/components/community/CommentThread.tsx"
  modified:
    - "src/lib/database.types.ts"
    - "src/queries/keys.ts"
    - "src/schemas/community.ts"
    - "src/app/components/community/CommunityDetailDrawer.tsx"
    - "src/app/components/community/CommunityFeedCard.tsx"

key-decisions:
  - "Flat-list comments (no nesting) per locked decision from research phase"
  - "Soft-delete pattern: deleted_at column with partial index filter, not physical delete"
  - "1-second debounce on realtime comment invalidation (vs 2.5s for community votes)"
  - "comment_count as denormalized column with trigger-based auto-update"

patterns-established:
  - "Per-item realtime subscription: useCommentRealtime(itemId) creates scoped channel"
  - "Tier-gated input: FREE users see read-only content with upgrade CTA link"
  - "Client+server edit window enforcement: UI hides edit button AND RLS blocks after 5 min"

requirements-completed: [CMNT-01, CMNT-02, CMNT-03, CMNT-04, CMNT-05, CMNT-06, CMNT-07, CMNT-08, CMNT-09]

# Metrics
duration: 6min
completed: 2026-02-17
---

# Phase 11 Plan 04: Community Comments Summary

**Flat-list comment threads with RLS, rate limiting, 5-min edit window, realtime sync, and PHOENIX/ELITE tier gating**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-17T19:31:59Z
- **Completed:** 2026-02-17T19:37:48Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- community_comments table with RLS immediately after CREATE TABLE, rate limit trigger (5/hour), indexes, and Supabase Realtime
- Full data layer: Zod schemas, TanStack Query with profile join, confirmed mutations with toast feedback
- CommentThread UI with inline edit, soft-delete confirmation, character counter, and FREE user upgrade prompt
- comment_count denormalized on feed items with trigger-based auto-increment/decrement

## Task Commits

Each task was committed atomically:

1. **Task 1: Database migration + data layer** - `2a8addc` (feat) -- Note: files absorbed into prior 11-02 commit by parallel agent
2. **Task 2: CommentThread UI + CommunityDetailDrawer + CommunityFeedCard integration** - `569a2c8` (feat)

## Files Created/Modified
- `supabase/migrations/20260217_phase11_comments.sql` - Table, RLS, rate limit trigger, indexes, realtime, comment_count
- `src/lib/database.types.ts` - community_comments, shared_routines, shared_cycles type stubs
- `src/schemas/comments.ts` - Zod commentSchema + createCommentSchema
- `src/queries/keys.ts` - comments.all and comments.byItem query keys
- `src/queries/comments.ts` - commentsOptions(itemId) with profile join and deleted_at filter
- `src/mutations/comments.ts` - useCreateComment, useUpdateComment, useDeleteComment (confirmed pattern)
- `src/hooks/useCommentRealtime.ts` - Per-item realtime subscription with 1s debounce
- `src/schemas/community.ts` - comment_count added to sharedRoutineSchema/sharedCycleSchema
- `src/app/components/community/CommentThread.tsx` - Flat-list comments with tier gating
- `src/app/components/community/CommunityDetailDrawer.tsx` - CommentThread below DetailContent
- `src/app/components/community/CommunityFeedCard.tsx` - MessageSquare comment count display

## Decisions Made
- Flat-list comments (no nesting) per locked decision from research phase
- Soft-delete pattern with deleted_at column, not physical delete, to support comment_count triggers
- 1-second debounce on comment realtime (faster than 2.5s community votes debounce for chat-like UX)
- comment_count as denormalized column with trigger auto-update (avoids COUNT query on every feed render)

## Deviations from Plan

None - plan executed exactly as written.

Note: Task 1 files were committed as part of the 11-02 commit (2a8addc) by a parallel agent that absorbed unstaged files. The files are correct and complete; only the commit attribution differs from the expected separate Task 1 commit.

## Issues Encountered
- Pre-existing test failures (10 tests) due to missing Router/AuthProvider context in test wrappers. Not caused by this plan's changes (verified by running tests on clean HEAD). Logged as out-of-scope.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Community comments feature is fully built and building cleanly
- Ready for manual verification: post comments, edit within 5 min, delete, check realtime, verify FREE user lockout
- All automated verification (build) passes

## Self-Check: PASSED

All 11 files verified present on disk. Both commit hashes (2a8addc, 569a2c8) confirmed in git log.

---
*Phase: 11-new-features*
*Completed: 2026-02-17*
