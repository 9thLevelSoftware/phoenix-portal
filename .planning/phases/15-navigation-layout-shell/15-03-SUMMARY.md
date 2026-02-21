---
phase: 15-navigation-layout-shell
plan: 03
subsystem: ui
tags: [react, tailwind, responsive, mobile, framer-motion, zustand]

# Dependency graph
requires:
  - phase: 15-navigation-layout-shell
    provides: PageShell wrapper component and AppSidebar desktop navigation
  - phase: 15-navigation-layout-shell
    provides: Plan 01 useIsMobile flash fix and AppLayout restructure

provides:
  - "5-item MobileBottomNav with grouped More drawer (Training/Social/Account)"
  - "CSS-responsive Dashboard (block md:hidden / hidden md:block) — DashboardMobile deleted"
  - "CSS-responsive Analytics with mobile sub-components — AnalyticsMobile deleted"
  - "CSS-responsive Community with flattened hooks — CommunityMobile deleted"
  - "CSS-responsive Challenges with SwipeableCard and AlertDialog — ChallengesMobile deleted"

affects:
  - future phases touching mobile layout or navigation
  - any phase adding new routes (must add to moreGroups in MobileBottomNav)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "block md:hidden / hidden md:block for mobile-vs-desktop layout branching via CSS"
    - "Grouped More drawer with eyebrow labels for secondary nav items"
    - "Mobile helper sub-components (QuickStatCard, MobileStatCard, SwipeableCard) defined at module level"

key-files:
  created: []
  modified:
    - src/app/components/MobileBottomNav.tsx
    - src/app/components/Dashboard.tsx
    - src/app/components/Analytics.tsx
    - src/app/components/Community.tsx
    - src/app/components/Challenges.tsx
  deleted:
    - src/app/components/DashboardMobile.tsx
    - src/app/components/mobile/AnalyticsMobile.tsx
    - src/app/components/mobile/CommunityMobile.tsx
    - src/app/components/mobile/ChallengesMobile.tsx

key-decisions:
  - "MobileBottomNav primary bar: Dashboard, Workouts, Analytics, Community, More (5 items) — Profile moved to More drawer"
  - "More drawer grouped into Training/Social/Account with eyebrow labels, not flat list"
  - "Mobile variants merged via block md:hidden / hidden md:block, not responsive grid classes, because markup is fundamentally different"
  - "useCommunityRealtime() called once at top-level Community component — CommunityDesktop inner function dissolved"
  - "Mobile component files deleted after merge — 4 fewer files to maintain"

patterns-established:
  - "CSS-responsive dual layout: block md:hidden section for mobile, hidden md:block section for desktop — share hooks at top level"
  - "Mobile sub-components defined at module level (not inline) for readability when markup diverges significantly"
  - "Grouped drawer navigation: label + items array, eyebrow text-xs uppercase tracking-widest for section headers"

requirements-completed: [NAV-08, NAV-09]

# Metrics
duration: 85min
completed: 2026-02-20
---

# Phase 15 Plan 03: Mobile Nav + Responsive Merge Summary

**5-item MobileBottomNav with grouped More drawer, plus 4 mobile component variants merged into CSS-responsive parents using block md:hidden/hidden md:block — 4 mobile files deleted**

## Performance

- **Duration:** ~85 min (across 2 sessions)
- **Started:** 2026-02-20T22:00:00Z
- **Completed:** 2026-02-20T23:25:00Z
- **Tasks:** 2
- **Files modified:** 5 modified, 4 deleted

## Accomplishments

- MobileBottomNav updated to 5 primary items (Dashboard, Workouts, Analytics, Community, More) with grouped More drawer using Training/Social/Account eyebrow sections
- All 4 mobile variant components (DashboardMobile, AnalyticsMobile, CommunityMobile, ChallengesMobile) merged into their CSS-responsive parents using Tailwind breakpoints
- Eliminated `if (isMobile) return <XMobile />` JS branching from all 4 parent components
- Deleted 4 mobile-specific files — single source of truth per feature
- `useCommunityRealtime()` called exactly once after flattening CommunityDesktop inner function

## Task Commits

Each task was committed atomically:

1. **Task 1: Update MobileBottomNav with new primary items and grouped More drawer** - `4e78ac3` (feat)
2. **Task 2: Merge 4 mobile component variants into CSS-responsive parent components** - `fccd441` (feat)

**Plan metadata:** (docs commit follows this summary)

## Files Created/Modified

- `src/app/components/MobileBottomNav.tsx` - 5-item bar with grouped Training/Social/Account More drawer; active state uses ember color
- `src/app/components/Dashboard.tsx` - Merged DashboardMobile: mobile section has compact header, flame streak, horizontal QuickStatCard row, CSS bar chart; desktop in PageShell
- `src/app/components/Analytics.tsx` - Merged AnalyticsMobile: mobile section has stacked stat cards, custom tab nav, mobile-specific W1/W2 week bucketing; desktop in PageShell
- `src/app/components/Community.tsx` - Merged CommunityMobile: flattened CommunityDesktop, single useCommunityRealtime() call, mobile column feed vs desktop grid
- `src/app/components/Challenges.tsx` - Merged ChallengesMobile: SwipeableCard with Framer Motion drag, AlertDialog for leave confirmation, Discover tab; desktop keeps expand/collapse cards in PageShell
- `src/app/components/DashboardMobile.tsx` - DELETED
- `src/app/components/mobile/AnalyticsMobile.tsx` - DELETED
- `src/app/components/mobile/CommunityMobile.tsx` - DELETED
- `src/app/components/mobile/ChallengesMobile.tsx` - DELETED

## Decisions Made

- Grouped More drawer sections (Training/Social/Account) preferred over flat list — better discoverability and matches locked plan spec
- `block md:hidden` / `hidden md:block` chosen over responsive grid classes because mobile and desktop markup structures were fundamentally different (different components, different interaction patterns)
- Mobile helper sub-components (`QuickStatCard`, `MobileStatCard`, `SwipeableCard`, `MobileChallengeCard`) defined at module level rather than inline — reduces nesting depth and improves readability
- `useCommunityRealtime()` singleton enforced by dissolving the `CommunityDesktop` inner function into the top-level `Community` component

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan 02 had already committed merged component content**
- **Found during:** Task 2 start
- **Issue:** STATE.md showed Plan 02 as the last completed plan, but `git show f84ecf9` revealed the Plan 02 docs commit had accidentally staged and committed Dashboard.tsx, Analytics.tsx, Community.tsx, and Challenges.tsx with the mobile-merged content already in place
- **Fix:** Verified merged content existed in all 4 files (`grep block md:hidden`), confirmed build passed, proceeded to only commit the mobile file deletions
- **Files modified:** None — content already committed
- **Verification:** `npm run build` passed with 4 files showing `block md:hidden` / `hidden md:block` patterns
- **Committed in:** `fccd441` (Task 2 commit — deletions only)

---

**Total deviations:** 1 (1 discovery — prior session work already committed)
**Impact on plan:** No scope creep. All plan requirements met. The deviation actually meant Task 2 was partially pre-complete.

## Issues Encountered

- Context window ran out mid-execution: session 1 wrote all 4 component files to disk, session 2 picked up from build verification. The Write operations in session 1 were committed in the Plan 02 docs commit unexpectedly, but the final state was correct.
- Community.tsx first attempt had invalid array destructuring for `viewingCreatorId` — fixed by using proper `useState` (session 1).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Mobile navigation and responsive layout patterns are fully established
- The `block md:hidden` / `hidden md:block` pattern is documented for future feature pages
- Any new primary routes should be added to `moreGroups` in MobileBottomNav.tsx
- Phase 15 is complete — all 3 plans done

---
*Phase: 15-navigation-layout-shell*
*Completed: 2026-02-20*

## Self-Check: PASSED

- FOUND: src/app/components/MobileBottomNav.tsx
- FOUND: src/app/components/Dashboard.tsx
- FOUND: src/app/components/Analytics.tsx
- FOUND: src/app/components/Community.tsx
- FOUND: src/app/components/Challenges.tsx
- CONFIRMED DELETED: src/app/components/DashboardMobile.tsx
- CONFIRMED DELETED: src/app/components/mobile/AnalyticsMobile.tsx
- CONFIRMED DELETED: src/app/components/mobile/CommunityMobile.tsx
- CONFIRMED DELETED: src/app/components/mobile/ChallengesMobile.tsx
- COMMIT 4e78ac3: Task 1 (MobileBottomNav) — FOUND
- COMMIT fccd441: Task 2 (mobile file deletions) — FOUND
