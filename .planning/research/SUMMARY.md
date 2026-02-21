# Project Research Summary

**Project:** Phoenix Portal v1.2 — Premium Visual Overhaul
**Domain:** Premium fitness analytics dashboard (React SPA, dark theme, existing working app)
**Researched:** 2026-02-20
**Confidence:** HIGH (codebase-specific analysis + official docs; no speculative architecture)

## Executive Summary

Phoenix Portal v1.2 is a visual quality milestone on top of an already-shipping product. The research is unusually well-grounded: the codebase is known (42K LOC, React 19, Tailwind v4, shadcn/ui, Framer Motion, Recharts, visx), the stack is fixed, and the goal is purely perceptual — shift the dashboard from "developer-built" to "premium product" without adding feature surface area. Research consensus from Whoop, Linear, Strava, and Vercel patterns is clear: the highest-leverage changes are structural (collapsible sidebar, shared page shell, CSS token hygiene) and depth-generating (ambient gradient, card surface hierarchy, hairline borders). Only one new dependency is needed: `@number-flow/react` for animated stat counters. Everything else is achievable with Framer Motion patterns and CSS already in the bundle.

The recommended approach follows a strict dependency order: CSS foundation first (tokens, ambient gradient, surface hierarchy), then navigation restructure (sidebar replaces horizontal nav), then motion design (stagger, spring hover, page transitions), then chart styling, then a final polish pass. This sequence matters because the ambient gradient backdrop is a prerequisite for glassmorphism to be visible, the sidebar is a prerequisite for the page shell, and the page shell is a prerequisite for chart sizing. Deviating from this order causes rework. The parallel mobile component variants (DashboardMobile, AnalyticsMobile, CommunityMobile, ChallengesMobile) should be deleted in favor of CSS-responsive single components — maintaining two files per feature is a maintainability trap and the flash-on-first-render from `useIsMobile()` is a real UX problem.

The main risk is scope creep in the wrong direction: glassmorphism applied everywhere (GPU overload on mobile), bundle growth from ad-hoc library additions, and AnimatePresence breaking with React Router v7's `<Outlet>` if implemented naively. All three are well-documented and avoidable. The CSS variable namespace between Tailwind v4 and shadcn/ui is an active community issue (GitHub #15754) and requires discipline about where tokens are defined in `theme.css`. The visx/SVG dual-token pattern (hex constants in ChartTheme.ts, CSS vars for HTML) must not be "cleaned up" — SVG cannot resolve CSS variables in presentation attributes.

---

## Key Findings

### Recommended Stack

The existing stack needs no changes beyond one new package and one shadcn/ui component. The visual overhaul is achievable inside the current bundle budget (95.69KB / 34.46KB gzip), ending at an estimated 41–45KB gzip — well within the 500KB ceiling established in v1.0 planning.

**Core technologies (additions only):**
- `@number-flow/react` v0.5.12: animated digit-slot stat counters — free, dependency-free, CSS custom property integration, Feb 2026 Safari fix included; preferred over react-countup (linear-only) and Motion's AnimateNumber (paid)
- shadcn/ui `Sidebar` (via CLI, ~3KB project-local): collapsible sidebar with `icon` mode (desktop) and `offcanvas` mode (mobile); already installed at `ui/sidebar.tsx` with full CSS tokens in `theme.css`
- Framer Motion (`motion` package, already bundled): `whileInView`, `AnimatePresence`, spring `whileHover`, stagger variants — use for ALL animation; do not add GSAP, react-spring, or CSS scroll-driven animations as primary approach
- CSS techniques (zero cost): glassmorphism via `backdrop-blur-[12px]` + `bg-black/60`, ambient radial gradients, SVG feTurbulence noise (prefer PNG tile for performance), custom `@keyframes` in `@theme` block

**What NOT to add:** GSAP (60KB gzip), react-spring (45KB, duplicates Framer Motion), Lottie, three.js, tailwindcss-animated plugin (v4-incompatible), react-countup, Motion's AnimateNumber (paid).

See `.planning/research/STACK.md` for full code patterns and bundle impact table.

### Expected Features

This is not a feature milestone — it is a visual quality milestone. Features are framed as visual UI patterns.

**Must have (table stakes — missing these makes the app look unfinished):**
- Collapsible sidebar nav replacing 13-item horizontal nav — every premium analytics app uses this
- Inter Variable declared on body — eliminates system-ui fallback that signals unfinished product
- Consistent `<PageShell>` component — eliminates max-width/padding duplication across 30+ locations
- Card surface hierarchy (3 elevation levels) — visual depth so dashboards are scannable
- Subtle 1px hairline card borders (`border-white/8`) — lifts cards from background
- Skeleton loading states replacing spinners — Whoop/Strava/Linear all use skeleton screens
- Custom Recharts tooltips + styled axes/gridlines — default tooltips look like dev tools

**Should have (competitive differentiators — signal premium intent):**
- Ambient background gradient orbs (Ember + Gold radial gradients, fixed, non-interactive) — prerequisite for glassmorphism; highest-impact single CSS change
- Glassmorphism on 2-3 priority cards per page only — reserved for highest-value metrics
- Spring-physics hover states on stat cards (Framer Motion `whileHover`, stiffness 400)
- Staggered card reveal on page load (50ms max per card, 400ms total window)
- Animated number counters on dashboard stats (via `@number-flow/react`)
- Page transition animations via `AnimatePresence` (150-200ms fade + 8px Y)
- Brand-tinted box shadows on priority cards (Ember at 12% opacity)
- Gradient fills in area charts (SVG linearGradient, 40% → 0%)
- Variable font weight hierarchy (450 body, 625 subheadings, via `font-variation-settings`)
- Uppercase label letter-spacing (`tracking-widest text-xs uppercase text-white/50`)

**Defer (not essential for this milestone):**
- Micro-animation on vote/reaction buttons — HIGH complexity, LOW ROI
- Neumorphism — avoid entirely on dark backgrounds (WCAG contrast failure)
- Particle/canvas background animations — battery drain, distraction
- Custom scrollbar styling as a dependency (progressive enhancement only)

See `.planning/research/FEATURES.md` for dependency graph, anti-feature list, and competitor comparison table.

### Architecture Approach

The migration is a layout restructure, not a data architecture change. The current `AppLayout` wraps a sticky horizontal `Navigation` above an `<Outlet>` where each page independently manages its own `min-h-screen`, `pb-20`, `max-w-7xl`, and `px-4 sm:px-6 lg:px-8`. The target wraps everything in `SidebarProvider` with an `AppSidebar` alongside a `main.flex-1` content area, and introduces a `PageShell` that centralizes all layout concerns. This is the standard pattern used by Linear, Vercel, and Stripe dashboards.

**Major components to create/modify:**
1. `src/app/components/shell/AppSidebar.tsx` — New sidebar nav using shadcn `Sidebar*` primitives; integrates with React Router `NavLink` via `asChild`
2. `src/app/components/shell/PageShell.tsx` — Shared page container; owns max-width, padding, page header; accepts `flush` prop for full-bleed pages (Session Replay)
3. `src/lib/animations.ts` — Shared Framer Motion variant presets (`fadeUp`, `staggerContainer`, `staggerItem`, `pageTransition`, `springHover`); eliminates inline animation values across 40+ components
4. `src/app/routes/AppLayout.tsx` (modify) — Add `SidebarProvider` + `AppSidebar`; wrap `Outlet` in `AnimatePresence mode="wait"`
5. `src/app/components/ui/card.tsx` (extend) — Add `StatCard` and `SectionCard` semantic variants above base `Card` primitive
6. Delete: `DashboardMobile.tsx`, `AnalyticsMobile.tsx`, `CommunityMobile.tsx`, `ChallengesMobile.tsx` — absorbed into CSS-responsive single components via `md:` utilities and container queries

**Key patterns:**
- CSS-first responsive (Tailwind `md:` + `@container`), not JS `useIsMobile()` component swapping
- `SidebarProvider` must live inside `AppLayout` (inside `ProtectedRoute`), never at router root
- `useIsMobile()` kept only for chart pixel dimension sizing (canvas), not layout switching
- `useOutlet(context)` instead of `<Outlet>` when wrapping with `AnimatePresence`
- `ChartTheme.ts` hex constants are permanent — SVG cannot resolve CSS variables in presentation attributes

See `.planning/research/ARCHITECTURE.md` for full component boundary table, data flow diagram, and 7-step migration path.

### Critical Pitfalls

1. **CSS variable namespace collision (Tailwind v4 + shadcn/ui)** — Active GitHub issue #15754. All `:root` variable definitions must be at file top-level in `theme.css`, NEVER inside `@layer base`. After every token addition, verify in DevTools that the variable appears in `:root` and that its Tailwind utility renders correctly. The `@theme inline` block references variables; it does not define them.

2. **Glassmorphism GPU overload on mobile** — `backdrop-blur` already exists on 19 files. Adding it to cards creates 6-10 composited layers per viewport, causing scroll jank on mid-range Android. Hard rule: max 3 `backdrop-blur` elements visible simultaneously per viewport. Use `md:backdrop-blur-lg` (desktop only), `backdrop-blur-sm` (mobile). Never animate the blur radius itself.

3. **Sidebar migration breaking chart widths** — Every chart component (`ResponsiveContainer`, visx `ParentSize`) inherits parent width. Adding a sidebar gutter changes all chart container widths simultaneously. Audit all chart pages before migration. Do NOT touch charts in the same PR as the sidebar restructure. Test every chart page at exactly 768px (the breakpoint boundary) after migration.

4. **AnimatePresence + React Router v7 `<Outlet>` integration** — `<Outlet>` renders through a context provider; `AnimatePresence` sees the provider as its child, so exit animations never fire. Use `useOutlet(context)` as the direct child with `key={location.pathname}` on the `motion.div` wrapper. Set `mode="wait"` to prevent page overlap.

5. **visx/SVG dual-token pattern breakage** — `ChartTheme.ts` uses hex constants because SVG presentation attributes cannot resolve CSS variables at runtime. Do not "clean up" these constants to use `var(--primary)`. If chart colors change, update both `ChartTheme.ts` and `theme.css` manually. Run visual smoke tests on `ForceCurve`, `PowerOutput`, and `AsymmetryGauge` after any theme change.

6. **Bundle size regression** — The main chunk is currently 95.69KB (34.46KB gzip). A single lazily-imported animation library added to the main chunk undoes months of optimization. Run `npm run build` after every new library addition. Main chunk must stay under 100KB. Use `rollup-plugin-visualizer` (already in project) as a pre-merge gate.

---

## Implications for Roadmap

Suggested phase structure based on dependency graph from FEATURES.md + migration path from ARCHITECTURE.md:

### Phase 1: CSS Foundation and Design Token Expansion
**Rationale:** All visual depth systems depend on correct token setup. The ambient gradient backdrop is a prerequisite for glassmorphism. Incorrect token placement causes silent failures (Pitfall 1). Zero risk — no existing components change.
**Delivers:** Inter Variable on body, ambient radial gradient orbs, CSS surface hierarchy tokens (`surface-1`, `surface-2`, `surface-overlay`), noise texture utility, new `@keyframes` in `theme.css`, verified DevTools token output
**Addresses:** Table stakes — Inter font, ambient gradient (highest-impact single change), 1px hairline borders across all cards
**Avoids:** CSS variable namespace collision (Pitfall 1) — validate before any component work

### Phase 2: Layout Shell and Navigation Migration
**Rationale:** PageShell must exist before pages can adopt it. AppSidebar must exist before AppLayout can use it. The sidebar is a prerequisite for chart responsive sizing. This is the highest structural risk — affects all 26 routes.
**Delivers:** `AppSidebar.tsx`, `PageShell.tsx`, `AppLayout.tsx` rewired with `SidebarProvider`, horizontal `Navigation.tsx` deleted, all 26 routes smoke-tested, mobile layout verified (sidebar hidden, `MobileBottomNav` unchanged)
**Uses:** shadcn/ui `Sidebar` (already installed), `theme.css` sidebar CSS tokens (already exist)
**Avoids:** Sidebar breaking chart widths (Pitfall 3) — do not touch charts in this phase; SidebarProvider scope (Pitfall 3 gotcha) — confirm it wraps only authenticated routes

### Phase 3: Page Migration and Mobile Consolidation
**Rationale:** Once PageShell and AppSidebar are proven, all 13+ pages can independently adopt them. Mobile component variants become deletable once CSS-responsive counterparts are validated.
**Delivers:** All pages wrapped in `PageShell`, all pages use `StatCard`/`SectionCard` variants, `DashboardMobile.tsx` + 3 other mobile variants deleted, `useIsMobile()` removed from layout switching (kept only for chart sizing), consistent empty states
**Addresses:** Table stakes — skeleton loading states, consistent page shell, card surface hierarchy applied across all pages
**Avoids:** useIsMobile flash (Anti-Pattern 2 from ARCHITECTURE.md) — CSS-first responsive replaces all JS component swapping

### Phase 4: Motion Design System
**Rationale:** Animation presets must be defined before they can be applied. Page transitions are added last — after all component-level animations are stable — because `AnimatePresence` conflicts with `<Outlet>` and is the most complex integration.
**Delivers:** `src/lib/animations.ts` with `fadeUp`, `staggerContainer`, `staggerItem`, `pageTransition`, `springHover` presets, spring hover on all stat cards, stagger on card grids, page transition `AnimatePresence` on all routes, `prefers-reduced-motion` compliance on every new animation
**Uses:** Framer Motion `motion` package (already bundled, zero cost)
**Avoids:** AnimatePresence + Outlet conflict (Pitfall 4) — use `useOutlet(context)`, verify exit animations fire on all 26 routes; stagger cap at 50ms max, 400ms total window

### Phase 5: Data Visualization Styling
**Rationale:** Chart styling is isolated from layout changes and can proceed after the sidebar is stable (chart container widths are locked). Must come after Phase 2 so chart containers have settled widths.
**Delivers:** Custom Recharts tooltips with Phoenix brand styling, rgba gridlines + no axis borders, SVG gradient fills in area charts, chart entrance animation (`isAnimationActive`, 800ms ease-out), ambient gradients suppressed on Analytics/Biomechanics/Session Replay pages (where they create false visual noise)
**Addresses:** Table stakes — custom chart tooltips + styled axes
**Avoids:** visx/SVG dual-token breakage (Pitfall 5) — maintain hex constants in `ChartTheme.ts`, run visual smoke tests on ForceCurve, PowerOutput, AsymmetryGauge after every change

### Phase 6: Polish and Differentiating Details
**Rationale:** Differentiating touches (animated counters, glassmorphism on select cards, gradient shadows) come last. They depend on the full visual system being in place. Glassmorphism on cards is only visible after the ambient gradient backdrop (Phase 1) and correct surface hierarchy (Phase 3) are established.
**Delivers:** `@number-flow/react` animated stat counters on Dashboard, glassmorphism on top 2-3 priority cards per page (Recovery score, streak, active challenge), variable font weight refinement, uppercase label letter-spacing pass, brand-tinted box shadows on priority cards
**Uses:** `@number-flow/react` v0.5.12 (the one new package required)
**Avoids:** Glassmorphism GPU overload (Pitfall 2) — enforce "blur budget": max 3 `backdrop-blur` elements per viewport; test on mid-range Android emulation; print styles preserved with `print:hidden` on gradient/blur elements

### Phase Ordering Rationale

- **Phase 1 before everything:** Ambient gradient is a visual prerequisite for glassmorphism; CSS tokens must be correct before any component touches them
- **Phase 2 (sidebar) before Phase 3 (pages):** PageShell requires stable sidebar state for content width; charts require stable container dimensions
- **Phase 3 (pages) before Phase 4 (motion):** Animation presets applied to pages require pages to be in their final structure; adding motion before PageShell adoption means animating components that will be restructured
- **Phase 5 (charts) after Phase 2:** Chart widths must be stable before chart styling is applied; chart and sidebar PRs must never overlap
- **Phase 6 (polish) last:** Glassmorphism requires ambient gradient (Phase 1) + surface hierarchy (Phase 3) to be visible; `@number-flow` install verified for bundle impact before merge

### Research Flags

Phases needing deeper research or careful validation during planning:
- **Phase 2:** `SidebarProvider` + `useUIStore` (Zustand) state deduplication — confirm whether to extend `useUIStore` or use `SidebarProvider` cookie exclusively; do not run two sources of truth for sidebar open/collapsed state
- **Phase 4:** `AnimatePresence mode="wait"` + `Suspense` interaction in React 19 concurrent mode — Framer Motion v11 claims improved compatibility but this warrants a prototype before applying to all 26 routes; validate `useOutlet(context)` pattern specifically with React Router v7's outlet API
- **Phase 5:** Recharts 3.0 `TooltipContentProps` rename — confirm API before writing custom tooltips (old `TooltipProps` from 2.x will type-error)

Phases with standard, well-documented patterns (skip additional research):
- **Phase 1:** CSS glassmorphism + radial gradients are native CSS with HIGH confidence sources (MDN, Tailwind official docs)
- **Phase 3:** PageShell pattern is standard in every mature React dashboard; the migration path is mechanical
- **Phase 6:** `@number-flow/react` usage is a drop-in replacement; bundle impact already calculated (6.8KB gzip)

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | One new package (`@number-flow/react`) confirmed at npm; all other decisions use already-installed libraries. Bundle calculations are precise. CSS techniques verified via MDN + Tailwind v4 official docs. |
| Features | MEDIUM | Visual pattern research from multiple secondary sources (Whoop, Linear, Strava) — no direct API access to their codebases. Competitor analysis is observational. Animation timing values are community consensus, not official spec. |
| Architecture | HIGH | Based on actual codebase analysis (725-line `ui/sidebar.tsx` confirmed installed; `theme.css` sidebar tokens confirmed; `Navigation.tsx` structure confirmed). Migration path validated against official shadcn/ui Sidebar docs. |
| Pitfalls | HIGH | CSS variable issue from active GitHub issues (tailwindlabs #15754, #16904). AnimatePresence + Outlet pattern confirmed across multiple sources. visx SVG limitation is a documented SVG spec constraint, not library-specific. |

**Overall confidence:** HIGH

### Gaps to Address

- **Sidebar state deduplication:** The project uses `useUIStore` (Zustand) and the shadcn `SidebarProvider` uses a cookie. Before Phase 2 implementation, decide which is the single source of truth and document the decision. Running both causes desync bugs.
- **`AnimatePresence` + React 19 concurrent mode:** Framer Motion's changelog says improved React 19 compatibility but a working prototype of page transitions should be validated in isolation before being applied to all 26 routes.
- **Ambient gradient suppression rules:** Phase 5 suppresses ambient gradients on data-heavy pages (Analytics, Biomechanics, Session Replay) to avoid false visual noise on charts. A precise list of which pages get gradients vs. which get suppressed should be written before Phase 5 starts.
- **`prefers-reduced-motion` coverage:** Every new animation (Phase 4 + 6) must be audited against this constraint. Playwright axe-core will catch violations in CI, but it is cheaper to design for it upfront than to remediate.

---

## Sources

### Primary (HIGH confidence)
- Tailwind CSS v4 official docs — `backdrop-blur`, container queries, `@theme` token syntax
- shadcn/ui official docs — `Sidebar` component, collapse modes, `useSidebar()` hook, Tailwind v4 migration guide
- Framer Motion (motion.dev) official docs — `AnimatePresence`, `whileInView`, spring configs, variants, `useOutlet` integration
- MDN Web Docs — `backdrop-filter`, CSS scroll-driven animations, browser support tables
- `src/app/components/ui/sidebar.tsx` (actual codebase) — 725 lines, confirmed installed
- `src/styles/theme.css` (actual codebase) — sidebar tokens, surface tokens confirmed
- npm / GitHub — `@number-flow/react` v0.5.12 release notes, Feb 2026 Safari fix confirmed
- GitHub tailwindlabs/tailwindcss #15754, #16904 — CSS variable namespace collision, active issues

### Secondary (MEDIUM confidence)
- [Linear UI Redesign Part II](https://linear.app/now/how-we-redesigned-the-linear-ui) — color/typography/elevation patterns
- [Whoop App Navigation Redesign](https://www.whoop.com/us/en/thelocker/app-update-navigation-bar/) — sidebar pattern on fitness app
- [Glassmorphism Implementation Guide](https://playground.halfaccessible.com/blog/glassmorphism-design-trend-implementation-guide) — backdrop-blur performance limits
- [Muzli Dashboard Design Examples 2026](https://muz.li/blog/best-dashboard-design-examples-inspirations-for-2026/) — dark theme patterns
- [AnimatePresence with Outlet — Medium](https://medium.com/@antonio.falcescu/animating-react-pages-with-react-router-dom-outlet-and-framer-motion-animatepresence-bd5438b3433b) — `useOutlet` pattern, corroborated by Motion docs
- Recharts 3.0 migration guide — `TooltipContentProps` rename, CartesianGrid ID matching

### Tertiary (MEDIUM-LOW confidence)
- LogRocket bundle size benchmarks (GSAP, react-spring) — single source, directionally correct
- fffuel.co noise generator — PNG tile alternative to SVG feTurbulence
- CSS Tricks Grainy Gradients — `feTurbulence` technique, performance notes

---

*Research completed: 2026-02-20*
*Ready for roadmap: yes*
