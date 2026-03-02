---
phase: 14-css-foundation-typography
plan: 01
subsystem: ui
tags: [inter, typography, css-variables, tailwind-v4, fonts, svg]

# Dependency graph
requires: []
provides:
  - Inter Variable font loaded with full wght axis (100..900) via Google Fonts
  - --default-font-family and --font-sans set to Inter in Tailwind @theme
  - Typography weight hierarchy: h1=700, h2=625, h3=500, h4=500
  - .eyebrow utility class (weight 450, 11px, letter-spacing 0.08em, uppercase)
  - All SVG chart text uses "Inter, system-ui, sans-serif" literal string
  - AppLayout uses bg-background token (BUG-08 fixed)
  - Dead CSS variables removed (--font-size-xs through --font-size-3xl, --leading-*, --font-weight-*)
affects: [15-sidebar-navigation, 16-card-surfaces, 17-data-visualization, 18-chart-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inter Variable loaded as CSS variable font enabling non-standard weights 450 and 625"
    - "SVG text elements use literal fontFamily strings not CSS variables (CSS vars dont work in SVG presentation attributes)"
    - "@theme block in fonts.css sets --default-font-family so every element inherits Inter automatically"
    - ".eyebrow class for uppercase stat labels and data labels with tight letter-spacing"

key-files:
  created: []
  modified:
    - index.html
    - src/styles/fonts.css
    - src/styles/theme.css
    - src/app/routes/AppLayout.tsx
    - src/app/components/LandingPage.tsx
    - src/app/components/MuscleHeatmap.tsx
    - src/app/components/ConsistencyCalendar.tsx
    - src/app/components/charts/RomTrend.tsx
    - src/app/components/charts/AsymmetryGauge.tsx

key-decisions:
  - "Inter Variable loaded with full wght axis (0,100..900;1,100..900) to unlock non-standard weights 450 (eyebrow) and 625 (h2)"
  - "Bebas Neue removed entirely — no longer used anywhere in the app"
  - "fonts.css uses @theme block (not @layer base) so Tailwind v4 generates html/:host font-family rule automatically"
  - "SVG fontFamily uses literal string 'Inter, system-ui, sans-serif' — CSS variables do not resolve in SVG presentation attributes"
  - "h2 uses weight 625 (non-standard, only possible with variable font) for visual distinction between h1 and h3"
  - "AppLayout gets relative z-[10] alongside bg-background to prepare for Plan 02 ambient glow layers on body::before/::after"

patterns-established:
  - "Variable font weights: use numeric values (450, 625, 700) not named weights for Inter Variable"
  - "SVG text pattern: fontFamily='Inter, system-ui, sans-serif' as literal string in all chart/SVG contexts"
  - "Eyebrow pattern: .eyebrow class for all uppercase stat labels and data category labels"

requirements-completed: [TYPE-01, TYPE-02, TYPE-03, TYPE-04, TYPE-05, TYPE-06, BUG-08]

# Metrics
duration: 2min
completed: 2026-02-20
---

# Phase 14 Plan 01: CSS Foundation & Typography Summary

**Inter Variable font with premium weight hierarchy (700/625/500/450), global default via Tailwind @theme, and all 16 SVG system-ui fontFamily references replaced with Inter**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-20T07:12:52Z
- **Completed:** 2026-02-20T07:14:56Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Inter Variable font loaded with full wght axis (100..900) unlocking non-standard weights 450 and 625
- Bebas Neue completely removed from font loading and all CSS rules
- Typography hierarchy established: h1=700, h2=625, h3=500, h4=500 with proper sizes and line-heights
- `.eyebrow` utility class added (weight 450, 11px, letter-spacing 0.08em, uppercase) for stat labels
- Dead CSS variables removed: 7 font-size vars, 3 line-height vars, 2 font-weight vars
- All 16 `fontFamily="system-ui"` SVG references replaced with literal `"Inter, system-ui, sans-serif"` strings
- BUG-08 fixed: AppLayout hardcoded `bg-[#0D0D0D]` replaced with `bg-background` token plus `relative z-[10]`

## Task Commits

Each task was committed atomically:

1. **Task 1: Load Inter Variable font and set as global default** - `e2d0a24` (feat)
2. **Task 2: Implement typography hierarchy, clean dead CSS, fix system-ui references** - `272e8df` (feat)

## Files Created/Modified
- `index.html` - Inter Variable font link (wght@0,100..900;1,100..900), preload tag, Bebas Neue removed
- `src/styles/fonts.css` - Replaced with @theme block setting --default-font-family and --font-sans to Inter
- `src/styles/theme.css` - Dead font-size/leading/font-weight vars removed; h1-h4 hierarchy with 700/625/500/500 weights; .eyebrow class added
- `src/app/routes/AppLayout.tsx` - bg-[#0D0D0D] -> bg-background relative z-[10] (BUG-08)
- `src/app/components/LandingPage.tsx` - h1 style={{ fontFamily: "system-ui" }} -> "Inter, system-ui, sans-serif"
- `src/app/components/MuscleHeatmap.tsx` - SVG text fontFamily="system-ui" -> "Inter, system-ui, sans-serif"
- `src/app/components/ConsistencyCalendar.tsx` - 2x SVG text fontFamily replaced
- `src/app/components/charts/RomTrend.tsx` - 6x fontFamily replaced (Text components and tooltip style object)
- `src/app/components/charts/AsymmetryGauge.tsx` - 6x fontFamily replaced (Text components and tooltip style object)

## Decisions Made
- Inter Variable loaded with full italic + weight axis (`0,100..900;1,100..900`) to support both normal and italic variants at any weight
- `@theme` block used in fonts.css rather than `@layer base` — Tailwind v4's `@theme` generates the global `html, :host { font-family }` rule automatically without specificity conflicts
- SVG fontFamily must use literal strings — CSS custom properties (`var(--font-sans)`) do not resolve in SVG presentation attributes
- h2 weight 625 (non-standard, requires variable font) provides perceptible visual distinction between h1 (700) and h3 (500) without being heavy
- AppLayout gets `relative z-[10]` preemptively so Plan 02's ambient glow layers on `body::before`/`body::after` stack correctly

## Deviations from Plan

None - plan executed exactly as written.

The plan noted 16 total system-ui occurrences across 5 files; actual count was also 16 (AsymmetryGauge had 3 attribute-form + 3 object-form = 6, RomTrend had 1 attribute-form + 5 object-form = 6, matching the plan's per-file counts).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Inter Variable typography foundation complete — all subsequent phases can use weights 450, 625, and standard weights
- `.eyebrow` class available for stat labels, data categories, section badges
- BUG-08 resolved — AppLayout uses semantic `bg-background` token
- Plan 02 (ambient glow + grain texture on body) can safely add z-index 0/1 layers — AppLayout is at z-10

## Self-Check

**Files verified:**
- `index.html` — contains `100..900` range syntax (verified via grep: 3 matches)
- `src/styles/fonts.css` — contains `--default-font-family` in @theme block
- `src/styles/theme.css` — contains `font-weight: 625` and `.eyebrow`
- `src/app/routes/AppLayout.tsx` — contains `bg-background relative z-[10]`

**Commits verified:**
- `e2d0a24` — feat(14-01): load Inter Variable font and set as global default
- `272e8df` — feat(14-01): implement typography hierarchy, clean dead CSS, fix system-ui references

**Build:** Passes cleanly (verified twice — once per task)

## Self-Check: PASSED

---
*Phase: 14-css-foundation-typography*
*Completed: 2026-02-20*
