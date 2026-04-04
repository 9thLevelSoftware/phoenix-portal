# Design Quality Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 3 FAIL items and 10 actionable WARN items from the design-for-ai:hone quality audit.

**Architecture:** Changes span three layers: (1) HTML meta tags for SEO/social, (2) CSS utilities for fluid display sizes and minor color fix, (3) component-level heading consistency across ALL app page titles, semantic HTML, and dashboard composition improvements. Each task is self-contained and independently committable.

**Tech Stack:** React 19, Tailwind v4, CSS custom properties, semantic HTML

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `index.html` | Modify | Add meta description + OG/Twitter meta tags |
| `src/styles/theme.css` | Modify | Add fluid display utilities, fix sidebar hover #fff |
| `src/app/components/LandingPage.tsx` | Modify | Add role="presentation" to decorative hero image |
| `src/app/components/Dashboard.tsx` | Modify | Strengthen welcome section hierarchy, use fluid headings |
| `src/app/components/Analytics.tsx` | Modify | Use fluid heading on page title |
| `src/app/components/Community.tsx` | Modify | Use fluid heading on page title |
| `src/app/components/ComparisonView.tsx` | Modify | Use fluid heading on page title |
| `src/app/components/Biomechanics.tsx` | Modify | Use fluid heading on page title |
| `src/app/components/Challenges.tsx` | Modify | Use fluid heading on page title |
| `src/app/components/Goals.tsx` | Modify | Use fluid heading on page title (2 instances) |
| `src/app/components/PersonalRecords.tsx` | Modify | Use fluid heading on page title (2 instances) |
| `src/app/components/Recovery.tsx` | Modify | Use fluid heading on page title (2 instances) |
| `src/app/components/RoutinesEnhanced.tsx` | Modify | Use fluid heading on page title (2 instances) |
| `src/app/components/SessionDetail.tsx` | Modify | Use fluid heading on page title |
| `src/app/components/TrainingCycles.tsx` | Modify | Use fluid heading on page title (3 instances) |
| `src/app/components/WorkoutHistory.tsx` | Modify | Use fluid heading on page title (2 instances) |
| `src/app/components/CelebrationDemo.tsx` | Modify | Use fluid heading on page title |
| `src/app/components/Integrations.tsx` | Modify | Use fluid heading on page title |
| `src/app/components/PricingPlans.tsx` | Modify | Use fluid heading on page title |
| `src/app/components/Profile.tsx` | Modify | Use fluid heading on profile name |
| `src/app/components/NotFound.tsx` | Modify | Use fluid heading on 404 title |
| `src/app/components/FAQ.tsx` | Modify | Wrap in `<article>`, use fluid heading |
| `src/app/components/PrivacyPolicy.tsx` | Modify | Wrap in `<article>`, use fluid heading |
| `src/app/components/TermsOfService.tsx` | Modify | Wrap in `<article>`, use fluid heading |
| `src/styles/fonts.css` | Modify | Document Inter rationale and spacing system |

---

### Task 1: SEO Meta Tags

**Fixes:** S2 (FAIL: missing meta description), S12 (WARN: no OG/Twitter tags)

**Files:**
- Modify: `index.html:7-8`

- [ ] **Step 1: Add meta description and social tags to index.html**

In `index.html`, after the `<title>` tag (line 8), add:

```html
<meta name="description" content="Phoenix Portal — training companion dashboard for Vitruvian Trainer machines. View workouts, build routines, track personal records, and analyze performance data.">
<meta property="og:title" content="Phoenix Portal — Vitruvian Trainer Companion">
<meta property="og:description" content="Community-powered fitness dashboard. Sync workouts, build routines, track PRs, and visualize biomechanics from your Vitruvian Trainer.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://portal.phoenixproject.app">
<meta property="og:image" content="/phoenix-hero.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Phoenix Portal">
<meta name="twitter:description" content="Training companion dashboard for Vitruvian Trainer machines.">
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "fix(seo): add meta description and OG/Twitter social tags"
```

---

### Task 2: Fluid Display Utilities + CSS Polish

**Fixes:** P2/VH3 (FAIL: infrastructure for fluid display sizes), C5 (WARN: #fff in sidebar hover)

**Files:**
- Modify: `src/styles/theme.css:287,290,386`

- [ ] **Step 1: Add fluid display size utilities to theme.css**

In `src/styles/theme.css`, inside the `@layer base {}` block, after the eyebrow class (after line 386), add:

```css
  /*
   * Fluid display sizes — for page titles and section headings in app views.
   * Extends the Perfect Fourth scale (1.333x) above the h1 base level.
   * Use these instead of static Tailwind text-3xl/4xl/5xl on page headings.
   *
   * Display scale (above h1):
   *   .text-display-1: 37.9px → 50.5px   (1.333^4 from 16px base)
   *   .text-display-2: 28.4px → 37.9px   (same as h1 — alias for explicit use)
   */
  .text-display-1 {
    font-family: var(--font-display);
    font-size: clamp(2.369rem, 1.5rem + 3.5vw, 3.157rem);
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: -0.03em;
  }

  .text-display-2 {
    font-family: var(--font-display);
    font-size: clamp(1.777rem, 1.2rem + 2.5vw, 2.369rem);
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: -0.03em;
  }
```

- [ ] **Step 2: Fix sidebar hover to use token instead of hardcoded #fff**

In `src/styles/theme.css`, replace the two `#fff` instances in sidebar hover styles (lines 287 and 290). Use `var(--primary-foreground)` which resolves to `#FFFFFF` — preserves the intentional white-on-hover emphasis while using a design token.

Replace line 287:
```css
  color: #fff !important;
```
with:
```css
  color: var(--primary-foreground) !important;
```

Replace line 290:
```css
  color: #fff !important;
```
with:
```css
  color: var(--primary-foreground) !important;
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/styles/theme.css
git commit -m "fix(design): add fluid display utilities, replace hardcoded #fff with design token"
```

---

### Task 3: App Page Title Consistency (Complete Sweep)

**Fixes:** P2/VH3 (FAIL: inline text sizes bypass fluid scale)

**Scope:** ALL h1 page titles in the app that use static Tailwind text-3xl/4xl/5xl classes. This is a comprehensive sweep — no app page title should use static Tailwind text sizes after this task.

**Exclusions (intentionally NOT changed):**
- `LandingPage.tsx` headings — marketing display text with intentionally huge responsive sizes (text-5xl→8xl)
- `celebrations/` directory — display modals with intentionally large animated text
- Non-heading elements using text-3xl+ (data metrics with `font-data`, emoji sizes, pricing numbers)

**Replacement rules:**
- `text-4xl sm:text-5xl` or `text-4xl lg:text-5xl` → `text-display-1` (primary page titles, ~50px max)
- `text-3xl sm:text-4xl` or `text-3xl font-bold` → `text-display-2` (standard page titles, ~38px max)
- Remove redundant `font-bold`, `tracking-tight` when present (already in the display utility)

**Files and replacements:**

- [ ] **Step 1: Dashboard.tsx (3 h1 instances)**

```
Line ~397: <h1 className="text-3xl font-bold mb-3 text-white">
  → <h1 className="text-display-2 mb-3 text-white">

Line ~491: <h1 className="text-4xl sm:text-5xl mb-4 text-white">
  → <h1 className="text-display-1 mb-4 text-white">

Line ~879: <h1 className="text-4xl lg:text-5xl font-bold tracking-tight mb-2">
  → <h1 className="text-display-1 mb-2">
```

- [ ] **Step 2: Analytics, Community, ComparisonView, Biomechanics**

```
Analytics.tsx ~1133: <h1 className="text-3xl sm:text-4xl mb-2 text-white">
  → <h1 className="text-display-2 mb-2 text-white">

Community.tsx ~274: <h1 className="text-3xl sm:text-4xl mb-2 text-white">
  → <h1 className="text-display-2 mb-2 text-white">

ComparisonView.tsx ~520: <h1 className="text-3xl sm:text-4xl mb-2 text-white">
  → <h1 className="text-display-2 mb-2 text-white">

Biomechanics.tsx ~595: <h1 className="text-3xl font-bold text-white">
  → <h1 className="text-display-2 text-white">
```

- [ ] **Step 3: Challenges, Goals, PersonalRecords**

```
Challenges.tsx ~725: <h1 className="text-3xl sm:text-4xl mb-2 text-white">
  → <h1 className="text-display-2 mb-2 text-white">

Goals.tsx ~365: <h1 className="text-3xl sm:text-4xl mb-2 text-white">
  → <h1 className="text-display-2 mb-2 text-white">

Goals.tsx ~401: <h1 className="text-3xl sm:text-4xl mb-2 text-white">
  → <h1 className="text-display-2 mb-2 text-white">

PersonalRecords.tsx ~258: <h1 className="text-3xl sm:text-4xl text-white">
  → <h1 className="text-display-2 text-white">

PersonalRecords.tsx ~286: <h1 className="text-3xl sm:text-4xl text-white">
  → <h1 className="text-display-2 text-white">
```

- [ ] **Step 4: Recovery, RoutinesEnhanced, SessionDetail**

```
Recovery.tsx ~115: <h1 className="text-3xl sm:text-4xl mb-2 flex items-center gap-3">
  → <h1 className="text-display-2 mb-2 flex items-center gap-3">

Recovery.tsx ~227: <h1 className="text-3xl sm:text-4xl mb-2 flex items-center gap-3">
  → <h1 className="text-display-2 mb-2 flex items-center gap-3">

RoutinesEnhanced.tsx ~79: <h1 className="text-3xl sm:text-4xl mb-2 text-white">
  → <h1 className="text-display-2 mb-2 text-white">

RoutinesEnhanced.tsx ~111: <h1 className="text-3xl sm:text-4xl mb-2 text-white">
  → <h1 className="text-display-2 mb-2 text-white">

SessionDetail.tsx ~236: <h1 className="text-3xl sm:text-4xl mb-2 text-white">
  → <h1 className="text-display-2 mb-2 text-white">
```

- [ ] **Step 5: TrainingCycles, WorkoutHistory, remaining pages**

```
TrainingCycles.tsx ~62: <h1 className="text-3xl sm:text-4xl mb-2 text-white">
  → <h1 className="text-display-2 mb-2 text-white">

TrainingCycles.tsx ~93: <h1 className="text-3xl sm:text-4xl mb-2 text-white">
  → <h1 className="text-display-2 mb-2 text-white">

TrainingCycles.tsx ~132: <h1 className="text-3xl sm:text-4xl mb-2 text-white">
  → <h1 className="text-display-2 mb-2 text-white">

WorkoutHistory.tsx ~306: <h1 className="text-3xl sm:text-4xl mb-2 text-white">
  → <h1 className="text-display-2 mb-2 text-white">

WorkoutHistory.tsx ~339: <h1 className="text-3xl sm:text-4xl mb-2 text-white">
  → <h1 className="text-display-2 mb-2 text-white">

CelebrationDemo.tsx ~34: <h1 className="text-3xl sm:text-4xl mb-2 text-white">
  → <h1 className="text-display-2 mb-2 text-white">

Integrations.tsx ~88: <h1 className="text-3xl font-bold">
  → <h1 className="text-display-2">

PricingPlans.tsx ~352: <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
  → <h1 className="text-display-2 text-white mb-3">

Profile.tsx ~343: <h1 className="text-3xl text-white mb-2">
  → <h1 className="text-display-2 text-white mb-2">

NotFound.tsx ~10: <h1 className="text-4xl font-bold text-white mb-2">
  → <h1 className="text-display-1 text-white mb-2">

FAQ.tsx ~262: <h1 className="text-4xl sm:text-5xl">
  → <h1 className="text-display-1">

PrivacyPolicy.tsx ~39: <h1 className="text-4xl sm:text-5xl mb-4 text-white">
  → <h1 className="text-display-1 mb-4 text-white">

TermsOfService.tsx ~41: <h1 className="text-4xl sm:text-5xl mb-4">
  → <h1 className="text-display-1 mb-4">
```

- [ ] **Step 6: Run tests**

Run: `npm test -- --run`
Expected: All 485 tests pass. These are className-only changes.

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/app/components/Dashboard.tsx src/app/components/Analytics.tsx \
  src/app/components/Community.tsx src/app/components/ComparisonView.tsx \
  src/app/components/Biomechanics.tsx src/app/components/Challenges.tsx \
  src/app/components/Goals.tsx src/app/components/PersonalRecords.tsx \
  src/app/components/Recovery.tsx src/app/components/RoutinesEnhanced.tsx \
  src/app/components/SessionDetail.tsx src/app/components/TrainingCycles.tsx \
  src/app/components/WorkoutHistory.tsx src/app/components/CelebrationDemo.tsx \
  src/app/components/Integrations.tsx src/app/components/PricingPlans.tsx \
  src/app/components/Profile.tsx src/app/components/NotFound.tsx \
  src/app/components/FAQ.tsx src/app/components/PrivacyPolicy.tsx \
  src/app/components/TermsOfService.tsx
git commit -m "fix(design): apply fluid display utilities to all app page titles (complete sweep)"
```

---

### Task 4: Dashboard Composition

**Fixes:** CO4 (WARN: dashboard lacks dominant element), CO5 (WARN: card uniformity)

**Files:**
- Modify: `src/app/components/Dashboard.tsx:874-890`

**Approach:** The desktop welcome section (line 874, `<motion.div className="mb-10">`) should be the clear visual anchor. Add a bottom border to separate it as a "hero zone" from the content grid. The welcome heading was already updated to `text-display-1` in Task 3.

- [ ] **Step 1: Add visual separation to welcome section**

In `src/app/components/Dashboard.tsx`, find line ~874:
```tsx
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						className="mb-10"
					>
```
Replace with:
```tsx
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						className="mb-8 pb-8 border-b border-border"
					>
```

This adds a subtle bottom border and extra bottom padding, creating a visual "welcome zone" that anchors the top of the dashboard as the dominant compositional element.

- [ ] **Step 2: Visual verification**

Run: `npm run dev`
Navigate to the dashboard. Verify:
- Welcome section clearly dominates the view
- A subtle border separates the welcome zone from the content grid below
- The overall layout has a clear top-down hierarchy: welcome → stats → content

- [ ] **Step 3: Run tests**

Run: `npm test -- --run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/components/Dashboard.tsx
git commit -m "fix(design): add visual separation to dashboard welcome zone for compositional hierarchy"
```

---

### Task 5: Semantic HTML on Content Pages

**Fixes:** S10 (WARN: missing `<article>`)

**Files:**
- Modify: `src/app/components/FAQ.tsx`
- Modify: `src/app/components/PrivacyPolicy.tsx`
- Modify: `src/app/components/TermsOfService.tsx`

Note: Heading changes for these files are handled in Task 3 Step 5. This task only adds `<article>` wrappers.

**Approach:** Wrap the self-contained content section in `<article>`. The `<article>` goes inside the existing `<main>` element, around the content body (not the page header/navigation). In all three files, the content body is inside a `<div className="space-y-8">` — wrap that div in `<article>`.

- [ ] **Step 1: Add `<article>` to FAQ.tsx**

Find the FAQ content area (the Accordion component and its wrapper). Wrap in `<article>`:

```tsx
<article>
  {/* FAQ accordion and content - existing code */}
</article>
```

Place `<article>` around the content section, not around the entire page (header/nav stays outside).

- [ ] **Step 2: Add `<article>` to PrivacyPolicy.tsx**

Find the policy text content (the `<div className="space-y-8">` containing the policy sections). Wrap it in `<article>`.

- [ ] **Step 3: Add `<article>` to TermsOfService.tsx**

Same pattern as PrivacyPolicy — wrap the `<div className="space-y-8">` in `<article>`.

- [ ] **Step 4: Run tests**

Run: `npm test -- --run`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/FAQ.tsx src/app/components/PrivacyPolicy.tsx src/app/components/TermsOfService.tsx
git commit -m "fix(a11y): wrap content pages in article elements for semantic HTML"
```

---

### Task 6: Hero Image Accessibility

**Fixes:** S6 (hero image alt text clarity)

**Files:**
- Modify: `src/app/components/LandingPage.tsx:626-629`

The hero image has `alt=""` and `opacity: 0.3` — it IS decorative. `alt=""` is the correct WAI pattern. Adding `role="presentation"` makes the intent explicit.

- [ ] **Step 1: Add role="presentation" to hero image**

In `src/app/components/LandingPage.tsx`, find line ~626-629:
```tsx
<img
    src="/phoenix-hero.png"
    alt=""
    className="absolute inset-0 w-full h-full object-cover opacity-30"
/>
```
Replace with:
```tsx
<img
    src="/phoenix-hero.png"
    alt=""
    role="presentation"
    className="absolute inset-0 w-full h-full object-cover opacity-30"
/>
```

- [ ] **Step 2: Run tests**

Run: `npm test -- --run`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/components/LandingPage.tsx
git commit -m "fix(a11y): mark decorative hero image with role=presentation"
```

---

### Task 7: Documentation

**Fixes:** P5 (WARN: document spacing system), AI6 (WARN: document Inter rationale)

**Files:**
- Modify: `src/styles/fonts.css`

- [ ] **Step 1: Update fonts.css header comment**

Replace the existing header comment in `src/styles/fonts.css` with the expanded version that documents:
- Inter rationale (why an "AI default" font is retained with justification)
- Spacing system decision (Tailwind 4px ordinal, not compound-ratio proportional)

```css
/* Phoenix Typography — Three-font system
 *
 * Display:  Chakra Petch — angular, squared terminals, mechanical.
 *           Used for headings h1-h3 and .text-display-1/2 utilities.
 *           Extreme structural contrast with Inter (Design for Hackers, Appendix A).
 * UI/Body:  Inter — realist sans-serif, screen-optimized.
 *           Used for body text, labels, buttons, inputs.
 *           Inter is a common "AI default" font, but retained here because:
 *           (1) designed specifically for screens (Ch. 3 medium-form match),
 *           (2) large x-height + open counters for data-dense dashboard,
 *           (3) variable font with tabular figures for metrics,
 *           (4) paired with distinctive Chakra Petch display font that
 *               eliminates the "generic AI" impression.
 * Data:     JetBrains Mono — monospace, tabular figures.
 *           Used for metrics, values, readouts.
 *
 * Pairing: Inter (realist, rounded 'n') + Chakra Petch (geometric-angular,
 *   blocky 'n') = extreme structure contrast — the valid exception to the
 *   one-serif-one-sans rule (Appendix A).
 *
 * Type scale: Perfect Fourth (1.333x) = 3:4 ratio (Ch. 5).
 *
 * Spacing: Tailwind 4px base unit (ordinal, not proportional).
 *   Hierarchy: space-y-2 (8px) within → space-y-4 (16px) between →
 *   space-y-6 (24px) sections → gap-8 (32px) major breaks.
 */
```

- [ ] **Step 2: Commit**

```bash
git add src/styles/fonts.css
git commit -m "docs(design): document Inter rationale and spacing system decisions"
```

---

## Quality Audit Items NOT Addressed (With Rationale)

| Item | Why Not | Action |
|------|---------|--------|
| T11: Eyebrow weight 450 | Weight 450 renders correctly on Inter (variable font, 100-900 range). Eyebrow class uses Inter, not Chakra Petch. Not a real issue. | None |
| T12: Both fonts sans-serif | Documented in fonts.css as intentional extreme contrast | None |
| MO7: Celebration particle count | Low severity; celebrations are rare high-impact moments | Monitor |
| RE6: Container queries unused | `.cq-container` utilities exist; adoption is per-component as needed | Incremental |
| S11: Charts lack `<figure>` | 20+ chart instances; requires per-chart wrapping | Future sprint |
