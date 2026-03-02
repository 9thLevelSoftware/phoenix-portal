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


---

# === v1.3 Research (from main) ===

# Pitfalls Research

**Domain:** Launch-readiness hardening for premium fitness analytics SaaS (security, legal, CI/CD, accessibility)
**Researched:** 2026-02-27 (v1.2 launch readiness) / 2026-02-16 (v1.1) / 2026-02-15 (v1.0)
**Confidence:** HIGH (CSO/COO findings verified against codebase), MEDIUM (CI/CD and a11y from community post-mortems)

---

# v1.2 Pitfalls: Launch-Readiness Hardening of Existing Production System

> **Scope:** These pitfalls are specific to ADDING security hardening, legal compliance, CI/CD pipelines, and accessibility improvements to an existing 41,920 LOC / 266-file React 19 + Supabase system. The app already works. The risks are: security fixes that break existing functionality, compliance additions that lock out users, CI/CD that rejects valid builds, and accessibility changes that regress visual design.

---

## Critical Pitfalls

### Pitfall 1: CSP Headers Block Sentry, Stripe, and Supabase -- App Breaks Silently

**What goes wrong:**
Adding a `Content-Security-Policy` header without accounting for all third-party domains causes silent failures. Stripe.js stops loading (checkout breaks), Sentry stops reporting errors (you lose visibility), and Supabase realtime websockets are blocked (live data stops updating). The app appears to work on initial load but critical paths fail. Users cannot subscribe, errors go unreported, and realtime sync dies -- all silently, because CSP violations only appear in the browser console.

**Why it happens:**
Developers start with a restrictive CSP (`default-src 'self'`) and whitelist domains as they discover breakage. But SPAs have dozens of runtime dependencies that load dynamically. Phoenix Portal specifically requires:
- **Stripe:** `js.stripe.com`, `api.stripe.com`, `q.stripe.com`, `r.stripe.com`, `errors.stripe.com`, `checkout.stripe.com` (connect-src, script-src, frame-src)
- **Sentry:** `*.ingest.sentry.io`, `*.sentry.io` (connect-src)
- **Supabase:** `*.supabase.co` (connect-src for REST + websocket for realtime)
- **Google OAuth:** `accounts.google.com` (connect-src, frame-src)
- **Apple OAuth:** `appleid.apple.com` (connect-src, frame-src)
- **Google Fonts:** `fonts.googleapis.com`, `fonts.gstatic.com` (style-src, font-src)

Missing any one of these causes that specific integration to fail while the rest of the app works fine -- making it extremely hard to catch in basic smoke testing.

Additionally, SPAs cannot use nonce-based CSPs because there is no server generating a unique nonce per request. The Vite-built `index.html` is a static file. Hash-based CSP or `'unsafe-inline'` for styles (required by Tailwind CSS and inline style injection) is the only option.

**How to avoid:**
1. **Start with `Content-Security-Policy-Report-Only` header first.** This reports violations without blocking anything. Deploy to staging, exercise every feature path, and collect the full list of required domains before switching to enforcement mode.
2. **Build the CSP incrementally from a known-good baseline:**
```
default-src 'self';
script-src 'self' https://js.stripe.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://q.stripe.com https://r.stripe.com https://errors.stripe.com https://*.ingest.sentry.io;
frame-src https://js.stripe.com https://checkout.stripe.com https://accounts.google.com https://appleid.apple.com;
img-src 'self' data: blob:;
worker-src 'self' blob:;
```
3. **Set up CSP violation reporting to Sentry** using `report-uri` directive so violations are captured as events.
4. **Test every integration path:** Stripe checkout, Stripe portal, Sentry error capture, Supabase realtime, Google/Apple OAuth, PWA service worker, all chart rendering.
5. **Never use `'unsafe-eval'`** -- it defeats the purpose of CSP entirely. If a library requires it, that library has a security problem.

**Warning signs:**
- Stripe checkout redirects fail with no error message
- Sentry dashboard shows zero events after CSP deployment
- Community realtime feed stops updating
- Browser console shows `Refused to connect to '...' because it violates Content Security Policy`
- PWA service worker fails to register (`worker-src` missing `blob:`)

**Phase to address:** Security Hardening phase -- CSP must be deployed in report-only mode first, then enforced only after comprehensive integration testing passes.

---

### Pitfall 2: OAuth Token Column Restriction Locks Out Existing Connected Users

**What goes wrong:**
The CSO identified that `user_integrations.access_token` and `refresh_token` columns are readable from the browser via the RLS SELECT policy. The fix is to restrict SELECT to exclude token columns. But if the fix is deployed without considering Edge Functions that read tokens server-side, or if the migration drops the columns from the SELECT policy while the client code still expects them, existing connected users see "disconnected" status and must re-authenticate all their integrations.

Worse: if token encryption is added simultaneously, existing plaintext tokens become unreadable. The Edge Functions that refresh expired tokens (Strava, Fitbit) fail silently because they decrypt garbage. Users' integrations show "error" status with no way to recover except disconnecting and reconnecting.

**Why it happens:**
The security fix is conceptually simple: "don't expose tokens to the browser." But the implementation has three moving parts that must be coordinated:
1. RLS policy change (database migration)
2. Client-side code that may reference token columns (remove expectations)
3. Server-side Edge Functions that legitimately need token access (must use service role key, which already bypasses RLS -- but verify)

Deploying these out of order or missing the Edge Function verification creates a window where integrations break.

**How to avoid:**
1. **Audit before changing:** Verify that Edge Functions use `SUPABASE_SERVICE_ROLE_KEY` (which bypasses RLS) for all token reads. Current code in `strava-oauth/index.ts` already does this -- confirm for all 12 Edge Functions.
2. **Client-side audit:** Search the frontend codebase for any reference to `access_token` or `refresh_token` on `user_integrations`. The client should never need these -- it only needs `status`, `provider`, `connected_at`, `last_sync_at`.
3. **Create a restricted SELECT policy:**
```sql
-- Replace existing SELECT policy with column-restricted view
CREATE OR REPLACE VIEW user_integrations_safe AS
SELECT id, user_id, provider, provider_user_id, connected_at,
       last_sync_at, status, error_message
FROM user_integrations;
```
Or use a policy that does not restrict columns (RLS policies cannot restrict columns -- they restrict rows) and instead create a database view that excludes sensitive columns, then point the client at the view.
4. **Do NOT encrypt existing tokens without a migration plan.** If encryption is added, it must: (a) encrypt all existing plaintext tokens in a migration, (b) update all Edge Functions to decrypt before use, (c) be tested with real OAuth refresh flows.
5. **Deploy and test integrations immediately after:** Trigger a manual sync for each provider and verify tokens are still usable server-side.

**Warning signs:**
- After deploying the RLS change, the Integrations page shows all providers as "disconnected"
- Edge Functions log "null" for access_token when attempting sync
- Users report "Strava sync failed" after a deployment that didn't touch integration code
- Sentry shows errors from `strava-sync`, `fitbit-sync` Edge Functions with null token errors

**Phase to address:** Security Hardening phase (P0 item) -- must be the first security fix deployed, tested with real OAuth tokens, and verified end-to-end before proceeding to other security fixes.

---

### Pitfall 3: CORS Restriction on Edge Functions Breaks Stripe Checkout and OAuth Flows

**What goes wrong:**
The current `cors.ts` shared module returns `Access-Control-Allow-Origin: *`. The CSO correctly flagged this as a security issue. Replacing `*` with a specific domain (e.g., `https://portal.phoenix-app.com`) fixes the security concern but breaks:
1. **Local development** (`http://localhost:5173`) -- CORS blocks all Edge Function calls
2. **Preview/staging deployments** (e.g., Vercel preview URLs) -- different domain per PR
3. **Stripe checkout redirect** -- the success/cancel URL uses `req.headers.get('origin')`, which may not match the restricted CORS domain
4. **OAuth callback redirects** -- Strava/Fitbit/Garmin OAuth callbacks redirect to the Edge Function URL, not the portal URL

Additionally, Supabase has a known issue (December 2025) where Edge Functions truncate custom headers in `Access-Control-Allow-Headers` during OPTIONS preflight responses, returning only the first four standard headers. This can silently break requests that include `x-client-info` or custom headers.

**Why it happens:**
`*` works for everything but is insecure. A single hardcoded domain breaks everything else. The solution requires an allowlist, but Edge Functions have no built-in domain allowlist feature -- you must implement it in code.

**How to avoid:**
1. **Implement an environment-based CORS allowlist:**
```typescript
// supabase/functions/_shared/cors.ts
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173')
  .split(',')
  .map(o => o.trim());

export function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Vary': 'Origin',
  };
}
```
2. **Set `ALLOWED_ORIGINS` env var** in Supabase project settings: `https://portal.phoenix-app.com,http://localhost:5173,https://*.vercel.app`
3. **The `Vary: Origin` header is critical** -- without it, CDN/proxy caching returns the wrong CORS header to different origins.
4. **Update all 12 Edge Functions** to use `getCorsHeaders(req)` instead of the static `corsHeaders` import.
5. **Fix the open redirect in Stripe checkout:** Replace `req.headers.get('origin')` with the `APP_URL` environment variable for success/cancel URLs. The `origin` header can be spoofed.
6. **Test with both `localhost:5173` and the production domain** before deploying.

**Warning signs:**
- After CORS restriction, `npm run dev` shows CORS errors on every Edge Function call
- Stripe checkout creates a session but redirect fails
- OAuth flows work in production but break on staging/preview
- Browser shows `Access-Control-Allow-Origin` mismatch errors
- Garmin webhook (server-to-server) still works but browser-initiated syncs break

**Phase to address:** Security Hardening phase (P0 item) -- CORS fix must be deployed with the environment variable approach from day one. Never hardcode a single domain.

---

### Pitfall 4: GDPR Account Deletion Cascades Incorrectly -- Destroys Community Content or Leaves Orphans

**What goes wrong:**
Implementing "Right to Erasure" (GDPR Article 17) requires deleting a user's personal data. The naive approach is `DELETE FROM auth.users WHERE id = $1`, which cascades through every table with `ON DELETE CASCADE`. In Phoenix Portal, this destroys:
- **Community shared routines** that other users have saved to their library
- **Community votes** that affect other routines' rankings
- **Community comments** on other users' routines
- **Workout sessions** that feed into the community's aggregate statistics

The cascade either (a) deletes too much data affecting other users, or (b) fails entirely due to a `RESTRICT` constraint somewhere in the chain.

Additionally, Supabase's `auth.users` table is managed by Supabase Auth. You cannot simply `DELETE FROM auth.users` -- you must use the Supabase Admin API. And if any foreign key in the chain uses `RESTRICT` instead of `CASCADE`, the entire deletion fails and no records are removed.

**Why it happens:**
The schema was designed for data integrity, not for user deletion. `ON DELETE CASCADE` is applied uniformly, but "cascade everything" is wrong for social data. Deleting a user should anonymize their community contributions, not vaporize them.

**How to avoid:**
1. **Classify data into three categories before building the deletion flow:**
   - **Personal data (must delete):** profiles, user_integrations, sync_queue, rate_limit_tracking, subscription records
   - **User-generated content (anonymize):** shared_routines, community_comments, community_votes -- set `user_id` to a "deleted-user" sentinel or NULL, replace display_name with "[Deleted User]"
   - **Behavioral data (anonymize or delete):** workout_sessions, exercise_sets, rep_telemetry -- if anonymization is sufficient for GDPR compliance, NULL the user_id; if not, hard delete

2. **Create a dedicated deletion Edge Function:**
```typescript
// Order matters -- must handle in dependency order
// 1. Anonymize community content
await supabase.from('shared_routines').update({ user_id: DELETED_USER_ID }).eq('user_id', userId);
await supabase.from('community_comments').update({ user_id: DELETED_USER_ID, content: '[deleted]' }).eq('user_id', userId);
// 2. Delete private data
await supabase.from('user_integrations').delete().eq('user_id', userId);
await supabase.from('workout_sessions').delete().eq('user_id', userId);
// 3. Delete Stripe customer (via Stripe API)
await stripe.customers.del(stripeCustomerId);
// 4. Delete auth user last (via Supabase Admin API)
await supabase.auth.admin.deleteUser(userId);
```

3. **Add a "deletion_requested_at" column to profiles** to implement a 30-day grace period (GDPR allows up to 30 days). Show a "Your account is scheduled for deletion" banner. This protects against accidental deletion.

4. **Test the entire deletion flow** on a staging environment with a user who has: subscriptions, integrations, shared routines saved by other users, comments, votes, and workout history. Verify nothing breaks for OTHER users after deletion.

5. **Never rely on CASCADE alone for GDPR deletion.** Explicit, ordered deletion is the only safe approach.

**Warning signs:**
- After deleting a test user, other users' saved routines disappear
- Community page shows broken cards with missing user data
- `DELETE FROM auth.users` fails with a foreign key constraint error
- Comments show as "null" instead of "[Deleted User]"
- Stripe continues billing a deleted user

**Phase to address:** Legal/Compliance phase (P1 item) -- must be designed and tested before any public launch. Requires a dedicated Edge Function with comprehensive integration testing.

---

### Pitfall 5: CI/CD Pipeline Fails on Existing Tests and Build Configuration

**What goes wrong:**
Setting up GitHub Actions for the first time on an existing project reveals environment-specific failures that never surfaced locally. Phoenix Portal's specific risks:
1. **17 authenticated E2E tests skip without env vars** -- CI has no `SUPABASE_TEST_EMAIL`/`SUPABASE_TEST_PASSWORD`, so 17 tests silently skip. The pipeline reports "all tests pass" when most tests were not run.
2. **Playwright browser installation adds 200-400MB download** per CI run. Without caching, this exceeds typical CI timeouts and adds ~2 minutes per run. APT repository instability in GitHub Actions runners causes intermittent installation failures.
3. **`vite build` with `sourcemap: true`** generates source maps that the Sentry plugin tries to upload, but `SENTRY_AUTH_TOKEN` is not in CI secrets -- build fails or succeeds with a warning that is swallowed.
4. **The `--legacy-peer-deps` flag** may be needed for `npm install` but is not in any lockfile or CI config. Fresh `npm ci` fails with `ERESOLVE` due to visx peer dep mismatch.
5. **`forbidOnly: !!process.env.CI`** is already configured in Playwright config, but `process.env.CI` may not be set in all GitHub Actions contexts (it IS set by default, but custom runners may not).
6. **Windows line endings (CRLF)** in committed files may cause Biome to report errors in CI (Linux runner) that do not appear locally (Windows).

**Why it happens:**
Local development has accumulated environment-specific configuration: env vars, installed browsers, cached dependencies, OS-specific line endings. CI is a clean room that exposes every implicit assumption. The project has never had CI -- every assumption is untested.

**How to avoid:**
1. **Start with the simplest possible pipeline** -- build + unit tests only. Add E2E after the basic pipeline is green.
```yaml
# .github/workflows/ci.yml -- Phase 1: Build gate only
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npm test
```
2. **Add Playwright as a separate job with browser caching:**
```yaml
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
        env:
          CI: true
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```
3. **Make skipped tests visible:** Add a CI check that counts skipped tests and fails if more than N tests are skipped unexpectedly. Alternatively, create a separate job for auth-required tests that only runs on `main` with secrets available.
4. **Fix the visx peer dep** before CI setup: add `overrides` to `package.json` or switch to `npm ci --legacy-peer-deps` in CI (document the reason).
5. **Ensure Biome runs in CI** with `npx biome check .` as a gate. Fix CRLF issues before merging (configure git `autocrlf` or add `.gitattributes`).
6. **Conditionally upload source maps:** Only run the Sentry upload when `SENTRY_AUTH_TOKEN` is available:
```ts
...(process.env.SENTRY_AUTH_TOKEN ? [sentryVitePlugin({...})] : []),
```
This is already implemented in `vite.config.ts` -- verify it works correctly in CI.

**Warning signs:**
- CI shows "18 tests passed, 17 skipped" and reports success
- `npm ci` fails with `ERESOLVE` on first CI run
- Playwright tests timeout at the "installing browsers" step
- Build succeeds locally but fails in CI due to missing env vars
- Biome reports line ending errors that do not appear on Windows

**Phase to address:** CI/CD phase (P1 item) -- start with build+lint+unit tests; add E2E in a follow-up PR after the basic pipeline is stable.

---

### Pitfall 6: OAuth State Parameter Forgery Allows Account Linking Hijack

**What goes wrong:**
The current Strava OAuth flow uses raw `user_id` as the OAuth `state` parameter (line 28 of `strava-oauth/index.ts`: `const userId = state`). An attacker who knows a victim's user ID can craft an OAuth callback URL that links the attacker's Strava account to the victim's Phoenix account. The attacker then controls what fitness data appears in the victim's dashboard and can trigger syncs that overwrite legitimate data.

This is the CSO's #2 critical finding and affects Strava, Fitbit, and Garmin OAuth flows.

**Why it happens:**
OAuth `state` is commonly misunderstood. It exists as a CSRF protection mechanism -- the client generates a random token, sends it with the auth request, and verifies it matches on callback. Using a predictable value (user_id, which is a UUID visible in the JWT) defeats this protection entirely.

**How to avoid:**
1. **Generate a cryptographic random state token** on the client before initiating OAuth:
```typescript
// Client-side: before redirecting to OAuth provider
const state = crypto.randomUUID();
sessionStorage.setItem('oauth_state', state);
// Include state in OAuth redirect URL
window.location.href = `https://www.strava.com/oauth/authorize?state=${state}&...`;
```
2. **Store the state-to-user mapping server-side** in a short-lived table or cache:
```sql
CREATE TABLE oauth_state_tokens (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  provider TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '10 minutes'
);
```
3. **Verify state in the callback Edge Function:**
```typescript
// In strava-oauth/index.ts
const { data: stateRecord } = await supabase
  .from('oauth_state_tokens')
  .select('user_id')
  .eq('token', state)
  .gt('expires_at', new Date().toISOString())
  .single();

if (!stateRecord) {
  return Response.redirect(`${APP_URL()}/integrations?error=invalid_state`, 302);
}
const userId = stateRecord.user_id;
// Delete used token
await supabase.from('oauth_state_tokens').delete().eq('token', state);
```
4. **Apply the same pattern to all 3 OAuth providers** (Strava, Fitbit, Garmin).
5. **Deploy the state token table migration BEFORE updating the OAuth Edge Functions.** The table must exist when the new Edge Function code first executes.

**Warning signs:**
- OAuth callback URL contains a UUID that matches the user's ID in JWT claims
- No server-side state validation in OAuth callback handlers
- An attacker can link their fitness account to any known user ID
- State parameter is passed through the URL without any HMAC or encryption

**Phase to address:** Security Hardening phase (P0 item) -- this is the #2 most dangerous vulnerability identified by the CSO. Must be fixed before any public launch.

---

### Pitfall 7: Source Map Removal Breaks Sentry Error Debugging

**What goes wrong:**
The CSO identified that source maps are deployed to production CDN (`sourcemap: true` in `vite.config.ts`). The fix is to stop deploying source maps publicly. But if source maps are removed without uploading them to Sentry first, all future error reports show minified stack traces (`r.tsx:1:4562`) instead of readable ones (`SessionReplay.tsx:142:handlePlayback`). The app becomes harder to debug in production, exactly when you most need debugging.

**Why it happens:**
`sourcemap: true` in Vite outputs `.map` files alongside `.js` files. The Sentry Vite plugin uploads these to Sentry. But if the build runs without `SENTRY_AUTH_TOKEN` (which it does in local dev and may in CI), the plugin is skipped and source maps are only available via the public CDN. Removing public source maps without ensuring Sentry upload works means NO source maps anywhere.

**How to avoid:**
1. **Change Vite config to generate hidden source maps:**
```typescript
build: {
  sourcemap: 'hidden',  // Generates .map files but does NOT reference them in .js files
}
```
This generates `.map` files for Sentry upload but browsers cannot discover them from the deployed `.js` files.
2. **Ensure `SENTRY_AUTH_TOKEN` is set in CI** and in the production build environment. The Sentry plugin is already conditionally loaded -- verify it runs during the production build.
3. **Add a CI step to verify Sentry upload succeeded:**
```yaml
- name: Verify Sentry source maps
  run: npx sentry-cli sourcemaps list --org $SENTRY_ORG --project $SENTRY_PROJECT
```
4. **Test error reporting in staging** after the change -- trigger an intentional error and verify Sentry shows readable stack traces.

**Warning signs:**
- After deployment, Sentry error reports show minified file names and line numbers
- `SENTRY_AUTH_TOKEN` is not set in the production build pipeline
- Build output still contains `.js.map` files referenced via `//# sourceMappingURL=`
- Browser DevTools Sources tab shows the full original source code

**Phase to address:** Security Hardening phase (P1 item) -- change to `sourcemap: 'hidden'` and verify Sentry upload in CI before removing public source maps.

---

### Pitfall 8: Accessibility Fixes Regress Phoenix Visual Design

**What goes wrong:**
Adding `prefers-reduced-motion` support to 81 files with 815 motion/animation occurrences risks two failure modes:
1. **Over-suppression:** Setting `<MotionConfig reducedMotion="user">` at the root disables ALL transform and layout animations when the OS preference is set. This removes page transitions, celebration animations, chart entrance effects, and the signature ember-rise/flame-flicker effects that define the Phoenix brand. The app looks broken and lifeless.
2. **Under-suppression:** Selectively targeting individual components misses some, creating an inconsistent experience where some elements animate and others do not.

Additionally, adding skip-to-content links, chart aria-labels, and focus indicators can clash with the dark theme design:
- Default focus rings (blue) clash with the dark background
- Skip-to-content links that are not properly hidden create layout shifts
- Adding `aria-label` to SVG charts without also adding `role="img"` creates screen reader confusion

**Why it happens:**
Accessibility and visual design are often treated as separate concerns. The Phoenix design system uses animation as a core brand element (ember particles, flame flicker, phoenix glow). Blanket motion suppression removes the brand identity. Surgical suppression requires touching 81 files individually.

**How to avoid:**
1. **Use Motion's `reducedMotion` prop strategically, not globally:**
```tsx
// Root level: suppress layout/transform animations
<MotionConfig reducedMotion="user">
  {/* All children respect user preference */}
</MotionConfig>
```
This preserves `opacity` and `backgroundColor` animations (which are non-vestibular-triggering) while disabling transforms and layout animations. This is the correct default for WCAG 2.1 AA compliance.

2. **Categorize animations by necessity:**
   - **Remove under reduced-motion:** Page transitions, parallax, ember particles, flame flicker, bounce effects
   - **Keep under reduced-motion (as instant transitions):** Opacity fades, color changes, progress bar fills
   - **Always keep:** Loading spinners (reduced to opacity pulse), skeleton loaders

3. **Custom focus styles that match the Phoenix theme:**
```css
:focus-visible {
  outline: 2px solid var(--phoenix-ember);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
```
Never use the browser default blue focus ring on a dark theme.

4. **Skip-to-content link pattern:**
```tsx
<a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:bg-phoenix-ember focus:text-white focus:px-4 focus:py-2 focus:rounded">
  Skip to content
</a>
```

5. **Chart accessibility requires both `role` and `aria-label`:**
```tsx
<svg role="img" aria-label="Weekly volume trend showing 15% increase over last 4 weeks">
  {/* chart content */}
</svg>
```
Without `role="img"`, screen readers may try to parse individual SVG elements.

6. **Run axe-core after EVERY a11y change** -- the existing `e2e/a11y.spec.ts` is the regression gate. Ensure it covers new skip-to-content and focus ring changes.

**Warning signs:**
- After adding `MotionConfig reducedMotion="user"`, the app looks static and lifeless with OS reduced-motion enabled
- Celebration animations (PR, streak, badge, challenge-won) break because they rely entirely on transform animations
- Blue focus rings appear on dark backgrounds after adding `:focus-visible` styles
- Skip-to-content link is visible on page load instead of only when focused
- axe-core reports new violations after accessibility changes

**Phase to address:** Accessibility phase (P2 item) -- use `MotionConfig reducedMotion="user"` at root, test with OS reduced-motion ON and OFF, verify celebration animations degrade gracefully.

---

### Pitfall 9: Desktop Navigation Restructure Breaks Deep Links and Bookmarks

**What goes wrong:**
The CXO flagged 13 flat navigation items as a Hick's Law violation. Restructuring into 4-5 grouped categories requires changing the information architecture. If route paths change (e.g., `/biomechanics` moves to `/analytics/biomechanics`), every existing deep link and browser bookmark breaks. Users who shared links to specific pages on Discord or other channels get 404s. The PWA manifest `start_url` may also break if the Dashboard route changes.

More subtly: if the navigation restructure changes which items appear in the mobile `MobileBottomNav`, users who built muscle memory for the bottom nav positions find themselves tapping the wrong item.

**Why it happens:**
Navigation restructure is a UX improvement that feels purely visual but has URL-level implications. Developers change the nav grouping but also refactor routes to match the new hierarchy, not realizing that URLs are part of the public API.

**How to avoid:**
1. **Never change route paths during a navigation restructure.** The nav grouping is a UI concern; the URL structure is a separate concern. Group items visually without changing `/biomechanics` to `/analytics/biomechanics`.
2. **If route paths MUST change, add redirect routes:**
```tsx
<Route path="/biomechanics" element={<Navigate to="/analytics/biomechanics" replace />} />
```
Keep redirects for at least 6 months. Never remove a route that was publicly accessible.
3. **Preserve the PWA `start_url`** (`/` in current manifest). If changing, the PWA may prompt users to re-install.
4. **Document the current 26 routes** in a test fixture (they already exist in `e2e/a11y.spec.ts`) and verify all resolve after the restructure.
5. **Mobile bottom nav should only change if user research supports it.** Do not reorder bottom nav items in a "cleanup" -- this breaks muscle memory.

**Warning signs:**
- After deployment, Discord/forum links to specific pages show 404
- PWA installed on user's device opens to a broken route
- Mobile users tap the wrong bottom nav item
- Google Search Console shows a spike in 404 errors
- Bookmarked pages redirect unexpectedly

**Phase to address:** UX/Navigation phase (P2 item) -- change nav grouping UI only; do not change route paths unless absolutely necessary, and always add redirects.

---

### Pitfall 10: Content Moderation False Positives on Legitimate Fitness Content

**What goes wrong:**
Adding automated content moderation to community features (shared routines, comments) flags legitimate fitness content. Workout names like "Chest Destroyer", "Leg Killer", "Suicide Grip Bench Press" (an actual grip technique), and "Skull Crushers" contain words that trigger basic keyword-based moderation. Overly aggressive moderation silences the most engaged community members -- exactly the people who create content that drives retention.

Platform data from 2025 shows that 10-20% of content moderation actions are false positives. In a niche fitness community of ~200 active users, even 5% false positive rate means the most active contributors get flagged weekly.

**Why it happens:**
Basic moderation (keyword blocklists, regex patterns) does not understand domain context. Fitness has its own vocabulary that overlaps with violent or inappropriate language in other contexts. Machine learning-based moderation trained on general-purpose data has the same problem -- it does not understand that "Skull Crusher" is a tricep exercise.

**How to avoid:**
1. **Start with human moderation only.** For a community of 50-200 users, manual report + flag is sufficient and has zero false positives. Build the report/flag/block UI without any automated filtering.
2. **If automated moderation is added later, use an allowlist approach:**
   - Maintain a fitness vocabulary allowlist (exercise names, grip types, training methodologies)
   - Only flag content that triggers keyword filters AND is not on the allowlist
3. **Never auto-remove content.** Flag for review only. Auto-removal at this scale destroys community trust faster than any spam.
4. **Community Notes model over algorithmic moderation:** Let users flag content; show flags to moderators (initially the developer); act on flags manually.
5. **Rate limiting is better than content filtering** for preventing spam. The existing 5-comment-per-minute rate limit (from v1.1 RLS) prevents the most common abuse pattern without touching legitimate content.

**Warning signs:**
- Active community members report their routines being hidden or flagged
- Legitimate exercise names trigger moderation alerts
- Community engagement drops after moderation is deployed
- Users stop creating content because "it keeps getting removed"

**Phase to address:** Community/Moderation phase (P2 item) -- implement report/flag/block UI for manual moderation only. Defer automated moderation until the community is large enough to warrant it (100+ daily posts).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `Access-Control-Allow-Origin: *` on all Edge Functions | Everything works everywhere | Any website can make authenticated requests to your API | Never in production with auth endpoints |
| Skip CSP and add it later | No integration testing needed | Every third-party integration added later must be CSP-audited retroactively | Never -- start with report-only mode from day one |
| Use `unsafe-inline` in CSP script-src | Avoids script hash management | Defeats XSS protection entirely | Never for script-src; acceptable for style-src with Tailwind |
| Hardcode CORS to production domain only | Simple, secure | Breaks dev/staging/preview | Never -- use environment-based allowlist |
| Skip Stripe webhook integration tests | Faster CI pipeline | Revenue-critical path is untested; billing bugs surface in production | Never |
| Privacy Policy copied from a template | Launches faster | Legally actionable if it contradicts actual data practices | Never -- must reflect reality |
| Auto-delete community content on user deletion | Simpler implementation | Other users lose saved routines and context | Never -- anonymize, do not delete |
| Deploy source maps to production | Easier debugging in browser | Full source code exposed; aids reverse engineering | Acceptable in private beta only |
| Keyword-based content moderation | Quick to implement | High false positive rate in fitness domain | Never as auto-removal; acceptable as flagging input to human review |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Stripe + CSP | Missing `q.stripe.com` and `r.stripe.com` in connect-src | Include all 6 Stripe domains: `js.stripe.com`, `api.stripe.com`, `q.stripe.com`, `r.stripe.com`, `errors.stripe.com`, `checkout.stripe.com` |
| Sentry + CSP | Missing `*.ingest.sentry.io` in connect-src | Add `*.ingest.sentry.io` to connect-src; also add `report-uri` directive pointing to Sentry's CSP endpoint |
| Supabase + CSP | Forgetting websocket protocol for realtime | Include both `https://*.supabase.co` and `wss://*.supabase.co` in connect-src |
| Supabase + GDPR deletion | Using CASCADE on auth.users and expecting it to work | Supabase Auth requires admin API (`supabase.auth.admin.deleteUser`); cascade only works on tables referencing `auth.users(id)` |
| Stripe + CORS | Using `req.headers.get('origin')` for checkout redirect | Use `APP_URL` environment variable; the origin header can be spoofed and may not match the allowed CORS origin |
| GitHub Actions + Playwright | Installing browsers on every run | Cache the Playwright browser binaries or use Playwright's official Docker image |
| GitHub Actions + Sentry | Build fails when `SENTRY_AUTH_TOKEN` is not set | The Vite config already conditionally loads the Sentry plugin -- verify this works in CI and add the token as a GitHub secret |
| OAuth + state parameter | Using user_id or other predictable value as state | Generate cryptographic random token, store server-side with expiry, verify on callback |
| Garmin webhook + authentication | Accepting any POST without signature verification | Verify request signature using Garmin's Consumer Secret; reject unsigned requests |
| PWA + CSP | Forgetting `worker-src blob:` directive | Service workers and web workers need `worker-src 'self' blob:` in CSP |
| Tailwind CSS + CSP | Trying to avoid `unsafe-inline` for styles | Tailwind injects styles via `<style>` tags; `style-src 'unsafe-inline'` is required. This is a known Tailwind limitation |
| Biome + GitHub Actions | CRLF line endings in committed files | Add `.gitattributes` with `* text=auto eol=lf` to normalize line endings; run `git add --renormalize .` once |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| RLS 3-table join on `rep_telemetry` queries | Session detail page loads slowly as data grows | Denormalize `user_id` onto `sets` and `rep_summaries` tables; CA identified this specifically | After 1000+ workout sessions per user |
| CSP report-uri flooding Sentry | Sentry event quota exhausted by CSP violation reports | Use `report-to` header with rate limiting; filter CSP reports in Sentry with inbound filters | After deploying CSP to production with any misconfigured domain |
| E2E tests downloading Playwright browsers on every CI run | CI pipeline takes 5+ minutes | Cache browser binaries with `actions/cache` keyed on Playwright version | Every CI run without caching |
| Dual subscription tables (`subscriptions` + `user_subscriptions`) | Queries must check both tables; inconsistent tier status | Unify into single table or explicitly deprecate one; CA flagged this | When tier gating queries check the wrong table |
| GDPR deletion without index on `user_id` across all tables | Account deletion takes 30+ seconds, times out Edge Function | Ensure `user_id` indexes exist on every table that needs deletion/anonymization | First deletion of a power user with extensive history |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| OAuth tokens readable via browser RLS SELECT | Attacker with valid JWT can read other users' Strava/Fitbit tokens (if RLS has a policy bug) | Create a `user_integrations_safe` view excluding token columns; point client at view, not table |
| OAuth state is raw user_id | Account linking forgery -- attacker links their fitness account to victim's profile | Use cryptographic random state with server-side verification and 10-minute expiry |
| CORS `*` on payment Edge Functions | Any website can initiate Stripe checkout on behalf of authenticated users | Environment-based CORS allowlist with `Vary: Origin` header |
| Stripe SDK loaded from esm.sh CDN in Edge Functions | Supply chain risk -- esm.sh compromise = payment handler compromise | Pin to specific version URL with integrity hash, or bundle Stripe SDK locally |
| `req.headers.get('origin')` for Stripe redirect URLs | Open redirect -- attacker crafts request with malicious origin, user redirected to phishing site after checkout | Use `APP_URL` environment variable for all redirect URLs |
| Garmin webhook accepts unsigned POSTs | Attacker can inject fake workout data into any user's account if they know the Garmin provider_user_id | Verify webhook signature using Garmin Consumer Secret; reject unsigned requests |
| Hevy sync accepts arbitrary user_id without auth | Any caller can trigger sync for any user by providing their user_id | Add JWT authentication to the Hevy sync endpoint; extract user_id from the authenticated session |
| Sentry captures PII in health/biometric data | Biometric data (heart rate, body weight, force measurements) appears in error reports | Configure Sentry `beforeSend` to scrub sensitive fields; add PII scrubbing rules for known biometric field names |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Privacy Policy page contradicts actual data practices | Users lose trust immediately; legally actionable | Rewrite from scratch describing actual Supabase data storage, third-party integrations, and Stripe billing data |
| Pricing inconsistency ($9.99 landing vs $14.99 pricing page) | Users feel deceived; trust-killer for paid conversion | Single source of truth for pricing; ensure landing page, pricing page, and Stripe price IDs all match |
| Free tier promises limits that code does not enforce | Free users get premium features; paying users feel cheated | Audit every tier-gated feature against both UI gating and RLS-level enforcement |
| No Terms of Service with Stripe billing | Cannot legally charge users without ToS; Stripe compliance risk | Create ToS covering subscription terms, auto-renewal, cancellation, refund policy |
| Accessibility changes remove signature animations | App loses brand identity; "it just looks broken now" | Use `MotionConfig reducedMotion="user"` to respect preference while keeping opacity animations |
| Skip-to-content link visible on page load | Layout shift on every page; looks like a bug | Use `sr-only focus:not-sr-only` pattern; only visible when focused via keyboard |
| Navigation restructure changes mobile bottom nav order | Users tap wrong item; muscle memory broken | Only change bottom nav if user research supports it; keep the 5 most-used items stable |

---

## "Looks Done But Isn't" Checklist

- [ ] **CSP Headers:** `Content-Security-Policy` header is present -- verify it works with Stripe checkout flow end-to-end (create session, redirect, complete, webhook), Sentry error capture (throw intentional error, verify it appears in dashboard), and Supabase realtime (post a community vote, verify realtime update fires)
- [ ] **CORS Restriction:** Edge Functions return specific origin -- verify local dev (`localhost:5173`), staging preview URL, and production domain all work; verify `Vary: Origin` header is present
- [ ] **OAuth State Fix:** State parameter is random -- verify by inspecting the OAuth redirect URL; confirm server-side state table has rows during OAuth flow; confirm used tokens are deleted after callback
- [ ] **Source Maps Removed:** Production bundle has no `.map` references -- verify by checking Network tab for `.js.map` requests (should 404); verify Sentry shows readable stack traces for a test error
- [ ] **GDPR Deletion:** Account deletion works -- verify by deleting a test user who has shared routines saved by other users; confirm other users' saved copies are not deleted; confirm Stripe customer is deleted; confirm auth.users row is removed
- [ ] **CI/CD Pipeline:** Tests pass in CI -- verify by checking how many tests ACTUALLY RAN vs. were skipped; CI should report distinct counts for passed/failed/skipped
- [ ] **Privacy Policy:** Policy matches reality -- verify it mentions Supabase cloud storage, Stripe billing data, OAuth integrations with named providers, and cookies/session storage; verify it does NOT say "we do not collect personal information"
- [ ] **Accessibility - Reduced Motion:** `prefers-reduced-motion` is respected -- verify by enabling reduced motion in OS settings and confirming: page transitions are instant, ember particles do not render, celebration animations show static congratulation, charts still animate opacity
- [ ] **Accessibility - Keyboard Nav:** Tab through all nav items -- verify focus ring is visible (ember color, not blue), skip-to-content link works, all interactive elements are reachable
- [ ] **Content Moderation:** Report/flag UI works -- verify a flagged routine appears in moderation queue; verify flagging does NOT auto-remove content; verify a user can block another user
- [ ] **Stripe Webhooks Tested:** Webhook integration tests exist -- verify checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.paid, and invoice.payment_failed are all covered

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| CSP blocks Stripe/Sentry/Supabase | LOW | Switch to `Content-Security-Policy-Report-Only` immediately; collect violations; fix policy; switch back to enforcement |
| OAuth token restriction locks out users | MEDIUM | Revert the RLS migration; users retain existing connections; re-plan the migration with view-based approach |
| CORS restriction breaks Edge Functions | LOW | Revert `cors.ts` to `*` temporarily; fix the allowlist logic; redeploy |
| GDPR deletion destroys community content | HIGH | Restore from Supabase point-in-time recovery; redesign deletion to anonymize instead of cascade; notify affected users |
| CI/CD fails on existing tests | LOW | Remove failing tests from CI gate temporarily; fix tests; re-enable. Never leave tests out of CI permanently |
| OAuth state forgery exploited | HIGH | Invalidate all existing integration tokens; force all users to re-authenticate integrations; deploy state token fix; notify affected users |
| Source maps removed without Sentry upload | LOW | Re-enable `sourcemap: true` temporarily; fix Sentry upload in CI; switch to `sourcemap: 'hidden'` |
| Accessibility changes regress visual design | MEDIUM | Revert specific a11y commits; apply changes incrementally with visual review per component; use axe-core as regression gate |
| Navigation restructure breaks deep links | MEDIUM | Add `<Navigate>` redirect routes for all changed paths; keep redirects for 6+ months; fix bookmarks in documentation |
| Content moderation false positives | LOW | Disable automated moderation; switch to manual report/flag only; restore any auto-removed content from audit log |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| CSP blocks third-party services | Security Hardening (P0/P1) | CSP deployed in report-only mode for 1 week; zero violations in Sentry after enforcement; Stripe checkout, Sentry capture, and Supabase realtime all tested |
| OAuth token exposure | Security Hardening (P0) | `user_integrations_safe` view created; client code uses view; Edge Functions verified with service role key |
| OAuth state forgery | Security Hardening (P0) | `oauth_state_tokens` table exists; all 3 OAuth flows use cryptographic state; state tokens expire after 10 minutes |
| CORS wildcard on Edge Functions | Security Hardening (P0) | `cors.ts` uses environment-based allowlist; tested with localhost, staging, and production domains |
| Source maps in production | Security Hardening (P1) | `sourcemap: 'hidden'` in vite.config.ts; Sentry shows readable stack traces; browser DevTools does not show original source |
| GDPR deletion cascades incorrectly | Legal/Compliance (P1) | Deletion Edge Function exists; test user with community content deleted; other users' saved routines unaffected |
| CI/CD fails on existing code | CI/CD (P1) | Pipeline green on `main`; Playwright runs with browser caching; skipped test count is logged and visible |
| Privacy Policy contradicts reality | Legal/Compliance (P0) | Policy reviewed by someone who has read actual Supabase data flow; no "we do not collect" language |
| Reduced-motion accessibility regression | Accessibility (P2) | App tested with OS reduced-motion ON; ember particles hidden; charts still render; celebrations show static state |
| Navigation restructure breaks deep links | UX/Navigation (P2) | All 26 routes tested after restructure; redirect routes added for any changed paths; PWA start_url unchanged |
| Content moderation false positives | Community/Moderation (P2) | Report/flag UI deployed; no auto-removal; fitness vocabulary allowlist exists if keyword filtering added |
| Garmin webhook accepts unsigned POSTs | Security Hardening (P1) | Webhook verifies signature; unsigned requests return 401 |
| Hevy sync accepts arbitrary user_id | Security Hardening (P1) | Hevy sync requires JWT auth; user_id extracted from session, not request body |
| Stripe redirect open redirect | Security Hardening (P0) | `success_url` and `cancel_url` use APP_URL env var, not `req.headers.get('origin')` |
| Pricing inconsistency | UX (P0) | Landing page, pricing page, and Stripe price IDs all show identical prices |

---

## Sources

- [Supabase CORS for Edge Functions -- Official Docs](https://supabase.com/docs/guides/functions/cors)
- [Supabase Edge Functions CORS Fix Guide 2025](https://nikofischer.com/supabase-edge-functions-cors-error-fix)
- [Supabase Edge Functions Truncate Headers -- Issue #41334](https://github.com/supabase/supabase/issues/41334)
- [Supabase Cascade Deletes -- Official Docs](https://supabase.com/docs/guides/database/postgres/cascade-deletes)
- [Supabase User Management -- Official Docs](https://supabase.com/docs/guides/auth/managing-user-data)
- [React Content Security Policy Guide -- StackHawk](https://www.stackhawk.com/blog/react-content-security-policy-guide-what-it-is-and-how-to-enable-it/)
- [CSP in Single Page Applications -- Auth0](https://auth0.com/blog/deploying-csp-in-spa/)
- [Stripe CSP Requirements -- CSPLite](https://csplite.com/csp/svc155/)
- [Stripe CSP r.stripe.com Issue -- connect-js #205](https://github.com/stripe/connect-js/issues/205)
- [Stripe Integration Security Guide](https://docs.stripe.com/security/guide)
- [Sentry CSP Configuration -- Help Center](https://sentry.zendesk.com/hc/en-us/articles/26503024867867-How-to-Configure-CSP-for-Sentry)
- [Sentry CSP Reporting -- Official Docs](https://docs.sentry.io/platforms/javascript/guides/solid/security-policy-reporting/)
- [Motion Accessibility Guide -- motion.dev](https://motion.dev/docs/react-accessibility)
- [useReducedMotion Hook -- motion.dev](https://www.framer.com/motion/use-reduced-motion/)
- [Accessible Animations in React -- Josh W. Comeau](https://www.joshwcomeau.com/react/prefers-reduced-motion/)
- [prefers-reduced-motion No-Motion-First -- Tatiana Mac](https://www.tatianamac.com/posts/prefers-reduced-motion)
- [OAuth 2.0 Security Best Practices -- RFC 9700](https://datatracker.ietf.org/doc/rfc9700/)
- [OAuth Token Storage Best Practices -- FusionAuth](https://fusionauth.io/articles/oauth/oauth-token-storage)
- [Playwright CI Setup -- Official Docs](https://playwright.dev/docs/ci-intro)
- [Playwright GitHub Actions Timeout Issues -- Issue #13940](https://github.com/microsoft/playwright/issues/13940)
- [Playwright Browser Installation Failures -- Issue #23388](https://github.com/microsoft/playwright/issues/23388)
- [Content Moderation False Positives -- BigIdeasDB](https://bigideasdb.com/problems/content-moderation-tools-problems)
- [Meta Moderation Policy Changes 2025](https://about.fb.com/news/2025/01/meta-more-speech-fewer-mistakes/)
- [Vite CSP Guard -- SPA Guide](https://vite-csp.tsotne.co.uk/guides/spa)
- [React Router v7 Strict CSP Without unsafe-inline](https://www.technetexperts.com/react-router-v7-strict-csp-guide/)
- Phoenix Portal codebase analysis: `supabase/functions/`, `vite.config.ts`, `src/app/routes/index.tsx`, `e2e/a11y.spec.ts`, migration files

---

# v1.1 Pitfalls (2026-02-16) -- Archived

> The v1.1 pitfalls (React 19 migration, design system, Biome formatting, PWA service worker, etc.) have been resolved. They are preserved below for historical reference but are no longer active concerns.

<details>
<summary>Click to expand v1.1 pitfalls (resolved)</summary>

### Pitfall 1: `.dark` CSS Block Overwrites Phoenix Color Palette
**Status:** RESOLVED in v1.1 -- `.dark` block deleted, dual-token pattern implemented.

### Pitfall 2: React 19 Upgrade Breaks dnd-kit
**Status:** RESOLVED in v1.1 -- migrated to `@dnd-kit/react@0.3.0` new API.

### Pitfall 3: Recharts and visx Do Not Officially Support React 19
**Status:** RESOLVED in v1.1 -- Recharts 3.x upgraded, visx works with `--legacy-peer-deps`.

### Pitfall 4: Recovery/Readiness Dashboard Gives Medically Dangerous Advice
**Status:** RESOLVED in v1.1 -- 14-day gate, 25-75% clamp, descriptive language only, ACWR with conservative thresholds.

### Pitfall 5: Biome Formats All Files and Corrupts Git History
**Status:** RESOLVED in v1.1 -- Biome 2.4 configured with isolated formatting commit.

### Pitfall 6: CSS Color Tokenization Breaks SVG Chart Colors
**Status:** RESOLVED in v1.1 -- dual-token pattern (CSS vars for Tailwind, hex constants for SVG/motion).

### Pitfall 7: PWA Service Worker Caches Stale App Shell
**Status:** RESOLVED in v1.1 -- `updateViaCache: 'none'`, `registerType: 'autoUpdate'`, `skipWaiting: true`.

### Pitfall 8: Community Comments Without RLS
**Status:** RESOLVED in v1.1 -- RLS shipped with table creation in migration file.

### Pitfall 9: React 19 Strict Mode Double-Invokes Effects
**Status:** RESOLVED in v1.1 -- all Supabase subscriptions audited for cleanup functions.

### Pitfall 10: shadcn/ui Re-Init Overwrites Components
**Status:** RESOLVED in v1.1 -- components updated individually.

</details>

---

# v1.0 Pitfalls (2026-02-15) -- Archived

> The v1.0 pitfalls covered initial Supabase integration, third-party APIs, and foundational stability. Most are resolved; some remain relevant as ongoing concerns.

<details>
<summary>Click to expand v1.0 pitfalls</summary>

### V1-1: Client-Side Subscription Gating Without Server Enforcement
**Status:** PARTIALLY RESOLVED -- RLS gating exists but board flagged gaps between pricing page promises and actual enforcement. Needs audit in v1.2.

### V1-2: RLS Misconfiguration on Shared Supabase Project
**Status:** RESOLVED -- comprehensive RLS across all tables.

### V1-3: Data Model Mismatch Between Web and Mobile
**Status:** RESOLVED -- Zod transform layer at data boundary.

### V1-4: Recharts SVG Rendering Collapse With Biomechanics Data
**Status:** RESOLVED -- visx for high-frequency data, Recharts for aggregates, LTTB downsampling.

### V1-5: Building on Existing Bugs Without Stabilization First
**Status:** RESOLVED -- v1.0 stabilization phase completed.

### V1-6: Fitness API Rate Limit Exhaustion
**Status:** RESOLVED -- sync queue with rate limit budget tracking.

</details>

---
*Pitfalls research for: Phoenix Portal v1.2 -- Launch-readiness hardening (security, legal, CI/CD, accessibility)*
*Researched: 2026-02-27*
