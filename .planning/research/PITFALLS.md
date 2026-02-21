# Pitfalls Research

**Domain:** React fitness dashboard visual overhaul (dark theme, 42K LOC, working app)
**Researched:** 2026-02-20
**Confidence:** HIGH — project-specific analysis of actual codebase, verified against official docs and current community sources

---

## Critical Pitfalls

### Pitfall 1: CSS Variable Namespace Collision Between Tailwind v4 and shadcn/ui

**What goes wrong:**
Tailwind v4 auto-generates CSS variables from every `@theme` token using its own naming convention. The project's `theme.css` already uses `@theme inline` with 60+ custom variables (`--primary`, `--background`, `--card`, `--sidebar`, etc.). When adding new tokens, Tailwind v4 can silently overwrite or clash with existing variables — confirmed active GitHub issue: tailwindlabs/tailwindcss#15754. Additionally, any variable defined inside `@layer base` instead of `:root` will be invisible to `@theme inline` and break utility generation without an error.

**Why it happens:**
Tailwind v4 moved to a CSS-first config where all tokens in `@theme` get auto-prefixed and exposed as CSS variables. The project's `theme.css` already mixes raw `:root` variables with `@theme inline` declarations — adding tokens in the wrong block silently fails. The shadcn/ui dark mode note from official docs confirms: "Variables inside `@layer base` won't be available to `@theme inline` and will break utility generation."

**How to avoid:**
- New color/surface tokens ALWAYS go in `:root` at the top of `theme.css`, NEVER inside `@layer base`
- `@theme inline` references the variable, it does not define it
- After every token addition, verify: (1) the CSS variable appears in DevTools `:root`, (2) a Tailwind utility using that token compiles correctly
- Avoid token names that collide with Tailwind's built-in namespace (`--color-*`, `--spacing-*`, etc.)
- The project's existing dual-token pattern (CSS vars for Tailwind, hex constants for SVG/motion) is correct — maintain this separation

**Warning signs:**
- A new Tailwind class like `bg-surface-2` compiles but applies the wrong color
- A CSS variable works in inline styles but not in a Tailwind utility
- Biome passes but the element renders transparent or unstyled
- `--radius` variable shows a different value than expected (regression from prior working state)

**Phase to address:**
Phase 1 (CSS foundation / token expansion). Verify before touching any other component.

---

### Pitfall 2: Glassmorphism / backdrop-filter Causing Mobile Jank and Battery Drain

**What goes wrong:**
`backdrop-blur` is already used in `Navigation.tsx` (`backdrop-blur-lg`) and across 19 files. Adding more glassmorphism to cards, sidebars, and modals exponentially increases GPU compositing cost. Each `backdrop-filter: blur()` forces the browser to create a new stacking context and composite layer. On mobile (especially mid-range Android), stacking 4+ `backdrop-blur` elements in a single viewport causes dropped frames and battery drain. The blur value matters exponentially: 8px ≈ cheap, 20px ≈ 4x the cost.

**Why it happens:**
Glassmorphism looks stunning in Figma previews (which have no rendering cost). Engineers add it to cards, sidebars, nav bars, modals, and tooltips across the redesign, resulting in 6-10 blur contexts on a single page. The `CelebrationOverlay.tsx`, `MobileBottomNav.tsx`, and navigation bar are already composited — adding blur to cards stacks on top.

**How to avoid:**
- Limit `backdrop-blur` to maximum 2-3 elements visible simultaneously per viewport
- Use reduced blur on mobile: `backdrop-blur-sm` (4px) instead of `backdrop-blur-lg` (16px) via responsive prefix `md:backdrop-blur-lg`
- Never animate elements that have `backdrop-filter` active (scale/translate is fine, but transitioning blur radius itself is catastrophic)
- For card surfaces, use opaque `bg-surface-1` or `bg-surface-2` rather than blur — the elevation system already exists for this
- Reserve blur for: nav bar, sidebar overlay backdrop, celebration modals — NOT data cards
- Test specifically on a mid-range Android device (Chrome on Pixel 6a or similar)

**Warning signs:**
- Chrome DevTools Performance tab shows "Composite Layers" > 8 items per frame
- Mobile scrolling feels sticky or choppy when cards are visible
- Battery usage noticeably higher in dev testing
- `--layer-count` in DevTools Layers panel exceeds expectations

**Phase to address:**
Phase 2 (Visual depth / glassmorphism pass). Enforce a "blur budget" rule before merging.

---

### Pitfall 3: Horizontal-to-Sidebar Navigation Breaking Mobile Responsive Behavior

**What goes wrong:**
The current `Navigation.tsx` is a sticky top nav (`hidden md:block`), and `MobileBottomNav.tsx` handles mobile. Converting desktop nav to a collapsible sidebar changes the layout contract for every page: `max-w-7xl mx-auto` padding assumptions change, chart widths break because parent container width changed, sticky elements (search bars, filters) reposition relative to new context. The `shadcn/ui Sidebar` component requires `SidebarProvider` to wrap the app root — this must integrate cleanly with the existing `Zustand` store and `React Router v7` outlet structure.

**Why it happens:**
A sidebar adds a permanent left gutter that consumes horizontal space. Every page currently assumes the full viewport width minus navigation height. Pages with `max-w-7xl` centered layouts will shift. Chart components (visx `ParentSize`, Recharts' `ResponsiveContainer`) inherit the new narrower parent width and re-render at the wrong size if not given explicit dimensions during transition. The 26-route `React Router v7` outlet structure must be reorganized so the sidebar wraps routes correctly.

**How to avoid:**
- Audit every page with `ResponsiveContainer` or `ParentSize` before sidebar migration — list them explicitly
- Maintain `MobileBottomNav.tsx` exactly as-is — the sidebar is desktop-only (`md:` prefix); do not change mobile layout
- The `SidebarProvider` context must wrap the router `<Outlet>` — confirm this is compatible with the existing `useUIStore` sidebar state without duplication
- Use `--sidebar-width` CSS variable (already defined in `theme.css`) so chart containers can subtract it: `calc(100vw - var(--sidebar-width))`
- Test every chart page at exactly 768px width (the breakpoint boundary) after migration
- Keep `Navigation.tsx` in place and build `Sidebar.tsx` as a parallel component — delete the old one only after all 26 routes are verified

**Warning signs:**
- Recharts `ResponsiveContainer` shows "width: 0" error in console
- Charts render narrower than expected or overflow their containers
- visx `ParentSize` reports dimensions smaller than intended
- Mobile layout shows horizontal scrollbar (sidebar leaking into mobile)
- `MobileBottomNav` disappears or repositions unexpectedly

**Phase to address:**
Phase 3 (Navigation migration). Do NOT touch charts in the same PR as the sidebar restructure.

---

### Pitfall 4: Framer Motion Layout Animations Thrashing on Page Transitions

**What goes wrong:**
Adding page transitions with `AnimatePresence` + React Router v7 requires `useOutlet` to get routes as direct `AnimatePresence` children — using the `<Outlet>` component directly causes `AnimatePresence` to track `OutletContext.Provider` as the child instead of the actual page, breaking unmount detection. If `layout` animations are also used (for the sidebar collapse, card reordering), they interact with page transitions via shared layout recalculations and can cause "purple layout bars" thrash in Framer Motion DevTools, manifesting as brief full-page layout flickers during navigation.

**Why it happens:**
React Router v7's `<Outlet>` renders through a context provider, which is what `AnimatePresence` sees as its child — not the page component. Exit animations never fire because from `AnimatePresence`'s perspective, the provider never unmounts. This is a known integration pattern requirement documented across React Router + Framer Motion discussions.

**How to avoid:**
- Use `useOutlet(context)` instead of `<Outlet>` when wrapping with `AnimatePresence`
- Set `mode="wait"` on `AnimatePresence` to prevent old and new pages from overlapping
- Use `key={location.pathname}` on the motion wrapper, not on `AnimatePresence` itself
- Keep page transitions to `opacity` and `transform` only — never animate `height`, `width`, or layout-affecting properties during route changes
- Disable page transitions entirely if `prefers-reduced-motion` is set (this is a WCAG requirement, not optional — axe-core will flag it)
- The existing `AnimatePresence` usage in `CelebrationOverlay.tsx` must not conflict with the route-level `AnimatePresence` — they need separate roots

**Warning signs:**
- Page content flashes before exit animation completes
- Console: "You're attempting to animate multiple children within AnimatePresence"
- Exit animations never fire (page immediately disappears)
- CPU spikes during navigation visible in Performance tab

**Phase to address:**
Phase 4 (Motion design). Build page transitions as the last animation step, after all other Framer Motion usage is stable.

---

### Pitfall 5: Chart Styling Regression in visx Force Curve and Power Output Charts

**What goes wrong:**
The `ChartTheme.ts` uses hardcoded hex constants (`CHART_COLORS`, `REP_COLORS`, `FONT_SIZES`) because visx/SVG attributes cannot consume CSS variables at runtime — SVG `fill`, `stroke`, and `tick` style objects require resolved color values, not `var(--primary)`. The dual-token pattern exists for exactly this reason. If the redesign tries to "clean up" `ChartTheme.ts` by replacing constants with CSS variable references (to align with the design system), the SVG rendering will silently fail — SVG props like `stroke={CHART_COLORS.gridLine}` will receive the string `"var(--chart-1)"` which SVG does not resolve, producing transparent/black strokes.

**Why it happens:**
CSS variables work in CSS properties but not in SVG presentation attributes. `getComputedStyle(element).getPropertyValue('--primary')` can read them at runtime, but the visx `AxisLeft`/`AxisBottom`/`GridRows` components pass style objects directly to SVG — these are not run through CSS resolution. `ForceCurve.tsx` uses `CHART_COLORS.axisText` in `tickLabelProps` style objects, and `PowerOutput.tsx` uses `CHART_COLORS.primary`/`secondary` in dynamic tick `fill` props. Both will break silently if constants are replaced with CSS variable strings.

**How to avoid:**
- Treat `ChartTheme.ts` as SVG-only, permanent hex constants — do NOT replace with CSS var references
- If chart colors need to change for the redesign, update the hex values in `ChartTheme.ts` AND the corresponding CSS variable in `theme.css` — keep both in sync manually
- When adding new chart styles (gradient fills, animated axes, custom tooltips), continue the pattern: hex constants in `ChartTheme.ts` for SVG attributes, CSS vars for HTML overlay elements
- The `ChartTooltipContent` in `ChartTooltip.tsx` correctly mixes both: `color: "var(--foreground)"` for HTML text (CSS-resolvable), `backgroundColor: CHART_COLORS.tooltipBg` for the SVG-adjacent container (hex required)
- Run visual smoke tests on `ForceCurve`, `PowerOutput`, and `AsymmetryGauge` after ANY `ChartTheme.ts` or `theme.css` change

**Warning signs:**
- Force curve chart renders with invisible/black axis lines
- Chart grid lines disappear
- Tick labels lose color and appear as default browser black
- Tooltip background becomes transparent

**Phase to address:**
Phase 5 (Data visualization styling). Establish a "chart colors contract" document before any chart styling changes.

---

### Pitfall 6: The "Make It Pretty But Slower" Bundle Size Trap

**What goes wrong:**
The main bundle is currently optimized to 95KB (34KB gzip) with 15+ lazy-loaded chunks after significant work removing 100MB of unused deps. UI redesigns routinely introduce library creep: a gradient animation library here, a scroll-triggered animation library there, a new icon pack, a "parallax" utility — each small individually but collectively devastating. A single 150KB animation library added to the main chunk undoes months of bundle optimization and pushes TTI (Time to Interactive) past 3.5 seconds on mobile networks.

**Why it happens:**
Redesign phases often happen quickly, optimized for visual output. Imports get added to page-level components rather than lazy-loaded chunks. New libraries are evaluated for visual effect, not bundle impact. shadcn/ui sidebar component (`sidebar.tsx` already exists in `src/app/components/ui/`) may trigger additional dependency imports.

**How to avoid:**
- Run `npm run build` and check chunk sizes after every new library addition — not at the end of the phase
- Use `rollup-plugin-visualizer` (already in the project per `PROJECT.md`) to catch unexpected chunk growth
- Any new visual library must be imported in a lazy-loaded page component or `React.lazy()` boundary — never in `App.tsx`, `Navigation.tsx`, or any always-loaded component
- Budget: main chunk must stay under 100KB (currently 95KB); total initial JS must stay under 200KB gzip
- Prefer CSS animations (`@keyframes` in `theme.css`) over JavaScript animation libraries for anything that CSS can handle (fade-in, slide, pulse)
- Lucide React is already the icon library — do not add a second icon pack for "nicer" icons

**Warning signs:**
- `npm run build` output shows main chunk growing above 120KB
- Visualizer shows a new vendor appearing in the main chunk
- `vite-plugin-visualizer` shows a dependency not previously visible
- Lighthouse mobile TTI regression above 4s

**Phase to address:**
Every phase. Establish a pre-merge bundle size check as a gate on every PR.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode redesigned colors in component JSX (`text-[#FF6B35]`) | Faster visual iteration | Defeats design system, creates drift from theme.css | Never — always use CSS variable token |
| Apply `backdrop-blur` to all card components at once | Consistent glass look across all pages | GPU overload on mobile, 6+ composited layers | Never — budget blur per viewport |
| Import a scroll animation library (AOS, GSAP, Lenis) to main chunk | Quick scroll effects | Bundle regression, breaks current optimization | Only if lazy-loaded at page level |
| Keep both `Navigation.tsx` (horizontal) and `Sidebar.tsx` active during migration | Easier rollback | Double rendering, CSS class conflicts, layout instability | Only as 2-day max transitional state |
| Use `layout` animations on chart containers | Smooth resize transitions | Triggers full chart re-render + layout recalculation | Never on data-heavy charts |
| Skip `prefers-reduced-motion` check on new animations | Less code | WCAG 2.1 AA violation — Playwright axe-core tests will fail | Never |
| Replace `CHART_COLORS` hex constants with CSS var strings | Cleaner code | Silent SVG rendering failure | Never — SVG cannot resolve CSS variables |

---

## Integration Gotchas

Common mistakes when working with the existing library integrations during redesign.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Recharts 3.x `TooltipProps` | Using old `TooltipProps` type for custom tooltip content | Use `TooltipContentProps` (renamed in Recharts 3.0 migration) |
| Recharts `CartesianGrid` | Mismatching `xAxisId`/`yAxisId` props after redesign | Verify IDs match corresponding axis components after any chart refactor |
| visx `ParentSize` | Wrapping in a container that changes width during sidebar transition | Parent container must have explicit `width` or `overflow: hidden` |
| Framer Motion `AnimatePresence` with React Router v7 | Wrapping `<Outlet>` directly | Use `useOutlet(context)` as the direct child with a keyed `motion.div` |
| shadcn/ui Sidebar + existing `useUIStore` | Creating duplicate sidebar state (SidebarProvider cookie + Zustand `sidebarOpen`) | Use one source of truth — either extend `useUIStore` or use `SidebarProvider` exclusively |
| Tailwind v4 `@theme inline` + new tokens | Defining new tokens inside `@layer base` | All `:root` variables must be at file top-level, not inside any `@layer` |
| `@dnd-kit/react@0.3.0` (pre-1.0) | API changes breaking `RoutineBuilder` drag-drop during unrelated refactor | Do not touch `DragDropProvider`/`useSortable` during the visual overhaul |

---

## Performance Traps

Patterns that work fine in development but degrade on real mobile hardware.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Multiple `backdrop-blur` in same viewport | Scroll jank, frame drops on mobile | Max 3 blurred elements per viewport; use `backdrop-blur-sm` on mobile | Any mid-range Android with 4+ blur contexts |
| Animating non-composited CSS properties (`height`, `top`, `color`) | Layout thrash, visible stutter | Only animate `transform` and `opacity`; use `Framer Motion`'s `layout` sparingly | Any device when > 3 layout animations fire simultaneously |
| `useMotionValue` in chart containers | Chart jank during scroll | Motion values belong in UI chrome (nav, cards), not data visualization wrappers | When chart contains > 200 data points |
| `will-change: transform` on many elements | Excessive GPU memory allocation, crashes on low-RAM devices | Apply `will-change` only during active animation, remove after | Devices with < 2GB RAM (common Android budget range) |
| Page transitions blocking data fetching | Users wait for both animation AND data | Use `mode="sync"` not `mode="wait"` for data-heavy pages, or pre-fetch on hover | Routes with Supabase queries behind the transition |
| Stagger animations on lists > 20 items | Long visual delay before content is usable | Cap stagger at 10 items max; beyond that, animate only the first batch | Community feeds, workout history lists |

---

## UX Pitfalls

Visual redesign decisions that hurt the user experience despite looking good.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Sidebar replaces `MobileBottomNav` on mobile | Breaks thumb-reach navigation pattern users already learned | Sidebar is desktop-only (`md:`); `MobileBottomNav` stays unchanged |
| Page transitions adding > 300ms perceived delay | Data-focused users feel the app got slower | Keep transitions under 200ms; use `opacity` only, no scale on page exits |
| Glassmorphism making text unreadable over busy chart backgrounds | Accessibility failure, WCAG contrast ratio drops below 4.5:1 | Test contrast ratio of text-over-blur with real chart data visible behind it |
| Stat counting animations (count-up numbers) that always replay on re-render | Disorienting when navigating back to Dashboard | Use `useInView` to trigger count-up only once on mount, not on every render |
| Ambient background gradients creating false visual noise on chart pages | Users misread gradient artifacts as data | Suppress ambient gradients on Analytics, Biomechanics, and Session Replay pages |
| Removing the sticky top bar without a replacement breadcrumb | Users lose context of which page they're on | The sidebar highlights the active route — verify this is visible in collapsed state |

---

## "Looks Done But Isn't" Checklist

Things that pass visual inspection but are broken in edge cases.

- [ ] **Sidebar collapsed state:** Verify active route indicator is visible in icon-only mode, not just expanded mode
- [ ] **Charts at 768px:** Run every chart page at exactly 768px viewport width — this is the sidebar/no-sidebar breakpoint where charts are widest/narrowest
- [ ] **Celebration animations over glassmorphism:** `CelebrationOverlay.tsx` uses `backdrop-blur` — verify it composites above sidebar without z-index conflict
- [ ] **Reduced-motion compliance:** Every new animation must check `prefers-reduced-motion` — Playwright axe-core will catch this in CI
- [ ] **Print styles preserved:** Session print reports use `@media print` CSS — verify glassmorphism and gradient backgrounds are suppressed in print mode (use `print:hidden` or `print:bg-white`)
- [ ] **Recharts tooltip z-index:** After sidebar migration, verify Recharts tooltips render above sidebar overlay (they use absolute positioning in a portal)
- [ ] **PWA install prompt timing:** The install prompt fires after 3 sessions — verify it doesn't visually conflict with the new sidebar layout on mobile
- [ ] **Biome formatting gate:** New motion component files must pass `biome check` — tabs, double quotes, 80-char width — or CI blocks merge

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| CSS variable namespace collision | LOW | Run DevTools → `:root` inspection, find conflicting variable, rename in `theme.css`, rebuild |
| Glassmorphism mobile jank | MEDIUM | Remove `backdrop-blur` from offending component, replace with `bg-surface-1` opaque background, re-test |
| Sidebar breaking chart widths | MEDIUM | Add `min-w-0` to chart containers, verify `ParentSize`/`ResponsiveContainer` parent has explicit width, re-test all 26 routes |
| AnimatePresence exit animations not firing | LOW | Replace `<Outlet>` with `useOutlet(context)`, add `key={location.pathname}` to motion wrapper |
| Bundle size regression | MEDIUM | Use `rollup-plugin-visualizer` to identify culprit, move import to lazy-loaded chunk, verify tree-shaking |
| Chart SVG styling broken after ChartTheme.ts edit | LOW | Revert `ChartTheme.ts` to hex constants, rebuild — SVG cannot use CSS vars in presentation attributes |
| `@theme inline` token not generating utilities | LOW | Move `:root` variable definition out of `@layer base` to top-level, run `npm run build` to verify |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| CSS variable namespace collision | Phase 1 (CSS foundation) | `npm run build` compiles, DevTools `:root` shows all expected variables, no utility classes render incorrect colors |
| Glassmorphism mobile jank | Phase 2 (Visual depth) | Chrome Performance tab on mobile emulation shows no dropped frames during scroll; max 3 blur contexts per viewport |
| Sidebar breaking chart widths | Phase 3 (Navigation) | Every chart page renders correctly at 768px, 1024px, 1440px; no "width: 0" console errors |
| AnimatePresence exit animations | Phase 4 (Motion design) | Manual navigation through all 26 routes confirms exit + enter animations fire; `mode="wait"` prevents overlap |
| Chart styling regression (visx/SVG) | Phase 5 (Data visualization) | Visual smoke test of ForceCurve, PowerOutput, AsymmetryGauge after any theme change |
| Bundle size regression | Every phase | `npm run build` main chunk stays under 100KB; visualizer shows no new vendor in main chunk |
| `@dnd-kit/react` breakage from unrelated refactor | All phases | `RoutineBuilder` drag-drop tested after every merge to main |
| Reduced-motion compliance | Phase 4 (Motion design) | Playwright axe-core test suite passes with `prefers-reduced-motion: reduce` media query active |
| Print styles broken by glassmorphism | Phase 2 (Visual depth) | `window.print()` in browser shows clean output without blur/gradient artifacts |

---

## Sources

- [Tailwind CSS v4 generated CSS variable clashes — tailwindlabs/tailwindcss#15754](https://github.com/tailwindlabs/tailwindcss/issues/15754)
- [Tailwind v4 CSS variables ignored in CSS Modules — tailwindlabs/tailwindcss#16904](https://github.com/tailwindlabs/tailwindcss/issues/16904)
- [shadcn/ui official Tailwind v4 migration guide — ui.shadcn.com/docs/tailwind-v4](https://ui.shadcn.com/docs/tailwind-v4)
- [Recharts 3.0 migration guide (TooltipContentProps, z-index rendering order, CartesianGrid IDs)](https://github.com/recharts/recharts/wiki/3.0-migration-guide)
- [AnimatePresence with React Router Outlet — useOutlet pattern](https://medium.com/@antonio.falcescu/animating-react-pages-with-react-router-dom-outlet-and-framer-motion-animatepresence-bd5438b3433b)
- [Framer Motion layout animation pitfalls (mid-animation snap, pointer event blocking)](https://reactlibraries.com/blog/framer-motion-vs-motion-one-mobile-animation-performance-in-2025)
- [backdrop-filter GPU performance — limit to 2-3 elements, 8-15px blur range](https://playground.halfaccessible.com/blog/glassmorphism-design-trend-implementation-guide)
- [Josh W. Comeau — backdrop-filter browser support and performance considerations](https://www.joshwcomeau.com/css/backdrop-filter/)
- [Playwright visual regression testing for large React codebases](https://css-tricks.com/automated-visual-regression-testing-with-playwright/)
- [Framer Motion performance tips — will-change and mobile optimization](https://tillitsdone.com/blogs/framer-motion-performance-tips/)
- [visx performance — react-spring animated components bypass VDOM, can cause rapid update issues](https://github.com/airbnb/visx/issues/819)
- [shadcn/ui Sidebar — SidebarProvider cookie state management](https://ui.shadcn.com/docs/components/radix/sidebar)
- [Tailwind v4 design token mapping complexity — tailwindlabs/tailwindcss Discussion #18843](https://github.com/tailwindlabs/tailwindcss/discussions/18843)

---
*Pitfalls research for: Phoenix Portal v1.2 Premium Visual Overhaul*
*Researched: 2026-02-20*
