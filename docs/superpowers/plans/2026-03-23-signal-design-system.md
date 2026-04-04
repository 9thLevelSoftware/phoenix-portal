# Signal Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the portal's AI-generic aesthetic (glassmorphism, glow, gradient-everything, bounce) with "The Signal" — an instrument-panel design language built around bilateral cable data, monospace data typography, and Night Shift density.

**Architecture:** The design system lives in 4 core files (theme.css, fonts.css, colors.ts, animations.ts) plus one component (button.tsx CTA variant). Changes propagate through CSS variables and Tailwind utility classes, so most component files only need class name swaps, not structural changes. The landing page retains the phoenix-hero.png background and Space Grotesk display font — it's the marketing surface, not the instrument panel.

**Tech Stack:** Tailwind CSS v4 (via @theme inline), CSS custom properties, Framer Motion presets, JetBrains Mono (monospace data font), React/TypeScript components.

**Constraint:** The phoenix-hero.png background image on the landing page MUST be preserved. The landing page can use the Signal palette but keeps its hero image and display font.

---

## File Structure

### Core Design System (modify)
| File | Responsibility | Changes |
|------|---------------|---------|
| `src/styles/theme.css` | CSS variables, card tiers, glow/glass utilities, animations, body ambient | Replace palette, remove glow/glass, add signal utilities, new card style, new body treatment |
| `src/styles/fonts.css` | Font stack definitions | Add JetBrains Mono, update --font-sans, add --font-data |
| `src/lib/colors.ts` | Programmatic color constants | Update PHOENIX, SURFACE, SEMANTIC, add CABLE, SIGNAL |
| `src/lib/animations.ts` | Framer Motion presets | Remove bouncy, adjust springs to be snappier, remove glow hover |
| `index.html` | Font loading | Add JetBrains Mono Google Font link |

### Components — Class Swaps (modify)
| File | Pattern to Replace |
|------|-------------------|
| `src/app/components/ui/button.tsx` | CTA variant: gradient → solid |
| `src/app/components/ui/unsaved-changes-dialog.tsx` | Save button gradient → solid |
| `src/app/components/Dashboard.tsx` | glass-panel, glow-text, glow-box, card-hero, card-secondary, from-primary to-chart-2 |
| `src/app/components/GoalDashboardWidget.tsx` | card-primary → signal-panel |
| `src/app/components/RecoveryDashboardWidget.tsx` | card-primary → signal-panel |
| `src/app/components/LandingPage.tsx` | Gradient text → solid text with --cable-a color (keep hero image, keep Space Grotesk) |
| `src/app/components/FAQ.tsx` | Gradient text → solid, backdrop-blur nav → solid bg |
| `src/app/components/TermsOfService.tsx` | Gradient text → solid |
| `src/app/components/PersonalRecords.tsx` | Gradient badges/buttons, hover:scale-105 |
| `src/app/components/WorkoutHistory.tsx` | Gradient badges/buttons, hover:scale-110 |
| `src/app/components/PricingPlans.tsx` | Gradient buttons → solid |
| `src/app/components/TrainingCycles.tsx` | Gradient badge → solid |
| `src/app/components/Challenges.tsx` | Gradient badge/button |
| `src/app/components/SessionDetail.tsx` | Gradient icon container |
| `src/app/components/Profile.tsx` | Avatar gradient, progress bar gradient, button gradients |
| `src/app/components/RoutineBuilder.tsx` | Gradient badge conditionals |
| `src/app/components/AppSidebar.tsx` | Avatar gradient |
| `src/app/components/MobileBottomNav.tsx` | Active indicator gradient |
| `src/app/components/CelebrationDemo.tsx` | Gradient buttons, hover:scale-105 |
| `src/app/components/community/CommentThread.tsx` | Avatar gradient |
| `src/app/components/community/CommunityDetailDrawer.tsx` | Avatar gradient |
| `src/app/components/community/CommunityFeedCard.tsx` | Avatar gradient |
| `src/app/components/community/CreatorProfile.tsx` | Avatar gradient, skeleton pulse |
| `src/app/components/community/FeaturedCreators.tsx` | Avatar gradient |
| `src/app/components/RoutineDetail.tsx` | Card gradient |
| `src/app/components/community/RoutinePicker.tsx` (cycle-builder) | Gradient |
| `src/app/components/modals/RoutinePickerModal.tsx` | Gradient |

---

## Phase 1: Core Design System (Tasks 1-4)

### Task 1: Font Stack — Add JetBrains Mono

**Files:**
- Modify: `index.html:9-14`
- Modify: `src/styles/fonts.css:1-11`
- Modify: `src/styles/theme.css:3` (--font-display variable)

- [ ] **Step 1: Add JetBrains Mono to index.html**

Add the Google Fonts link for JetBrains Mono alongside Inter:

```html
<!-- Load Inter Variable (UI) + JetBrains Mono (data) -->
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,100..900;1,100..900&family=JetBrains+Mono:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,100..900;1,100..900&family=JetBrains+Mono:wght@400;500;600;700&display=swap">
```

- [ ] **Step 2: Update fonts.css with --font-data variable**

```css
/* Phoenix Typography — Inter (UI) + JetBrains Mono (Data) */

@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --default-font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-data: "JetBrains Mono", "SF Mono", "Cascadia Code", "Fira Code", ui-monospace, monospace;
}

/* Data/Numbers — Tabular figures */
.tabular-nums {
  font-variant-numeric: tabular-nums;
}

/* Data font utility — monospace for metrics, values, readouts */
.font-data {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: Update theme.css --font-display to remove Space Grotesk as app-wide display font**

Change line 3 of theme.css from:
```css
--font-display: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
```
to:
```css
--font-display: "Inter", ui-sans-serif, system-ui, sans-serif;
```

Note: Space Grotesk is still lazy-loaded by LandingPage.tsx for the marketing page only. It should NOT be removed from LandingPage.tsx.

- [ ] **Step 4: Verify build**

Run: `cd phoenix-portal && npm run build`
Expected: Build succeeds. No font-related errors.

- [ ] **Step 5: Commit**

```bash
git add index.html src/styles/fonts.css src/styles/theme.css
git commit -m "feat(design): add JetBrains Mono data font, update font stack for Signal aesthetic"
```

---

### Task 2: Color Palette — Signal Variables

**Files:**
- Modify: `src/styles/theme.css:1-92` (:root block)
- Modify: `src/styles/theme.css:95-146` (@theme inline block)
- Modify: `src/lib/colors.ts:1-52`

- [ ] **Step 1: Replace :root CSS variables in theme.css**

Replace the entire `:root` block (lines 1-92) with the Signal palette:

```css
:root {
  --font-size: 16px;
  --font-display: "Inter", ui-sans-serif, system-ui, sans-serif;

  /* Signal palette — instrument panel */
  --phoenix-black: #06060a;
  --phoenix-ember: #FF6B35;
  --phoenix-flame-red: #DC2626;
  --phoenix-gold: #F59E0B;
  --phoenix-molten-steel: #374151;
  --phoenix-ash-gray: #6B7280;
  --phoenix-forge-green: #10B981;
  --phoenix-flame-yellow: #FBBF24;
  --phoenix-crimson: #EF4444;
  --phoenix-white: #e0e0e8;
  --phoenix-light-gray: #E5E7EB;

  /* Signal-specific */
  --cable-a: #FF6B35;
  --cable-b: #6ba3f7;
  --signal-ok: #00e676;
  --signal-warn: #ffab00;
  --signal-danger: #ff5252;

  --background: #06060a;
  --foreground: #e0e0e8;
  --card: #0a0a10;
  --card-foreground: #e0e0e8;
  --popover: #0e0e14;
  --popover-foreground: #e0e0e8;
  --primary: #FF6B35;
  --primary-foreground: #FFFFFF;
  --secondary: #1a1a24;
  --secondary-foreground: #e0e0e8;
  --muted: #4a4a56;
  --muted-foreground: #888894;
  --accent: #F59E0B;
  --accent-foreground: #06060a;
  --destructive: #ff5252;
  --destructive-foreground: #FFFFFF;
  --success: #00e676;
  --success-foreground: #06060a;
  --warning: #ffab00;
  --warning-foreground: #06060a;
  --border: #1a1a24;
  --input: rgba(26, 26, 36, 0.5);
  --input-background: rgba(26, 26, 36, 0.3);
  --switch-background: #1a1a24;
  --ring: #FF6B35;

  /* Chart colors — Signal palette */
  --chart-1: #FF6B35;
  --chart-2: #6ba3f7;
  --chart-3: #F59E0B;
  --chart-4: #00e676;
  --chart-5: #7c4dff;

  --radius: var(--radius-lg);
  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 6px;

  --sidebar: rgba(6, 6, 10, 0.95);
  --sidebar-foreground: #e0e0e8;
  --sidebar-primary: #FF6B35;
  --sidebar-primary-foreground: #FFFFFF;
  --sidebar-accent: rgba(255, 107, 53, 0.1);
  --sidebar-accent-foreground: #FF6B35;
  --sidebar-border: #1a1a24;
  --sidebar-ring: #FF6B35;
  --sidebar-group-label: #4a4a56;

  /* Surface layers — deeper, more contrast */
  --surface-0: #06060a;
  --surface-1: #0a0a10;
  --surface-2: #0e0e14;
  --surface-3: #141420;
  --surface-overlay: rgba(6, 6, 10, 0.95);

  /* Shadows — minimal, no brand tint */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.6);

  /* Icon colors */
  --icon-default: var(--foreground);
  --icon-muted: var(--muted-foreground);
  --icon-accent: var(--phoenix-ember);
  --icon-success: var(--signal-ok);
  --icon-warning: var(--signal-warn);
  --icon-danger: var(--signal-danger);

  /* Semantic data colors */
  --semantic-positive: #00e676;
  --semantic-caution: #ffab00;
  --semantic-info: #6ba3f7;
  --semantic-negative: #ff5252;
  --semantic-neutral: #4a4a56;
}
```

- [ ] **Step 2: Update @theme inline block to add new variables**

Add these lines inside the `@theme inline { ... }` block (after the existing variable mappings):

```css
  --color-cable-a: var(--cable-a);
  --color-cable-b: var(--cable-b);
  --color-signal-ok: var(--signal-ok);
  --color-signal-warn: var(--signal-warn);
  --color-signal-danger: var(--signal-danger);
  --font-family-data: var(--font-data);
```

Also update the shadow @theme block (lines 149-153) to match the new shadow values:

```css
@theme {
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.6);
}
```

- [ ] **Step 3: Update colors.ts**

Replace the entire file content:

```ts
/**
 * Phoenix Signal color constants for contexts where CSS variables cannot be used:
 * - SVG stroke/fill attributes
 * - Framer Motion animate targets
 * - Canvas drawing operations
 *
 * For all other contexts (Tailwind classes, inline styles), use CSS variables
 * from theme.css instead (e.g., var(--cable-a) or bg-primary).
 */
export const PHOENIX = {
	ember: "#FF6B35",
	flameRed: "#DC2626",
	gold: "#F59E0B",
	forgeGreen: "#10B981",
	black: "#06060a",
	white: "#e0e0e8",
	ashGray: "#6B7280",
	moltenSteel: "#374151",
	lightGray: "#E5E7EB",
	crimson: "#EF4444",
	flameYellow: "#FBBF24",
	mutedForeground: "#888894",
} as const;

/** Cable colors — the bilateral identity of Phoenix */
export const CABLE = {
	a: "#FF6B35",
	b: "#6ba3f7",
	aDim: "rgba(255, 107, 53, 0.15)",
	bDim: "rgba(107, 163, 247, 0.15)",
} as const;

/** Signal status colors */
export const SIGNAL = {
	ok: "#00e676",
	warn: "#ffab00",
	danger: "#ff5252",
} as const;

/** Surface layer colors for programmatic use */
export const SURFACE = {
	base: "#06060a",
	raised: "#0a0a10",
	elevated: "#0e0e14",
	overlay: "rgba(6, 6, 10, 0.95)",
} as const;

/** Semantic colors for data contexts (programmatic use) */
export const SEMANTIC = {
	positive: "#00e676",
	caution: "#ffab00",
	info: "#6ba3f7",
	negative: "#ff5252",
	neutral: "#4a4a56",
} as const;

/** Velocity zone colors */
export const VELOCITY_ZONES = {
	explosive: "#ff5252",
	fast: "#ffab00",
	moderate: "#00e676",
	slow: "#448aff",
	grind: "#7c4dff",
} as const;

/** Chart palette for visx/Recharts programmatic configuration */
export const CHART_PALETTE = [
	PHOENIX.ember,
	CABLE.b,
	PHOENIX.gold,
	SIGNAL.ok,
	"#7c4dff",
] as const;

export type PhoenixColor = (typeof PHOENIX)[keyof typeof PHOENIX];
```

- [ ] **Step 4: Verify build**

Run: `cd phoenix-portal && npm run build`
Expected: Build succeeds. Any TypeScript import of `PHOENIX`, `SURFACE`, `SEMANTIC`, `CHART_PALETTE` still works. New exports `CABLE`, `SIGNAL`, `VELOCITY_ZONES` available.

- [ ] **Step 5: Run typecheck**

Run: `cd phoenix-portal && npm run typecheck`
Expected: No type errors from colors.ts changes (exports are a superset of the old ones).

- [ ] **Step 6: Commit**

```bash
git add src/styles/theme.css src/lib/colors.ts
git commit -m "feat(design): replace palette with Signal aesthetic — deeper blacks, cable A/B colors, status signals"
```

---

### Task 3: Theme Utilities — Remove AI Tells, Add Signal Patterns

**Files:**
- Modify: `src/styles/theme.css:155-532` (the @layer base and @layer utilities sections)

- [ ] **Step 1: Replace the body ambient glow (lines 165-197) with scan-line texture**

Replace the body::before (ambient glow) and body::after (grain) blocks with:

```css
  body {
    @apply bg-background text-foreground;
    position: relative;
  }

  /* Scan-line texture — instrument panel feel, barely perceptible */
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 3px,
      rgba(255, 255, 255, 0.006) 3px,
      rgba(255, 255, 255, 0.006) 6px
    );
  }

  /* Keep grain texture but darken */
  body::after {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 1;
    opacity: 0.015;
    mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-repeat: repeat;
    background-size: 200px 200px;
  }
```

- [ ] **Step 2: Remove glow and glass utilities from @layer utilities (lines 427-532)**

Remove these utility classes entirely:
- `.glass-panel` (lines 486-493)
- `.glass-panel-hover` (lines 495-498)
- `.glow-text` (lines 501-503)
- `.glow-box` (lines 506-508)
- `.sidebar-avatar-hover` (lines 478-483)

Replace `.card-hero`, `.card-primary`, `.card-secondary` with Signal panel styles:

```css
  /* Signal panel — bordered instrument panel, no glass, no glow */
  .signal-panel {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  /* Signal panel with subtle highlight border (replaces card-hero) */
  .signal-panel-highlight {
    background: var(--surface-1);
    border: 1px solid var(--cable-a);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
  }

  /* Signal metric strip cell (for metric readout bars) */
  .signal-metric {
    font-family: var(--font-data);
    font-variant-numeric: tabular-nums;
  }
```

Keep the `.card-landing-feature` class but update it to match the new aesthetic:

```css
  /* Landing feature card — clean panel, subtle hover border shift */
  .card-landing-feature {
    border: 1px solid var(--border);
    background: var(--surface-2);
    box-shadow: var(--shadow-sm);
    transition: border-color 200ms ease, box-shadow 200ms ease;
    border-radius: var(--radius-md);
  }
  .card-landing-feature:hover {
    border-color: rgba(255, 107, 53, 0.3);
    box-shadow: var(--shadow-md);
  }
```

- [ ] **Step 3: Remove decorative animations from @layer base**

Remove these keyframes and classes:
- `@keyframes flame-flicker` and `.animate-flame-flicker` (lines 352-379)
- `@keyframes ember-rise` and `.animate-ember-rise` (lines 357-383)
- `@keyframes phoenix-glow` and `.animate-phoenix-glow` (lines 368-387)
- `@keyframes shimmer-sweep` and `.btn-shimmer` (lines 395-423)

Replace with a single functional animation:

```css
  /* Signal pulse — for live status indicators only */
  @keyframes signal-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .animate-signal-pulse {
    animation: signal-pulse 2.5s ease-in-out infinite;
  }
```

- [ ] **Step 4: Update sidebar styles**

Update the sidebar background (line 258-261):

```css
  [data-sidebar="sidebar"] {
    background: var(--surface-1) !important;
    border-right: 1px solid var(--border);
  }
```

Update sidebar separator (lines 471-475):

```css
  .sidebar-separator-phoenix {
    background: var(--border) !important;
    border: none;
    height: 1px;
  }
```

- [ ] **Step 5: Update reduced-motion block**

Replace the animation suppression list (lines 534-555) to match new animations:

```css
@media (prefers-reduced-motion: reduce) {
  .animate-signal-pulse {
    animation: none;
  }

  .animate-pulse,
  .animate-bounce,
  .animate-ping {
    animation: none;
  }
}
```

- [ ] **Step 6: Update border-secondary utility**

Keep the existing subtle border approach but match new palette:

```css
  .border-secondary {
    border-color: var(--border) !important;
  }
```

- [ ] **Step 7: Verify build**

Run: `cd phoenix-portal && npm run build`
Expected: Build succeeds. CSS compiles without errors.

- [ ] **Step 8: Commit**

```bash
git add src/styles/theme.css
git commit -m "feat(design): replace glass/glow/flame utilities with signal-panel, scan-line body, signal-pulse animation"
```

---

### Task 4: Animation Presets — Remove Bounce, Tighten Springs

**Files:**
- Modify: `src/lib/animations.ts`

- [ ] **Step 1: Replace animations.ts content**

```ts
/**
 * Centralized animation presets for Phoenix Portal — Signal aesthetic.
 * Tight, responsive instrument-panel feel. No bounce. No glow.
 * These are plain objects — no runtime dependency on motion/react.
 */

// --- Spring presets (Framer Motion transition configs) ---

export const springs = {
	/** Standard interaction — buttons, cards, toggles */
	snappy: { type: "spring", damping: 30, stiffness: 500 } as const,
	/** Content transitions — panels opening, route changes */
	smooth: { type: "spring", damping: 28, stiffness: 250 } as const,
	/** Quick micro-interactions — checkboxes, small state changes */
	quick: { type: "spring", damping: 35, stiffness: 600 } as const,
} as const;

// --- Variant presets (Framer Motion variants objects) ---

/** Single element entrance: opacity 0→1, y 8→0 (tighter than before) */
export const fadeUp = {
	hidden: { opacity: 0, y: 8 },
	visible: { opacity: 1, y: 0, transition: springs.smooth },
} as const;

/** Simple opacity entrance */
export const fadeIn = {
	hidden: { opacity: 0 },
	visible: { opacity: 1, transition: { duration: 0.2 } },
} as const;

/** Parent variant for staggered children */
export const staggerContainer = {
	hidden: { opacity: 0 },
	visible: {
		opacity: 1,
		transition: {
			staggerChildren: 0.04,
			delayChildren: 0.05,
		},
	},
} as const;

/** Route transition variant (used by AnimatePresence) */
export const pageTransition = {
	initial: { opacity: 0, y: 6 },
	animate: {
		opacity: 1,
		y: 0,
		transition: { duration: 0.2, ease: "easeOut" },
	},
	exit: {
		opacity: 0,
		y: -6,
		transition: { duration: 0.12, ease: "easeIn" },
	},
} as const;

// --- Hover & tap presets ---

export const hover = {
	/** Subtle lift — cards, interactive panels */
	lift: { scale: 1.005, y: -1, transition: springs.snappy },
} as const;

export const tap = {
	press: { scale: 0.98 },
} as const;

// --- Breathing animation (scroll indicator) ---

export const breathing = {
	animate: {
		y: [0, 4, 0] as number[],
		opacity: [0.5, 1, 0.5] as number[],
		transition: {
			duration: 2.5,
			repeat: Number.POSITIVE_INFINITY,
			ease: "easeInOut",
		},
	},
} as const;
```

Note: The `bouncy` spring and `glow` hover presets are removed. Any component importing `springs.bouncy` or `hover.glow` will get a TypeScript error — those references must be updated (addressed in Phase 2 component sweeps).

- [ ] **Step 2: Search for usages of removed exports**

Run: `cd phoenix-portal && grep -rn "springs\.bouncy\|hover\.glow" src/`
Expected: List any files importing removed presets. If none found, proceed. If found, note them for the component sweep tasks.

- [ ] **Step 3: Verify build**

Run: `cd phoenix-portal && npm run typecheck`
Expected: Passes, or identifies files referencing `bouncy`/`glow` (to be fixed in Phase 2).

- [ ] **Step 4: Commit**

```bash
git add src/lib/animations.ts
git commit -m "feat(design): tighten animation springs — remove bounce, reduce movement, instrument-panel feel"
```

---

## Phase 2: Component Sweep (Tasks 5-9)

### Task 5: Button CTA Variant + Dialog — Gradient → Solid

**Files:**
- Modify: `src/app/components/ui/button.tsx:21`
- Modify: `src/app/components/ui/unsaved-changes-dialog.tsx:51`

- [ ] **Step 1: Update CTA variant in button.tsx**

Replace line 21:
```ts
cta: "bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent text-white border-0",
```
with:
```ts
cta: "bg-primary hover:bg-primary/90 text-white border-0 font-medium",
```

- [ ] **Step 2: Update save button in unsaved-changes-dialog.tsx**

Replace line 51 class:
```ts
className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0 text-white"
```
with:
```ts
className="bg-primary hover:bg-primary/90 border-0 text-white"
```

- [ ] **Step 3: Verify build**

Run: `cd phoenix-portal && npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/components/ui/button.tsx src/app/components/ui/unsaved-changes-dialog.tsx
git commit -m "feat(design): replace gradient CTA button with solid primary — Signal aesthetic"
```

---

### Task 6: Dashboard — Glass/Glow/Gradient/Card-Tier Sweep

**Files:**
- Modify: `src/app/components/Dashboard.tsx` (lines 134, 167, 412, 414, 435, 460, 507, 508, 523, 540, 576, 588, 649, 686, 701, 747, 753, 765, 840, 881, 905, 953, 1046, 1073, 1151, 1224, 1304, 1358, 1366)
- Modify: `src/app/components/GoalDashboardWidget.tsx` (lines 27, 55)
- Modify: `src/app/components/RecoveryDashboardWidget.tsx` (lines 16, 45, 60)

- [ ] **Step 1: In Dashboard.tsx, replace ALL class patterns**

Search-and-replace within Dashboard.tsx:
- `glass-panel p-8 flex items-center justify-center relative overflow-hidden glow-box` → `signal-panel p-8 flex items-center justify-center relative overflow-hidden`
- `glass-panel glass-panel-hover` → `signal-panel`
- `glass-panel p-6 h-full` → `signal-panel p-6 h-full`
- `glass-panel p-6 flex` → `signal-panel p-6 flex`
- `p-5 glass-panel` → `p-5 signal-panel`
- `glow-text` → `` (remove entirely, keep surrounding classes)
- `card-hero` → `signal-panel-highlight`
- `card-secondary` → `signal-panel`

Replace all `bg-gradient-to-br from-primary to-chart-2` and `bg-gradient-to-r from-primary to-chart-2` with `bg-primary`:

E.g., avatar fallbacks: `bg-gradient-to-br from-primary to-chart-2 text-white` → `bg-primary text-white`

Replace `animate-pulse` on the notification dot (line 576) with `animate-signal-pulse`:
`w-2 h-2 bg-primary rounded-full animate-pulse` → `w-2 h-2 bg-primary rounded-full animate-signal-pulse`

- [ ] **Step 2: In GoalDashboardWidget.tsx, replace card-primary**

Replace all `card-primary` with `signal-panel`.

- [ ] **Step 3: In RecoveryDashboardWidget.tsx, replace card-primary**

Replace all `card-primary` with `signal-panel`.

- [ ] **Step 4: Verify build**

Run: `cd phoenix-portal && npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/Dashboard.tsx src/app/components/GoalDashboardWidget.tsx src/app/components/RecoveryDashboardWidget.tsx
git commit -m "feat(design): dashboard — replace glass/glow/gradient with signal panels"
```

---

### Task 7: Landing Page + Marketing Pages — Gradient Text → Solid

**Files:**
- Modify: `src/app/components/LandingPage.tsx:646`
- Modify: `src/app/components/FAQ.tsx:230,235,263`
- Modify: `src/app/components/TermsOfService.tsx:17,42`

- [ ] **Step 1: LandingPage.tsx — Replace gradient text with solid primary**

Replace line 646:
```jsx
<span className="block bg-gradient-to-r from-primary via-chart-2 to-accent bg-clip-text text-transparent">
```
with:
```jsx
<span className="block text-primary">
```

**DO NOT** touch the phoenix-hero.png image (lines 625-632). **DO NOT** remove the Space Grotesk lazy-loader (lines 86-96).

- [ ] **Step 2: FAQ.tsx — Replace gradient text and backdrop-blur nav**

Replace line 235:
```jsx
<span className="text-xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
```
with:
```jsx
<span className="text-xl text-primary">
```

Replace line 263:
```jsx
<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
```
with:
```jsx
<span className="text-primary">
```

If line 230 has `backdrop-blur-xl bg-background/80`, replace with `bg-surface-1 border-b border-border`.

- [ ] **Step 3: TermsOfService.tsx — Replace gradient text**

Replace lines 17 and 42 pattern:
```jsx
<span className="text-xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
```
with:
```jsx
<span className="text-xl text-primary">
```
(and same for the non-`text-xl` variant at line 42)

- [ ] **Step 4: Verify build**

Run: `cd phoenix-portal && npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/LandingPage.tsx src/app/components/FAQ.tsx src/app/components/TermsOfService.tsx
git commit -m "feat(design): replace gradient text with solid primary on landing, FAQ, ToS"
```

---

### Task 8: Comprehensive Gradient/Scale Sweep — ALL Components

This is the largest task. It's a **grep-driven mechanical sweep** of the entire `src/app/` tree, not a file-by-file list. The executor should grep for each pattern and fix every match found.

**Note on radius:** This plan also changes `--radius-sm` (6→2px), `--radius-md` (8→4px), `--radius-lg` (12→6px) globally. All `rounded-sm/md/lg` usage becomes sharper across the entire app. This is intentional for the instrument-panel feel.

**Approach:** Run grep for each old pattern, fix every file it appears in. The file list below is known matches as of plan creation, but **grep is authoritative** — if it finds matches in files not listed, fix those too.

**Known files (all in `src/app/`):**
- `components/PersonalRecords.tsx`, `WorkoutHistory.tsx`, `PricingPlans.tsx`
- `components/TrainingCycles.tsx`, `Challenges.tsx`, `SessionDetail.tsx`
- `components/Profile.tsx`, `RoutineBuilder.tsx`, `AppSidebar.tsx`
- `components/MobileBottomNav.tsx`, `CelebrationDemo.tsx`, `RoutineDetail.tsx`
- `components/Analytics.tsx`, `Biomechanics.tsx`, `Recovery.tsx`
- `components/ComparisonView.tsx`, `CycleBuilder.tsx`, `Community.tsx`
- `components/Goals.tsx`, `RoutinesEnhanced.tsx`, `Telemetry.tsx`
- `components/community/CommentThread.tsx`, `CommunityDetailDrawer.tsx`
- `components/community/CommunityFeedCard.tsx`, `CreatorProfile.tsx`
- `components/community/FeaturedCreators.tsx`
- `components/cycle-builder/RoutinePicker.tsx`
- `components/modals/RoutinePickerModal.tsx`
- `components/celebrations/` (all files)
- Any other file found by grep

- [ ] **Step 1: Grep and replace gradient patterns across ALL src/app/ files**

Run each grep, fix every match:

| Find | Replace |
|------|---------|
| `bg-gradient-to-r from-primary to-chart-2` | `bg-primary` |
| `bg-gradient-to-br from-primary to-chart-2` | `bg-primary` |
| `bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent` | `bg-primary hover:bg-primary/90` |
| `bg-gradient-to-r from-primary to-chart-2 hover:from-primary/90 hover:to-chart-2/90` | `bg-primary hover:bg-primary/90` |
| `bg-gradient-to-r from-accent to-warning` | `bg-accent` |
| `bg-gradient-to-r from-accent to-[#B45309] hover:from-accent/90 hover:to-[#B45309]/90` | `bg-accent hover:bg-accent/90` |
| `bg-gradient-to-br from-accent to-warning` | `bg-accent` |
| `bg-gradient-to-br from-amber-600 to-amber-800` | `bg-accent` |
| `bg-gradient-to-br from-surface-2 to-background` | `bg-surface-2` |
| `bg-gradient-to-r from-primary/5 to-chart-2/5` | `bg-primary/5` |
| `hover:scale-105` | `` (remove) |
| `hover:scale-110` | `` (remove) |

For `MobileBottomNav.tsx` active indicator:
`bg-gradient-to-r from-primary to-chart-2 rounded-full` → `bg-primary rounded-full`

For `Profile.tsx` progress bar fill:
If using gradient for a progress bar, replace with solid `bg-primary`.

For CelebrationDemo.tsx — the various `bg-gradient-to-br from-...` buttons: replace with appropriate solid colors (bg-accent, bg-primary, bg-secondary, etc.) depending on the button's purpose.

- [ ] **Step 2: Verify build**

Run: `cd phoenix-portal && npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Grep for any remaining `bg-gradient-to-br from-surface-2 to-background` patterns**

Run: `cd phoenix-portal && grep -rn "bg-gradient-to-br from-surface-2 to-background\|bg-gradient-to-b from-surface" src/app/`
Replace matches with `bg-surface-2`.

- [ ] **Step 4: Verify no remaining gradient/old-aesthetic patterns**

Run each of these — ALL should return empty:
```bash
cd phoenix-portal
grep -rn "from-primary to-chart-2" src/app/
grep -rn "bg-clip-text text-transparent" src/app/
grep -rn "from-accent to-warning" src/app/
grep -rn "from-amber-600 to-amber-800" src/app/
grep -rn "hover:scale-105\|hover:scale-110" src/app/
grep -rn "bg-gradient-to-br from-surface-2 to-background" src/app/
```

If any match, go back and fix.

- [ ] **Step 5: Verify build**

Run: `cd phoenix-portal && npm run build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

Stage only modified files (no `-A` to avoid stray files):
```bash
cd phoenix-portal && git add -u src/app/components/
git commit -m "feat(design): sweep all gradient badges/buttons/avatars to solid colors — Signal aesthetic"
```

---

### Task 9: Backdrop-Blur Sweep — Sticky Headers

The old aesthetic used `backdrop-blur-xl bg-background/80` on sticky headers throughout the app. This is glassmorphism lite — replace with solid backgrounds for the Signal aesthetic. Keep `backdrop-blur-sm` on dialog/celebration overlays (those serve a functional purpose: dimming content behind modals).

**Files (grep-driven — fix every match):**
Run: `cd phoenix-portal && grep -rn "backdrop-blur" src/app/`

Known matches include: `ComparisonView.tsx` (6), `RoutineBuilder.tsx`, `RoutinesEnhanced.tsx` (2), `SessionDetail.tsx` (3), `TrainingCycles.tsx` (2), `Analytics.tsx` (2), `CycleBuilder.tsx`, `MobileBottomNav.tsx`, `FAQ.tsx`, and celebration overlay components.

- [ ] **Step 1: Replace backdrop-blur on sticky headers**

For any sticky header pattern like:
```jsx
className="sticky top-0 z-10 backdrop-blur-xl bg-background/80 border-b border-secondary"
```
Replace with:
```jsx
className="sticky top-0 z-10 bg-surface-1 border-b border-border"
```

The key replacements:
- `backdrop-blur-xl bg-background/80` → `bg-surface-1`
- `backdrop-blur-lg bg-background/70` → `bg-surface-1`
- `backdrop-blur-md bg-background/60` → `bg-surface-1`

**Exception:** Keep `backdrop-blur-sm` or `backdrop-blur` on dialog overlays, celebration components, and the `Spotlight.tsx` component — these use blur functionally to dim content behind modals.

- [ ] **Step 2: Verify no unintended backdrop-blur removal**

Run: `cd phoenix-portal && grep -rn "backdrop-blur" src/app/`
Expected: Only matches in dialog/overlay/celebration contexts. No matches in sticky headers or nav bars.

- [ ] **Step 3: Verify build**

Run: `cd phoenix-portal && npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd phoenix-portal && git add -u src/app/components/
git commit -m "feat(design): replace backdrop-blur sticky headers with solid bg-surface-1"
```

---

### Task 10: Sidebar + Scrollbar Polish

**Files:**
- Modify: `src/styles/theme.css` (sidebar styles, scrollbar styles)

- [ ] **Step 1: Update scrollbar colors in theme.css**

Replace the sidebar scrollbar colors (lines 204-221) to use the new palette:

```css
  [data-sidebar="content"] {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 107, 53, 0.1) transparent;
  }
  [data-sidebar="content"]::-webkit-scrollbar {
    width: 5px;
  }
  [data-sidebar="content"]::-webkit-scrollbar-track {
    background: transparent;
  }
  [data-sidebar="content"]::-webkit-scrollbar-thumb {
    background: rgba(255, 107, 53, 0.1);
    border-radius: 2px;
  }
  [data-sidebar="content"]::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 107, 53, 0.2);
  }
```

Update main scrollbar (lines 224-240):

```css
  main {
    scrollbar-width: thin;
    scrollbar-color: #1a1a24 #06060a;
  }
  main::-webkit-scrollbar {
    width: 6px;
  }
  main::-webkit-scrollbar-track {
    background: #06060a;
  }
  main::-webkit-scrollbar-thumb {
    background: #1a1a24;
    border-radius: 2px;
  }
  main::-webkit-scrollbar-thumb:hover {
    background: #2a2a36;
  }
```

- [ ] **Step 2: Update sidebar separator gradient**

The sidebar separator (now in @layer utilities) should already be updated from Task 3. Verify it's using `var(--border)` instead of the ember gradient.

- [ ] **Step 3: Verify build**

Run: `cd phoenix-portal && npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/styles/theme.css
git commit -m "feat(design): update sidebar and scrollbar styling for Signal palette"
```

---

## Phase 3: Verification (Task 11)

### Task 11: Full Verification Pass

- [ ] **Step 1: Build check**

Run: `cd phoenix-portal && npm run build`
Expected: Clean build, no errors.

- [ ] **Step 2: Type check**

Run: `cd phoenix-portal && npm run typecheck`
Expected: No type errors.

- [ ] **Step 3: Lint check**

Run: `cd phoenix-portal && npx biome check src/`
Expected: No new lint errors introduced by changes.

- [ ] **Step 4: Verify no remaining AI tells**

Run each of these (all should return no matches from `src/app/` components, except backdrop-blur which may have legitimate dialog/overlay usage):
```bash
cd phoenix-portal
grep -rn "glass-panel" src/app/
grep -rn "glow-text\|glow-box" src/app/
grep -rn "bg-clip-text text-transparent" src/app/
grep -rn "card-hero\b" src/app/
grep -rn "card-primary\b" src/app/
grep -rn "card-secondary\b" src/app/
grep -rn "from-primary to-chart-2" src/app/
grep -rn "from-accent to-warning" src/app/
grep -rn "animate-flame\|animate-ember\|animate-phoenix" src/app/
grep -rn "btn-shimmer" src/app/
grep -rn "hover:scale-105\|hover:scale-110" src/app/
grep -rn "bg-gradient-to-br from-surface-2 to-background" src/app/
grep -rn "backdrop-blur-xl\|backdrop-blur-lg\|backdrop-blur-md" src/app/
```

Expected: All return empty. If any match, go back and fix.

- [ ] **Step 5: Visual spot-check**

Run: `cd phoenix-portal && npm run dev`
Open http://localhost:5173 in browser and verify:
- Landing page: phoenix-hero.png still shows, headline text is solid primary, no gradient text
- Dashboard: no glassmorphism, no glow, panels have clean borders
- Sidebar: clean background, no avatar glow on hover
- Cards: bordered panels, no gradient backgrounds
- Buttons: solid primary, no gradients
- Fonts: metrics/numbers should show JetBrains Mono once `font-data` class is applied to data components (future task)
- Colors: deeper blacks (#06060a), blue-tinted surfaces

- [ ] **Step 6: Commit any final fixes**

```bash
git add -A
git commit -m "fix(design): final Signal aesthetic polish pass"
```

---

## Out of Scope (Future Work)

These are natural follow-up tasks but are NOT part of this plan:

1. **Apply `font-data` class to metric/number displays** across all components — requires per-component review of where numbers appear. Large surface area, separate plan.
2. **Build bilateral cable display component** (`<BilateralDisplay cableA={98.5} cableB={101.5} />`) — new component, not a design system swap.
3. **Build force curve visualization component** — new component using visx/recharts, separate plan.
4. **Mobile app (Compose) theme alignment** — updating Color.kt, Material3Expressive.kt to match Signal palette. Separate plan since it's a different project with different tooling.
5. **Rep phase visualization component** — new component, separate plan.
6. **Velocity zone strip component** — new component, separate plan.
7. **Landing page restyle** beyond gradient text removal — the marketing page may want a different treatment than the instrument-panel dashboard.
8. **Print stylesheet update** — current print styles reference old palette colors, should be updated.
