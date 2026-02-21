---
phase: 16-visual-depth-surfaces
plan: 02
subsystem: ui
tags: [css, tailwind, typography, visual-hierarchy, gradient-text]

# Dependency graph
requires:
  - phase: 16-visual-depth-surfaces/16-01
    provides: Card tier utilities and landing page glass treatments that co-exist with this gradient text sweep

provides:
  - Gradient text reserved exclusively for 2 hero headlines (LandingPage h1, Dashboard welcome h1)
  - All 45 non-hero gradient text instances replaced with solid text-white (headers) or text-primary (stats/brands)
  - Codebase-wide visual hierarchy rule: bg-clip-text text-transparent = hero headline signal only

affects:
  - Any future plan adding headings, stats, or brand text - must use text-white/text-primary, not gradient

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Gradient text (bg-clip-text text-transparent) reserved for hero h1 only - 2 instances globally"
    - "Page/section h1 headers use text-white (not gradient) - consistent across all 23 modified files"
    - "Brand/logo spans use text-primary - AppSidebar, Navigation, PrivacyPolicy, ResetPassword, LandingPage auth dialog"
    - "Stat numbers use text-primary - PersonalRecords PR values, SessionDetail PR count, Profile total volume"
    - "Celebration modal h2 headlines use text-white - GoalCelebration, PRCelebration, StreakMilestone, ChallengeWon"

key-files:
  created: []
  modified:
    - src/app/components/LandingPage.tsx
    - src/app/components/Dashboard.tsx
    - src/app/components/PersonalRecords.tsx
    - src/app/components/Analytics.tsx
    - src/app/components/Challenges.tsx
    - src/app/components/Community.tsx
    - src/app/components/Goals.tsx
    - src/app/components/Recovery.tsx
    - src/app/components/RoutinesEnhanced.tsx
    - src/app/components/TrainingCycles.tsx
    - src/app/components/WorkoutHistory.tsx
    - src/app/components/SessionDetail.tsx
    - src/app/components/Profile.tsx
    - src/app/components/ComparisonView.tsx
    - src/app/components/AppSidebar.tsx
    - src/app/components/Navigation.tsx
    - src/app/components/PrivacyPolicy.tsx
    - src/app/components/ResetPassword.tsx
    - src/app/components/CelebrationDemo.tsx
    - src/app/components/GoalCelebration.tsx
    - src/app/components/celebrations/PRCelebration.tsx
    - src/app/components/celebrations/StreakMilestone.tsx
    - src/app/components/celebrations/ChallengeWon.tsx

key-decisions:
  - "Gradient text reserved for hero h1 only: LandingPage hero and Dashboard welcome h1 username span"
  - "Section h1/h2 headers across all pages use solid text-white - not gradient"
  - "Brand/logo text spans (AppSidebar, Navigation, auth dialogs, footer) use solid text-primary"
  - "Stat number displays (PR values, volume, PR count) use text-primary span - not gradient"
  - "Celebration modal h2 headlines use text-white - gradient in modal context does not signal hero status"
  - "ChallengeWon span had dynamic config.gradient in template literal - replaced with static text-white (gradient no longer meaningful)"
  - "StreakMilestone text-[12rem] number div uses text-white (decorative background element - bg gradient was visual noise)"

patterns-established:
  - "Hero gradient rule: only h1 elements that are THE primary page headline AND appear above-the-fold use bg-clip-text text-transparent"
  - "All other text: solid colors only - text-white for headings, text-primary for brand/stats, text-muted-foreground for supporting text"

requirements-completed: [BUG-07]

# Metrics
duration: 5min
completed: 2026-02-21
---

# Phase 16 Plan 02: Visual Depth & Surfaces Summary

**Codebase-wide gradient text sweep: 45 of 47 instances replaced with solid text-white/text-primary, reserving bg-clip-text treatment exclusively for LandingPage hero h1 and Dashboard welcome h1 username**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-21T04:18:30Z
- **Completed:** 2026-02-21T04:24:05Z
- **Tasks:** 2
- **Files modified:** 23

## Accomplishments

- Swept all 47 gradient text instances across 23 files, reducing to exactly 2 hero h1 instances
- Established clear visual hierarchy rule: gradient = hero headline signal, solid = everything else
- Section page headers (h1/h2) now use consistent solid text-white across Analytics, Challenges, Community, Goals, Recovery, RoutinesEnhanced, TrainingCycles, WorkoutHistory, SessionDetail, ComparisonView, CelebrationDemo
- Brand/logo text in AppSidebar, Navigation, PrivacyPolicy, ResetPassword, and LandingPage auth dialog now use solid text-primary
- Stat numbers (PR values, volume totals, PR counts) now use text-primary - not gradient
- Celebration modal headlines (GoalCelebration, PRCelebration, StreakMilestone, ChallengeWon) now use solid text-white

## Task Commits

1. **Task 1: Sweep gradient text from high-instance files (LandingPage, Dashboard, PersonalRecords, Analytics, Challenges, Community, Goals, Recovery)** - `6e8b294` (feat)
2. **Task 2: Sweep gradient text from remaining 15 files (sidebars, celebrations, detail pages, utilities)** - `517a928` (feat)

## Files Created/Modified

- `src/app/components/LandingPage.tsx` - Kept hero h1; replaced 7 instances (auth dialog brand, 3x h2 section headers, pricing stat, 2x footer brands)
- `src/app/components/Dashboard.tsx` - Kept welcome h1 username; replaced 3 instances (2x empty state h1, streak emoji div)
- `src/app/components/PersonalRecords.tsx` - 4 instances replaced (2x page h1, 2x stat values -> text-primary)
- `src/app/components/Analytics.tsx` - 2 instances replaced (mobile + desktop h1 -> text-white)
- `src/app/components/Challenges.tsx` - 2 instances replaced (mobile + desktop h1 -> text-white)
- `src/app/components/Community.tsx` - 2 instances replaced (mobile + desktop h1 -> text-white)
- `src/app/components/Goals.tsx` - 2 instances replaced (2x page h1 -> text-white)
- `src/app/components/Recovery.tsx` - 2 instances replaced (2x page h1 span alongside icon -> text-white)
- `src/app/components/RoutinesEnhanced.tsx` - 2 instances replaced (mobile + desktop h1 -> text-white)
- `src/app/components/TrainingCycles.tsx` - 3 instances replaced (3x h1 variants -> text-white)
- `src/app/components/WorkoutHistory.tsx` - 2 instances replaced (mobile + desktop h1 -> text-white)
- `src/app/components/SessionDetail.tsx` - 2 instances replaced (page h1 -> text-white, PR count stat -> text-primary)
- `src/app/components/Profile.tsx` - 1 instance replaced (total volume stat div -> text-primary)
- `src/app/components/ComparisonView.tsx` - 1 instance replaced (page h1 -> text-white)
- `src/app/components/AppSidebar.tsx` - 1 instance replaced (logo brand span -> text-primary, kept collapsible classes)
- `src/app/components/Navigation.tsx` - 1 instance replaced (logo brand span -> text-primary)
- `src/app/components/PrivacyPolicy.tsx` - 2 instances replaced (brand span -> text-primary, page h1 -> text-white)
- `src/app/components/ResetPassword.tsx` - 1 instance replaced (brand span -> text-primary)
- `src/app/components/CelebrationDemo.tsx` - 1 instance replaced (page h1 -> text-white)
- `src/app/components/GoalCelebration.tsx` - 1 instance replaced (modal h2 -> text-white)
- `src/app/components/celebrations/PRCelebration.tsx` - 1 instance replaced (modal h2 -> text-white)
- `src/app/components/celebrations/StreakMilestone.tsx` - 1 instance replaced (text-[12rem] number div -> text-white)
- `src/app/components/celebrations/ChallengeWon.tsx` - 1 instance replaced (dynamic config.gradient template literal -> static text-white)

## Decisions Made

- Gradient text reserved exclusively for the 2 hero h1 elements: the LandingPage "Project Phoenix" hero h1 and the Dashboard "Welcome back, [username]" h1 - these are the only above-the-fold primary headlines in the app
- Section page headers (even when large h1 elements) use solid text-white - the gradient signal would be diluted if every page title used it
- ChallengeWon's span previously used a dynamic `config.gradient` template literal - replaced with static text-white since gradient text no longer applies to celebration modal content
- StreakMilestone's large text-[12rem] number used gradient as a decorative background watermark effect - replaced with text-white since the gradient treatment conflicted with the new hero-only rule

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- File uses tab characters throughout, making Edit tool exact string matching fail. Resolved using Python scripts for all replacements, which handle tab characters correctly. This was anticipated from Phase 16 Plan 01 (same issue noted in previous SUMMARY).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Gradient text hierarchy rule is now globally enforced: future plans adding headings or brand text should use text-white (headers) or text-primary (brands/stats), never gradient
- The 2 remaining hero instances are permanent landmarks - do not add additional gradient text instances in future plans
- Build passes cleanly; all 23 files compile without errors

---
*Phase: 16-visual-depth-surfaces*
*Completed: 2026-02-21*

## Self-Check: PASSED

All files confirmed present. All task commits confirmed in git history.

| Item | Status |
|------|--------|
| src/app/components/LandingPage.tsx | FOUND |
| src/app/components/Dashboard.tsx | FOUND |
| src/app/components/PersonalRecords.tsx | FOUND |
| src/app/components/Analytics.tsx | FOUND |
| src/app/components/Challenges.tsx | FOUND |
| src/app/components/Community.tsx | FOUND |
| src/app/components/Goals.tsx | FOUND |
| src/app/components/Recovery.tsx | FOUND |
| src/app/components/RoutinesEnhanced.tsx | FOUND |
| src/app/components/TrainingCycles.tsx | FOUND |
| src/app/components/WorkoutHistory.tsx | FOUND |
| src/app/components/SessionDetail.tsx | FOUND |
| src/app/components/Profile.tsx | FOUND |
| src/app/components/ComparisonView.tsx | FOUND |
| src/app/components/AppSidebar.tsx | FOUND |
| src/app/components/Navigation.tsx | FOUND |
| src/app/components/PrivacyPolicy.tsx | FOUND |
| src/app/components/ResetPassword.tsx | FOUND |
| src/app/components/CelebrationDemo.tsx | FOUND |
| src/app/components/GoalCelebration.tsx | FOUND |
| src/app/components/celebrations/PRCelebration.tsx | FOUND |
| src/app/components/celebrations/StreakMilestone.tsx | FOUND |
| src/app/components/celebrations/ChallengeWon.tsx | FOUND |
| .planning/phases/16-visual-depth-surfaces/16-02-SUMMARY.md | FOUND |
| Commit 6e8b294 | FOUND |
| Commit 517a928 | FOUND |
