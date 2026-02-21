# Phase 20: Gap Closure & Tech Debt - Research

**Researched:** 2026-02-20
**Domain:** CSS stacking contexts, dead code removal, utility class consolidation
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TYPE-03 | Hardcoded `fontFamily: "system-ui"` removed from LandingPage hero h1 | Confirmed: line 551 of `LandingPage.tsx` has `style={{ fontFamily: "Inter, system-ui, sans-serif" }}` on the `<motion.h1>`. Global Inter declaration in `fonts.css` via `@theme` block already covers this element — inline `style` prop is redundant and prevents CSS cascade from applying correct font. Removing it is a one-line change. |
| VIS-01 | Body background has ambient radial gradient glows (ember at top-left, flame-red at bottom-right, 6-10% opacity) | The glows ARE already implemented in `theme.css` as `body::before` (position:fixed, z-index:0). They are visually occluded by opaque `bg-background` (#0D0D0D) layers in AppLayout, SidebarInset, and all page component root wrappers. Making glows visible requires a sweep removing `bg-background` from those layers — the body itself supplies the #0D0D0D base color via `@apply bg-background`. |

</phase_requirements>

---

## Summary

Phase 20 closes five concrete gaps from the v1.2 milestone audit. Four of the five are straightforward surgical fixes: remove one inline `style` prop, delete one dead file, replace one set of manual Tailwind classes with the existing `.eyebrow` utility, and verify the overall change compiles. The fifth — making the ambient ember/flame glows visible through the authenticated app shell — is the only multi-file sweep in this phase.

The glow occlusion problem has a clear root cause: `body::before` (the glow layer) is `position:fixed` at `z-index:0` in the document stacking context. The AppLayout shell `<div>` at `z-[10]` creates a new stacking context with an opaque `bg-background` (#0D0D0D) fill, covering the glow entirely. `SidebarInset` (from the shadcn/ui sidebar) compounds this with its own `bg-background`. All 16 authenticated page components add a third opaque `bg-background` layer via their root `min-h-screen bg-background` wrappers. Stripping `bg-background` from all three layers reveals the glow — the body's own `bg-background` provides the #0D0D0D base, so no visual regression occurs.

This phase has no external library requirements, no new dependencies, and no architectural changes. Every change is purely CSS class modification or file deletion.

**Primary recommendation:** Execute as two tasks: (1) the four surgical fixes (inline style removal, Navigation.tsx deletion, eyebrow class, any documentation cleanup), (2) the glow occlusion sweep (AppLayout + SidebarInset + 16 page files). Verify build passes and gradient counts are unchanged after the sweep.

---

## Standard Stack

### Core (no changes needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Tailwind CSS v4 | 4.x | Utility class generation | Already in project — `bg-transparent` utility is what replaces `bg-background` |
| shadcn/ui sidebar | local | SidebarInset component | SidebarInset accepts `className` prop — override `bg-background` from call site in AppLayout |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | — | — | No new libraries needed for this phase |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Stripping `bg-background` from page components | Changing `--background` CSS var to `rgba(13,13,13,0)` | Breaks ALL elements using `bg-background` — cards, modals, toasts — unacceptable |
| Stripping `bg-background` from page components | Making body::before `z-index` higher | Would place glow OVER content — wrong visual result |
| Stripping `bg-background` from page components | CSS `mix-blend-mode` tricks | Adds complexity; correct fix is simply removing redundant background declarations |

**Installation:** No new packages needed.

---

## Architecture Patterns

### Recommended Project Structure
No structural changes. All edits are within existing files.

### Pattern 1: CSS Stacking Context and Fixed Pseudo-Elements

**What:** `position:fixed` pseudo-elements (`body::before`, `body::after`) are painted in the root stacking context of the document at their declared `z-index`. A `position:relative` child with an explicit `z-index` creates a **new** stacking context — but that child's own `background-color` still paints over anything behind it in the viewport, regardless of the pseudo-element's `z-index`.

**When to use:** Any time a fixed-position background effect (glow, grain) must "show through" the app shell.

**The exact problem:**
```
Document root stacking context:
  body::before  [position:fixed, z-index:0]  ← ember/flame glow (8%, 6% opacity)
  body::after   [position:fixed, z-index:1]  ← grain texture
  AppLayout div [z-index:10, bg-background=#0D0D0D] ← OPAQUE — covers glows completely
    SidebarInset [bg-background=#0D0D0D]     ← also opaque
      Dashboard div [bg-background=#0D0D0D]  ← also opaque
        card-primary [backdrop-blur]          ← blurs opaque bg, not the glow!
```

**The fix:** Remove `bg-background` from the AppLayout shell, the SidebarInset override, and page component root wrappers. The `<body>` already applies `@apply bg-background` (via `theme.css @layer base`) — the #0D0D0D base color is provided by the body itself.

```
After fix:
  body            [bg-background=#0D0D0D]    ← provides base dark color
  body::before    [position:fixed, z-index:0] ← glow now visible
  body::after     [position:fixed, z-index:1] ← grain now visible
  AppLayout div   [z-index:10, bg-transparent] ← transparent!
    SidebarInset  [bg-transparent]            ← transparent!
      Dashboard div [transparent]             ← transparent!
        card-primary [backdrop-blur]          ← now blurs the actual glow! ✓
```

### Pattern 2: `.eyebrow` Utility vs Manual Tailwind

**What:** The project-specific `.eyebrow` class defined in `theme.css @layer base` encodes the canonical uppercase label treatment:

```css
/* theme.css line 241-247 */
.eyebrow {
  font-weight: 450;       /* Inter Variable non-standard weight */
  font-size: 0.6875rem;   /* 11px — smaller than text-xs (12px) */
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
```

The manual Tailwind on the MobileBottomNav section labels is:
```
text-xs font-semibold uppercase tracking-widest
```

This is *close but wrong*: `text-xs` = 12px (vs eyebrow's 11px), `font-semibold` = 600 (vs eyebrow's 450), `tracking-widest` ≈ 0.1em (vs eyebrow's 0.08em). The `.eyebrow` class uses Inter Variable weight 450 which is specifically chosen for this treatment.

**Fix:**
```tsx
// Before (MobileBottomNav.tsx line 243):
<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-4 pt-4 pb-1">

// After:
<p className="eyebrow text-muted-foreground px-4 pt-4 pb-1">
```

### Pattern 3: Inline Style vs CSS Cascade

**What:** React's `style` prop applies as an inline style with the highest specificity. On the LandingPage hero `<motion.h1>`, the inline `style={{ fontFamily: "Inter, system-ui, sans-serif" }}` was added historically as a defensive fallback when Inter wasn't loading reliably. Phase 14 fixed Inter loading globally — the inline style is now redundant AND creates a maintenance hazard (if `--font-family` ever changes in CSS, this element won't update).

**Fix:**
```tsx
// Before (LandingPage.tsx line 549-551):
<motion.h1
  className="mt-8 text-5xl sm:text-6xl md:text-7xl lg:text-8xl tracking-tight"
  style={{ fontFamily: "Inter, system-ui, sans-serif" }}

// After:
<motion.h1
  className="mt-8 text-5xl sm:text-6xl md:text-7xl lg:text-8xl tracking-tight"
```

### Anti-Patterns to Avoid

- **Changing `--background` to transparent:** Would break cards, modals, toasters, and any element using `bg-background` as a surface color. Do NOT touch the CSS variable — strip the `bg-background` class from elements that should not be opaque.
- **Applying `bg-transparent` globally via CSS:** Too broad. Apply it precisely to the three layers (AppLayout shell, SidebarInset override, page root wrappers).
- **Keeping `z-[10]` on AppLayout:** The z-index is correct — it must stay so content is above the fixed glow layers. Only the `bg-background` class must be removed.
- **Modifying `sidebar.tsx` (the shadcn/ui component):** SidebarInset is a shadcn primitive. Override it from the call site via `className="bg-transparent"` passed from `AppLayout.tsx` — do not edit the primitive itself.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Eyebrow label styling | Custom Tailwind utility classes | `.eyebrow` class (already in `theme.css`) | Canonical definition includes Inter Variable weight 450 which cannot be replicated with Tailwind's `font-semibold` |
| Font inheritance | Inline `style` prop | Global CSS cascade | Phase 14 already wired Inter globally — inline style fights the cascade |

---

## Common Pitfalls

### Pitfall 1: Stripping bg-background from Non-Authenticated Pages

**What goes wrong:** LandingPage, PrivacyPolicy, and ResetPassword also have `min-h-screen bg-background` patterns but they are NOT inside AppLayout (they render outside the ProtectedRoute boundary, where no SidebarInset exists). Stripping `bg-background` from them leaves them without any background — they appear transparent over whatever was previously rendered.

**Why it happens:** Grep results for `min-h-screen bg-background` include LandingPage, PrivacyPolicy, ResetPassword, which are in the same component directory but outside AppLayout.

**How to avoid:** Apply the strip only to authenticated page components (those inside the `<Route element={<AppLayout />}>` boundary in `routes/index.tsx`). Do NOT strip from: LandingPage.tsx, PrivacyPolicy.tsx, ResetPassword.tsx.

**Warning signs:** LandingPage hero becomes transparent/shows through to dashboard content after navigation.

**Authenticated page files to strip (16 total):**
- `Analytics.tsx` (2 instances)
- `CelebrationDemo.tsx` (1 instance)
- `Challenges.tsx` (2 instances)
- `Community.tsx` (1 instance)
- `ComparisonView.tsx` (6 instances)
- `CycleBuilder.tsx` (2 instances)
- `Dashboard.tsx` (2 instances)
- `Goals.tsx` (2 instances)
- `PersonalRecords.tsx` (3 instances)
- `Profile.tsx` (1 instance)
- `Recovery.tsx` (3 instances)
- `RoutineBuilder.tsx` (2 instances)
- `RoutinesEnhanced.tsx` (2 instances)
- `SessionDetail.tsx` (3 instances)
- `TrainingCycles.tsx` (3 instances)
- `WorkoutHistory.tsx` (3 instances)

**Total: approximately 38 instances across 16 files** (plus AppLayout.tsx shell div + SidebarInset override).

### Pitfall 2: Sticky Headers That Use bg-background/95 backdrop-blur

**What goes wrong:** Several page components have sticky headers with `bg-background/95 backdrop-blur-lg` for a frosted header effect. These are INTENTIONAL semi-transparent headers — do not strip their `bg-background/95`.

**Why it happens:** The grep `min-h-screen bg-background` is specific to root wrappers. The `/95` opacity modifier makes these easily distinguishable, but a broader search could catch them.

**How to avoid:** Only target the ROOT wrapper divs with `min-h-screen bg-background` — not interior sticky header divs with `bg-background/95` or similar.

**Warning signs:** Sticky page headers lose their frosted glass effect and become fully transparent.

**Example of what to KEEP (do NOT change):**
```tsx
// Analytics.tsx — sticky mobile header (keep bg-background/95)
<div className="sticky top-0 bg-background/95 backdrop-blur-lg z-10 px-4 py-3 border-b border-secondary">
```

### Pitfall 3: Navigation.tsx Deletion — Verify No Dynamic Imports

**What goes wrong:** Navigation.tsx has a deprecation comment saying no files import it, but dynamic `import()` calls or lazy loading would not be caught by static grep.

**Why it happens:** `React.lazy(() => import('./Navigation'))` would be missed by `grep -rn "from.*Navigation"`.

**How to avoid:** Run `grep -rn "Navigation" src/ --include="*.tsx"` and verify every match is either the deprecated file itself, a comment, or a different component (SetNavigation, NavigationMenu). Then delete the file and verify `npm run build` passes — build would fail if anything dynamically referenced it.

**Evidence from research:** The only references to "Navigation" in the codebase (outside Navigation.tsx itself) are:
- `SessionReplay.tsx` → imports `SetNavigation` (different component)
- `ui/navigation-menu.tsx` → Radix UI navigation menu primitive
- `WhatsNewBanner.tsx` → comment mentioning "Navigation" in text
- `WorkoutHistory.tsx` → comment about "Calendar Navigation"

All safe. Navigation.tsx is confirmed dead code.

### Pitfall 4: ComparisonView Has 6 Instances of Root bg-background

**What goes wrong:** ComparisonView.tsx has 6 separate `min-h-screen bg-background` wrappers (loading states + empty states + main return). Failing to update all 6 means the glow will show through some states but not others.

**Why it happens:** ComparisonView uses many conditional rendering paths, each with their own root wrapper.

**How to avoid:** After stripping, run `grep -c "min-h-screen bg-background" src/app/components/ComparisonView.tsx` and verify it returns 0.

---

## Code Examples

### Glow Occlusion Fix — AppLayout.tsx

```tsx
// src/app/routes/AppLayout.tsx

// BEFORE:
<div className="min-h-screen bg-background relative z-[10] flex w-full">

// AFTER (remove bg-background, keep z-[10] and relative):
<div className="min-h-screen relative z-[10] flex w-full">
```

### Glow Occlusion Fix — SidebarInset Override in AppLayout.tsx

```tsx
// src/app/routes/AppLayout.tsx
// Pass className to override SidebarInset's default bg-background

// BEFORE:
<SidebarInset>

// AFTER:
<SidebarInset className="bg-transparent">
```

### Glow Occlusion Fix — Page Component Root Wrappers

```tsx
// Pattern: strip " bg-background" from min-h-screen root wrappers in authenticated pages

// BEFORE (Dashboard.tsx, Analytics.tsx, Challenges.tsx, etc.):
<div className="min-h-screen bg-background pb-20 md:pb-8">

// AFTER:
<div className="min-h-screen pb-20 md:pb-8">
```

### Inline Style Removal — LandingPage.tsx

```tsx
// src/app/components/LandingPage.tsx line ~549-552

// BEFORE:
<motion.h1
  className="mt-8 text-5xl sm:text-6xl md:text-7xl lg:text-8xl tracking-tight"
  style={{ fontFamily: "Inter, system-ui, sans-serif" }}
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  transition={{ delay: 0.2 }}
>

// AFTER:
<motion.h1
  className="mt-8 text-5xl sm:text-6xl md:text-7xl lg:text-8xl tracking-tight"
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  transition={{ delay: 0.2 }}
>
```

### Eyebrow Class — MobileBottomNav.tsx

```tsx
// src/app/components/MobileBottomNav.tsx line ~243

// BEFORE:
<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-4 pt-4 pb-1">
  {group.label}
</p>

// AFTER:
<p className="eyebrow text-muted-foreground px-4 pt-4 pb-1">
  {group.label}
</p>
```

### Deletion Command — Navigation.tsx

```bash
# Verified safe: no imports found in codebase
rm src/app/components/Navigation.tsx
npm run build  # Must pass to confirm no dynamic references
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `bg-[#0D0D0D]` hardcoded on AppLayout | `bg-background` token (Phase 14, BUG-08) | Phase 14 Plan 01 | Introduced as prep for ambient glow — but missed that `bg-background` is still fully opaque |
| Horizontal top nav (Navigation.tsx) | AppSidebar (Phase 15) | Phase 15 Plan 01 | Navigation.tsx kept with deprecation comment — Phase 20 is the designated cleanup point |
| Manual `text-xs font-semibold uppercase tracking-widest` | `.eyebrow` utility class | `.eyebrow` defined in Phase 14 Plan 02 | MobileBottomNav drawer section labels were implemented before `.eyebrow` was canonical |
| Inline `style` for font-family | Global CSS cascade (Phase 14) | Phase 14 Plan 01 | Inline style was a pre-Phase-14 defensive fallback — now redundant and overrides the cascade unnecessarily |

**Deprecated/outdated:**
- `bg-background` on page component root wrappers: redundant — body already provides #0D0D0D base via `@apply bg-background` in `@layer base`
- `style={{ fontFamily: "Inter, system-ui, sans-serif" }}` on LandingPage hero h1: redundant since Phase 14 loaded Inter globally

---

## Open Questions

1. **Should bg-background/95 sticky headers also allow glow through?**
   - What we know: Sticky headers use `bg-background/95 backdrop-blur-lg` intentionally for a frosted effect
   - What's unclear: With the root wrapper now transparent, sticky headers at 95% opacity will show a slight amount of glow — this may look correct or may look inconsistent with the below-threshold glow at the edges
   - Recommendation: Leave sticky headers unchanged; they are intentionally different from page backgrounds. If they look wrong after the sweep, address in a follow-up.

2. **Does SidebarInset's `bg-background` need to remain for the inset sidebar variant?**
   - What we know: SidebarInset has `has-data-[variant=inset]:bg-sidebar` which only applies when variant=inset is set
   - What's unclear: The AppLayout does NOT use variant=inset, so this class is inactive in the current codebase
   - Recommendation: Safe to override with `bg-transparent` via className. The inset-variant conditional is a no-op in this app.

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection of `src/app/routes/AppLayout.tsx` — confirmed `z-[10] bg-background` at line 49
- Direct code inspection of `src/styles/theme.css` — confirmed `body::before` at z-index:0, `--background: #0D0D0D`
- Direct code inspection of `src/app/components/ui/sidebar.tsx` — SidebarInset default `bg-background` at line 310
- Direct code inspection of `src/app/components/LandingPage.tsx` — inline style at line 551
- Direct code inspection of `src/app/components/MobileBottomNav.tsx` — manual Tailwind at line 243
- `grep -rn` across all authenticated page components — confirmed 38 instances of root `min-h-screen bg-background`
- `grep -rn "Navigation"` across entire src/ — confirmed Navigation.tsx is dead code (no imports)
- `.planning/phases/14-css-foundation-typography/` plans and summaries — confirmed historical intent and gap

### Secondary (MEDIUM confidence)
- CSS specification: `position:fixed` elements paint in the root stacking context, not in any ancestor's stacking context — this is the fundamental reason the glow is covered by AppLayout's `bg-background`

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, existing utilities confirmed present
- Architecture (glow fix): HIGH — CSS stacking context behavior verified by direct code inspection; fix is mechanically correct
- Architecture (other 4 fixes): HIGH — each fix is one-line and directly observed in source
- Pitfalls: HIGH — all pitfalls identified from direct code inspection (non-authenticated files, sticky headers, ComparisonView count)

**Research date:** 2026-02-20
**Valid until:** 2026-03-20 (stable codebase, no fast-moving dependencies)
