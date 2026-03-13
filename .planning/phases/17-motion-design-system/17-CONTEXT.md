---
phase: 17-motion-design-system
milestone: v1.2
depends_on: [16-visual-depth-surfaces]
total_plans: 4
total_waves: 3
requirements: [MOT-01, MOT-02, MOT-03, MOT-04, MOT-05, MOT-06, MOT-07, MOT-08, MOT-09, MOT-10]
---

# Phase 17: Motion Design System — Context

## Phase Goal

All animations reference a single `src/lib/animations.ts` preset library; page transitions fire on every route change; stat cards spring on hover; card grids stagger on mount; key dashboard numbers count up from zero; all animations respect `prefers-reduced-motion`.

## Requirements

- **MOT-01**: Page transitions via AnimatePresence wrapping router outlet (using `useOutlet()` pattern for React Router v7 compatibility)
- **MOT-02**: Card hover states use Framer Motion spring physics (`whileHover={{ scale: 1.015, y: -2 }}` with elevated shadow)
- **MOT-03**: Entrance animations use `staggerChildren` variants instead of manual delay offsets
- **MOT-04**: Shared animation presets centralized in `src/lib/animations.ts` (fadeUp, staggerContainer, pageTransition)
- **MOT-05**: Stat numbers animate from 0 to value on mount using `@number-flow/react`
- **MOT-06**: Landing hero has scroll parallax (`useScroll` + `useTransform` on content container)
- **MOT-07**: Scroll indicator replaced with Framer Motion breathing animation (not Tailwind `animate-bounce`)
- **MOT-08**: Loading state uses branded Phoenix flame pulse instead of generic spinner
- **MOT-09**: `prefers-reduced-motion` check on EmberParticles and all entrance animations
- **MOT-10**: Key CTAs have `whileTap={{ scale: 0.97 }}` press feedback

## Existing Assets

### Already in place
- **motion v12.23.24** — Framer Motion fully integrated, 50+ files importing from `motion/react`
- **MotionConfig reducedMotion="user"** — Set at AppLayout level (line 51), covers all Framer Motion animations
- **CSS keyframes** — `animate-flame-flicker`, `animate-ember-rise`, `animate-phoenix-glow` in theme.css
- **Spring physics** — Already used in celebrations, card hovers (scale 1.02), bottom sheet
- **prefers-reduced-motion media query** — In theme.css (lines 342-359), suppresses decorative CSS animations
- **Vendor chunking** — motion has its own vendor chunk in vite.config.ts (line 95)
- **`.tabular-nums`** — Font variant class in fonts.css (ideal for animated counter alignment)

### Gaps to fill
- No `src/lib/animations.ts` — spring configs scattered across 50+ files
- No `@number-flow/react` — needed for stat counting animations
- No page transitions — AppLayout uses `<Outlet />`, not `useOutlet()` + AnimatePresence
- EmberParticles (Canvas-based) doesn't check `prefers-reduced-motion` — MotionConfig doesn't cover Canvas
- PageLoading uses generic CSS spinner — no branded animation
- Landing scroll indicator uses Tailwind `animate-bounce` — not Framer Motion

## Architecture Decisions

- **useOutlet() over <Outlet>**: React Router v7 unmounts outlet immediately; useOutlet() holds reference for AnimatePresence exit animations
- **@number-flow/react over custom hook**: ~4KB gzip, handles locale formatting, interrupt-resistant — avoids reinventing counting animation
- **EmberParticles manual matchMedia**: Canvas API is outside React/Framer Motion scope; use `window.matchMedia("(prefers-reduced-motion: reduce)")` directly
- **Bundle gate**: main chunk must stay under 100KB; @number-flow/react adds ~4KB gzip, animations.ts is tree-shakeable

## Plan Structure

| Plan | Wave | Name | Requirements | Agent |
|------|------|------|-------------|-------|
| 17-01 | 1 | Animation Foundation & Presets | MOT-04, MOT-09 | autonomous |
| 17-02 | 2 | Page Transitions & Loading | MOT-01, MOT-08 | engineering-frontend-developer |
| 17-03 | 2 | Landing Page Motion | MOT-06, MOT-07, MOT-10 | engineering-frontend-developer |
| 17-04 | 3 | Dashboard Stat Counting & Card Animations | MOT-02, MOT-03, MOT-05 | engineering-frontend-developer |

## Constraints

- Max 3 backdrop-blur layers per viewport (GPU budget — carried from Phase 16)
- AnimatePresence requires useOutlet() not <Outlet> for React Router v7
- Bundle gate: main chunk under 100KB after build
- MotionConfig reducedMotion="user" already handles Framer Motion — do NOT add duplicate checks
- visx ChartTheme.ts hex constants are permanent — SVG cannot resolve CSS vars

---
*Generated: 2026-03-13*
