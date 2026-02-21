# Stack Research

**Domain:** Premium fitness analytics dashboard — visual overhaul (v1.2 milestone)
**Researched:** 2026-02-20
**Confidence:** MEDIUM-HIGH (CSS techniques HIGH from MDN/official docs; library versions MEDIUM from npm/GitHub; design patterns MEDIUM from multiple web sources)

---

## Context: What Already Exists (Do NOT Re-Research)

The app already ships on a validated, optimized stack:
- React 19, Vite 7, TypeScript strict, Biome 2.4
- Tailwind CSS v4 with @tailwindcss/vite
- shadcn/ui (50+ components including Sidebar, Collapsible)
- Recharts 3 (trend charts), visx (force curves)
- Framer Motion (`motion` package) for celebrations and page transitions
- Supabase, Stripe, Sentry v10, TanStack Query, Zustand, React Router v7
- **Production bundle: 95.69KB main entry chunk (34.46KB gzip). This is the hard constraint.**

This research answers ONLY: what to add or do differently for the v1.2 visual overhaul.

---

## Recommended Stack Additions

### New Library: Animated Number Counters

| Library | Version | Bundle (gzip) | Purpose | Why Recommended |
|---------|---------|---------------|---------|-----------------|
| `@number-flow/react` | 0.5.12 | ~6–7KB | Animated stat counters (streak, reps, PRs, scores) | Dependency-free, MIT license, uses CSS custom properties so it respects the Phoenix design tokens; Safari alignment fix shipped Feb 2026; no premium paywall unlike Motion's AnimateNumber |

**Install:**
```bash
npm install @number-flow/react
```

**Usage pattern for dark theme:**
```tsx
import NumberFlow from '@number-flow/react'

// Drop-in replacement for static numbers in stat cards
<NumberFlow value={streak} format={{ style: 'decimal' }} />
```

**Styling:** Uses `::part(suffix)` and CSS custom properties (`--number-flow-char-height`). Works with the existing Tailwind v4 CSS variable token system without friction.

**Why not Motion's AnimateNumber:** Requires Motion+ paid membership (one-time, but adds procurement friction). `@number-flow/react` is fully free, slightly smaller, and has shadcn community adoption.

**Why not react-countup:** No built-in formatting, no digit-slot animation (counts sequentially, not slot-machine style). NumberFlow animates individual digit slots independently, which reads as more premium.

---

### No Other New Libraries Required

The visual overhaul is achievable entirely through CSS techniques and existing Framer Motion capabilities. Adding libraries beyond `@number-flow/react` would bloat the bundle and duplicate functionality already present.

---

## CSS Techniques (Zero Bundle Cost)

These are pure CSS patterns implemented via Tailwind v4 utilities and/or custom CSS in `src/styles/theme.css`. No new dependencies.

### 1. Glassmorphism — Card Surface Hierarchy

**Confidence:** HIGH (verified via Tailwind CSS official docs + MDN)

Tailwind v4 ships `backdrop-blur-*` utilities natively. The glassmorphism pattern for dark backgrounds uses:

```css
/* In theme.css or as Tailwind utilities */
.glass-card {
  /* Semi-transparent dark tint so text stays legible */
  background: rgba(13, 13, 13, 0.6);       /* Phoenix #0D0D0D at 60% */
  backdrop-filter: blur(12px);              /* backdrop-blur-[12px] */
  -webkit-backdrop-filter: blur(12px);      /* Safari prefix required */
  border: 1px solid rgba(255, 107, 53, 0.12); /* Ember at 12% opacity */
  box-shadow: 0 4px 24px rgba(255, 107, 53, 0.08); /* brand-tinted shadow */
}
```

**Tailwind v4 class equivalent:**
```html
<div class="bg-black/60 backdrop-blur-[12px] border border-[#FF6B35]/12 shadow-[0_4px_24px_rgba(255,107,53,0.08)] rounded-2xl">
```

**Critical caveat:** Text legibility fails on pure blur without the semi-transparent tint. The `bg-black/60` is non-negotiable for readability — do not remove it to "make it more glassy."

**Elevation hierarchy for Phoenix Portal:**
- Base surface: `bg-[#0D0D0D]` (page background)
- Card level 1: `bg-white/[0.03]` (subtle lift, no blur needed)
- Card level 2: `bg-black/60 backdrop-blur-[12px]` (glass, for modal/highlight cards)
- Overlay: `bg-black/80 backdrop-blur-[20px]` (sidebars, drawers)

### 2. Noise/Grain Texture — Premium Surface Feel

**Confidence:** HIGH (SVG feTurbulence is a CSS standard, widely supported)

A grainy overlay eliminates the "flat plastic" look of pure gradients. Implementation is a single inline SVG data URI applied as `background-image`:

```css
/* In theme.css — add to card or global body */
.surface-grain::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0.035;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  background-size: 128px 128px;
}
```

**Performance note:** SVG feTurbulence is CPU-rendered (not GPU). Use `opacity: 0.03–0.05` only — higher values trigger repaints on scroll. Apply to static elements (card backgrounds), NOT to animated or scrolling containers.

**Alternative for near-zero CPU cost:** Use a pre-generated PNG noise tile (256×256px, <4KB) as `background-image`. Generate at [fffuel.co/nnnoise](https://www.fffuel.co/nnnoise/). This avoids SVG filter re-rendering on every paint.

**Recommendation:** Use the PNG tile approach, not the inline SVG filter. Apply only to card backgrounds via `::after` pseudo-element.

### 3. Ambient Background Gradients — Depth Without Borders

**Confidence:** HIGH (native CSS radial-gradient, no library needed)

Large, low-opacity radial gradients at page-level create the "ember glow from below" effect seen in Whoop/premium fitness apps:

```css
/* In theme.css — on the root layout container */
.page-ambient {
  background-image:
    radial-gradient(ellipse 80% 50% at 20% 0%, rgba(255, 107, 53, 0.07) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 100%, rgba(220, 38, 38, 0.05) 0%, transparent 50%),
    radial-gradient(ellipse 50% 60% at 50% 50%, rgba(245, 158, 11, 0.03) 0%, transparent 70%);
}
```

**Tailwind v4 approach:** Define in `@theme` block as CSS custom properties, or use arbitrary values:
```html
<div class="bg-[radial-gradient(ellipse_80%_50%_at_20%_0%,rgba(255,107,53,0.07)_0%,transparent_60%)]">
```

**Note:** This goes on the fixed background container, NOT individual cards — it's a single layer behind all content.

### 4. Scroll-Driven Animations — Section Reveal on Scroll

**Confidence:** MEDIUM (CSS scroll-driven animations officially available in Chrome/Edge; Firefox and Safari still catching up as of Feb 2026)

**Browser support as of Feb 2026:** Chromium-based browsers (Chrome 115+, Edge 115+) = ~70% of users. Safari 26 beta adds support. Firefox: not yet. For a fitness dashboard, the audience skews tech-savvy — higher Chrome penetration expected.

**Recommendation: Use Framer Motion's `whileInView` + `useScroll` instead of native CSS scroll-driven animations.**

Reason: Framer Motion is already in the bundle. Its `whileInView` approach works across ALL browsers and provides richer spring physics. Native CSS scroll-driven animations require a progressive enhancement strategy (JS fallback) that doubles the implementation effort for no visual gain.

```tsx
// Framer Motion whileInView pattern — use this, not CSS scroll-timeline
import { motion } from 'motion/react'

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 30 } }
}

<motion.div
  variants={cardVariants}
  initial="hidden"
  whileInView="visible"
  viewport={{ once: true, amount: 0.2 }}
>
```

**For scroll-progress indicators only** (e.g., reading progress bar): CSS `animation-timeline: scroll()` with a Chromium-only `@supports` guard is acceptable:

```css
@supports (animation-timeline: scroll()) {
  .scroll-progress {
    animation: progress linear;
    animation-timeline: scroll();
  }
}
```

### 5. Spring Physics — Hover and Interaction States

**Confidence:** HIGH (Framer Motion official docs verified)

Framer Motion's spring transitions are the right tool. Already in the bundle. No addition needed.

**Pattern for card hover lifts (the most common premium dashboard interaction):**

```tsx
<motion.div
  whileHover={{
    y: -4,
    boxShadow: '0 20px 40px rgba(255, 107, 53, 0.15)',
  }}
  transition={{
    type: 'spring',
    stiffness: 400,
    damping: 25,
  }}
>
```

**Pattern for stagger on list/card grids (enter viewport):**

```tsx
const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } }
}
const item = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 350, damping: 28 } }
}

<motion.ul variants={container} initial="hidden" whileInView="visible" viewport={{ once: true }}>
  {items.map(i => <motion.li key={i.id} variants={item} />)}
</motion.ul>
```

### 6. Page Transitions — Framer Motion AnimatePresence

**Confidence:** HIGH (already used in the app for celebration animations; same pattern extends to page routing)

```tsx
// Wrap React Router outlet in AnimatePresence + motion.div
<AnimatePresence mode="wait">
  <motion.div
    key={location.pathname}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -8 }}
    transition={{ type: 'spring', stiffness: 400, damping: 35 }}
  >
    <Outlet />
  </motion.div>
</AnimatePresence>
```

---

## Existing Library Usage — Enhanced Patterns (No New Dependencies)

### Recharts — Premium Chart Styling

**Confidence:** MEDIUM (Recharts official docs + multiple community sources)

No new library needed. Recharts has full custom tooltip and axis support.

**Custom tooltip pattern:**
```tsx
const PhoenixTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-black/80 backdrop-blur-[8px] border border-[#FF6B35]/20 rounded-xl px-4 py-3 shadow-lg">
      <p className="text-xs text-white/50 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="text-sm font-semibold" style={{ color: p.color }}>
          {p.value} {p.name}
        </p>
      ))}
    </div>
  )
}
<Tooltip content={<PhoenixTooltip />} cursor={{ stroke: '#FF6B35', strokeWidth: 1, strokeDasharray: '4 2' }} />
```

**Styled axes:**
```tsx
<XAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
<YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
```

**Chart entrance animation:** Recharts has built-in `isAnimationActive` on all series components — it's enabled by default. Control duration: `animationDuration={800}`. Set `animationEasing="ease-out"`.

### shadcn/ui Sidebar — Collapsible Navigation

**Confidence:** HIGH (verified via official shadcn/ui docs)

The `Sidebar` component is already in the shadcn/ui registry (installed via `npx shadcn@latest add sidebar`). It supports three collapse modes:

| Mode | Behavior | Use Case |
|------|----------|----------|
| `"icon"` | Collapses to icon-only rail (48px wide) | Desktop: collapsed state showing nav icons |
| `"offcanvas"` | Slides fully off-screen | Mobile drawer pattern |
| `"none"` | Always visible, never collapses | Locked sidebars |

**For Phoenix Portal's collapsible sidebar (replacing the 13-item horizontal nav):**
- Use `collapsible="icon"` for desktop (icon rail on collapse)
- Use `collapsible="offcanvas"` for mobile
- `useSidebar()` hook exposes `state`, `open`, `toggleSidebar()` for controlled behavior
- `SidebarRail` provides the drag-to-resize handle
- State persists via cookie/localStorage out of the box

```bash
npx shadcn@latest add sidebar
```

**Bundle impact:** shadcn/ui components are copied into the project (no runtime package). The Sidebar adds ~3KB to the compiled output, well within budget.

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| GSAP | 60KB gzip — triple the app's main bundle. Cannot justify for a polish milestone | Framer Motion (already installed) |
| react-spring | 45KB gzip, overlaps completely with Framer Motion's spring system. Two spring libraries = confusion + bloat | `motion` package (already installed) |
| Lottie / react-lottie | JSON animation files are heavy; the app already has celebration animations via Framer Motion + Canvas | Keep existing pattern |
| three.js / @react-three/fiber | 3D is not needed; ambient gradients achieve depth at ~0KB | CSS radial-gradient |
| CSS scroll-driven animations (as primary approach) | Firefox has no support; Safari only in 26 beta (~5% installed base). Requires JS fallback anyway | Framer Motion `whileInView` |
| tailwindcss-animated plugin | v4-incompatible as of research date; Tailwind v4 uses `@theme` for custom keyframes directly | Define keyframes in `theme.css` via `@keyframes` in `@theme` block |
| react-countup | Counts linearly (0→100), not slot-machine style. Reads as cheap rather than premium | `@number-flow/react` |
| Motion's AnimateNumber | Requires paid Motion+ membership | `@number-flow/react` |

---

## Tailwind v4 Specific Patterns

**Confidence:** HIGH (Tailwind v4 official docs verified)

### Custom Keyframes in v4

In Tailwind v4, all custom animations are defined in CSS (not `tailwind.config.js`):

```css
/* src/styles/theme.css */
@theme {
  --animate-ember-pulse: ember-pulse 2s ease-in-out infinite;
  --animate-stat-enter: stat-enter 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;

  @keyframes ember-pulse {
    0%, 100% { box-shadow: 0 0 8px rgba(255, 107, 53, 0.3); }
    50% { box-shadow: 0 0 24px rgba(255, 107, 53, 0.6); }
  }

  @keyframes stat-enter {
    from { opacity: 0; transform: translateY(8px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
}
```

Then use: `<div class="animate-stat-enter">` or arbitrary: `<div class="animate-[ember-pulse_2s_ease-in-out_infinite]">`.

### CSS Variable Token Integration

The existing dual-token pattern (CSS vars + hex constants for SVG/motion) remains correct. For glassmorphism, reference the existing Phoenix palette tokens:

```css
/* Already defined in theme.css — reference these, don't hardcode */
var(--color-primary)    /* #FF6B35 ember */
var(--color-flame)      /* #DC2626 */
var(--color-gold)       /* #F59E0B */
var(--color-forge)      /* #10B981 */
```

---

## Bundle Impact Assessment

| Addition | Gzip Cost | Cumulative Total | Verdict |
|----------|-----------|-----------------|---------|
| Baseline (95.69KB / 34.46KB gzip) | — | 34.46KB | — |
| `@number-flow/react` | ~6.8KB | 41.26KB | Acceptable |
| shadcn Sidebar component | ~3KB (project-local copy) | 44.26KB | Acceptable |
| CSS techniques (all) | 0KB (pure CSS) | 44.26KB | Free |
| Framer Motion `whileInView` / spring patterns | 0KB (already bundled) | 44.26KB | Free |
| Recharts custom tooltips | 0KB (already bundled) | 44.26KB | Free |

**Estimated final gzip after overhaul: ~41–45KB.** Well within budget. The original 500KB target set in v1.0 planning leaves ample headroom.

---

## Version Compatibility

| Package | Version | Compatible With | Notes |
|---------|---------|-----------------|-------|
| `@number-flow/react` | 0.5.12 | React 19, Tailwind v4 | Dependency-free; CSS custom properties only; Feb 2026 Safari fix included |
| shadcn Sidebar | latest (via CLI) | React 19, Tailwind v4, Radix | Copied into project, no package version lock |
| Framer Motion (`motion`) | current in project | React 19 | Already installed; `whileInView`, `stagger`, `AnimatePresence`, `useScroll` all available |
| Recharts 3 | current in project | React 19 | `isAnimationActive`, `animationDuration`, custom `content` prop on Tooltip — all available |

---

## Installation Summary

```bash
# Only one new package needed for the entire visual overhaul
npm install @number-flow/react

# shadcn Sidebar (copies into src/app/components/ui/ — not a package dep)
npx shadcn@latest add sidebar
```

All other improvements are achieved through:
1. CSS patterns added to `src/styles/theme.css`
2. Enhanced usage of already-installed Framer Motion
3. Custom tooltip/axis components in Recharts (no new package)

---

## Sources

- [Tailwind CSS backdrop-blur docs](https://tailwindcss.com/docs/backdrop-filter-blur) — glassmorphism utilities, arbitrary value support (HIGH confidence)
- [MDN CSS scroll-driven animations](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations) — browser support status (HIGH confidence)
- [Scroll-driven animations and Tailwind - Gabor Juhasz](https://juhg.hu/scroll-driven-animations) — Tailwind v4 arbitrary value approach, Chromium-only caveat (MEDIUM confidence)
- [number-flow GitHub releases](https://github.com/barvian/number-flow/releases) — v0.5.12, Feb 2026 Safari fix (HIGH confidence)
- [number-flow npm](https://www.npmjs.com/package/@number-flow/react) — latest version 0.5.12 (HIGH confidence)
- [shadcn/ui Sidebar docs](https://ui.shadcn.com/docs/components/sidebar) — collapsible modes, useSidebar hook (HIGH confidence)
- [Motion docs - React scroll animations](https://motion.dev/docs/react-scroll-animations) — useScroll, whileInView, useSpring hooks (HIGH confidence)
- [Motion docs - reduce bundle size](https://motion.dev/docs/react-reduce-bundle-size) — LazyMotion, ~4.6KB minimum (HIGH confidence)
- [CSS Tricks - Grainy Gradients](https://css-tricks.com/grainy-gradients/) — SVG feTurbulence noise texture technique (HIGH confidence)
- [fffuel.co noise generator](https://www.fffuel.co/nnnoise/) — PNG noise tile alternative (MEDIUM confidence)
- [Motion changelog](https://github.com/motiondivision/motion/blob/main/CHANGELOG.md) — v12 features including scroll-linked timelines (MEDIUM confidence)
- [LogRocket - best React animation libraries 2026](https://blog.logrocket.com/best-react-animation-libraries/) — bundle size benchmarks: Motion ~85KB uncompressed, React Spring ~45KB (MEDIUM confidence, single source)

---

*Stack research for: Phoenix Portal v1.2 Premium Visual Overhaul*
*Researched: 2026-02-20*
