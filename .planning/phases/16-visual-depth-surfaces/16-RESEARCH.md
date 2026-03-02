# Phase 16: Visual Depth & Surfaces - Research

**Researched:** 2026-02-20
**Domain:** CSS visual hierarchy, glassmorphism, gradient borders, icon container differentiation
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VIS-03 | Card surface hierarchy: hero cards (brand shadow + border glow), primary cards (elevated + blur), secondary cards (subtle surface) | Elevation token system already exists in theme.css (`--shadow-sm/md/lg`, `--surface-1/2/3`); hero cards need `--shadow-lg` + `border-primary/50` + optional glow ring; glassmorphism tokens for primary |
| VIS-06 | Glassmorphism (`backdrop-blur + semi-transparent bg`) applied to 2-3 key cards per page only (max 3 blur layers per viewport) | Tailwind v4 `backdrop-blur-md` (12px) verified. Current codebase already uses sticky headers with `backdrop-blur-lg` — count those as 1 existing layer. Hero card glassmorph = 1 more. Viewport budget: 2 new blur layers max per page |
| VIS-07 | Auth dialog uses dark glass treatment (blur + branded border + inner shadow) | `DialogOverlay` uses `bg-black/50` — needs `backdrop-blur-sm` added. `DialogContent` needs glass background (`bg-surface-2/80 backdrop-blur-xl`), branded border, inner shadow. Pattern verified. |
| VIS-08 | Landing page feature cards have gradient borders and hover lift with glow bloom | Background-clip technique for rounded gradient borders confirmed working. Hover: CSS `transition` + `box-shadow` glow bloom. No Framer Motion needed — CSS hover sufficient for Phase 16 (Framer hover is Phase 17). |
| VIS-09 | Icon containers upgraded from uniform `w-12 h-12 rounded-lg` to differentiated treatments (primary: rounded-full + glow, secondary: no container) | Two-role system: primary icons get `rounded-full bg-primary/10 p-2.5 text-primary animate-phoenix-glow`; secondary informational icons get no container, just `text-muted-foreground` inline. |
| BUG-07 | Gradient text reserved for hero headlines only — section headers use solid `text-white` or `text-primary` | 40+ gradient text instances found across codebase. Only LandingPage hero h1 and Dashboard welcome h1 are hero headlines. All `<h2>` section headers, card titles, and branding instances (AppSidebar logo, Navigation logo) must use `text-white` or `text-primary`. |
</phase_requirements>

---

## Summary

Phase 16 is a pure CSS/Tailwind styling pass — no new libraries, no new components. The project already has all the tokens needed: `--shadow-sm/md/lg` shadow tokens, `--surface-1/2/3` background tiers, `--phoenix-ember` color palette, and `backdrop-blur-*` Tailwind utilities from v4. The work is applying these consistently according to a three-tier card hierarchy.

The single largest task is BUG-07: gradient text is used in 40+ locations across the codebase. The rule is straightforward — hero h1 headlines only — but it requires touching many files. Section headers (`<h2>`), card titles, and logo text spans must all switch to `text-white` or `text-primary`. This is a sweep task, not a design task.

Glassmorphism (VIS-06) requires restraint: the codebase already uses `backdrop-blur-lg` in sticky mobile/desktop headers on every page. Those count toward the 3-layer budget. Each page can add at most 2 glassmorphic cards, and the sticky header counts as the third. Implementing glassmorphism requires verifying the per-page count before applying to any card.

**Primary recommendation:** Define CSS utility classes for the three card tiers in `theme.css` (`@layer utilities`), then sweep the codebase to apply them rather than adding inline classes to 50 individual Card instances.

---

## Standard Stack

### Core (all already installed, no new installs needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Tailwind CSS v4 | 4.1.18 | `backdrop-blur-*`, `bg-*/opacity`, `shadow-*` utilities | Already in use; v4 has all needed blur/opacity syntax |
| shadcn/ui Card | current | Base card component with `data-slot="card"` hook | Already in use; theme.css already targets `[data-slot="card"]` |
| CSS Custom Properties | - | `--shadow-sm/md/lg`, `--surface-1/2/3` elevation tokens | Already defined in theme.css; just need applying |

### No New Installs Required

Phase 16 is entirely CSS and Tailwind class changes. The existing stack handles everything:
- Gradient borders: CSS `background-clip` technique (no library)
- Glassmorphism: Tailwind `backdrop-blur-md` + `bg-surface-2/60` (no library)
- Icon glow: existing `animate-phoenix-glow` CSS class in theme.css (no library)
- Hover bloom: CSS `box-shadow` transition + Tailwind `hover:shadow-*` (no library)

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS background-clip gradient border | `border-image` property | `border-image` breaks `border-radius`; background-clip works with rounded corners. Use background-clip. |
| Per-component inline classes | CSS utility classes in theme.css | Per-component: 50+ edits. Utility classes in `@layer utilities`: define once, apply everywhere. Use utilities. |
| `backdrop-blur-xl` (24px) for cards | `backdrop-blur-md` (12px) | xl is too heavy on mobile, causes GPU overload; md at 12px is the sweet spot for dark cards |

---

## Architecture Patterns

### Recommended Card Tier System

Define three CSS utility classes in `theme.css @layer utilities`:

```css
/* Source: Pattern derived from existing --shadow-sm/md/lg tokens in theme.css */
@layer utilities {
  /* Hero cards: streak, active goal, recovery score */
  .card-hero {
    background: linear-gradient(135deg, rgba(255,107,53,0.12), rgba(220,38,38,0.08));
    border-color: rgba(255, 107, 53, 0.4);
    border-width: 2px;
    box-shadow: var(--shadow-lg), 0 0 20px rgba(255, 107, 53, 0.15);
  }

  /* Primary elevated cards: glassmorphic treatment, key metrics */
  .card-primary {
    background: rgba(26, 26, 26, 0.6);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-color: rgba(255, 255, 255, 0.08);
    box-shadow: var(--shadow-md);
  }

  /* Secondary informational cards: subtle surface (default) */
  .card-secondary {
    background: linear-gradient(135deg, var(--surface-2), var(--surface-0));
    border-color: rgba(255, 255, 255, 0.06);
    box-shadow: var(--shadow-sm);
  }
}
```

**Usage in JSX:**
```tsx
{/* Hero card (streak, active goal, recovery score) */}
<Card className="p-6 card-hero">...</Card>

{/* Primary glassmorphic card */}
<Card className="p-6 card-primary">...</Card>

{/* Secondary informational card */}
<Card className="p-6 card-secondary">...</Card>
```

### Pattern 1: Glassmorphism Budget Management

**What:** Max 3 backdrop-blur layers per viewport simultaneously. The mobile sticky header (`bg-background/95 backdrop-blur-lg`) already consumes layer 1. Each page can have at most 2 glassmorphic cards visible at once.

**Per-page glassmorphic card assignments (VIS-06):**
- Dashboard: Streak card (hero, no blur needed — use border glow instead), Goals widget (primary blur), Recovery widget (primary blur) — 2 blur layers + 1 sticky header = 3 total. STOP.
- Landing: Feature cards get gradient borders only, NOT backdrop-blur (see VIS-08). Auth dialog gets blur — that's viewport-scoped when open.
- Analytics: The sticky tab header already uses `backdrop-blur-lg`. Max 1 additional blur card per screen.

**When to use:** Only assign glassmorphism to cards that display premium/key data: goal progress, recovery score, active challenge. Never apply to list items, stat summaries, or chart containers.

**Example (Goals widget with glass treatment):**
```tsx
// Primary glass card — for GoalDashboardWidget, RecoveryDashboardWidget
<Card className="p-6 card-primary">
  {/* content */}
</Card>
```

### Pattern 2: Gradient Border for Landing Feature Cards (VIS-08)

**What:** CSS `background-clip` technique creates gradient borders that work with `border-radius`. Uses `border: 1px solid transparent` + layered background.

**When to use:** Landing page feature cards only. Not inside the authenticated app.

**Example (Tailwind arbitrary properties approach):**
```tsx
// Source: https://buildui.com/recipes/gradient-border (background-clip technique)
// For Landing feature cards with rounded-xl border-radius
<Card
  className={cn(
    "p-6 h-full cursor-pointer rounded-xl border border-transparent",
    "transition-all duration-300",
    "hover:-translate-y-1 hover:shadow-[0_0_20px_rgba(255,107,53,0.25)]",
  )}
  style={{
    background: `
      padding-box linear-gradient(var(--surface-2), var(--background)),
      border-box linear-gradient(135deg, rgba(255,107,53,0.6), rgba(220,38,38,0.3), rgba(245,158,11,0.2))
    `,
  }}
>
```

Or as a CSS class in theme.css:
```css
@layer utilities {
  .card-landing-feature {
    border: 1px solid transparent;
    background:
      padding-box linear-gradient(135deg, var(--surface-2), var(--surface-0)),
      border-box linear-gradient(135deg,
        rgba(255, 107, 53, 0.6) 0%,
        rgba(220, 38, 38, 0.3) 50%,
        rgba(245, 158, 11, 0.15) 100%);
    transition: transform 150ms ease, box-shadow 150ms ease;
  }
  .card-landing-feature:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.4), 0 0 20px rgba(255,107,53,0.2);
  }
}
```

### Pattern 3: Auth Dialog Glass Treatment (VIS-07)

**What:** Dark glass dialog: blurred overlay, `bg-surface-2/80 backdrop-blur-xl`, branded border, inner glow shadow.

**Changes needed:**
1. `DialogOverlay` — add `backdrop-blur-sm` to the overlay (the overlay is the background behind the dialog, not a card)
2. `DialogContent` in LandingPage.tsx — replace `bg-surface-2 border-secondary` with glass classes

```tsx
// In LandingPage.tsx authDialog, the DialogContent className:
<DialogContent className="bg-surface-2/80 backdrop-blur-xl border-primary/30 shadow-[0_0_0_1px_rgba(255,107,53,0.15),0_0_40px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.05)] max-w-md p-6">
```

**CRITICAL:** Modifying `DialogContent` in `ui/dialog.tsx` changes ALL dialogs. Do NOT change the shared component. Apply the glass treatment only as a `className` override in LandingPage.tsx. The dialog component already supports className passthrough.

### Pattern 4: Icon Container Differentiation (VIS-09)

**What:** Two roles replace the uniform `w-12 h-12 rounded-lg bg-gradient-to-br` pattern.

**Current pattern (everywhere):** `w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center`

**New patterns:**

```tsx
{/* Role A: Primary feature icon (Landing features, main nav quick actions) */}
{/* rounded-full + soft glow halo — visually primary */}
<div className="w-11 h-11 rounded-full bg-primary/15 flex items-center justify-center ring-1 ring-primary/30 animate-phoenix-glow">
  <SomeIcon className="w-5 h-5 text-primary" />
</div>

{/* Role B: Secondary informational icon (card labels, stat categories) */}
{/* No container — just the icon with muted color */}
<Target className="w-5 h-5 text-muted-foreground" />

{/* Role C: Keep gradient container for action/CTA icons (buttons, dashboard quick actions) */}
{/* These are intentionally high-visibility */}
<div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center">
  <TrendingUp className="w-5 h-5 text-white" />
</div>
```

**Where to apply:** Landing feature cards (6 icons) get Role A. Dashboard GoalDashboardWidget and RecoveryDashboardWidget h3 inline icons get Role B. QuickStatCards in Dashboard keep Role C (they ARE the action CTAs). h3 label icons like `<Target>` and `<HeartPulse>` beside section titles get Role B.

### Pattern 5: BUG-07 Gradient Text Sweep

**What:** Replace `bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent` with solid colors everywhere except hero h1 elements.

**Rule:**
- KEEP gradient text: LandingPage hero h1 ("Project Phoenix"), Dashboard welcome h1 username span
- CHANGE to `text-white`: All `<h2>` section titles (LandingPage "Elevate Your Training", "Choose Your Path"; feature page section headers)
- CHANGE to `text-primary`: AppSidebar logo text, Navigation logo text, dialog header branding spans (`text-xl bg-gradient...`)
- CHANGE to `text-white`: Celebration modals (PRCelebration, StreakMilestone, GoalCelebration) — these are overlays, not hero headlines
- CHANGE to `text-primary`: Large numeric stats displayed with gradient (Dashboard streak number in desktop, Profile stat numbers, PersonalRecords stat numbers)

**Files with gradient text instances to sweep (ordered by count):**
1. LandingPage.tsx — 8 instances, keep 1 (hero h1), fix 7
2. Dashboard.tsx — 5 instances, keep 1 (welcome h1 username), fix 4
3. PersonalRecords.tsx — 4 instances, fix all
4. Analytics.tsx — 2 instances (section headers), fix both
5. Challenges.tsx — 2 instances (section headers), fix both
6. Community.tsx — 2 instances (section headers), fix both
7. Goals.tsx — 2 instances, fix both
8. AppSidebar.tsx — 1 instance (logo text), fix to `text-primary`
9. Others (Navigation, PrivacyPolicy, Profile, Recovery, RoutinesEnhanced, ComparisonView, ResetPassword, CelebrationDemo, celebrations/) — 1 each, fix

### Anti-Patterns to Avoid

- **Applying glassmorphism to list items or table rows:** Scroll jank guaranteed on mobile. Glass = card-level only, never list-item-level.
- **Stacking 4+ backdrop-blur elements on one page:** GPU overload on mid-range phones. Count sticky headers as layer 1.
- **Using `border-image` for gradient borders:** Breaks `border-radius` entirely. Use `background-clip` technique.
- **Modifying `ui/dialog.tsx` base component for glass treatment:** That changes all dialogs. Apply glass via `className` on the specific instance in LandingPage.tsx.
- **`will-change: backdrop-filter` on static cards:** Only use `will-change` if the element animates. Static glass cards do not need it.
- **Animating `backdrop-filter` property directly:** Extremely expensive. If hover states change a glass card, change `box-shadow` or `border-color` only — not the blur value.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Gradient borders on rounded elements | Custom canvas or SVG overlay | CSS `background-clip` technique with layered backgrounds | Native CSS, zero JS, works with `border-radius` |
| Counting blur layers at runtime | JavaScript viewport inspection | Design-time rule: assign glass tiers in planning, count before implementing | Runtime counting is over-engineering; design constraint solves it statically |
| Custom glass card component | `GlassCard.tsx` wrapper component | CSS utility class `.card-primary` in `theme.css @layer utilities` | Utility class applies to any element, including shadcn `<Card>`; component wrapper adds unnecessary abstraction |
| Animated gradient border rotation | JavaScript animation loop | CSS `@keyframes` with `background-position` on the gradient border | Phase 17 handles animation; Phase 16 is static borders only |

**Key insight:** All visual depth work in Phase 16 is CSS-only. Creating new React components for presentation concerns (glass cards, gradient borders) adds abstraction without value. CSS utilities in `@layer utilities` apply to existing shadcn components via `className` — the existing Card component's `className` passthrough already handles this.

---

## Common Pitfalls

### Pitfall 1: Gradient Border Breaks Border-Radius

**What goes wrong:** Developer uses `border-image: linear-gradient(...)` which ignores `border-radius`. Cards appear with sharp corners despite `rounded-xl`.

**Why it happens:** `border-image` and `border-radius` are fundamentally incompatible in CSS — the spec does not support rounded border-image.

**How to avoid:** Use the `background-clip` technique exclusively. The card needs `border: 1px solid transparent` + layered `background` using `padding-box` / `border-box` clips.

**Warning signs:** If you see `border-image` anywhere, it's wrong.

### Pitfall 2: Exceeding Backdrop-Blur Budget

**What goes wrong:** Page has 4+ elements with `backdrop-blur-*`, causing scroll jank on mid-range mobile (Pixel 4a, iPhone 12 equivalent).

**Why it happens:** Each `backdrop-blur` element requires a compositor layer. Each layer captures a framebuffer copy of everything behind it and blurs it on the GPU. Three layers is the threshold where mid-range devices start dropping frames.

**How to avoid:** Current budget per page:
- Sticky mobile header: `backdrop-blur-lg` (layer 1) — always exists
- Auth dialog overlay: `backdrop-blur-sm` (layer 1 when open — dialog overlays everything else)
- Max 2 glass cards per page content area (layers 2 and 3)
- MobileBottomNav: `backdrop-blur-lg` (layer 2 — persistent on mobile)

This means on **mobile**: sticky header + bottom nav already consume 2 layers. Only 1 glass card allowed on mobile per page.

**Warning signs:** Test on Chrome DevTools device emulation (Pixel 4) — check for >60ms frame times when scrolling. Reduce blur values to 8px or fewer for mobile.

**Mitigation:** Use `@media (prefers-reduced-motion: no-preference)` to gate heavy glass:
```css
.card-primary {
  background: rgba(26, 26, 26, 0.6);
}
@media (min-width: 768px) {
  .card-primary {
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
}
```

This gives desktop full glass treatment and mobile just the semi-transparent background.

### Pitfall 3: `-webkit-backdrop-filter` Missing

**What goes wrong:** Glass effect appears on Chrome/Firefox but not Safari (desktop or iOS).

**Why it happens:** Safari still requires `-webkit-backdrop-filter` prefix as of 2026, even though the un-prefixed property is supported.

**How to avoid:** Always write both:
```css
backdrop-filter: blur(12px);
-webkit-backdrop-filter: blur(12px);
```

When using Tailwind `backdrop-blur-md`, the generated CSS includes both prefixes automatically. The risk is in raw CSS in theme.css — always include the webkit prefix there.

### Pitfall 4: Glass Card Over Dark Background Invisible

**What goes wrong:** `backdrop-blur + bg-white/5` looks invisible against the `#0D0D0D` background because there's almost nothing to blur — the background is uniform.

**Why it happens:** Glassmorphism requires a non-uniform layer behind the element. A solid dark background has nothing to blur through.

**How to avoid:** The project already has ambient radial gradients and grain texture on `body::before/::after` (VIS-01/02, Phase 14). These provide the visual variation that glassmorphism blurs. The glass card must sit above these layers (z > 1). Ensure the glass card has `relative z-10` or inherits from AppLayout's `z-10`.

**Warning signs:** Glass card looks identical to a non-glass card → the element is below the ambient gradient layers.

### Pitfall 5: BUG-07 Sweep Misses Instances

**What goes wrong:** Developer fixes gradient text in the files they remember to check, but misses PrivacyPolicy.tsx, ResetPassword.tsx, celebrations/ subdirectory, etc.

**Why it happens:** 40+ instances across 20+ files — easy to miss with file-by-file inspection.

**How to avoid:** Use grep to enumerate all instances before touching any file:
```bash
grep -rn "bg-clip-text text-transparent" src/ --include="*.tsx"
```
Fix ALL instances in one pass. Use the list of 40 instances from research as the task checklist.

---

## Code Examples

Verified patterns from official sources and codebase analysis:

### Card Hero (Streak Card — current → upgraded)

```tsx
{/* CURRENT (Dashboard.tsx line 723, desktop) */}
<Card className="p-6 bg-gradient-to-br from-primary/20 to-chart-2/20 border-primary border-2">

{/* UPGRADED — card-hero utility class */}
<Card className="p-6 card-hero">
```

### Card Primary (GoalDashboardWidget — glassmorphic)

```tsx
{/* CURRENT (GoalDashboardWidget.tsx) */}
<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">

{/* UPGRADED — card-primary utility class (glass, desktop only) */}
<Card className="p-6 card-primary">
```

### Auth Dialog Glass Treatment

```tsx
{/* CURRENT (LandingPage.tsx line 269) */}
<DialogContent className="bg-surface-2 border-secondary max-w-md p-6">

{/* UPGRADED */}
<DialogContent className="bg-surface-2/80 backdrop-blur-xl border border-primary/30 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05),0_0_40px_rgba(0,0,0,0.6)] max-w-md p-6">
```

Also update the DialogOverlay in LandingPage to use blur on the overlay:
```tsx
{/* Option: Override DialogOverlay via className on Dialog — not possible with shadcn */}
{/* Correct approach: The DialogOverlay already has bg-black/50 — just add backdrop-blur-sm
    by passing className to the overlay via DialogContent's children wrapper */}
```
Note: The shadcn DialogOverlay is rendered inside DialogContent's portal automatically. To add `backdrop-blur-sm` to the overlay, override it in `ui/dialog.tsx` ONLY for this case by adding the class to `DialogOverlay`. Since this is the ONLY dialog using blur, consider wrapping it differently — a simpler approach is to just add `backdrop-blur-sm` directly to the DialogOverlay in `ui/dialog.tsx` as a baseline since blur on overlays is standard practice.

### Landing Feature Card Gradient Border

```tsx
{/* CURRENT (LandingPage.tsx line 645) */}
<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary hover:border-primary/50 transition-all duration-300 group cursor-pointer h-full">

{/* UPGRADED — gradient border via CSS class */}
<Card className="p-6 card-landing-feature group cursor-pointer h-full">
```

### Primary Icon Container (Landing features)

```tsx
{/* CURRENT */}
<div className="mb-4 w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
  <feature.icon className="w-6 h-6 text-white" />
</div>

{/* UPGRADED — rounded-full + glow halo */}
<div className="mb-4 w-11 h-11 rounded-full bg-primary/15 flex items-center justify-center ring-1 ring-primary/30">
  <feature.icon className="w-5 h-5 text-primary" />
</div>
```

### Section Header Gradient Text Fix (BUG-07)

```tsx
{/* CURRENT — section header (wrong) */}
<h2 className="text-4xl sm:text-5xl mb-4">
  <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
    Elevate Your Training
  </span>
</h2>

{/* FIXED — solid white for section headers */}
<h2 className="text-4xl sm:text-5xl mb-4 text-white">
  Elevate Your Training
</h2>

{/* CURRENT — logo/brand span (wrong) */}
<span className="text-base font-semibold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
  Project Phoenix
</span>

{/* FIXED — primary color for brand text */}
<span className="text-base font-semibold text-primary">
  Project Phoenix
</span>
```

### theme.css @layer utilities Addition

```css
/* Source: Existing pattern from theme.css @layer base + @theme blocks */
@layer utilities {
  /* === Card Surface Tiers === */

  /* Hero: streak, active goal, recovery score — max 1 per page */
  .card-hero {
    background: linear-gradient(135deg,
      rgba(255, 107, 53, 0.12) 0%,
      rgba(220, 38, 38, 0.06) 100%);
    border: 2px solid rgba(255, 107, 53, 0.4);
    box-shadow:
      var(--shadow-lg),
      0 0 20px rgba(255, 107, 53, 0.12);
  }

  /* Primary glass: key metric cards — max 2 per viewport desktop, max 1 mobile */
  .card-primary {
    background: rgba(26, 26, 26, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: var(--shadow-md);
  }
  @media (min-width: 768px) {
    .card-primary {
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
  }

  /* Secondary: informational content — default tier */
  .card-secondary {
    background: linear-gradient(135deg, var(--surface-2), var(--surface-0));
    border: 1px solid rgba(255, 255, 255, 0.06);
    box-shadow: var(--shadow-sm);
  }

  /* Landing-specific: gradient border feature cards */
  .card-landing-feature {
    border: 1px solid transparent;
    background:
      padding-box linear-gradient(135deg, var(--surface-2), var(--surface-0)),
      border-box linear-gradient(135deg,
        rgba(255, 107, 53, 0.5) 0%,
        rgba(220, 38, 38, 0.25) 50%,
        rgba(245, 158, 11, 0.1) 100%);
    box-shadow: var(--shadow-sm);
    transition: transform 200ms ease, box-shadow 200ms ease;
  }
  .card-landing-feature:hover {
    transform: translateY(-3px);
    box-shadow:
      var(--shadow-lg),
      0 0 24px rgba(255, 107, 53, 0.2);
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| All cards use `border-image` for gradient borders | `background-clip` technique (padding-box/border-box) | 2023+ | Works with `border-radius`; no sharp corners |
| Individual CSS props per card | Design token + utility class system | 2022+ | Single source of truth; consistent application |
| `will-change: backdrop-filter` on all glass | `will-change` only on animated elements | 2024+ | Avoids memory waste from static glass |
| Full glassmorphism everywhere | Budget-constrained glassmorphism (max 3 layers) | 2023+ | Prevents GPU thrash on mobile |
| webkit prefix required for backdrop-filter | Tailwind generates `-webkit-backdrop-filter` automatically | Tailwind v3.3+ | Safe to use `backdrop-blur-*` utility; raw CSS still needs explicit prefix |

**Deprecated/outdated:**
- `border-image` for rounded gradient borders: incompatible with `border-radius`, do not use
- `backdrop-blur` on every card: mobile GPU budget exceeded; constrain to 2-3 per page

---

## Open Questions

1. **DialogOverlay backdrop-blur scope**
   - What we know: `DialogOverlay` is defined in `ui/dialog.tsx` and renders the backdrop. Adding `backdrop-blur-sm` there affects ALL dialogs in the app.
   - What's unclear: Are there other dialogs in the app that should NOT have a blurred overlay? (RoutinePickerModal, alert-dialog, etc.)
   - Recommendation: Audit all Dialog usages before touching `ui/dialog.tsx`. If only LandingPage auth dialog needs glass overlay, use a local override approach — pass a custom `DialogOverlay` via render props, or wrap `DialogContent` in a custom component just for that page. The simpler path: add `backdrop-blur-sm` to the global `DialogOverlay` — it's a subtle effect that improves all dialogs.

2. **Mobile blur budget on Dashboard**
   - What we know: On mobile, `MobileBottomNav` uses `backdrop-blur-lg` (layer 1) and the sticky dashboard header uses `backdrop-blur-lg` (layer 2). Two persistent layers already.
   - What's unclear: Should the Streak card on mobile get the `.card-hero` treatment (no blur, just gradient + border glow) or `.card-primary` (with blur)?
   - Recommendation: Mobile Streak card uses `.card-hero` only (gradient bg + colored border + shadow). No `backdrop-blur` on mobile cards at all — the gradient background alone provides sufficient visual distinction. Reserve glass for desktop.

3. **Icon container scope — how far to sweep VIS-09**
   - What we know: The uniform `w-12 h-12 rounded-lg` pattern appears in ~15 locations across Dashboard, LandingPage, CelebrationDemo, WorkoutHistory, NextWorkoutWidget, Challenges.
   - What's unclear: Should ALL instances be converted, or only the "feature-level" icons?
   - Recommendation: Convert Landing feature icons (6 cards — high visibility) and Dashboard h3-level label icons (Goals, Recovery section titles). Leave dashboard QuickStatCards and WorkoutHistory timeline icons as-is — they serve as action indicators and the gradient container reinforces that CTA meaning.

---

## Sources

### Primary (HIGH confidence)
- Official Tailwind CSS v4 docs (https://tailwindcss.com/docs/backdrop-filter-blur) — verified `backdrop-blur-md` = 12px, all blur utilities confirmed
- Project codebase audit — `theme.css`, `card.tsx`, `dialog.tsx`, `Dashboard.tsx`, `LandingPage.tsx` read directly
- buildui.com gradient border recipe — `background-clip` technique with `padding-box`/`border-box` confirmed working with `border-radius`

### Secondary (MEDIUM confidence)
- Multiple web sources confirm: max 3 backdrop-blur layers per viewport for mobile performance
- Multiple sources confirm: `-webkit-backdrop-filter` required for Safari; Tailwind utilities generate both automatically
- CSS gradient border limitation (`border-image` breaks `border-radius`) verified across multiple sources including MDN

### Tertiary (LOW confidence)
- Mid-range device (Pixel 4a class) performance threshold — the "3 layers" number is widely cited in glassmorphism guides but is not from a single authoritative benchmark. Treat as a reasonable heuristic, not a hard limit.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; existing Tailwind v4 + CSS verified
- Architecture (card tiers, CSS utilities): HIGH — based on existing theme.css token system
- Glassmorphism budget: MEDIUM — 3-layer budget is an industry heuristic, not benchmarked on this specific project's device targets
- Gradient border technique: HIGH — background-clip technique confirmed from multiple authoritative sources
- BUG-07 instance count: HIGH — grep audit of codebase, 40+ instances enumerated

**Research date:** 2026-02-20
**Valid until:** 2026-03-20 (stable CSS techniques; Tailwind v4 API is stable)
