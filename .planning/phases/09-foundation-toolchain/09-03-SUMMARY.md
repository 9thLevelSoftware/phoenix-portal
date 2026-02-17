---
phase: 09-foundation-toolchain
plan: 03
subsystem: ui
tags: [css-variables, design-tokens, tailwind-v4, shadcn, dark-mode, color-palette]

# Dependency graph
requires:
  - phase: 09-foundation-toolchain (plan 02)
    provides: Biome linter/formatter configured, TS strict mode enabled
provides:
  - Complete design token layer in theme.css (elevation, typography, radius, icons)
  - Hex constant module (src/lib/colors.ts) for SVG/motion contexts
  - Clean shadcn components free of dead dark: variant classes
  - Surface/shadow tokens exposed to Tailwind via @theme inline
affects: [09-04-PLAN, 09-05-PLAN, all-ui-components]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual-token pattern: CSS variables for Tailwind/inline, hex constants for SVG/motion"
    - "3-tier border radius: sm(6px), md(8px), lg(12px)"
    - "Elevation layers: surface-0/1/2/overlay with brand-tinted shadows"

key-files:
  created:
    - src/lib/colors.ts
  modified:
    - src/styles/theme.css
    - src/app/components/ui/badge.tsx
    - src/app/components/ui/button.tsx
    - src/app/components/ui/chart.tsx
    - src/app/components/ui/checkbox.tsx
    - src/app/components/ui/context-menu.tsx
    - src/app/components/ui/dropdown-menu.tsx
    - src/app/components/ui/input-otp.tsx
    - src/app/components/ui/input.tsx
    - src/app/components/ui/menubar.tsx
    - src/app/components/ui/radio-group.tsx
    - src/app/components/ui/select.tsx
    - src/app/components/ui/switch.tsx
    - src/app/components/ui/tabs.tsx
    - src/app/components/ui/textarea.tsx
    - src/app/components/ui/toggle.tsx

key-decisions:
  - "dark: variant values promoted to base styles since app is dark-only (not removed outright)"
  - "Chart THEMES dark selector set to empty string rather than removing the theme system entirely"
  - "bg-input/30 used as unified dark input background replacing both bg-input-background and dark:bg-input/30"

patterns-established:
  - "Dual-token pattern: PHOENIX/SURFACE hex constants in colors.ts for SVG/motion; CSS variables in theme.css for everything else"
  - "No dark: Tailwind variants anywhere in shadcn UI components"
  - "All form inputs use bg-input/30 as base background (dark-only app)"

requirements-completed: [DSGN-01, DSGN-03, DSGN-04, DSGN-05, DSGN-06]

# Metrics
duration: 7min
completed: 2026-02-17
---

# Phase 9 Plan 03: Design Token Layer Summary

**Deleted .dark CSS override block, defined complete design tokens (elevation/typography/radius/icons), created hex constant module, and cleaned 21 dark: variants from 15 shadcn components**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-17T04:24:08Z
- **Completed:** 2026-02-17T04:31:20Z
- **Tasks:** 2
- **Files modified:** 17

## Accomplishments

- Deleted the .dark CSS block and @custom-variant dark line that silently overwrote the Phoenix palette with generic oklch grays
- Defined complete design token layer: elevation surfaces (surface-0/1/2/overlay), brand-tinted shadows (shadow-sm/md/lg), typography scale (7 sizes + 3 line heights), icon color tokens (6 semantic colors), 3-tier border radius (6px/8px/12px)
- Created src/lib/colors.ts with PHOENIX, SURFACE, and CHART_PALETTE hex constants for SVG/motion contexts
- Removed all 21 dark: Tailwind variant classes from 15 shadcn UI components, promoting dark values to base styles

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete .dark CSS block, define design system tokens, create colors.ts** - `12189c3` (feat)
2. **Task 2: Clean up dark: variant usages in 15 shadcn UI components** - `52d3953` (refactor)

## Files Created/Modified

- `src/styles/theme.css` - Removed .dark block, added elevation/typography/radius/icon tokens, exposed surface/shadow in @theme inline
- `src/lib/colors.ts` - New hex constant module with PHOENIX, SURFACE, CHART_PALETTE exports
- `src/app/components/ui/badge.tsx` - Removed 2 dark: variants (aria-invalid, destructive bg)
- `src/app/components/ui/button.tsx` - Removed 5 dark: variants (destructive, outline, ghost)
- `src/app/components/ui/chart.tsx` - Neutralized THEMES dark selector
- `src/app/components/ui/checkbox.tsx` - Removed 3 dark: variants (bg, checked, aria-invalid)
- `src/app/components/ui/context-menu.tsx` - Removed 1 dark: variant (destructive focus bg)
- `src/app/components/ui/dropdown-menu.tsx` - Removed 1 dark: variant (destructive focus bg)
- `src/app/components/ui/input-otp.tsx` - Removed 2 dark: variants (aria-invalid, bg)
- `src/app/components/ui/input.tsx` - Removed 2 dark: variants (bg, aria-invalid)
- `src/app/components/ui/menubar.tsx` - Removed 1 dark: variant (destructive focus bg)
- `src/app/components/ui/radio-group.tsx` - Removed 2 dark: variants (aria-invalid, bg)
- `src/app/components/ui/select.tsx` - Removed 3 dark: variants (aria-invalid, bg, hover:bg)
- `src/app/components/ui/switch.tsx` - Removed 3 dark: variants (unchecked bg, thumb states)
- `src/app/components/ui/tabs.tsx` - Removed 4 dark: variants (active states, text)
- `src/app/components/ui/textarea.tsx` - Removed 2 dark: variants (aria-invalid, bg)
- `src/app/components/ui/toggle.tsx` - Removed 1 dark: variant (aria-invalid)

## Decisions Made

- **dark: values promoted to base**: Since the app is dark-only, we use the dark variant values as the base styles rather than simply deleting them. For example, `aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40` becomes `aria-invalid:ring-destructive/40`.
- **Chart THEMES dark selector emptied**: Set the dark key's CSS selector to empty string `""` rather than removing the theme system entirely, preserving the API contract for chart config consumers that may use `theme: { light: "...", dark: "..." }`.
- **Unified bg-input/30 for inputs**: Replaced both `bg-input-background` (light base) and `dark:bg-input/30` patterns with just `bg-input/30` as the base, since we only need the dark appearance.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Design token layer is complete and ready for the hex color migration (Plan 09-05)
- PHOENIX, SURFACE, and CHART_PALETTE constants available for SVG/motion contexts
- All shadcn components are clean of dark: variants, ready for any theme-related refactoring
- Surface and shadow tokens are exposed via @theme inline for Tailwind utility class consumption

## Self-Check: PASSED

- [x] src/styles/theme.css exists
- [x] src/lib/colors.ts exists
- [x] 09-03-SUMMARY.md exists
- [x] Commit 12189c3 exists
- [x] Commit 52d3953 exists

---
*Phase: 09-foundation-toolchain*
*Completed: 2026-02-17*
