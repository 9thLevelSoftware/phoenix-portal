---
phase: 14-css-foundation-typography
plan: 02
subsystem: ui
tags: [css-variables, tailwind-v4, ambient-glow, grain-texture, shadow-tokens, surface-tokens]

# Dependency graph
requires:
  - phase: 14-01
    provides: "AppLayout with relative z-[10] ensures content sits above z-0 glow and z-1 grain layers"
provides:
  - body::before ambient ember/flame radial gradient glows (top-left 8% orange, bottom-right 6% red)
  - body::after SVG feTurbulence grain texture at 2.5% opacity with overlay blend mode
  - Tailwind shadow-sm/md/lg utilities wired to warm ember-tinted values via standalone @theme block
  - --surface-3: #222222 token (bg-surface-3 Tailwind utility available)
  - [data-slot="card"] default box-shadow via var(--shadow-sm)
  - .border-secondary overridden to rgba(255,255,255,0.06) subtle separator
  - All CSS variables (--surface-0 through --surface-3, --shadow-sm/md/lg) resolve cleanly in DevTools
affects: [15-sidebar-navigation, 16-card-surfaces, 17-data-visualization, 18-chart-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tailwind shadow utilities require standalone @theme block (not @theme inline) to generate utility classes — inline only maps existing vars"
    - "body::before/::after pseudo-elements for ambient glows at z-index 0/1; content layer must be at z-10 or higher"
    - "SVG feTurbulence inline data URI for grain texture — zero network cost, works in production build"
    - "Circular var() self-references in @theme inline do nothing — remove them and use standalone @theme for value definition"
    - ".border-secondary override via @layer base with !important bypasses Tailwind utilities layer specificity"

key-files:
  created: []
  modified:
    - src/styles/theme.css

key-decisions:
  - "Standalone @theme block (not @theme inline) used to wire shadow-sm/md/lg to Tailwind utility generation — @theme inline only bridges existing :root vars, does not generate new utility values"
  - "Circular shadow self-references (--shadow-sm: var(--shadow-sm)) removed from @theme inline — they were no-ops and blocked correct utility generation"
  - "SVG feTurbulence grain texture embedded as inline data URI — no external file dependency, survives production build asset hashing"
  - "body::before/::after use position: fixed + inset: 0 to cover full viewport regardless of scroll position"
  - ".border-secondary override uses !important because @layer base has lower specificity than @layer utilities where Tailwind generates the original class"

patterns-established:
  - "Ambient glow pattern: body::before with multiple radial-gradients at low opacity (6-8%) for cinematic depth without distraction"
  - "Grain texture pattern: body::after with SVG feTurbulence data URI, opacity 0.025, mix-blend-mode: overlay"
  - "Shadow token pattern: define values in :root + standalone @theme block; never use circular var() in @theme inline"

requirements-completed: [VIS-01, VIS-02, VIS-04, VIS-05]

# Metrics
duration: 2min
completed: 2026-02-21
---

# Phase 14 Plan 02: CSS Foundation & Typography Summary

**Ambient ember/flame glow overlays, SVG grain texture, warm-tinted Tailwind shadow utilities, and global card elevation via body pseudo-elements and fixed @theme shadow wiring**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-21T02:38:02Z
- **Completed:** 2026-02-21T02:40:38Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Fixed circular shadow token self-references in `@theme inline` that were preventing Tailwind from generating warm shadow utilities
- Wired `shadow-sm/md/lg` Tailwind utilities to brand-tinted values (ember orange 3-5% ring) via standalone `@theme` block
- Added `--surface-3: #222222` as third elevation surface step, exposed as `bg-surface-3` Tailwind utility
- Applied `box-shadow: var(--shadow-sm)` as default elevation for all `[data-slot="card"]` elements
- Added `body::before` ambient glow: ember orange 8% top-left + flame red 6% bottom-right radial gradients
- Added `body::after` SVG feTurbulence grain texture at 2.5% opacity with overlay blend mode
- Overrode `.border-secondary` to `rgba(255,255,255,0.06)` subtle separator replacing the heavier `#374151`

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix shadow token wiring and add surface-3 token** - `7f2c203` (feat)
2. **Task 2: Add ambient glow, grain texture, and border-secondary override** - `d6e7cca` (feat)

## Files Created/Modified
- `src/styles/theme.css` - All changes: shadow token fix, @theme block, surface-3, body pseudo-elements, border-secondary override

## Decisions Made
- Standalone `@theme` block used for shadow utility generation (not `@theme inline`) — Tailwind v4's `@theme inline` only maps existing vars to color/token utilities, it does not generate new utility class values for shadows. A non-inline `@theme` block is required to actually define what `shadow-sm` etc. output.
- Circular `--shadow-sm: var(--shadow-sm)` removed from `@theme inline` — these were completely inert (CSS self-reference cycles resolve to initial value) and were masking the real issue
- SVG feTurbulence grain texture embedded as inline data URI in CSS — survives production build without any file reference issues; no external asset dependency
- `body::before`/`body::after` use `position: fixed` + `inset: 0` to cover the full viewport on scroll, not just above-the-fold
- `.border-secondary` override placed in `@layer base` with `!important` — necessary because Tailwind's utilities layer has higher specificity than base; `!important` is justified here as a design system global override (not a one-off hack)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Ambient visual foundation complete — all authenticated pages now show warm ember glow and organic grain depth
- Tailwind `shadow-sm/md/lg` produce brand-tinted warm shadows ready for Phase 16 card hierarchy
- `bg-surface-3` available for modal/popover elevations in Phase 15 (sidebar) and beyond
- `.border-secondary` globally overridden — Phase 16 can build on this or replace with component-level tokens
- Phase 14 (CSS Foundation & Typography) fully complete — both plans done

## Self-Check

**Files verified:**
- `src/styles/theme.css` — contains `body::before`, `body::after`, `@theme {` (standalone), `--surface-3`, `[data-slot="card"]`, `.border-secondary`

**Commits verified:**
- `7f2c203` — feat(14-02): fix shadow token wiring, add surface-3 token, default card elevation
- `d6e7cca` — feat(14-02): add ambient glow, grain texture, border-secondary override

**Build:** Passes cleanly (verified twice — once per task)

**Built CSS verified:**
- `body:before` with `radial-gradient` present in minified output
- `body:after` with `feTurbulence` grain SVG present
- `[data-slot=card]{box-shadow:var(--shadow-sm)}` present
- Shadow values contain ember ring (`#ff6b3508`, `#ff6b350a`, `#ff6b350d`)
- `.border-secondary` override present

## Self-Check: PASSED

---
*Phase: 14-css-foundation-typography*
*Completed: 2026-02-21*
