# Landing Page Design Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevate the Phoenix Portal landing page from generic dark-dashboard to a visually distinctive, brand-coherent experience by introducing a display font, fixing color inconsistencies, refining spacing, and adding micro-interactions.

**Architecture:** Changes are concentrated in two files: `index.html` (font loading) and `src/styles/theme.css` (CSS variables, animations, utility classes). Component-level changes are all within `src/app/components/LandingPage.tsx`, modifying Tailwind classes and a single constant object. No new dependencies. No structural refactors.

**Tech Stack:** Google Fonts (Space Grotesk), Tailwind CSS v4, Framer Motion (existing), CSS keyframes

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `index.html` | Add Space Grotesk font loading |
| Modify | `src/styles/theme.css` | Display font CSS variable, shimmer animation, nav hover animation, eyebrow utility |
| Modify | `src/app/components/LandingPage.tsx` | All visual changes: font classes, badge colors, card spacing, nav styling, section rhythm, pricing, footer, CTA |
| Modify | `src/app/components/__tests__/LandingPage.test.tsx` | Add tests for new visual elements (eyebrow labels, badge colors) |

---

### Task 1: Add Space Grotesk Display Font

**Why Space Grotesk:** Geometric, angular letterforms with strong character at display sizes. Pairs well with Inter (humanist vs geometric contrast). Free variable font on Google Fonts. The angular geometry evokes forged metal and technical precision - fitting for a fitness data portal named after a mythical fire creature.

**Files:**
- Modify: `index.html:11-16`
- Modify: `src/styles/theme.css:1-3`

- [ ] **Step 1: Add Space Grotesk to font loading in index.html**

In `index.html`, replace the existing Google Fonts loading block (lines 11-16) with:

```html
<!-- Preconnect to Google Fonts domains for faster font loading -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <!-- Load Inter Variable (UI) + Space Grotesk Variable (display headings) -->
  <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,100..900;1,100..900&family=Space+Grotesk:wght@300..700&display=swap">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,100..900;1,100..900&family=Space+Grotesk:wght@300..700&display=swap">
```

- [ ] **Step 2: Add display font CSS variable in theme.css**

At the top of the `:root` block in `src/styles/theme.css`, after `--font-size: 16px;`, add:

```css
--font-display: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
```

- [ ] **Step 3: Register display font family with Tailwind v4 in theme.css**

In the `@theme inline` block, add:

```css
--font-family-display: var(--font-display);
```

**Important:** Tailwind v4 uses `--font-family-*` namespace for font families. Using `--font-*` would generate a `font-display` CSS descriptor (used in `@font-face`), not `font-family`. The `--font-family-display` registration produces the `font-family-display` Tailwind utility class.

- [ ] **Step 4: Verify font loads correctly**

Run: `npm run dev`

Open browser to `http://localhost:5173`. Open DevTools > Network > filter "fonts". Confirm both `Inter` and `SpaceGrotesk` woff2 files load. Inspect the h1 element and confirm `font-family` includes "Space Grotesk" when the class is applied (next task).

- [ ] **Step 5: Commit**

```bash
git add index.html src/styles/theme.css
git commit -m "feat(design): add Space Grotesk display font loading and CSS variable"
```

---

### Task 2: Apply Display Font to Landing Page Headlines

**Files:**
- Modify: `src/app/components/LandingPage.tsx:637-646` (hero h1)
- Modify: `src/app/components/LandingPage.tsx:732-733` (features heading)
- Modify: `src/app/components/LandingPage.tsx:779-780` (pricing heading)
- Modify: `src/app/components/LandingPage.tsx:876-877` (CTA heading)
- Modify: `src/app/components/LandingPage.tsx:818` (pricing dollar amounts)

- [ ] **Step 1: Add font-display to hero headline**

In `LandingPage.tsx`, find the hero h1 `className` (around line 638):

```tsx
className="mt-8 text-5xl sm:text-6xl md:text-7xl lg:text-8xl tracking-tight"
```

Change to:

```tsx
className="mt-8 text-5xl sm:text-6xl md:text-7xl lg:text-8xl tracking-tight font-family-display"
```

- [ ] **Step 2: Add font-display to section headings**

Find the features section heading (around line 732):
```tsx
<h2 className="text-4xl sm:text-5xl mb-4 text-white">
```
Change to:
```tsx
<h2 className="text-4xl sm:text-5xl mb-4 text-white font-family-display">
```

Find the pricing section heading (around line 779):
```tsx
<h2 className="text-4xl sm:text-5xl mb-4 text-white">
```
Change to:
```tsx
<h2 className="text-4xl sm:text-5xl mb-4 text-white font-family-display">
```

Find the CTA section heading (around line 876):
```tsx
<h2 className="text-4xl sm:text-5xl mb-6 text-white">
```
Change to:
```tsx
<h2 className="text-4xl sm:text-5xl mb-6 text-white font-family-display">
```

- [ ] **Step 3: Add font-display to pricing dollar amounts**

Find the pricing amount span (around line 818):
```tsx
<span className="text-5xl text-primary">{tier.price}</span>
```
Change to:
```tsx
<span className="text-5xl text-primary font-family-display font-bold tabular-nums">{tier.price}</span>
```

- [ ] **Step 4: Verify visually**

Open `http://localhost:5173` and scroll through the landing page. Confirm:
- Hero headline uses Space Grotesk (angular geometry, visibly different from Inter)
- Section headings ("Built for serious athletes.", "Choose Your Path", "Fan the flames.") use Space Grotesk
- Pricing dollar amounts ($15, $25) use Space Grotesk with bold weight
- Body text, nav links, feature descriptions all remain Inter

- [ ] **Step 5: Commit**

```bash
git add src/app/components/LandingPage.tsx
git commit -m "feat(design): apply display font to landing page headlines and pricing"
```

---

### Task 3: Fix EMBER Badge Color and Tier Badge Palette

**Context:** The `TIER_BADGE_STYLES` constant maps EMBER to green (`forge-green`), which contradicts the color name. EMBER should be orange/warm. The tiers should follow a heat progression: EMBER (warm orange) -> FLAME (deep red/crimson) -> INFERNO (gold/amber, the hottest).

**Files:**
- Modify: `src/app/components/LandingPage.tsx:67-72`
- Modify: `src/app/components/__tests__/LandingPage.test.tsx`

- [ ] **Step 1: Write test for tier badge rendering**

In `src/app/components/__tests__/LandingPage.test.tsx`, add after the existing test:

```tsx
it("renders feature cards with correct tier badges", () => {
  renderWithProviders(<LandingPage />);
  const badges = screen.getAllByText(/^(EMBER|FLAME|INFERNO)$/);
  expect(badges.length).toBeGreaterThanOrEqual(6);
  // EMBER badges should exist
  expect(screen.getAllByText("EMBER")).toHaveLength(2);
  // FLAME badges should exist
  expect(screen.getAllByText("FLAME")).toHaveLength(2);
  // INFERNO badges should exist
  expect(screen.getAllByText("INFERNO")).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify it passes with current code**

Run: `npx vitest run src/app/components/__tests__/LandingPage.test.tsx`

Expected: PASS (the badge text already exists; this test validates the structure before we change colors).

- [ ] **Step 3: Update TIER_BADGE_STYLES**

In `LandingPage.tsx`, find the `TIER_BADGE_STYLES` constant (around line 67-72):

```tsx
const TIER_BADGE_STYLES: Record<string, string> = {
	EMBER:
		"bg-[var(--color-forge-green)]/20 text-[var(--color-forge-green)] border-[var(--color-forge-green)]/30",
	FLAME: "bg-primary/20 text-primary border-primary/30",
	INFERNO: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};
```

Replace with:

```tsx
const TIER_BADGE_STYLES: Record<string, string> = {
	EMBER: "bg-primary/20 text-primary border-primary/30",
	FLAME: "bg-red-500/20 text-red-400 border-red-500/30",
	INFERNO: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};
```

This creates a heat progression: orange (EMBER) -> red (FLAME) -> amber/gold (INFERNO).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/components/__tests__/LandingPage.test.tsx`

Expected: PASS

- [ ] **Step 5: Verify visually**

Open the landing page and scroll to the features section. Confirm:
- "EMBER" badges are orange (matching the brand primary color)
- "FLAME" badges are red
- "INFERNO" badges are amber/gold

- [ ] **Step 6: Commit**

```bash
git add src/app/components/LandingPage.tsx src/app/components/__tests__/LandingPage.test.tsx
git commit -m "fix(design): correct EMBER badge color from green to orange, establish heat progression"
```

---

### Task 4: Add Section Rhythm with Eyebrow Labels

**Context:** Every section heading uses the same center-aligned pattern. Adding uppercase eyebrow labels above headings creates visual rhythm and provides context cues. The `.eyebrow` class is already defined in `theme.css` but unused on the landing page.

**Files:**
- Modify: `src/app/components/LandingPage.tsx:726-739` (features section)
- Modify: `src/app/components/LandingPage.tsx:773-785` (pricing section)
- Modify: `src/app/components/__tests__/LandingPage.test.tsx`

- [ ] **Step 1: Write test for eyebrow labels**

In `src/app/components/__tests__/LandingPage.test.tsx`, add:

```tsx
it("renders section eyebrow labels", () => {
  renderWithProviders(<LandingPage />);
  expect(screen.getByText("FEATURES")).toBeInTheDocument();
  expect(screen.getByText("PRICING")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/components/__tests__/LandingPage.test.tsx`

Expected: FAIL with "Unable to find an element with the text: FEATURES"

- [ ] **Step 3: Add eyebrow labels to feature and pricing sections**

In `LandingPage.tsx`, find the features section heading block (around line 726-739). The current code is:

```tsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true }}
  className="text-center mb-16"
>
  <h2 className="text-4xl sm:text-5xl mb-4 text-white font-family-display">
    Built for serious athletes.
  </h2>
  <p className="text-xl text-muted max-w-2xl mx-auto">
```

Add the eyebrow label before the h2:

```tsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true }}
  className="text-center mb-16"
>
  <p className="eyebrow text-primary mb-3">FEATURES</p>
  <h2 className="text-4xl sm:text-5xl mb-4 text-white font-family-display">
    Built for serious athletes.
  </h2>
  <p className="text-xl text-muted max-w-2xl mx-auto">
```

Similarly, find the pricing section heading (around line 773-785) and add:

```tsx
  <p className="eyebrow text-primary mb-3">PRICING</p>
  <h2 className="text-4xl sm:text-5xl mb-4 text-white font-family-display">
    Choose Your Path
  </h2>
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/components/__tests__/LandingPage.test.tsx`

Expected: PASS

- [ ] **Step 5: Verify visually**

Scroll to features and pricing sections. Confirm small uppercase "FEATURES" and "PRICING" labels appear above each section heading in the primary (orange) color with the eyebrow typography treatment (11px, 0.08em letter-spacing).

- [ ] **Step 6: Commit**

```bash
git add src/app/components/LandingPage.tsx src/app/components/__tests__/LandingPage.test.tsx
git commit -m "feat(design): add eyebrow labels above landing page section headings"
```

---

### Task 5: Add CTA Button Shimmer Animation

**Context:** The primary CTA "Get Started" button uses the same gradient as every other primary button in the app. Adding a shimmer sweep animation makes it feel special and draws the eye.

**Files:**
- Modify: `src/styles/theme.css` (add shimmer keyframes + utility)
- Modify: `src/app/components/LandingPage.tsx:678-687` (hero CTA)
- Modify: `src/app/components/LandingPage.tsx:889-898` (bottom CTA)

- [ ] **Step 1: Add shimmer keyframes and utility class to theme.css**

In `src/styles/theme.css`, inside the `@layer base` block, insert before the closing `}` of `@layer base` (line 360), after the `.border-secondary` block (lines 356-358):

```css
/* CTA shimmer sweep — draws attention to primary call-to-action */
@keyframes shimmer-sweep {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(200%);
  }
}

.btn-shimmer {
  position: relative;
  overflow: hidden;
}

.btn-shimmer::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    105deg,
    transparent 30%,
    rgba(255, 255, 255, 0.12) 45%,
    rgba(255, 255, 255, 0.18) 50%,
    rgba(255, 255, 255, 0.12) 55%,
    transparent 70%
  );
  animation: shimmer-sweep 3s ease-in-out infinite;
  pointer-events: none;
}
```

Also add the shimmer to the reduced-motion block (around line 430):

```css
.btn-shimmer::after {
  animation: none;
}
```

- [ ] **Step 2: Apply shimmer to hero CTA button**

In `LandingPage.tsx`, find the hero "Get Started" Button (around line 679):

```tsx
className="relative group w-full sm:w-auto bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent text-white border-0 shadow-lg shadow-primary/50 hover:shadow-xl hover:shadow-primary/70 transition-all duration-300"
```

Add `btn-shimmer` to the className:

```tsx
className="relative group w-full sm:w-auto bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent text-white border-0 shadow-lg shadow-primary/50 hover:shadow-xl hover:shadow-primary/70 transition-all duration-300 btn-shimmer"
```

- [ ] **Step 3: Apply shimmer to bottom CTA button**

Find the bottom "Get Started" Button (around line 892):

```tsx
className="w-full sm:w-auto bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent text-white border-0 shadow-lg shadow-primary/50 hover:shadow-xl hover:shadow-primary/70 text-lg px-8 py-6"
```

Add `btn-shimmer`:

```tsx
className="w-full sm:w-auto bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent text-white border-0 shadow-lg shadow-primary/50 hover:shadow-xl hover:shadow-primary/70 text-lg px-8 py-6 btn-shimmer"
```

- [ ] **Step 4: Verify visually**

Open the landing page. Watch the "Get Started" buttons. A subtle light sweep should move across the button every 3 seconds. It should be barely noticeable — a glint, not a disco.

- [ ] **Step 5: Verify reduced-motion**

In DevTools, enable "Emulate CSS media feature prefers-reduced-motion" (Rendering tab). Confirm the shimmer animation stops.

- [ ] **Step 6: Commit**

```bash
git add src/styles/theme.css src/app/components/LandingPage.tsx
git commit -m "feat(design): add shimmer sweep animation to landing page CTA buttons"
```

---

### Task 6: Refine Nav Bar

**Files:**
- Modify: `src/styles/theme.css` (nav link hover underline animation)
- Modify: `src/app/components/LandingPage.tsx:583-605` (nav links)
- Modify: `src/app/components/LandingPage.tsx:569-574` (scrolled state)

- [ ] **Step 1: Add nav link hover animation in theme.css**

In `src/styles/theme.css`, inside `@layer utilities` (after the existing utilities, around line 422), add:

```css
/* Landing nav link — expanding underline from center on hover */
.nav-link-landing {
  position: relative;
  padding-bottom: 2px;
}

.nav-link-landing::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 0;
  height: 1px;
  background: var(--primary);
  transition: width 200ms ease, left 200ms ease;
}

.nav-link-landing:hover::after {
  width: 100%;
  left: 0;
}
```

- [ ] **Step 2: Update nav link classes in LandingPage.tsx**

Find the three nav links in the landing page nav (around lines 584-605). Each currently has:

```tsx
className="text-sm text-muted-foreground hover:text-white transition-colors"
```

Change all three to:

```tsx
className="text-base font-medium text-muted-foreground hover:text-white transition-colors nav-link-landing"
```

Note: the third item is an `<a>` tag (Support link), the first two are `<button>` elements. Apply the same class to all three.

- [ ] **Step 3: Add ember glow border to scrolled nav state**

Find the scrolled nav className (around line 571-573):

```tsx
scrolled
  ? "bg-background/80 backdrop-blur-lg border-b border-secondary/50"
  : "bg-transparent"
```

Change to:

```tsx
scrolled
  ? "bg-background/80 backdrop-blur-lg border-b border-primary/15 shadow-[0_1px_12px_rgba(255,107,53,0.06)]"
  : "bg-transparent"
```

This replaces the dull gray border with a subtle ember-tinted border and glow when scrolled.

- [ ] **Step 4: Verify visually**

1. Load landing page, scroll down past the hero. Confirm the nav bar backdrop has a warm ember tint on the bottom border.
2. Hover over "Features", "Pricing", "Support" links. Confirm a small orange underline expands from center.
3. Confirm text is now `text-base font-medium` (slightly larger and heavier than before).

- [ ] **Step 5: Commit**

```bash
git add src/styles/theme.css src/app/components/LandingPage.tsx
git commit -m "feat(design): refine landing nav with hover underline and ember-tinted scroll state"
```

---

### Task 7: Tighten Feature Cards

**Files:**
- Modify: `src/app/components/LandingPage.tsx:750-763` (feature card template)

- [ ] **Step 1: Tighten feature card padding and spacing**

Find the feature card template (around line 750):

```tsx
<Card className="p-6 card-landing-feature group cursor-pointer h-full">
  <div className="flex items-center justify-between mb-4">
    <div className="w-11 h-11 rounded-full bg-primary/15 flex items-center justify-center ring-1 ring-primary/30">
      <feature.icon className="w-5 h-5 text-primary" />
    </div>
    <span
      className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${TIER_BADGE_STYLES[feature.badge]}`}
    >
      {feature.badge}
    </span>
  </div>
  <h3 className="text-xl mb-2 text-white">{feature.title}</h3>
  <p className="text-muted-foreground">{feature.description}</p>
</Card>
```

Change to:

```tsx
<Card className="p-5 card-landing-feature group cursor-pointer h-full">
  <div className="flex items-center justify-between mb-3">
    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center ring-1 ring-primary/25">
      <feature.icon className="w-5 h-5 text-primary" />
    </div>
    <span
      className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${TIER_BADGE_STYLES[feature.badge]}`}
    >
      {feature.badge}
    </span>
  </div>
  <h3 className="text-lg font-semibold mb-1.5 text-white">{feature.title}</h3>
  <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
</Card>
```

Changes:
- `p-6` -> `p-5` (less padding)
- `mb-4` -> `mb-3` (tighter icon-to-heading gap)
- Icon container: `w-11 h-11 rounded-full` -> `w-10 h-10 rounded-lg` (smaller, square-ish)
- `bg-primary/15` -> `bg-primary/10` (subtler icon background)
- `text-xl mb-2` -> `text-lg font-semibold mb-1.5` (slightly smaller, tighter heading)
- Description: added `text-sm leading-relaxed` (smaller but readable)

- [ ] **Step 2: Verify visually**

Scroll to features section. Confirm cards feel denser and more purposeful. There should be less dead space below the description text. Cards should still be comfortably readable.

- [ ] **Step 3: Commit**

```bash
git add src/app/components/LandingPage.tsx
git commit -m "feat(design): tighten feature card spacing and proportions"
```

---

### Task 8: Polish Footer Spacing and Separator

**Files:**
- Modify: `src/app/components/LandingPage.tsx:922-1036` (footer section)

- [ ] **Step 1: Add breathing room and ember separator to footer**

Find the footer opening tag (around line 923):

```tsx
<footer className="relative py-12 px-4 sm:px-6 lg:px-8 border-t border-secondary">
```

Change to:

```tsx
<footer className="relative pt-16 pb-12 px-4 sm:px-6 lg:px-8 border-t border-primary/10">
```

Changes: increased top padding from `py-12` to `pt-16 pb-12`, and changed the border from `border-secondary` (gray) to `border-primary/10` (faint ember).

- [ ] **Step 2: Reduce legal notice density**

Find the legal notice container (around line 1008):

```tsx
<div className="text-muted text-xs max-w-3xl mx-auto space-y-2">
```

Change to:

```tsx
<div className="text-muted text-[11px] max-w-3xl mx-auto space-y-1.5 leading-relaxed">
```

- [ ] **Step 3: Verify visually**

Scroll to the bottom of the page. Confirm:
- More breathing room between the "Fan the flames" CTA section and the footer
- Footer top border is warm-tinted (faint orange) instead of cold gray
- Legal text is slightly smaller and more compact

- [ ] **Step 4: Commit**

```bash
git add src/app/components/LandingPage.tsx
git commit -m "feat(design): polish footer spacing and separator color"
```

---

### Task 9: Run Full Test Suite and Final Verification

- [ ] **Step 1: Run all unit tests**

Run: `npx vitest run`

Expected: All tests pass, including the new LandingPage tests from Tasks 3 and 4.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: No errors.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 4: Run linter**

Run: `npx biome check src/app/components/LandingPage.tsx src/styles/theme.css`

Expected: No errors. If formatting issues, fix with `npx biome check --write`.

- [ ] **Step 5: Full visual walkthrough**

Open `http://localhost:5173` and verify the complete landing page:
1. Hero: Space Grotesk headline with gradient text, shimmer on CTA button
2. Scrolled nav: ember-tinted border, hover underlines on links
3. Features: "FEATURES" eyebrow label, orange EMBER badges, tighter cards
4. Pricing: "PRICING" eyebrow label, Space Grotesk price numbers with bold weight
5. CTA: shimmer on bottom "Get Started" button
6. Footer: warm separator, spacious top padding, compact legal text

- [ ] **Step 6: Commit any linting fixes if needed**

```bash
git add src/app/components/LandingPage.tsx src/styles/theme.css src/app/components/__tests__/LandingPage.test.tsx
git commit -m "chore: lint and format fixes for landing page design polish"
```
