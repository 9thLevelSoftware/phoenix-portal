---
phase: 09-foundation-toolchain
plan: 05
subsystem: ui
tags: [tailwind, css-variables, design-tokens, color-system, recharts, svg, framer-motion]

# Dependency graph
requires:
  - phase: 09-foundation-toolchain
    plan: 03
    provides: "Design token layer (theme.css CSS variables + colors.ts PHOENIX constants)"
provides:
  - "Fully tokenized color system across all 74 feature component files"
  - "Zero hardcoded Phoenix brand hex in Tailwind classes, SVG, or inline styles"
  - "mutedForeground (#9CA3AF) added to PHOENIX constants for chart axis styling"
affects: [10-data-integrity, 11-premium-features, 12-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Semantic Tailwind tokens: bg-primary, text-muted-foreground, border-secondary, etc."
    - "PHOENIX constants for SVG stroke/fill and Recharts programmatic colors"
    - "SURFACE constants for chart CartesianGrid stroke colors"
    - "CSS var() for inline style backgroundColor/color values"

key-files:
  created: []
  modified:
    - "src/lib/colors.ts"
    - "src/app/components/*.tsx (67 top-level + subdirectory files)"
    - "src/app/components/mobile/*.tsx"
    - "src/app/components/celebrations/*.tsx"
    - "src/app/components/cycle-builder/*.tsx"
    - "src/app/components/routine-builder/*.tsx"
    - "src/app/components/community/*.tsx"
    - "src/app/components/charts/*.tsx"

key-decisions:
  - "Non-Phoenix palette colors (#6366F1 indigo, #FC4C02 Strava, #8B5CF6 purple, #EC4899 pink) retained as arbitrary values -- no semantic tokens for third-party/accent colors"
  - "Added mutedForeground (#9CA3AF) to PHOENIX constants since chart axes need this color programmatically and CSS vars cannot be used in SVG attributes"
  - "Surface colors (#1a1a1a, #1A1A2E) mapped to bg-surface-2 token; #2D2D44 borders mapped to border-secondary as closest semantic match"
  - "Inline style hex values converted to CSS var() references (var(--surface-2), var(--foreground), etc.) rather than PHOENIX constants"

patterns-established:
  - "Color usage rule: Tailwind classes use semantic tokens (bg-primary, text-muted); SVG/Recharts use PHOENIX.* constants; inline styles use var(--token)"
  - "Import pattern: files needing programmatic colors import { PHOENIX } or { PHOENIX, SURFACE } from @/lib/colors"

requirements-completed: [DSGN-02]

# Metrics
duration: 8min
completed: 2026-02-17
---

# Phase 9 Plan 5: Feature Component Color Token Migration Summary

**2,714 hardcoded hex values replaced with semantic tokens and PHOENIX constants across 74 files, completing full color system tokenization**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-17T04:47:44Z
- **Completed:** 2026-02-17T04:55:56Z
- **Tasks:** 2
- **Files modified:** 74

## Accomplishments
- Eliminated all Phoenix brand hex colors (#FF6B35, #DC2626, #F59E0B, #10B981, #EF4444, #FBBF24, etc.) from Tailwind arbitrary value syntax across 67 feature components (2,571 replacements)
- Converted SVG stroke/fill attributes, Recharts chart props, and inline styles to PHOENIX constants and CSS variable references (143 additional replacements)
- Added PHOENIX import to 22 files that now reference color constants programmatically
- Future palette changes now require editing only theme.css + colors.ts (2 files instead of 74+)

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate Tailwind arbitrary hex colors to semantic token classes** - `80777d0` (feat)
2. **Task 2: Migrate SVG stroke/fill hex and motion animate hex to PHOENIX constants** - `b3db41e` (feat)

## Files Created/Modified
- `src/lib/colors.ts` - Added mutedForeground constant for chart axis styling
- `src/app/components/*.tsx` (33 files) - Top-level feature components tokenized
- `src/app/components/mobile/*.tsx` (3 files) - Mobile variants tokenized
- `src/app/components/celebrations/*.tsx` (6 files) - Celebration animations tokenized
- `src/app/components/cycle-builder/*.tsx` (7 files) - Cycle builder components tokenized
- `src/app/components/routine-builder/*.tsx` (4 files) - Routine builder components tokenized
- `src/app/components/community/*.tsx` (7 files) - Community components tokenized
- `src/app/components/charts/*.tsx` (3 files) - Chart components tokenized
- `src/app/components/integrations/*.tsx` (1 file) - Integration components tokenized
- `src/app/components/modals/*.tsx` (1 file) - Modal components tokenized
- `src/app/components/profile/*.tsx` (1 file) - Profile sub-components tokenized
- `src/app/components/session-replay/*.tsx` (3 files) - Session replay components tokenized

## Decisions Made
- Non-Phoenix palette colors retained as Tailwind arbitrary values since they don't belong to the brand token system
- mutedForeground added to PHOENIX object (rather than using CSS vars) because SVG attributes and Recharts props cannot accept CSS variables
- #1A1A2E (custom dark indigo used in Biomechanics/ExerciseProgress) mapped to surface-2 token as closest match
- Inline styles use CSS var() references for static rendering, while SVG/Recharts use PHOENIX constants for programmatic rendering

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed broken PHOENIX import insertion in AnalyticsMobile.tsx**
- **Found during:** Task 2 (SVG/motion migration)
- **Issue:** Automated import insertion placed `import { PHOENIX }` in the middle of a multi-line import statement, breaking the file
- **Fix:** Moved the PHOENIX import after the completed multi-line import block
- **Files modified:** src/app/components/mobile/AnalyticsMobile.tsx
- **Verification:** Build passes after fix
- **Committed in:** b3db41e (Task 2 commit)

**2. [Rule 2 - Missing Critical] Added mutedForeground to PHOENIX constants**
- **Found during:** Task 2 (SVG/motion migration)
- **Issue:** #9CA3AF (muted foreground gray) was extensively used in chart axes but had no PHOENIX constant -- only ashGray (#6B7280) existed
- **Fix:** Added `mutedForeground: "#9CA3AF"` to PHOENIX object in colors.ts
- **Files modified:** src/lib/colors.ts
- **Verification:** All 19 chart axis references now use PHOENIX.mutedForeground, build passes
- **Committed in:** b3db41e (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
None - migration executed systematically via scripted bulk replacements with manual review of edge cases.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 9 (Foundation & Toolchain) is now complete -- all 5 plans executed
- Color system fully tokenized; ready for any future palette changes
- All feature components reference centralized tokens; new components should follow the established pattern

## Self-Check: PASSED

- SUMMARY.md exists: FOUND
- Commit 80777d0 exists: FOUND
- Commit b3db41e exists: FOUND
- colors.ts mutedForeground: FOUND
- Build passes: YES

---
*Phase: 09-foundation-toolchain*
*Completed: 2026-02-17*
