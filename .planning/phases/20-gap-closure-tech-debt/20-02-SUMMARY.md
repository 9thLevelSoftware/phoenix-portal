---
phase: 20-gap-closure-tech-debt
plan: 02
subsystem: ui
tags: [react, tailwind, typography, design-system, cleanup]

# Dependency graph
requires:
  - phase: 14-typography
    provides: "Inter Variable loaded globally via fonts.css @theme block — inline fontFamily override no longer needed"
  - phase: 15-sidebar-nav
    provides: "AppSidebar replaces Navigation.tsx — eyebrow utility established in theme.css"
provides:
  - "LandingPage hero h1 inherits Inter from global CSS with no inline style override"
  - "Navigation.tsx deleted — zero dead nav files"
  - "MobileBottomNav drawer section labels use canonical .eyebrow utility (Inter Variable weight 450, 11px, 0.08em)"
affects: [any phase touching LandingPage typography, MobileBottomNav drawer]

# Tech tracking
tech-stack:
  added: []
  patterns: [".eyebrow utility for drawer/section labels — do NOT use manual text-xs/font-semibold/uppercase/tracking-widest"]

key-files:
  created: []
  modified:
    - src/app/components/LandingPage.tsx
    - src/app/components/MobileBottomNav.tsx
  deleted:
    - src/app/components/Navigation.tsx

key-decisions:
  - "Navigation.tsx confirmed safe to delete — grep found zero direct imports in codebase (only SetNavigation and NavigationMenu reference 'Navigation', not the component itself)"
  - ".eyebrow utility uses Inter Variable weight 450 + 11px + 0.08em letter-spacing; manual text-xs/font-semibold/uppercase/tracking-widest was close but incorrect (600 weight, 12px, ~0.1em)"
  - "LandingPage hero h1 now correctly inherits Inter from fonts.css @theme block — inline style was blocking CSS cascade"

patterns-established:
  - "Eyebrow pattern: use .eyebrow utility class for all drawer/section uppercase labels — never manual Tailwind"

requirements-completed: [TYPE-03]

# Metrics
duration: 2min
completed: 2026-02-21
---

# Phase 20 Plan 02: Gap Closure Surgical Cleanup Summary

**Three leftover Phase 14-15 artifacts removed: inline fontFamily stripped from LandingPage hero h1, deprecated Navigation.tsx deleted (157 lines), MobileBottomNav drawer labels upgraded to canonical .eyebrow utility**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-21T05:01:46Z
- **Completed:** 2026-02-21T05:03:39Z
- **Tasks:** 1
- **Files modified:** 2 modified, 1 deleted

## Accomplishments
- Removed `style={{ fontFamily: "Inter, system-ui, sans-serif" }}` from LandingPage hero h1 — Inter now inherits correctly from global CSS via the fonts.css `@theme` block established in Phase 14
- Deleted Navigation.tsx (deprecated since Phase 15-01 replacement by AppSidebar; 0 imports confirmed via grep) — 157 lines of dead code eliminated
- Replaced manual `text-xs font-semibold uppercase tracking-widest` classes on MobileBottomNav drawer section labels with canonical `.eyebrow` utility — ensures consistent Inter Variable weight 450 (not semibold 600) across all eyebrow labels in the app

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove inline fontFamily, delete Navigation.tsx, apply eyebrow utility** - `e55a145` (refactor)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/app/components/LandingPage.tsx` - Removed inline `style` prop from hero `<motion.h1>`
- `src/app/components/MobileBottomNav.tsx` - Drawer section `<p>` labels now use `className="eyebrow text-muted-foreground px-4 pt-4 pb-1"`
- `src/app/components/Navigation.tsx` - DELETED (deprecated since Phase 15-01)

## Decisions Made
- Navigation.tsx was safe to delete: confirmed via `grep -rn "from.*Navigation"` — only `SetNavigation` (a different component in session-replay/) was imported, never the `Navigation` component itself
- The `.eyebrow` utility is the canonical pattern; `text-xs font-semibold uppercase tracking-widest` is an incorrect approximation (wrong weight and size)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All three Phase 14-15 deferred artifacts are now resolved
- Design system consistency restored: `.eyebrow` utility is the single source of truth for section labels
- Build passes with zero errors confirming no broken imports from Navigation.tsx deletion

---
*Phase: 20-gap-closure-tech-debt*
*Completed: 2026-02-21*
