# Design Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 2 Critical, 5 Major, and 6 Minor design issues identified in the Design for Hackers audit of phoenix-portal.

**Architecture:** Changes flow from token-level (theme.css) outward to component-level (Button variant) to page-level (sweep replacements). Each phase produces independently testable, committable work. No behavioral changes to business logic.

**Tech Stack:** React 19, Tailwind v4, shadcn/ui, CSS custom properties, Biome linter

---

## File Map

| File | Role | Tasks |
|------|------|-------|
| `src/styles/theme.css` | Design tokens, typography scale, card tiers | 1, 2 |
| `src/app/components/ui/button.tsx` | Button variant definitions | 3 |
| `src/app/components/Dashboard.tsx` | Dashboard page (progress, padding, empty states) | 4, 5, 8 |
| `index.html` | Font loading (Space Grotesk removal) | 6 |
| `src/app/components/LandingPage.tsx` | Landing page (Space Grotesk self-loading) | 6 |
| `src/app/components/ui/empty-state.tsx` | Empty state CTA button | 7 |
| ~50 files (see Task 7 notes) | Global `text-muted` sweep | 7 |
| ~28 files (see Task 9 notes) | Gradient button → `cta` variant | 9 |
| `src/app/components/AppSidebar.tsx` | Sidebar accessibility | 10 |

## Verification Commands

All tasks use these verification steps:

```bash
cd phoenix-portal
npm run typecheck          # TypeScript compilation
npx biome check src/       # Lint check
npm test -- --run           # Unit tests (non-watch)
```

Visual verification: run `npm run dev` and inspect affected pages in browser.

---

### Task 1: Fix Typography Scale and h2 Weight

**Principle:** Typographic hierarchy must use a consistent modular ratio. h3 at 16px is indistinguishable from body text. h2 at weight 625 is non-standard.

**Files:**
- Modify: `src/styles/theme.css:298-340` (typography hierarchy block)

- [ ] **Step 1: Update the typography scale in theme.css**

Replace the Typography hierarchy block (lines ~298-340) with a 1.25x Major Third scale anchored at 16px body:

```css
  /* Typography hierarchy — 1.25x Major Third scale, Inter Variable weights */
  h1 {
    font-size: 1.953rem;  /* ~31px — 16 * 1.25^3 */
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }

  h2 {
    font-size: 1.563rem;  /* ~25px — 16 * 1.25^2 */
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: -0.01em;
  }

  h3 {
    font-size: 1.25rem;   /* 20px — 16 * 1.25^1 */
    font-weight: 500;
    line-height: 1.35;
  }

  h4 {
    font-size: 1rem;      /* 16px — base */
    font-weight: 500;
    line-height: 1.5;
  }
```

Key changes from current:
- h1: 30px → 31px (negligible visual change)
- h2: 20px/625wt → 25px/600wt (bigger heading, standard weight)
- h3: 16px → 20px (now visually distinct from body)
- h4: 14px → 16px (was too small, now matches body size but with 500 weight)

- [ ] **Step 2: Run typecheck and lint**

```bash
cd phoenix-portal && npm run typecheck && npx biome check src/
```

Expected: PASS (CSS-only change, no TS impact)

- [ ] **Step 3: Visual verification**

Open `http://localhost:5173/dashboard` and `http://localhost:5173/analytics` in browser. Verify:
- Page titles ("Welcome back", "Analytics Hub") still look proportional
- Section headings ("Quick Stats", "Recent Activity") are now larger and distinct from body text
- No text overflow or layout breaks

- [ ] **Step 4: Commit**

```bash
git add src/styles/theme.css
git commit -m "fix(theme): adopt 1.25x Major Third type scale and standardize h2 weight to 600"
```

---

### Task 2: Fix Progress Decimal Formatting (Critical)

**Principle:** Displaying "11,009.446 / 50,000" exposes raw floating-point data. Numerical display precision must match conceptual precision.

**Files:**
- Modify: `src/app/components/Dashboard.tsx:308` (ActiveChallengesSection progress display)

- [ ] **Step 1: Write a failing test**

In `src/app/components/__tests__/Dashboard.test.tsx`, add or update a test that verifies challenge progress renders without decimals. If test infrastructure makes this difficult (mock-heavy), skip to step 3.

- [ ] **Step 2: Fix the progress formatting**

In `Dashboard.tsx`, find the `ActiveChallengesSection` component. Locate the line (around line 308):

```tsx
? `${progress.current.toLocaleString()} / ${progress.target.toLocaleString()}`
```

Replace with:

```tsx
? `${Math.round(progress.current).toLocaleString()} / ${Math.round(progress.target).toLocaleString()}`
```

- [ ] **Step 3: Fix the "--" empty state for Weekly Volume (Minor m4)**

In `Dashboard.tsx`, there are 3 occurrences of `"--"`:
- **Line 717** — Weekly Volume QuickStatCard: `weeklyTotal > 0 ? formatVolume(weeklyTotal, unit) : "--"` → **FIX THIS ONE**
- **Line 733** — Goals QuickStatCard: `value="--"` → **LEAVE AS-IS** (Goals feature is a placeholder)
- **Line 1029** — Mobile Weekly Volume: same pattern as line 717 → **FIX THIS ONE**

Replace line 717:
```tsx
// Before:
weeklyTotal > 0 ? formatVolume(weeklyTotal, unit) : "--"
// After:
formatVolume(weeklyTotal, unit)
```

Apply the same fix to line 1029 (mobile layout equivalent). `formatVolume(0, unit)` will render "0 lbs" or "0 kg" — clearer than "--".

- [ ] **Step 4: Run tests and typecheck**

```bash
cd phoenix-portal && npm run typecheck && npm test -- --run
```

Expected: PASS

- [ ] **Step 5: Visual verification**

Open dashboard, check Active Challenges section. Progress should show whole numbers (e.g., "11,009 / 50,000"). Weekly Volume should show "0 lbs" or "0 kg" instead of "--".

- [ ] **Step 6: Commit**

```bash
git add src/app/components/Dashboard.tsx
git commit -m "fix(dashboard): round challenge progress display, replace '--' with '0' for empty weekly volume"
```

---

### Task 3: Add `cta` Button Variant

**Principle:** Button style proliferation (4+ patterns) dilutes CTA hierarchy. Consolidate the gradient button pattern into a reusable variant.

**Files:**
- Modify: `src/app/components/ui/button.tsx` (add `cta` variant)

- [ ] **Step 1: Add the `cta` variant to buttonVariants**

In `button.tsx`, add a new variant inside the `variants.variant` object:

```tsx
variant: {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  destructive:
    "bg-destructive/60 text-white hover:bg-destructive/90 focus-visible:ring-destructive/40",
  outline:
    "border border-input bg-input/30 text-foreground hover:bg-input/50 hover:text-accent-foreground",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  ghost: "hover:bg-accent/50 hover:text-accent-foreground",
  link: "text-primary underline-offset-4 hover:underline",
  cta: "bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent text-white border-0",
},
```

- [ ] **Step 2: Run typecheck and lint**

```bash
cd phoenix-portal && npm run typecheck && npx biome check src/app/components/ui/button.tsx
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/components/ui/button.tsx
git commit -m "feat(ui): add cta button variant for gradient CTA buttons"
```

---

### Task 4: Fix Hardcoded Colors (Minor m3)

**Principle:** Hardcoded hex values like `[#D97706]`, `[#059669]`, `[#6366F1]`, `[#4F46E5]`, `[#92400E]` bypass the token system. There are 13 occurrences of `[#D97706]` across 5 files, plus other hardcoded hex values in Dashboard.tsx QuickStatCards.

**Files:**
- Modify: `src/app/components/Dashboard.tsx` (3x `#D97706`, 1x `#059669`, 1x `#6366F1`, 1x `#4F46E5`)
- Modify: `src/app/components/CelebrationDemo.tsx` (5x `#D97706`, 2x `#92400E`, 3x `#059669`)
- Modify: `src/app/components/Challenges.tsx` (1x `#D97706`, 1x `#059669`)
- Modify: `src/app/components/celebrations/BadgeEarned.tsx` (2x `#D97706`/`#92400E`)
- Modify: `src/app/components/celebrations/WorkoutComplete.tsx` (2x `#D97706`, 1x `#059669`)
- Modify: `src/app/components/Profile.tsx` (1x `#059669`)
- Modify: `src/app/components/PersonalRecords.tsx` (1x `#059669`)

- [ ] **Step 1: Replace hardcoded colors in Dashboard.tsx**

Replace in QuickStatCard gradients (around lines 462, 541, 712, 720, 735):
```tsx
// #D97706 is amber-600 — same hex, now tokenized
from-accent to-[#D97706]  →  from-accent to-amber-600
// #059669 is emerald-600
from-success to-[#059669]  →  from-success to-emerald-600
// #6366F1 is indigo-500, #4F46E5 is indigo-600
from-[#6366F1] to-[#4F46E5]  →  from-indigo-500 to-indigo-600
```

- [ ] **Step 2: Replace hardcoded colors in all other files**

Apply across CelebrationDemo.tsx, Challenges.tsx, BadgeEarned.tsx, WorkoutComplete.tsx, Profile.tsx, PersonalRecords.tsx:
```tsx
from-accent to-[#D97706]      →  from-accent to-amber-600
from-[#D97706] to-[#92400E]   →  from-amber-600 to-amber-800
to-[#D97706]/10               →  to-amber-600/10
from-success to-[#059669]     →  from-success to-emerald-600
to-[#059669]/10               →  to-emerald-600/10
```

Note: `#92400E` is amber-800 and `#059669` is emerald-600 in Tailwind's palette. Verify visually.

- [ ] **Step 3: Run typecheck and verify visually**

```bash
cd phoenix-portal && npm run typecheck
```

All replacements are exact hex matches to Tailwind named colors — zero visual change expected.

- [ ] **Step 4: Commit**

```bash
git add src/app/components/Dashboard.tsx src/app/components/CelebrationDemo.tsx src/app/components/Challenges.tsx src/app/components/celebrations/BadgeEarned.tsx src/app/components/celebrations/WorkoutComplete.tsx src/app/components/Profile.tsx src/app/components/PersonalRecords.tsx
git commit -m "fix(theme): replace 20+ hardcoded hex colors with Tailwind token equivalents"
```

---

### Task 5: Lazy-Load Space Grotesk Font

**Principle:** Space Grotesk (~20KB) is loaded for all users via index.html but only used on the landing page. Authenticated users (majority of sessions) waste the download.

**Files:**
- Modify: `index.html:10-14` (remove Space Grotesk from global font load)
- Modify: `src/app/components/LandingPage.tsx` (add font self-loading)

- [ ] **Step 1: Remove Space Grotesk from the Google Fonts link in index.html**

The current file (lines 10-14) has preconnect links plus a combined font URL. Keep preconnects, strip Space Grotesk from the URLs:

```html
<!-- Before (lines 10-14, loads both Inter + Space Grotesk): -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,100..900;1,100..900&family=Space+Grotesk:wght@300..700&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,100..900;1,100..900&family=Space+Grotesk:wght@300..700&display=swap">

<!-- After (Inter only — remove "&family=Space+Grotesk:wght@300..700" from both URLs): -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,100..900;1,100..900&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,100..900;1,100..900&display=swap">
```

- [ ] **Step 2: Add Space Grotesk self-loading to LandingPage.tsx**

At the top of the `LandingPage` component function, add a `useEffect` that loads the font:

```tsx
useEffect(() => {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap";
  document.head.appendChild(link);
  return () => {
    document.head.removeChild(link);
  };
}, []);
```

- [ ] **Step 3: Run typecheck and test**

```bash
cd phoenix-portal && npm run typecheck && npm test -- --run
```

Expected: PASS

- [ ] **Step 4: Visual verification**

1. Open `http://localhost:5173/` (landing page) — headings should still use Space Grotesk
2. Open `http://localhost:5173/dashboard` — Network tab should NOT load Space Grotesk

- [ ] **Step 5: Commit**

```bash
git add index.html src/app/components/LandingPage.tsx
git commit -m "perf(fonts): lazy-load Space Grotesk only on landing page, saving ~20KB for authenticated users"
```

---

### Task 6: Standardize Card Padding on Dashboard

**Principle:** Card padding inconsistency (p-4, p-5, p-6) within the same page breaks the grid alignment and makes cards feel ad-hoc.

**Files:**
- Modify: `src/app/components/Dashboard.tsx` (standardize padding)

- [ ] **Step 1: Audit and fix padding values**

In `Dashboard.tsx`, find all Card components and standardize:
- `QuickStatCard`: currently `p-4` → keep `p-4` (compact stat cards are fine smaller)
- `MobileRecentActivityCard`: currently `p-4` → keep `p-4`
- Welcome state cards (mobile): currently `p-5` → change to `p-6` (match desktop)
- Welcome state cards (desktop): already `p-6` → keep
- Section cards (streak, challenges, badges, recent activity, weekly volume, today's workout, goals, recovery): should all use `p-5` consistently

Search for `className="p-4 card-secondary` on section-level cards and change to `p-5`.

- [ ] **Step 2: Run typecheck**

```bash
cd phoenix-portal && npm run typecheck
```

- [ ] **Step 3: Visual verification**

Check dashboard on desktop. All section cards should have consistent internal spacing.

- [ ] **Step 4: Commit**

```bash
git add src/app/components/Dashboard.tsx
git commit -m "fix(dashboard): standardize card padding to p-5 for section cards, p-6 for welcome cards"
```

---

### Task 7: Global `text-muted` → `text-muted-foreground` Sweep (Critical)

**Principle:** `text-muted` applies the background token `--muted` (#838B98) as a text color, violating the shadcn semantic convention. Should be `text-muted-foreground` (#9CA3AF) for all text usage.

**Scope:** ~130+ occurrences across ~50 files.

**Files:**
- Modify: ~50 `.tsx` files (full list in audit grep results)
- **Preserve (do NOT modify):** 8 files with `placeholder:text-muted` (LandingPage, RoutineBuilder, ResetPassword, ComparisonSessionPicker, CommunitySearch, input.tsx, textarea.tsx, command.tsx)

**Important context-sensitive rules:**
- `text-muted` on text elements (`<div>`, `<span>`, `<p>`, headings) → replace with `text-muted-foreground`
- `text-muted` on icons (`<Trophy className="text-muted" />`) → replace with `text-muted-foreground` (icons follow same token convention)
- `placeholder:text-muted` → **KEEP AS-IS** (placeholder text is intentionally dimmer)
- Conditional expressions like `someCondition ? "text-amber-400" : "text-muted"` → replace the `"text-muted"` portion

- [ ] **Step 1: Create a safety branch**

```bash
cd phoenix-portal && git checkout -b design-audit-text-muted-sweep
```

- [ ] **Step 2: Run the global replacement using regex (primary approach)**

Use your editor's project-wide find-replace with regex. This is safer than `sed` on Windows:
- **Find regex:** `(?<!placeholder:)text-muted(?!-)`
  (negative lookbehind excludes `placeholder:text-muted`, negative lookahead excludes `text-muted-foreground`)
- **Replace:** `text-muted-foreground`
- **Scope:** `src/**/*.tsx`

If your tool doesn't support lookbehind, use two-pass:
1. Find: `text-muted(?!-)` → Replace: `text-muted-foreground` (scope: `src/**/*.tsx`)
2. Find: `placeholder:text-muted-foreground` → Replace: `placeholder:text-muted` (revert overreplacements)

- [ ] **Step 3: Verify placeholder: occurrences were preserved**

```bash
cd phoenix-portal
grep -rn "placeholder:text-muted" src/ --include="*.tsx" | head -20
```

Expected: All 8 files should show `placeholder:text-muted` (NOT `placeholder:text-muted-foreground`)

Verify no double-replacements:
```bash
grep -rn "text-muted-foreground-foreground" src/ --include="*.tsx"
```
Expected: zero matches

- [ ] **Step 4: Run typecheck and lint**

```bash
cd phoenix-portal && npm run typecheck && npx biome check src/
```

Expected: PASS (class name strings, no type impact)

- [ ] **Step 5: Run unit tests**

```bash
npm test -- --run
```

Expected: PASS (no behavioral changes)

- [ ] **Step 6: Visual spot-check**

Open these pages and verify muted text is visible (slightly lighter than before):
- Dashboard: timestamps, stat labels, empty states
- Challenges: empty states, progress labels
- Analytics: chart area "no data" messages
- Community: empty feed messages
- Profile: stat labels

The visual change is subtle: #838B98 → #9CA3AF (slightly lighter gray). Should improve readability without changing the visual character.

- [ ] **Step 7: Commit**

```bash
git add -u src/
git commit -m "fix(a11y): replace text-muted with text-muted-foreground across ~50 files

text-muted applied the background token --muted (#838B98) as text color,
violating shadcn semantic convention. text-muted-foreground (#9CA3AF)
is the correct text token with better contrast (7.6:1 vs 5.7:1)."
```

---

### Task 8: Apply `cta` Button Variant Across Codebase

**Principle:** Replace 53 inline gradient button class strings with the `cta` variant from Task 3.

**Scope:** 53 occurrences across 28 files.

**Files:**
- Modify: 28 `.tsx` files (full list in audit grep results)
- Also modify: `src/app/components/ui/empty-state.tsx` (uses gradient inline)

- [ ] **Step 1: Replace gradient class strings with variant="cta"**

There are two gradient patterns to handle:

**Variant 1 (with hover states, ~35 occurrences):**
`bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0`

**Variant 2 (without hover states, ~11 occurrences in empty-state.tsx, PersonalRecords, etc.):**
`bg-gradient-to-r from-primary to-chart-2 border-0`

Both map to the same `variant="cta"` since the hover behavior is now in the variant definition.

**Pattern A** — Button component with full hover gradient:
```tsx
// Before:
<Button className="w-full bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0">
// After:
<Button variant="cta" className="w-full">
```

**Pattern B** — Button component with gradient, no hover:
```tsx
// Before:
<Button className="bg-gradient-to-r from-primary to-chart-2 border-0">
// After:
<Button variant="cta">
```

**Pattern C** — Button with gradient + extra layout/spacing classes:
```tsx
// Before:
<Button className="mt-6 bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0">
// After:
<Button variant="cta" className="mt-6">
```

**Pattern D** — Non-Button elements using gradient (raw `<button>`, `<span>`, or gradient indicator lines):
Keep as-is. Only replace on `<Button>` components.

**Pattern E** — Inline gradient strings in non-className contexts (e.g., `className="px-4 py-1.5 text-sm font-medium rounded-lg bg-gradient-to-r from-primary to-chart-2 text-white"` on raw elements):
Keep as-is. These are custom elements, not using the Button component.

- [ ] **Step 2: Handle special cases**

Some buttons add extra gradient modifiers:
- `shadow-lg shadow-primary/50` on NextWorkoutWidget — keep the shadow, remove gradient:
  ```tsx
  <Button variant="cta" className="w-full shadow-lg shadow-primary/50">
  ```
- `btn-shimmer` on LandingPage hero — the landing hero CTA is intentionally special. Change to `variant="cta"` + keep `btn-shimmer`:
  ```tsx
  <Button variant="cta" size="lg" className="w-full sm:w-auto btn-shimmer">
  ```

- [ ] **Step 3: Run typecheck and lint**

```bash
cd phoenix-portal && npm run typecheck && npx biome check src/
```

- [ ] **Step 4: Run unit tests**

```bash
npm test -- --run
```

- [ ] **Step 5: Visual spot-check**

Open Dashboard, Challenges, Goals, and Landing pages. Verify gradient CTA buttons still look correct (same visual result, now from the variant).

- [ ] **Step 6: Commit**

```bash
git add -u src/
git commit -m "refactor(ui): consolidate ~46 gradient button instances into Button variant='cta'"
```

---

### Task 9: Sidebar Accessibility Fix (Minor m6)

**Principle:** In collapsed sidebar mode, nav items show only icons. The `tooltip` prop provides hover labels but no `aria-label` fallback for screen readers or touch devices where tooltips don't render.

**Files:**
- Modify: `src/app/components/AppSidebar.tsx:227-249` (nav item render loop)

- [ ] **Step 1: Add aria-label to collapsed nav items**

In the nav item render loop, add `aria-label` to the NavLink:

```tsx
<NavLink to={item.path} className="relative" aria-label={item.label}>
```

This provides screen reader text regardless of sidebar state. The visible `<span>` text is already hidden in collapsed mode via `group-data-[collapsible=icon]:hidden`.

- [ ] **Step 2: Run typecheck**

```bash
cd phoenix-portal && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/app/components/AppSidebar.tsx
git commit -m "fix(a11y): add aria-label to sidebar nav links for collapsed icon-only mode"
```

---

### Task 10: Apply Eyebrow Class to Dashboard Stat Labels (Minor m2)

**Principle:** The `.eyebrow` class (11px uppercase with tracking) is defined in theme.css but underutilized. Dashboard stat labels ("Total Workouts", "Personal Records") would benefit from this treatment.

**Files:**
- Modify: `src/app/components/Dashboard.tsx` (QuickStatCard label)

- [ ] **Step 1: Update QuickStatCard label styling**

In the `QuickStatCard` component, find the label element:

```tsx
// Before:
<div className="text-xs text-muted-foreground">{label}</div>

// After:
<div className="eyebrow text-muted-foreground">{label}</div>
```

The `.eyebrow` class provides `font-size: 0.6875rem` (11px), `letter-spacing: 0.08em`, `text-transform: uppercase`, `font-weight: 450`. This replaces `text-xs` (12px) with a more purposeful stat-label treatment.

- [ ] **Step 2: Visual verification**

Open dashboard. Stat labels ("TOTAL WORKOUTS", "PERSONAL RECORDS") should now be uppercase with wider tracking — matching the sidebar group labels.

- [ ] **Step 3: Commit**

```bash
git add src/app/components/Dashboard.tsx
git commit -m "fix(dashboard): apply eyebrow treatment to stat labels for stronger hierarchy"
```

---

## Execution Order and Dependencies

```
Task 1 (type scale) ─────────┐
Task 2 (progress fix) ───────┤
Task 3 (cta variant) ────────┤── All independent, can run in parallel
Task 4 (hardcoded color) ────┤
Task 5 (font loading) ───────┤
Task 6 (card padding) ───────┘
                              │
Task 7 (text-muted sweep) ───┤── Depends on nothing, but large scope — run after foundation tasks
                              │
Task 8 (cta variant apply) ──┤── Depends on Task 3
                              │
Task 9 (sidebar a11y) ───────┤── Independent
Task 10 (eyebrow labels) ────┘── Independent
```

**Estimated total time:** 60-90 minutes for an agent, 30-45 minutes for parallel execution with subagents.

**Risk notes:**
- Task 7 (text-muted sweep) is the highest-risk change due to scope (51 files). Use `git diff --stat` after the sweep to verify only `.tsx` files changed, and run the full test suite.
- Task 8 (cta variant) depends on Task 3 being committed first.
- Task 1 (type scale) may cause minor layout shifts on pages with tight vertical space — verify analytics and dashboard scroll behavior.
