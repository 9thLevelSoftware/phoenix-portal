---
phase: 20-gap-closure-tech-debt
plan: 01
subsystem: ui
tags: [tailwind, css, glassmorphism, ambient-glow, transparency, react, vite]

# Dependency graph
requires:
  - phase: 14-css-foundation-typography
    provides: body::before/::after ambient ember/flame glow layers (position fixed, z-0/z-1)
  - phase: 15-navigation-layout-shell
    provides: AppLayout with SidebarProvider/SidebarInset, relative z-[10] positioning
provides:
  - Transparent authenticated app shell so body::before ambient glow is visible
  - Transparent page root wrappers across all 16 authenticated pages
  - Glassmorphism cards can now blur against actual visual depth (glow layer)
affects: [21-glassmorphism-depth, any phase touching authenticated page root wrappers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "bg-transparent on SidebarInset overrides shadcn primitive's built-in bg-background at call site (not by editing primitive)"
    - "body provides bg-background via @apply in theme.css — child page divs must not re-declare it"
    - "min-h-screen retains layout function when bg-background is stripped — only the color is removed"

key-files:
  created: []
  modified:
    - src/app/routes/AppLayout.tsx
    - src/app/components/Analytics.tsx
    - src/app/components/CelebrationDemo.tsx
    - src/app/components/Challenges.tsx
    - src/app/components/Community.tsx
    - src/app/components/ComparisonView.tsx
    - src/app/components/CycleBuilder.tsx
    - src/app/components/Dashboard.tsx
    - src/app/components/Goals.tsx
    - src/app/components/PersonalRecords.tsx
    - src/app/components/Profile.tsx
    - src/app/components/Recovery.tsx
    - src/app/components/RoutineBuilder.tsx
    - src/app/components/RoutinesEnhanced.tsx
    - src/app/components/SessionDetail.tsx
    - src/app/components/TrainingCycles.tsx
    - src/app/components/WorkoutHistory.tsx

key-decisions:
  - "SidebarInset overridden with bg-transparent at call site in AppLayout, not by editing shadcn primitive sidebar.tsx"
  - "LandingPage, PrivacyPolicy, ResetPassword retain bg-background — they are outside AppLayout boundary and need their own opaque background"
  - "Sticky headers with bg-background/95 are intentionally untouched — /95 opacity modifier provides frosted glass effect, not the same as root wrapper opaque blocks"
  - "38 total instances removed across 16 files; body::before glow now unoccluded through the full render stack"

patterns-established:
  - "Authenticated page root wrappers use min-h-screen without bg-background — background comes from body via theme.css"
  - "Public/unauthenticated pages retain their own bg-background (outside AppLayout boundary)"

requirements-completed: [VIS-01]

# Metrics
duration: 8min
completed: 2026-02-21
---

# Phase 20 Plan 01: Ambient Glow Unblocking Summary

**Removed 38 opaque bg-background instances from 16 authenticated page root wrappers and AppLayout shell, unblocking the Phase 14 body::before ambient ember/flame glow through the full render stack**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-21T05:01:46Z
- **Completed:** 2026-02-21T05:09:46Z
- **Tasks:** 2
- **Files modified:** 17

## Accomplishments
- AppLayout shell div stripped of `bg-background`; `SidebarInset` overridden with `bg-transparent` at call site (shadcn primitive untouched)
- All 38 `min-h-screen bg-background` instances removed from 16 authenticated page components in a single pass
- Body::before/::after ambient ember/flame glow (built Phase 14-02, occluded since) now propagates through the full transparent render stack
- LandingPage, PrivacyPolicy, ResetPassword correctly retain their `bg-background` (public pages outside AppLayout)
- Sticky headers with `bg-background/95` frosted glass effect preserved

## Task Commits

Each task was committed atomically:

1. **Task 1: Strip bg-background from AppLayout shell and SidebarInset** - `11953e7` (feat)
2. **Task 2: Strip bg-background from all 16 authenticated page root wrappers** - `34bacb3` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/app/routes/AppLayout.tsx` - Removed `bg-background` from shell div; added `className="bg-transparent"` to `<SidebarInset>`
- `src/app/components/Analytics.tsx` - 2 root wrapper instances removed
- `src/app/components/CelebrationDemo.tsx` - 1 root wrapper instance removed
- `src/app/components/Challenges.tsx` - 2 root wrapper instances removed
- `src/app/components/Community.tsx` - 1 root wrapper instance removed
- `src/app/components/ComparisonView.tsx` - 6 root wrapper instances removed (loading/empty states + main)
- `src/app/components/CycleBuilder.tsx` - 2 root wrapper instances removed
- `src/app/components/Dashboard.tsx` - 2 root wrapper instances removed
- `src/app/components/Goals.tsx` - 2 root wrapper instances removed
- `src/app/components/PersonalRecords.tsx` - 3 root wrapper instances removed
- `src/app/components/Profile.tsx` - 1 root wrapper instance removed
- `src/app/components/Recovery.tsx` - 3 root wrapper instances removed
- `src/app/components/RoutineBuilder.tsx` - 2 root wrapper instances removed
- `src/app/components/RoutinesEnhanced.tsx` - 2 root wrapper instances removed
- `src/app/components/SessionDetail.tsx` - 3 root wrapper instances removed
- `src/app/components/TrainingCycles.tsx` - 3 root wrapper instances removed
- `src/app/components/WorkoutHistory.tsx` - 3 root wrapper instances removed

## Decisions Made
- Override SidebarInset with `bg-transparent` at call site rather than editing the shadcn primitive — keeps primitive untouched per Phase 15 pattern
- Used Python regex for bulk replacement across 16 files to ensure atomic, accurate removal with exact count verification (38 of 38 instances)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all instance counts matched research exactly (38 total).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Ambient glow is now unoccluded — visual verification can confirm glow is visible through authenticated pages
- Glassmorphism card `backdrop-filter: blur()` from Phase 16-01 will now blur against the actual glow depth rather than a flat background
- Phase 20-02 (next plan in gap closure) can proceed

---
*Phase: 20-gap-closure-tech-debt*
*Completed: 2026-02-21*
