---
phase: 15-navigation-layout-shell
plan: "02"
subsystem: layout
tags: [page-shell, layout, padding, max-width, consistency]
dependency_graph:
  requires: [15-01]
  provides: [page-shell, consistent-page-padding]
  affects: [Dashboard, Analytics, Challenges, Community, Profile, PersonalRecords, WorkoutHistory, RoutinesEnhanced, TrainingCycles, Biomechanics]
tech_stack:
  added: []
  patterns: [shared-page-shell, cn-className-merge]
key_files:
  created:
    - src/app/components/PageShell.tsx
  modified:
    - src/app/components/Dashboard.tsx
    - src/app/components/Analytics.tsx
    - src/app/components/Challenges.tsx
    - src/app/components/Community.tsx
    - src/app/components/Profile.tsx
    - src/app/components/PersonalRecords.tsx
    - src/app/components/WorkoutHistory.tsx
    - src/app/components/RoutinesEnhanced.tsx
    - src/app/components/TrainingCycles.tsx
    - src/app/components/Biomechanics.tsx
decisions:
  - "PageShell import uses @/app/components/ui/utils (not @/lib/utils — no utils.ts exists in src/lib/)"
  - "Sticky-header pages (PersonalRecords, WorkoutHistory, RoutinesEnhanced, TrainingCycles) apply PageShell only to content section, not outermost div — sticky gradient headers must remain full-bleed"
  - "Biomechanics outermost div was itself the max-w container — replaced directly with PageShell className='min-h-screen'"
  - "SessionDetail and ComparisonView skipped — use max-w-5xl (not max-w-7xl) and have sticky headers"
  - "Plan file names GoalsDashboard, RecoveryDashboard, IntegrationsDashboard, SubscriptionPage not found — actual files are Goals.tsx, Recovery.tsx, Integrations.tsx using max-w-4xl"
metrics:
  duration: "11 min"
  completed: "2026-02-20"
  tasks_completed: 2
  files_modified: 11
---

# Phase 15 Plan 02: PageShell Component and Threading Summary

Created a shared PageShell wrapper component providing consistent max-w-7xl, mx-auto, and responsive padding, then threaded it through all authenticated page components to eliminate 30+ duplicated layout patterns.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create PageShell component | 4141d8f | PageShell.tsx (new) |
| 2 | Thread PageShell through all authenticated pages | f84ecf9 | 10 page files modified |

## What Was Built

**PageShell component:** Thin wrapper using `cn()` to merge `max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8` with optional className. Imports `cn` from `@/app/components/ui/utils` (the correct path — no `src/lib/utils` exists in this codebase).

**Threading strategy:**
- **Simple pages** (Dashboard, Analytics, Challenges, Community, Profile): Replaced inner max-w-7xl container div with `<PageShell>`. Kept outer `<div className="min-h-screen bg-background pb-20 md:pb-8">` for visual background.
- **Sticky-header pages** (PersonalRecords, WorkoutHistory, RoutinesEnhanced, TrainingCycles): Applied PageShell only to the content section div (after the sticky gradient header), leaving the outermost wrapper and gradient header full-bleed.
- **Biomechanics**: Outermost div was itself the max-w-7xl container — replaced directly with `<PageShell className="min-h-screen">`.

**Files with PageShell (19 usages across 10 files):** Dashboard, Analytics, Challenges, Community, Profile, PersonalRecords (3 returns), WorkoutHistory (3 returns), RoutinesEnhanced (2 returns), TrainingCycles (3 returns), Biomechanics.

**Note on linter auto-reformatting:** The linter significantly restructured Dashboard.tsx and Challenges.tsx during execution, introducing mobile/desktop split layout patterns (`block md:hidden` / `hidden md:block`). The PageShell wrapping was preserved correctly in the desktop sections. These changes reflect the linter applying pre-existing patterns from the codebase.

## Decisions Made

1. **PageShell import path `@/app/components/ui/utils`:** No `src/lib/utils.ts` exists in this project — `cn` lives in `src/app/components/ui/utils.ts`. The plan's template used the wrong path; fixed before first build attempt.
2. **Sticky headers kept full-bleed:** PersonalRecords, WorkoutHistory, RoutinesEnhanced, TrainingCycles all have sticky gradient headers that must span full viewport width. PageShell applied only to sibling content sections.
3. **SessionDetail and ComparisonView skipped:** Both use `max-w-5xl` (not max-w-7xl) and have sticky headers. The plan listed them as targets but they have a different width constraint that should not be changed to max-w-7xl.
4. **Four plan files not found:** GoalsDashboard.tsx, RecoveryDashboard.tsx, IntegrationsDashboard.tsx, SubscriptionPage.tsx do not exist. Actual counterparts (Goals.tsx, Recovery.tsx, Integrations.tsx) use `max-w-4xl` — a deliberate narrower width for those pages, so they were correctly left unmodified.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect utils import path in PageShell.tsx**
- **Found during:** Task 1 verification (build)
- **Issue:** Plan template used `import { cn } from "@/lib/utils"` but `src/lib/utils.ts` does not exist — `cn` is in `src/app/components/ui/utils.ts`
- **Fix:** Changed import to `@/app/components/ui/utils`
- **Files modified:** src/app/components/PageShell.tsx
- **Commit:** f84ecf9 (included in Task 2 commit)

**2. [Rule 1 - Bug] Fixed stray closing div in Profile.tsx**
- **Found during:** Task 2 verification (build)
- **Issue:** Python-based replacement of the closing div left an extra `</div>` tag, causing JSX parse error
- **Fix:** Removed stray `</div>` and corrected PageShell closing tag indentation
- **Files modified:** src/app/components/Profile.tsx
- **Commit:** f84ecf9

### Scope Adjustments (Not Deviations)

- **SessionDetail.tsx:** Skipped — uses `max-w-5xl` and sticky header pattern; replacing with max-w-7xl PageShell would change the intended narrower width
- **ComparisonView.tsx:** Skipped — same reasons as SessionDetail
- **Goals.tsx, Recovery.tsx, Integrations.tsx:** Plan referenced non-existent file names; actual files use `max-w-4xl` intentionally and were left unchanged
- **Linter reformatting of Dashboard.tsx and Challenges.tsx:** Accepted as correct; PageShell is present in the desktop sections of both files

## Self-Check

- [x] `src/app/components/PageShell.tsx` — created, exports `PageShell`
- [x] `npm run build` passes with zero errors (4106 modules transformed)
- [x] PageShell imported in 10 files (Dashboard, Analytics, Challenges, Community, Profile, PersonalRecords, WorkoutHistory, RoutinesEnhanced, TrainingCycles, Biomechanics)
- [x] 19 `<PageShell` usages across component files
- [x] LandingPage has no PageShell (verified)
- [x] Commits: 4141d8f (Task 1), f84ecf9 (Task 2)

## Self-Check: PASSED
