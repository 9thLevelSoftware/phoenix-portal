---
phase: 16-visual-depth-surfaces
plan: 01
subsystem: ui
tags: [css, tailwind, glassmorphism, card-hierarchy, theming]

# Dependency graph
requires:
  - phase: 14-css-foundation-typography
    provides: CSS variable system (--surface-*, --shadow-*) and @theme blocks that card utilities reference
  - phase: 15-navigation-layout-shell
    provides: Layout shell (AppLayout, PageShell) that card hierarchy renders within

provides:
  - Four card tier CSS utilities in @layer utilities (.card-hero, .card-primary, .card-secondary, .card-landing-feature)
  - Dashboard three-tier visual hierarchy (streak=hero, goals/recovery=glass-primary, info=secondary)
  - Landing page gradient border feature cards with hover lift/glow
  - Auth dialog frosted glass treatment (backdrop-blur-xl + branded border)
  - Feature icon differentiation (rounded-full glow halo vs. gradient square)

affects:
  - 16-visual-depth-surfaces (remaining plans that may apply card-* utilities to other pages)
  - Any future plan touching Dashboard, LandingPage, GoalDashboardWidget, RecoveryDashboardWidget

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "padding-box/border-box gradient border pattern (no border-image - preserves border-radius)"
    - "Mobile blur budget: card-primary skips backdrop-filter on mobile (MobileBottomNav + sticky header = 2 layers already)"
    - "@layer utilities for custom card tier classes - overrides Tailwind utilities layer via specificity"

key-files:
  created: []
  modified:
    - src/styles/theme.css
    - src/app/components/ui/dialog.tsx
    - src/app/components/Dashboard.tsx
    - src/app/components/GoalDashboardWidget.tsx
    - src/app/components/RecoveryDashboardWidget.tsx
    - src/app/components/LandingPage.tsx

key-decisions:
  - "card-primary backdrop-filter applies desktop-only (min-width: 768px) - mobile blur budget already consumed by MobileBottomNav + sticky header"
  - "GoalDashboardWidget and RecoveryDashboardWidget render Cards internally - card-primary applied inside widget files, not at Dashboard call site"
  - "card-landing-feature uses padding-box/border-box background shorthand for gradient borders (border-image breaks border-radius)"
  - "Feature icons use rounded-full bg-primary/15 ring-1 ring-primary/30 (Role A - primary) vs. gradient square (Role C - action CTA)"
  - "backdrop-blur-sm added to DialogOverlay as baseline for all dialogs - auth dialog glass counts as 1 layer (acceptable overlay context)"

patterns-established:
  - "Card tier system: .card-hero (ember glow, hero metric) > .card-primary (glass, key metric) > .card-secondary (subtle gradient, informational)"
  - "Icon Role A: rounded-full + bg-primary/15 + ring-1 ring-primary/30 for primary feature icons"
  - "Icon Role C: rounded-lg + bg-gradient-to-br gradient for action CTA icons (QuickStatCards)"

requirements-completed: [VIS-03, VIS-06, VIS-07, VIS-08, VIS-09]

# Metrics
duration: 2min
completed: 2026-02-21
---

# Phase 16 Plan 01: Visual Depth & Surfaces Summary

**Three-tier card hierarchy (hero/primary/secondary) + glassmorphic widgets + gradient border landing cards + frosted auth dialog via CSS utilities in theme.css**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-21T04:13:20Z
- **Completed:** 2026-02-21T04:15:30Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Defined four card tier CSS utilities in `@layer utilities` block in theme.css: `.card-hero` (ember glow), `.card-primary` (glassmorphism desktop-only), `.card-secondary` (subtle gradient), `.card-landing-feature` (gradient border + hover lift)
- Applied three-tier hierarchy to Dashboard: streak cards use `card-hero`, GoalDashboardWidget + RecoveryDashboardWidget use `card-primary` (glass on desktop only per blur budget), all informational cards use `card-secondary`
- Landing page feature cards use `card-landing-feature` (gradient borders via padding-box/border-box, hover translateY(-3px) + glow bloom), auth dialog glass treatment (backdrop-blur-xl + border-primary/30 + inner shadow ring), feature icons changed from gradient-square to rounded-full glow halo (Role A)

## Task Commits

1. **Task 1: Define card tier CSS utilities and add dialog overlay blur** - `4004bf2` (feat)
2. **Task 2: Apply card hierarchy to Dashboard cards** - `f38f12c` (feat)
3. **Task 3: Landing page gradient borders, auth dialog glass, and icon differentiation** - `eac1405` (feat)

## Files Created/Modified

- `src/styles/theme.css` - Added @layer utilities block with four card tier classes
- `src/app/components/ui/dialog.tsx` - Added backdrop-blur-sm to DialogOverlay
- `src/app/components/Dashboard.tsx` - Applied card-hero (2x), card-secondary (21x)
- `src/app/components/GoalDashboardWidget.tsx` - Applied card-primary (2x)
- `src/app/components/RecoveryDashboardWidget.tsx` - Applied card-primary (3x conditional branches)
- `src/app/components/LandingPage.tsx` - card-landing-feature, backdrop-blur-xl auth dialog, rounded-full icon containers

## Decisions Made

- `card-primary` uses desktop-only `backdrop-filter: blur(12px)` via `@media (min-width: 768px)` — mobile already has 2 blur layers (MobileBottomNav + sticky header) at the budget limit of 3
- GoalDashboardWidget and RecoveryDashboardWidget have conditional render branches (isPremium, isLoading, active) — applied `card-primary` to all Card instances in each widget since only one branch renders at a time; desktop view shows exactly 2 glassmorphic cards
- `padding-box/border-box` background shorthand used for `.card-landing-feature` gradient borders — `border-image` property explicitly avoided because it breaks `border-radius`
- `backdrop-blur-sm` (4px) added to DialogOverlay as a project-wide baseline — subtle and consistent with standard practice; auth dialog `backdrop-blur-xl` (24px) works because the overlay displaces other blur layers

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Edit tool failed on Dashboard.tsx due to tab characters in the file (Read tool displays tabs as spaces making exact string matching fail) — resolved using `sed -i` for all multi-occurrence replacements. The fix was immediate and correct.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Card tier utilities are available globally via CSS for any future plan applying them to other pages (Analytics, Challenges, Community, etc.)
- The 3 blur-layer budget is enforced: MobileBottomNav (1) + sticky header (1) + card-primary desktop (1) = 3 on desktop; mobile card-primary has no blur
- Auth dialog glass is production-ready; no additional configuration needed

---
*Phase: 16-visual-depth-surfaces*
*Completed: 2026-02-21*

## Self-Check: PASSED

All files confirmed present. All task commits confirmed in git history.

| Item | Status |
|------|--------|
| src/styles/theme.css | FOUND |
| src/app/components/ui/dialog.tsx | FOUND |
| src/app/components/Dashboard.tsx | FOUND |
| src/app/components/GoalDashboardWidget.tsx | FOUND |
| src/app/components/RecoveryDashboardWidget.tsx | FOUND |
| src/app/components/LandingPage.tsx | FOUND |
| .planning/phases/16-visual-depth-surfaces/16-01-SUMMARY.md | FOUND |
| Commit 4004bf2 | FOUND |
| Commit f38f12c | FOUND |
| Commit eac1405 | FOUND |
