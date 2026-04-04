# Tab Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate 6 competing tab active-state patterns across 17 consumer files by adding CVA variants to the base tabs component, then sweeping all consumers to use variants instead of ad-hoc className overrides.

**Architecture:** Add CVA variant support to `TabsList` (3 variants: `default`, `panel`, `underline`) and `TabsTrigger` (2 variants: `default`, `underline`), matching the pattern already used by `button.tsx`. The default trigger active state changes from nearly-invisible `bg-input/30` to solid `bg-primary` — this is the root cause fix that makes ad-hoc overrides unnecessary. Tab trigger radius changes from `rounded-xl` (10px) to `rounded-md` (4px) to match button radius. All 16 consumer files get sweept in one pass.

**Tech Stack:** React 19, Radix UI Tabs, class-variance-authority (CVA), Tailwind v4

---

## File Map

| File | Role | Task |
|------|------|------|
| `src/app/components/ui/tabs.tsx` | Base tab components — add CVA variants | 1 |
| `src/app/components/Analytics.tsx:1281` | Panel tabs, 4 triggers | 2 |
| `src/app/components/Biomechanics.tsx:341` | Panel tabs, dynamic set triggers | 2 |
| `src/app/components/Challenges.tsx:741` | Panel tabs (desktop), 2 triggers | 2 |
| `src/app/components/ExerciseProgress.tsx:265` | Panel tabs, dynamic triggers | 2 |
| `src/app/components/SummaryReport.tsx:331,360,398` | Panel tabs, 3 separate instances | 2 |
| `src/app/components/RoutinesEnhanced.tsx:133` | **Gradient tabs (user's flagged issue)** | 2 |
| `src/app/components/Community.tsx:296` | Panel tabs (desktop), subtle active | 2 |
| `src/app/components/Profile.tsx:436` | Panel tabs, subtle active, 4 triggers | 2 |
| `src/app/components/Challenges.tsx:534` | Underline tabs (mobile), 3 triggers | 3 |
| `src/app/components/Community.tsx:138` | Underline tabs (mobile), 2 triggers | 3 |
| `src/app/components/Goals.tsx:833` | Inline tabs with icons | 4 |
| `src/app/components/LandingPage.tsx:335` | Inline tabs (auth dialog) | 4 |
| `src/app/components/ComparisonView.tsx:569` | Inline tabs | 4 |
| `src/app/components/community/ShareContentDialog.tsx:197` | Inline tabs (dialog) | 4 |
| `src/app/components/integrations/HevyConnect.tsx:300` | Inline tabs | 4 |
| `src/app/components/integrations/StrongConnect.tsx:285` | Inline tabs | 4 |
| `src/app/components/session-replay/SessionReplay.tsx:209` | Inline tabs | 4 |
| `src/app/components/session-replay/PlaybackControls.tsx:64` | Compact tabs (speed selector) | 4 |
| `src/app/components/session-replay/SetNavigation.tsx:59` | Compact tabs | 4 |

## Variant Design

Three list variants and two trigger variants cover all current usage patterns:

| List Variant | Styling | Use Case |
|---|---|---|
| `default` | `bg-muted/40 rounded-lg p-[3px] h-9 w-fit` | Inline/dialog contexts, embedded controls |
| `panel` | `bg-surface-2 border border-secondary p-1 rounded-lg` | Primary page-level navigation tabs |
| `underline` | `bg-transparent border-b border-secondary` | Mobile horizontal-scroll tab bars |

| Trigger Variant | Active State | Radius |
|---|---|---|
| `default` | `bg-primary text-primary-foreground` (solid ember) | `rounded-md` (4px, matches buttons) |
| `underline` | `border-b-2 border-primary text-white` (bottom line) | `rounded-none` |

## Verification Commands

```bash
cd phoenix-portal
npm run typecheck          # TypeScript compilation
npx biome check src/       # Lint check
npm test -- --run          # Unit tests
```

Visual: run `npm run dev`, check these pages for consistent tab appearance:
- `/analytics` — 4-tab panel
- `/routines` — 2-tab panel (was gradient, now solid)
- `/challenges` — desktop panel + mobile underline
- `/community` — desktop panel + mobile underline
- `/profile` — 4-tab panel (was subtle, now solid)
- `/goals` — 3-tab inline with icons
- `/session-replay/:id` — inline tabs + compact speed selector

---

### Task 1: Rewrite tabs.tsx with CVA Variants

**Files:**
- Modify: `src/app/components/ui/tabs.tsx`

**Context:** The current `tabs.tsx` has a single hardcoded style per component. The `TabsTrigger` active state (`bg-input/30`) is nearly invisible, which is why every consumer overrides it differently. Adding CVA variants (same pattern as `button.tsx`) gives consumers named options instead of ad-hoc class dumps.

- [ ] **Step 1: Read the current tabs.tsx to confirm starting state**

```bash
cat src/app/components/ui/tabs.tsx
```

Verify it matches 66 lines with no existing CVA imports.

- [ ] **Step 2: Replace tabs.tsx with the CVA variant version**

Write the complete new file:

```tsx
"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "./utils";

function Tabs({
	className,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
	return (
		<TabsPrimitive.Root
			data-slot="tabs"
			className={cn("flex flex-col gap-2", className)}
			{...props}
		/>
	);
}

/* ── TabsList ── */

const tabsListVariants = cva(
	"text-muted-foreground flex items-center justify-center",
	{
		variants: {
			variant: {
				default: "bg-muted/40 h-9 w-fit rounded-lg p-[3px]",
				panel: "bg-surface-2 border border-secondary p-1 rounded-lg",
				underline:
					"bg-transparent gap-1 rounded-none p-0 h-auto border-b border-secondary",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function TabsList({
	className,
	variant,
	...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
	VariantProps<typeof tabsListVariants>) {
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			className={cn(tabsListVariants({ variant }), className)}
			{...props}
		/>
	);
}

/* ── TabsTrigger ── */

const tabsTriggerVariants = cva(
	"inline-flex items-center justify-center gap-1.5 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-ring focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default:
					"flex-1 h-[calc(100%-1px)] rounded-md border border-transparent px-2 py-1 text-secondary-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground",
				underline:
					"flex-1 rounded-none border-b-2 border-transparent px-4 py-3 text-secondary-foreground data-[state=active]:border-primary data-[state=active]:text-white",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function TabsTrigger({
	className,
	variant,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> &
	VariantProps<typeof tabsTriggerVariants>) {
	return (
		<TabsPrimitive.Trigger
			data-slot="tabs-trigger"
			className={cn(tabsTriggerVariants({ variant }), className)}
			{...props}
		/>
	);
}

/* ── TabsContent ── */

function TabsContent({
	className,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
	return (
		<TabsPrimitive.Content
			data-slot="tabs-content"
			className={cn("flex-1 outline-none", className)}
			{...props}
		/>
	);
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
```

Key changes from the original:
- Import `cva` and `VariantProps` from `class-variance-authority`
- `TabsList` gains `variant` prop: `default` | `panel` | `underline`
- `TabsTrigger` gains `variant` prop: `default` | `underline`
- Default trigger active state: `bg-input/30` (invisible) -> `bg-primary` (visible)
- Default trigger radius: `rounded-xl` (10px) -> `rounded-md` (4px, matches buttons)
- Removed duplicate `inline-flex`/`flex` conflict from TabsList base

- [ ] **Step 3: Run typecheck**

```bash
cd phoenix-portal && npm run typecheck
```

Expected: PASS. Existing consumers still compile — the `variant` prop is optional with defaults. The `className` override prop still works, so existing overrides don't break (they'll be redundant, cleaned up in Tasks 2-4).

- [ ] **Step 4: Commit**

```bash
git add src/app/components/ui/tabs.tsx
git commit -m "feat(ui): add CVA variants to TabsList and TabsTrigger

TabsList: default (inline), panel (page-level), underline (mobile)
TabsTrigger: default (solid primary active), underline (bottom border)
Default trigger active state changed from bg-input/30 to bg-primary.
Trigger radius changed from rounded-xl (10px) to rounded-md (4px)."
```

---

### Task 2: Sweep Panel-Style Tab Consumers (8 files, 12 instances)

**Files:**
- Modify: `src/app/components/Analytics.tsx:1281`
- Modify: `src/app/components/Biomechanics.tsx:341`
- Modify: `src/app/components/Challenges.tsx:741`
- Modify: `src/app/components/ExerciseProgress.tsx:265`
- Modify: `src/app/components/SummaryReport.tsx:331,360,398`
- Modify: `src/app/components/RoutinesEnhanced.tsx:133`
- Modify: `src/app/components/Community.tsx:296`
- Modify: `src/app/components/Profile.tsx:436`

**Context:** These pages all use `bg-surface-2 border border-secondary` on `TabsList` and some form of `data-[state=active]:bg-primary` on `TabsTrigger`. The `panel` variant on `TabsList` and the new default trigger active state handle all of this. Remove the overrides, add `variant="panel"`.

- [ ] **Step 1: Update Analytics.tsx**

Line 1281 — replace TabsList and clean 4 TabsTrigger classNames:

```tsx
// Before:
<TabsList className="bg-surface-2 border border-secondary p-1">
  <TabsTrigger value="overview" className="data-[state=active]:bg-primary">
  <TabsTrigger value="progress" className="data-[state=active]:bg-primary">
  <TabsTrigger value="body" className="data-[state=active]:bg-primary">
  <TabsTrigger value="performance" className="data-[state=active]:bg-primary">

// After:
<TabsList variant="panel">
  <TabsTrigger value="overview">
  <TabsTrigger value="progress">
  <TabsTrigger value="body">
  <TabsTrigger value="performance">
```

Remove `className` prop entirely from each TabsTrigger. Remove `className` from TabsList, replace with `variant="panel"`.

- [ ] **Step 2: Update Biomechanics.tsx**

Line 341 — this uses dynamic triggers with extra size classes. Keep the size overrides:

```tsx
// Before:
<TabsList className="bg-surface-2 border border-secondary">
  {sets.map((s, i) => (
    <TabsTrigger key={s.id} value={s.id}
      className="data-[state=active]:bg-primary data-[state=active]:text-white text-xs px-3">

// After:
<TabsList variant="panel">
  {sets.map((s, i) => (
    <TabsTrigger key={s.id} value={s.id}
      className="text-xs px-3">
```

Keep `text-xs px-3` (size overrides for compact set tabs). Remove active-state classes.

- [ ] **Step 3: Update Challenges.tsx desktop tabs**

Line 741 — 2 triggers:

```tsx
// Before:
<TabsList className="bg-surface-2 border border-secondary p-1">
  <TabsTrigger value="active" className="data-[state=active]:bg-primary">
  <TabsTrigger value="past" className="data-[state=active]:bg-primary">

// After:
<TabsList variant="panel">
  <TabsTrigger value="active">
  <TabsTrigger value="past">
```

- [ ] **Step 4: Update ExerciseProgress.tsx**

Line 265 — time-range triggers (1W/1M/3M/6M/1Y) with compact sizing:

```tsx
// Before:
<TabsList className="bg-surface-2 border border-secondary">
  {TIME_RANGES.map((r) => (
    <TabsTrigger key={r.label} value={r.label}
      className="data-[state=active]:bg-primary data-[state=active]:text-white text-xs px-3">

// After:
<TabsList variant="panel">
  {TIME_RANGES.map((r) => (
    <TabsTrigger key={r.label} value={r.label}
      className="text-xs px-3">
```

Keep `text-xs px-3` (size overrides for compact time-range tabs). Remove active-state classes.

- [ ] **Step 5: Update SummaryReport.tsx (3 instances)**

Lines 331, 360, 398 — all follow the same pattern:

```tsx
// Before (each instance):
<TabsList className="bg-surface-2 border border-secondary">
  <TabsTrigger value="..." className="data-[state=active]:bg-primary">

// After (each instance):
<TabsList variant="panel">
  <TabsTrigger value="...">
```

Apply to all 3 TabsList instances and their 6 total TabsTriggers.

- [ ] **Step 6: Update RoutinesEnhanced.tsx (kill the gradient)**

Line 133 — this is the user's primary complaint. The gradient `from-primary to-chart-2` is decorative and misuses Cable A/B semantic colors:

```tsx
// Before:
<TabsList className="bg-surface-2 border border-secondary mb-6">
  <TabsTrigger value="my-routines"
    className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary data-[state=active]:to-chart-2">
  <TabsTrigger value="favorites"
    className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary data-[state=active]:to-chart-2">

// After:
<TabsList variant="panel" className="mb-6">
  <TabsTrigger value="my-routines">
  <TabsTrigger value="favorites">
```

Keep `className="mb-6"` on TabsList (layout spacing). Remove all gradient classes from triggers.

- [ ] **Step 7: Update Community.tsx desktop tabs**

Line 296 — had subtle `bg-primary/20` active state, standardizing to solid:

```tsx
// Before:
<TabsList className="bg-surface-2 border border-secondary p-1">
  <TabsTrigger value="routines"
    className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
  <TabsTrigger value="cycles"
    className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">

// After:
<TabsList variant="panel">
  <TabsTrigger value="routines">
  <TabsTrigger value="cycles">
```

- [ ] **Step 8: Update Profile.tsx**

Line 436 — had subtle `bg-primary/20` active state, 4 triggers:

```tsx
// Before:
<TabsList className="bg-surface-2 border border-secondary p-1">
  <TabsTrigger value="stats"
    className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
  <TabsTrigger value="badges"
    className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
  <TabsTrigger value="integrations"
    className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
  <TabsTrigger value="settings"
    className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">

// After:
<TabsList variant="panel">
  <TabsTrigger value="stats">
  <TabsTrigger value="badges">
  <TabsTrigger value="integrations">
  <TabsTrigger value="settings">
```

- [ ] **Step 9: Run typecheck and lint**

```bash
cd phoenix-portal && npm run typecheck && npx biome check src/
```

Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/app/components/Analytics.tsx src/app/components/Biomechanics.tsx src/app/components/Challenges.tsx src/app/components/ExerciseProgress.tsx src/app/components/SummaryReport.tsx src/app/components/RoutinesEnhanced.tsx src/app/components/Community.tsx src/app/components/Profile.tsx
git commit -m "refactor(ui): migrate 8 files to TabsList variant='panel', remove ad-hoc overrides

Removes gradient active state from RoutinesEnhanced.
Standardizes subtle bg-primary/20 to solid bg-primary on Community/Profile.
All panel-style tabs now use the same visual treatment."
```

---

### Task 3: Sweep Underline-Style Tab Consumers (2 files)

**Files:**
- Modify: `src/app/components/Challenges.tsx:533-553`
- Modify: `src/app/components/Community.tsx:137-152`

**Context:** Mobile tab bars use a bottom-border underline pattern. The `underline` variant on both `TabsList` and `TabsTrigger` handles this. The wrapper `<div>` with `border-b` is now redundant for Community (TabsList provides the border), but Challenges needs the wrapper kept for `overflow-x-auto scrollbar-hide`.

- [ ] **Step 1: Update Challenges.tsx mobile tabs**

Lines 533-553. The wrapper div provides horizontal scrolling — keep it, but remove its `border-b border-secondary` since the underline TabsList variant provides it:

```tsx
// Before:
<div className="overflow-x-auto scrollbar-hide border-b border-secondary">
  <TabsList className="flex px-4 gap-1 bg-transparent">
    <TabsTrigger value="active"
      className="px-4 py-3 text-sm font-medium whitespace-nowrap data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-primary">
    <TabsTrigger value="past"
      className="px-4 py-3 text-sm font-medium whitespace-nowrap data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-primary">
    <TabsTrigger value="discover"
      className="px-4 py-3 text-sm font-medium whitespace-nowrap data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-primary">
  </TabsList>
</div>

// After:
<div className="overflow-x-auto scrollbar-hide">
  <TabsList variant="underline" className="px-4">
    <TabsTrigger variant="underline" value="active">
      Active
    </TabsTrigger>
    <TabsTrigger variant="underline" value="past">
      Past
    </TabsTrigger>
    <TabsTrigger variant="underline" value="discover">
      Discover
    </TabsTrigger>
  </TabsList>
</div>
```

Remove `border-b border-secondary` from the wrapper div. Replace TabsList className with `variant="underline" className="px-4"`. Replace all TabsTrigger classNames with `variant="underline"` (the variant includes padding, font, whitespace, and active state).

- [ ] **Step 2: Update Community.tsx mobile tabs**

Lines 137-152. The wrapper div ONLY has `border-b border-secondary` — it can be removed entirely since the underline TabsList variant provides the border:

```tsx
// Before:
<div className="border-b border-secondary">
  <TabsList className="flex w-full bg-transparent px-4 gap-1">
    <TabsTrigger value="routines"
      className="flex-1 py-3 text-sm font-medium data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-primary">
    <TabsTrigger value="cycles"
      className="flex-1 py-3 text-sm font-medium data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-primary">
  </TabsList>
</div>

// After (remove wrapper div):
<TabsList variant="underline" className="w-full px-4">
  <TabsTrigger variant="underline" value="routines">
    Routines
  </TabsTrigger>
  <TabsTrigger variant="underline" value="cycles">
    Cycles
  </TabsTrigger>
</TabsList>
```

- [ ] **Step 3: Run typecheck**

```bash
cd phoenix-portal && npm run typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/components/Challenges.tsx src/app/components/Community.tsx
git commit -m "refactor(ui): migrate mobile tabs to TabsList/TabsTrigger variant='underline'"
```

---

### Task 4: Sweep Inline/Dialog Tab Consumers (9 files)

**Files:**
- Modify: `src/app/components/Goals.tsx:833`
- Modify: `src/app/components/LandingPage.tsx:335`
- Modify: `src/app/components/ComparisonView.tsx:569`
- Modify: `src/app/components/community/ShareContentDialog.tsx:197`
- Modify: `src/app/components/integrations/HevyConnect.tsx:300`
- Modify: `src/app/components/integrations/StrongConnect.tsx:285`
- Modify: `src/app/components/session-replay/SessionReplay.tsx:209`
- Modify: `src/app/components/session-replay/PlaybackControls.tsx:64`
- Modify: `src/app/components/session-replay/SetNavigation.tsx:59`

**Context:** These use the `default` variant (no variant prop needed). The only change is removing `className="flex-1"` from triggers where present — the default trigger variant now includes `flex-1`. Compact/size overrides (`text-xs`, `px-3`, `h-8`, `h-9`, `min-w-[40px]`) are kept as className additions.

- [ ] **Step 1: Remove flex-1 from trigger classNames in 7 files**

These files all have `<TabsTrigger value="..." className="flex-1">`. Remove the `className="flex-1"` since the default variant includes `flex-1`:

**Goals.tsx:834,838,842** — 3 triggers, each has `className="flex-1"` plus an icon child. Remove className prop. Note: the SVG icon before text stays — it's a child, not a class.

```tsx
// Before:
<TabsTrigger value="frequency" className="flex-1">
  <Target className="w-4 h-4 mr-1" /> Frequency
</TabsTrigger>

// After:
<TabsTrigger value="frequency">
  <Target className="w-4 h-4 mr-1" /> Frequency
</TabsTrigger>
```

**LandingPage.tsx:336,339** — 2 triggers:
```tsx
// Before:
<TabsTrigger value="signin" className="flex-1">
// After:
<TabsTrigger value="signin">
```

**ComparisonView.tsx:570,573** — 2 triggers: remove `className="flex-1"`.

**ShareContentDialog.tsx:198,201** — 2 triggers: remove `className="flex-1"`.

**HevyConnect.tsx:301,305,309** — 3 triggers: remove `className="flex-1"`.

**StrongConnect.tsx:286,290** — 2 triggers: remove `className="flex-1"`.

**SessionReplay.tsx:210,213** — 2 triggers: remove `className="flex-1"`.

- [ ] **Step 2: Keep size overrides on compact tabs (2 files)**

**PlaybackControls.tsx:64-75** — Speed selector. Keep size overrides on both list and triggers:
```tsx
// No changes needed — className="h-9" on list and className="px-2 text-xs min-w-[40px]" on triggers
// are layout overrides, not active-state overrides. Leave as-is.
```

**SetNavigation.tsx:59-66** — Set/Session toggle. Same — keep `className="h-8"` on list and `className="px-3 text-xs"` on triggers.

These two files need no changes — they were already using the base styling with only size overrides, and those overrides are still valid.

- [ ] **Step 3: Run typecheck and lint**

```bash
cd phoenix-portal && npm run typecheck && npx biome check src/
```

Expected: PASS

- [ ] **Step 4: Run unit tests**

```bash
cd phoenix-portal && npm test -- --run
```

Expected: PASS (no behavioral changes, only className removals)

- [ ] **Step 5: Commit**

```bash
git add src/app/components/Goals.tsx src/app/components/LandingPage.tsx src/app/components/ComparisonView.tsx src/app/components/community/ShareContentDialog.tsx src/app/components/integrations/HevyConnect.tsx src/app/components/integrations/StrongConnect.tsx src/app/components/session-replay/SessionReplay.tsx
git commit -m "refactor(ui): remove redundant flex-1 className from inline tab triggers

Default TabsTrigger variant now includes flex-1. Compact tabs in
PlaybackControls and SetNavigation keep their size overrides."
```

---

### Task 5: Visual Verification Sweep

**Context:** All code changes are done. This task verifies every affected page renders correctly.

- [ ] **Step 1: Start dev server**

```bash
cd phoenix-portal && npm run dev
```

- [ ] **Step 2: Check panel-style tabs (should all look identical)**

Open each page and verify the tabs have:
- `bg-surface-2` container with subtle border
- Solid ember (#FF6B35) active state with white text
- `rounded-md` (4px) corners on triggers (matching buttons)
- No gradient, no subtle 20% opacity — solid and consistent

Pages to check:
- `/analytics` — 4 tabs (Overview, Progress, Body, Performance)
- `/routines` — 2 tabs (My Routines, Favorites) — **was gradient, now solid**
- `/challenges` — desktop view: 2 tabs (Active, Past)
- `/biomechanics` — dynamic set tabs
- `/profile` — 4 tabs — **was subtle bg-primary/20, now solid**
- `/community` — desktop view: 2 tabs (Routines, Cycles) — **was subtle, now solid**

- [ ] **Step 3: Check underline-style tabs (mobile viewport)**

Resize browser to < 768px width and check:
- `/challenges` — 3 underline tabs (Active, Past, Discover) with horizontal scroll
- `/community` — 2 underline tabs (Routines, Cycles) with bottom border

Verify: bottom border appears only under active tab, no background highlight.

- [ ] **Step 4: Check inline/dialog tabs**

- `/goals` — 3 tabs with icons (Frequency, Volume, PR) in the goal creation card
- Landing page auth dialog — Sign In / Sign Up tabs
- `/session-replay/:id` — Force/Velocity tabs + speed selector + set navigation

Verify: muted container background, solid ember active state, compact sizing preserved on speed/set selectors.

- [ ] **Step 5: Final lint and test run**

```bash
cd phoenix-portal && npm run typecheck && npx biome check src/ && npm test -- --run
```

Expected: all PASS.

---

## Execution Order

```
Task 1 (tabs.tsx rewrite) ── must be first, all other tasks depend on it
     │
     ├── Task 2 (panel sweep, 8 files)
     ├── Task 3 (underline sweep, 2 files)    ── Tasks 2-4 are independent of each other
     └── Task 4 (inline sweep, 7 files changed, 2 left as-is)
              │
              └── Task 5 (visual verification) ── after all sweeps complete
```

**Estimated time:** 25-35 minutes sequential, 15-20 minutes with parallel subagents on Tasks 2-4.

**Risk notes:**
- Task 1 changes the default active state for ALL tabs. Existing consumers with `className="data-[state=active]:bg-primary"` will see the override become redundant (no visual change). Consumers without any override (Goals, LandingPage, etc.) will see a visible improvement (previously invisible active state now shows solid ember).
- Task 2 changes the visual weight of Profile and Community desktop tabs from subtle (20% opacity) to solid. This is intentional — the subtle variant was inconsistent with the rest of the portal.
- Task 3 removes a wrapper `<div>` from Community mobile tabs. Verify no layout shift from the missing div.
