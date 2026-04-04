# Landing Page Design Overhaul — "Precision Performance Cockpit"

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Supersedes:** `2026-03-22-landing-page-design-polish.md` (that plan covered minor font/badge polish; this plan covers the full overhaul described in the design critique).

**Goal:** Transform the Phoenix Portal landing page from a generic dark SaaS template into a product-revealing "precision performance cockpit" that leads with data, demonstrates the product's unique analytics, and replaces atmospheric brand language with concrete product proof.

**Architecture:** Four-layer approach: (1) refine the visual foundation in theme.css (glow reduction, semantic colors, sidebar), (2) rewrite all landing page copy and structure with product-first messaging, (3) create new `landing/` sub-components for product showcase panels, (4) add one signature interactive force curve demo that visitors can actually use. Auth dialog stays untouched. Footer gets minor copy adjustment only.

**Tech Stack:** React 19, Tailwind CSS v4, visx (already installed), Framer Motion (existing), lucide-react (existing)

**Design target:** Black/charcoal base, one restrained ember accent, dense data panels, stronger type hierarchy, less metaphor, more proof. Think: lab instrument dashboard, not gaming platform.

---

## Scope Boundaries

**In scope (this plan):**
- `src/styles/theme.css` — glow reduction, semantic colors, sidebar active state
- `src/app/components/LandingPage.tsx` — full copy + structure rewrite
- `src/app/components/landing/ProductShowcase.tsx` — NEW: mock dashboard panels
- `src/app/components/landing/ForceCurveDemo.tsx` — NEW: interactive force curve
- `src/app/components/__tests__/LandingPage.test.tsx` — update for new copy
- `src/app/components/landing/__tests__/ProductShowcase.test.tsx` — NEW
- `src/app/components/landing/__tests__/ForceCurveDemo.test.tsx` — NEW

**Out of scope (separate plans):**
- Dashboard redesign (layout, empty states, streak card, sync banner)
- Workout History redesign (calendar enrichment, detail drawer, view modes)
- Analytics Hub redesign (hero insight, KPI context, sparklines, chart readability)
- Prerendering/SSG for public pages (architectural change, needs separate investigation)
- Mobile-specific landing page variant

**Pre-existing issues noted:**
- `LandingPage.tsx` is 1047 lines — a single monolithic component. This plan extracts landing sub-components into `landing/` but does not split the auth dialog or form logic out. That's a healthy follow-up refactor.
- `EmberParticles.tsx` canvas animation runs on the landing page even though it adds visual noise without communicating product value. This plan removes it from the landing page render.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/styles/theme.css` | Reduce ambient glow ~70%, add semantic color tokens, refine sidebar active state |
| Modify | `src/app/components/LandingPage.tsx` | Full hero/features/pricing/CTA copy rewrite, integrate ProductShowcase + ForceCurveDemo, remove EmberParticles import |
| Create | `src/app/components/landing/ProductShowcase.tsx` | 2x2 grid of mock dashboard panels (force curve mini, recovery gauge, PR delta, volume bars) |
| Create | `src/app/components/landing/ForceCurveDemo.tsx` | Interactive visx force curve with hover tooltip, velocity zone coloring, and scrubber |
| Modify | `src/app/components/__tests__/LandingPage.test.tsx` | Update assertions for new heading text, proof row, section labels |
| Create | `src/app/components/landing/__tests__/ProductShowcase.test.tsx` | Render test, panel count, accessibility |
| Create | `src/app/components/landing/__tests__/ForceCurveDemo.test.tsx` | Render test, SVG presence, tooltip interaction |

---

## Copy Changelog (Reference)

| Location | Current | New |
|----------|---------|-----|
| Hero H1 | "Your workouts, unlocked." | "See every rep as data." |
| Hero subtitle | "Rise From the Ashes. Forge Your Strength." | "Force curves, recovery signals, PR trends, and session analysis — synced from the Project Phoenix app." |
| Hero primary CTA | "Get Started" | "Preview dashboard" |
| Hero secondary CTA | "View Plans" | "Get the mobile app" (uses `asChild` — no nested `<button>` in `<a>`) |
| Proof row | _(none)_ | "Force curves · Recovery signals · Records · Replay" |
| Hero disclaimer | "Requires the Project Phoenix mobile app..." | _(moved into proof row context)_ |
| Features eyebrow | "FEATURES" | "WHAT YOU GET" |
| Features H2 | "Built for serious athletes." | "What your machine captures — finally visible." |
| Features sub | "The insights your Vitruvian machine captures but never shows you..." | "Every rep generates force, velocity, and timing data. Phoenix Portal turns it into actionable training intelligence." |
| Pricing H2 | "Choose Your Path" | "Plans" |
| Pricing sub | "Select the plan that fits your journey" | "Each tier unlocks deeper analysis." |
| CTA H2 | "Fan the flames." | "Start syncing workouts." |
| CTA body | phoenix metaphor copy | "Connect the Project Phoenix mobile app, complete a workout, and your data flows here automatically. Force curves, recovery, records — everything updates in real time." |
| CTA primary | "Get Started" | "Get the mobile app" |
| CTA secondary | "Support on Ko-fi" | "Preview dashboard" |
| Footer tagline | "Rise From the Ashes. Forge Your Strength." | "Performance data for Vitruvian athletes." |

---

### Task 1: Visual Foundation — Reduce Ambient Glow and Refine Shadows

**Why:** The reddish haze from `body::before` and ember-tinted shadows make the UI feel atmospheric rather than precise. Reducing these by ~70% keeps the faintest warmth without the "gaming platform" effect.

**Files:**
- Modify: `src/styles/theme.css:153-171` (body::before glow)
- Modify: `src/styles/theme.css:73-76` (shadow definitions)
- Modify: `src/styles/theme.css:137-141` (Tailwind shadow overrides)

- [ ] **Step 1: Reduce body::before radial gradient opacities**

In `src/styles/theme.css`, find the `body::before` block (lines 153-171). Change:
```css
/* Current */
rgba(255, 107, 53, 0.08) 0%,
/* ... */
rgba(220, 38, 38, 0.06) 0%,
```
To:
```css
/* Reduced ~70% */
rgba(255, 107, 53, 0.025) 0%,
/* ... */
rgba(220, 38, 38, 0.02) 0%,
```

- [ ] **Step 2: Reduce shadow ember tint**

In `src/styles/theme.css`, find the `:root` shadow definitions (lines 73-76). Change:
```css
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 107, 53, 0.03);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 107, 53, 0.04);
--shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 107, 53, 0.05);
```
To:
```css
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 107, 53, 0.01);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 107, 53, 0.015);
--shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 107, 53, 0.02);
```

Apply the same values to the `@theme` block (lines 137-141).

- [ ] **Step 3: Reduce card-hero glow intensity**

In the `.card-hero` utility class (line ~421), change:
```css
box-shadow: var(--shadow-lg), 0 0 20px rgba(255, 107, 53, 0.12);
```
To:
```css
box-shadow: var(--shadow-lg), 0 0 12px rgba(255, 107, 53, 0.06);
```

- [ ] **Step 4: Reduce card-landing-feature hover glow**

In `.card-landing-feature:hover` (line ~458), change:
```css
box-shadow: var(--shadow-lg), 0 0 24px rgba(255, 107, 53, 0.2);
```
To:
```css
box-shadow: var(--shadow-lg), 0 0 12px rgba(255, 107, 53, 0.08);
```

- [ ] **Step 5: Reduce sidebar background glow**

In `[data-sidebar="sidebar"]` (line ~248), change:
```css
box-shadow: 1px 0 8px rgba(255, 107, 53, 0.06);
```
To:
```css
box-shadow: 1px 0 4px rgba(0, 0, 0, 0.15);
```

- [ ] **Step 6: Refine sidebar active state — less gradient wash**

In `[data-sidebar="menu-button"][data-active="true"]` (line ~253), change:
```css
background: linear-gradient(to right, rgba(255, 107, 53, 0.12), transparent) !important;
```
To:
```css
background: rgba(255, 107, 53, 0.06) !important;
```

This makes the active state subtler. The left accent bar already exists in `AppSidebar.tsx` JSX (the `<span className="absolute left-0 top-1 bottom-1 w-[3px] bg-primary rounded-full">`) so the accent bar carries the active indicator role.

- [ ] **Step 7: Verify — run dev server and check visual changes**

```bash
cd C:/Users/dasbl/AndroidStudioProjects/Phoenix\ App\ Monorepo/phoenix-portal
npm run dev
```

Open browser, check:
- Landing page: reddish haze should be barely perceptible
- Dashboard: cards should look less "glowy"
- Sidebar: active state should be a subtle fill, not a gradient sweep
- Feature cards hover: glow should be restrained

- [ ] **Step 8: Commit**

```bash
git add src/styles/theme.css
git commit -m "style: reduce ambient glow ~70% and refine shadow system

Reduce body::before radial gradient opacity from 0.08/0.06 to 0.025/0.02.
Reduce ember tint in shadow system. Tone down card-hero, card-landing-feature,
and sidebar glow intensities. Refine sidebar active state to subtle fill
instead of gradient wash."
```

---

### Task 2: Visual Foundation — Add Semantic Color Tokens

**Why:** Orange currently serves as brand, CTA, active state, chart accent, status emphasis, and glow all at once. Adding semantic tokens lets data contexts use appropriate colors (green=recovery, amber=load, blue=info) without everything being orange.

**Files:**
- Modify: `src/styles/theme.css:1-85` (:root variables)
- Modify: `src/styles/theme.css:88-134` (@theme inline block)

- [ ] **Step 1: Add semantic color variables to :root**

In `:root` block, after the `--icon-*` variables (after line 84), add:
```css
/* Semantic data colors — use instead of brand orange for contextual meaning */
--semantic-positive: #10B981;    /* recovery ready, improvement, streak */
--semantic-caution: #F59E0B;     /* high load, approaching limit */
--semantic-info: #60A5FA;        /* synced status, neutral data, info badges */
--semantic-negative: #EF4444;    /* fatigue, regression, alert */
--semantic-neutral: #6B7280;     /* inactive, empty, placeholder */
```

- [ ] **Step 2: Register semantic tokens in @theme inline**

In the `@theme inline` block, after `--font-family-display` (line 133), add:
```css
--color-semantic-positive: var(--semantic-positive);
--color-semantic-caution: var(--semantic-caution);
--color-semantic-info: var(--semantic-info);
--color-semantic-negative: var(--semantic-negative);
--color-semantic-neutral: var(--semantic-neutral);
```

This makes them available as Tailwind classes: `text-semantic-positive`, `bg-semantic-info`, etc.

- [ ] **Step 3: Add semantic tokens to colors.ts**

In `src/lib/colors.ts`, add after the `SURFACE` export:
```typescript
/** Semantic colors for data contexts (programmatic use) */
export const SEMANTIC = {
  positive: "#10B981",
  caution: "#F59E0B",
  info: "#60A5FA",
  negative: "#EF4444",
  neutral: "#6B7280",
} as const;
```

- [ ] **Step 4: Verify — Tailwind classes resolve**

```bash
cd C:/Users/dasbl/AndroidStudioProjects/Phoenix\ App\ Monorepo/phoenix-portal
npm run build
```

Build should succeed. The new tokens are available but not yet consumed — they'll be used in subsequent tasks and the follow-up dashboard/analytics plans.

- [ ] **Step 5: Commit**

```bash
git add src/styles/theme.css src/lib/colors.ts
git commit -m "feat: add semantic color tokens for data-context UI

Add --semantic-positive (recovery/improvement), --semantic-caution (high load),
--semantic-info (sync/neutral), --semantic-negative (fatigue/alert),
--semantic-neutral (inactive). Registered in @theme inline for Tailwind and
in colors.ts for programmatic use (visx/Recharts/Canvas)."
```

---

### Task 3: Create ProductShowcase Component

**Why:** The hero currently uses a faded background image (`phoenix-hero.png`) and atmospheric copy. The product showcase replaces that with 4 mock dashboard panels that immediately show visitors what the app actually does: force curves, recovery scores, PR tracking, and volume analysis.

**Files:**
- Create: `src/app/components/landing/ProductShowcase.tsx`
- Create: `src/app/components/landing/__tests__/ProductShowcase.test.tsx`

- [ ] **Step 1: Create landing directory**

```bash
mkdir -p "C:/Users/dasbl/AndroidStudioProjects/Phoenix App Monorepo/phoenix-portal/src/app/components/landing"
mkdir -p "C:/Users/dasbl/AndroidStudioProjects/Phoenix App Monorepo/phoenix-portal/src/app/components/landing/__tests__"
```

- [ ] **Step 2: Write the failing test**

Create `src/app/components/landing/__tests__/ProductShowcase.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductShowcase } from "../ProductShowcase";

describe("ProductShowcase", () => {
  it("renders 4 panel labels", () => {
    render(<ProductShowcase />);
    expect(screen.getByText("Force Output")).toBeInTheDocument();
    expect(screen.getByText("Recovery")).toBeInTheDocument();
    expect(screen.getByText("PR Trend")).toBeInTheDocument();
    expect(screen.getByText("Volume")).toBeInTheDocument();
  });

  it("renders sample metric values", () => {
    render(<ProductShowcase />);
    expect(screen.getByText("95 kg")).toBeInTheDocument();
    expect(screen.getByText(/82/)).toBeInTheDocument(); // recovery score
  });

  it("has accessible panel structure", () => {
    const { container } = render(<ProductShowcase />);
    const panels = container.querySelectorAll("[data-panel]");
    expect(panels).toHaveLength(4);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd C:/Users/dasbl/AndroidStudioProjects/Phoenix\ App\ Monorepo/phoenix-portal
npx vitest run src/app/components/landing/__tests__/ProductShowcase.test.tsx
```
Expected: FAIL — module not found

- [ ] **Step 4: Implement ProductShowcase**

Create `src/app/components/landing/ProductShowcase.tsx`:
```tsx
/**
 * ProductShowcase — 2x2 grid of mock dashboard panels for the landing page hero.
 *
 * Each panel previews a real product feature with hardcoded sample data.
 * These are purely presentational — no data fetching, no auth required.
 *
 * Design intent: "precision performance cockpit" — sharp borders, mono labels,
 * dense data, minimal glow. Panels use surface-2 background with subtle
 * white/5% borders to look like real app panels.
 */
import { motion } from "motion/react";

interface PanelProps {
  label: string;
  children: React.ReactNode;
  delay?: number;
}

function Panel({ label, children, delay = 0 }: PanelProps) {
  return (
    <motion.div
      data-panel
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6 + delay, duration: 0.5 }}
      className="rounded-lg border border-white/[0.06] bg-surface-2 p-4 flex flex-col gap-2"
    >
      <span className="eyebrow text-muted-foreground">{label}</span>
      {children}
    </motion.div>
  );
}

/** Mini SVG force curve — simplified line showing concentric → eccentric */
function ForceCurveMini() {
  return (
    <svg
      viewBox="0 0 120 48"
      className="w-full h-12"
      aria-label="Sample force curve showing peak force of 95 kg"
    >
      <path
        d="M 0 44 Q 15 40, 25 28 Q 35 12, 50 6 Q 60 4, 70 8 Q 80 14, 90 20 Q 100 28, 110 36 Q 115 40, 120 44"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M 0 44 Q 15 40, 25 28 Q 35 12, 50 6 Q 60 4, 70 8 Q 80 14, 90 20 Q 100 28, 110 36 Q 115 40, 120 44 V 48 H 0 Z"
        fill="url(#force-gradient)"
        opacity="0.15"
      />
      <defs>
        <linearGradient id="force-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Circular recovery gauge */
function RecoveryGauge({ score }: { score: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;

  return (
    <div className="flex items-center gap-3">
      <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
        <circle
          cx="24" cy="24" r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="3"
        />
        <circle
          cx="24" cy="24" r={radius}
          fill="none"
          stroke="var(--semantic-positive, #10B981)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${progress} ${circumference - progress}`}
          transform="rotate(-90 24 24)"
        />
        <text
          x="24" y="26"
          textAnchor="middle"
          className="fill-white text-[11px] font-semibold"
        >
          {score}
        </text>
      </svg>
      <div>
        <div className="text-sm font-medium text-white">Ready to train</div>
        <div className="text-xs text-semantic-positive">Fully recovered</div>
      </div>
    </div>
  );
}

/** PR trend with sparkline and delta */
function PRTrend() {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-2xl font-semibold text-white tabular-nums">+12%</div>
        <div className="text-xs text-muted-foreground">Bench press 1RM</div>
      </div>
      <svg viewBox="0 0 60 24" className="w-16 h-6" aria-hidden="true">
        <polyline
          points="0,20 10,18 20,16 30,14 40,10 50,7 60,4"
          fill="none"
          stroke="var(--primary)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/** Volume comparison bars */
function VolumeComparison() {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-14">This wk</span>
        <div className="flex-1 h-3 rounded-full bg-white/[0.04] overflow-hidden">
          <div className="h-full rounded-full bg-primary" style={{ width: "78%" }} />
        </div>
        <span className="text-xs text-white tabular-nums w-12 text-right">18,400</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-14">Last wk</span>
        <div className="flex-1 h-3 rounded-full bg-white/[0.04] overflow-hidden">
          <div className="h-full rounded-full bg-white/20" style={{ width: "62%" }} />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">14,950</span>
      </div>
      <div className="text-xs text-semantic-positive mt-1">+23% volume</div>
    </div>
  );
}

export function ProductShowcase() {
  return (
    <div className="grid grid-cols-2 gap-3 max-w-lg mx-auto">
      <Panel label="Force Output" delay={0}>
        <ForceCurveMini />
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-semibold text-white tabular-nums">95 kg</span>
          <span className="text-xs text-muted-foreground">peak</span>
        </div>
      </Panel>

      <Panel label="Recovery" delay={0.1}>
        <RecoveryGauge score={82} />
      </Panel>

      <Panel label="PR Trend" delay={0.2}>
        <PRTrend />
      </Panel>

      <Panel label="Volume" delay={0.3}>
        <VolumeComparison />
      </Panel>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/app/components/landing/__tests__/ProductShowcase.test.tsx
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/components/landing/
git commit -m "feat: add ProductShowcase component for landing page hero

2x2 grid of mock dashboard panels — force curve mini, recovery gauge,
PR trend sparkline, and volume comparison bars. Hardcoded sample data,
pure presentational. Uses surface-2 panels with subtle borders for
'precision cockpit' aesthetic."
```

---

### Task 4: Create ForceCurveDemo — Interactive Signature Component

**Why:** The critique says "give the landing page one signature interaction." Instead of describing features abstractly, let visitors scrub a rep timeline and see force/velocity data. This immediately communicates that the product is a data tool, not a motivational fitness app.

**Files:**
- Create: `src/app/components/landing/ForceCurveDemo.tsx`
- Create: `src/app/components/landing/__tests__/ForceCurveDemo.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/components/landing/__tests__/ForceCurveDemo.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ForceCurveDemo } from "../ForceCurveDemo";

describe("ForceCurveDemo", () => {
  it("renders the chart container", () => {
    const { container } = render(<ForceCurveDemo />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders section label", () => {
    render(<ForceCurveDemo />);
    expect(screen.getByText(/bench press/i)).toBeInTheDocument();
  });

  it("shows axis labels", () => {
    render(<ForceCurveDemo />);
    expect(screen.getByText("Force (kg)")).toBeInTheDocument();
  });

  it("renders phase labels", () => {
    render(<ForceCurveDemo />);
    expect(screen.getByText("Concentric")).toBeInTheDocument();
    expect(screen.getByText("Eccentric")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/app/components/landing/__tests__/ForceCurveDemo.test.tsx
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement ForceCurveDemo**

Create `src/app/components/landing/ForceCurveDemo.tsx`. This is the largest new component.

Key structure:
```tsx
/**
 * ForceCurveDemo — Interactive force curve for the landing page.
 *
 * Shows a sample bench press rep with:
 * - Force curve line (primary axis)
 * - Velocity zone color bands (background fill)
 * - Hover tooltip showing force, velocity, and zone name
 * - Phase labels (concentric / eccentric)
 *
 * Uses visx for the chart (already a project dependency).
 * All data is hardcoded — this is a demo, not a live chart.
 */
import { AxisBottom, AxisLeft } from "@visx/axis";
import { curveNatural } from "@visx/curve";
import { localPoint } from "@visx/event";
import { LinearGradient } from "@visx/gradient";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { useTooltip } from "@visx/tooltip";
import { bisector } from "d3-array";
import { useCallback, useMemo } from "react";
import { PHOENIX } from "@/lib/colors";

interface DataPoint {
  time: number;
  force: number;
  velocity: number;
}

// Sample bench press rep — concentric (push) → eccentric (lower)
const SAMPLE_DATA: DataPoint[] = [
  { time: 0.0, force: 0, velocity: 0 },
  { time: 0.2, force: 22, velocity: 0.35 },
  { time: 0.4, force: 52, velocity: 0.72 },
  { time: 0.6, force: 78, velocity: 0.95 },
  { time: 0.8, force: 91, velocity: 1.08 },
  { time: 1.0, force: 95, velocity: 0.88 },
  { time: 1.2, force: 90, velocity: 0.52 },
  { time: 1.5, force: 82, velocity: 0.15 },
  { time: 1.8, force: 78, velocity: 0.08 },
  { time: 2.0, force: 84, velocity: 0.32 },
  { time: 2.3, force: 87, velocity: 0.55 },
  { time: 2.6, force: 85, velocity: 0.48 },
  { time: 3.0, force: 78, velocity: 0.32 },
  { time: 3.3, force: 58, velocity: 0.22 },
  { time: 3.6, force: 28, velocity: 0.12 },
  { time: 3.8, force: 8, velocity: 0.05 },
  { time: 4.0, force: 0, velocity: 0 },
];

// Velocity zones from project spec (CLAUDE.md parity-critical section)
function getVelocityZone(v: number): { name: string; color: string } {
  const abs = Math.abs(v);
  if (abs >= 1.0) return { name: "Explosive", color: PHOENIX.ember };
  if (abs >= 0.75) return { name: "Fast", color: PHOENIX.gold };
  if (abs >= 0.5) return { name: "Moderate", color: PHOENIX.forgeGreen };
  if (abs >= 0.25) return { name: "Slow", color: PHOENIX.ashGray };
  return { name: "Grind", color: PHOENIX.moltenSteel };
}

const bisectTime = bisector<DataPoint, number>((d) => d.time).left;
const getTime = (d: DataPoint) => d.time;
const getForce = (d: DataPoint) => d.force;

const MARGIN = { top: 16, right: 16, bottom: 36, left: 44 };

function Chart({ width, height }: { width: number; height: number }) {
  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop } =
    useTooltip<DataPoint>();

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  const xScale = useMemo(
    () => scaleLinear({ domain: [0, 4], range: [0, innerWidth] }),
    [innerWidth],
  );

  const yScale = useMemo(
    () => scaleLinear({ domain: [0, 110], range: [innerHeight, 0] }),
    [innerHeight],
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const point = localPoint(event);
      if (!point) return;
      const x0 = xScale.invert(point.x - MARGIN.left);
      const idx = bisectTime(SAMPLE_DATA, x0, 1);
      const d0 = SAMPLE_DATA[idx - 1];
      const d1 = SAMPLE_DATA[idx];
      if (!d0 || !d1) return;
      const d = x0 - d0.time > d1.time - x0 ? d1 : d0;
      showTooltip({
        tooltipData: d,
        tooltipLeft: xScale(d.time) + MARGIN.left,
        tooltipTop: yScale(d.force) + MARGIN.top,
      });
    },
    [xScale, yScale, showTooltip],
  );

  // Determine phase midpoints for labels
  const concentricX = xScale(0.8) + MARGIN.left;
  const eccentricX = xScale(2.8) + MARGIN.left;

  return (
    <div className="relative">
      <svg width={width} height={height}>
        <LinearGradient
          id="force-area-gradient"
          from={PHOENIX.ember}
          to={PHOENIX.ember}
          fromOpacity={0.15}
          toOpacity={0.02}
        />
        <Group left={MARGIN.left} top={MARGIN.top}>
          {/* Area fill */}
          <AreaClosed
            data={SAMPLE_DATA}
            x={(d) => xScale(getTime(d))}
            y={(d) => yScale(getForce(d))}
            yScale={yScale}
            curve={curveNatural}
            fill="url(#force-area-gradient)"
          />
          {/* Force line */}
          <LinePath
            data={SAMPLE_DATA}
            x={(d) => xScale(getTime(d))}
            y={(d) => yScale(getForce(d))}
            curve={curveNatural}
            stroke={PHOENIX.ember}
            strokeWidth={2}
            strokeLinecap="round"
          />
          {/* Phase divider */}
          <line
            x1={xScale(1.8)}
            y1={0}
            x2={xScale(1.8)}
            y2={innerHeight}
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray="4,4"
          />
          {/* Axes */}
          <AxisLeft
            scale={yScale}
            numTicks={5}
            stroke="rgba(255,255,255,0.1)"
            tickStroke="rgba(255,255,255,0.1)"
            tickLabelProps={{
              fill: "#6B7280",
              fontSize: 10,
              fontFamily: "inherit",
              textAnchor: "end",
              dx: -4,
            }}
            label="Force (kg)"
            labelProps={{
              fill: "#6B7280",
              fontSize: 11,
              fontFamily: "inherit",
              textAnchor: "middle",
            }}
            labelOffset={28}
          />
          <AxisBottom
            scale={xScale}
            top={innerHeight}
            numTicks={4}
            stroke="rgba(255,255,255,0.1)"
            tickStroke="rgba(255,255,255,0.1)"
            tickLabelProps={{
              fill: "#6B7280",
              fontSize: 10,
              fontFamily: "inherit",
              textAnchor: "middle",
            }}
            tickFormat={(v) => `${v}s`}
          />
          {/* Hover capture area */}
          <rect
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onMouseMove={handleMouseMove}
            onMouseLeave={hideTooltip}
          />
          {/* Tooltip crosshair */}
          {tooltipData && (
            <>
              <line
                x1={xScale(tooltipData.time)}
                y1={0}
                x2={xScale(tooltipData.time)}
                y2={innerHeight}
                stroke={PHOENIX.ember}
                strokeWidth={1}
                strokeDasharray="3,3"
                pointerEvents="none"
              />
              <circle
                cx={xScale(tooltipData.time)}
                cy={yScale(tooltipData.force)}
                r={4}
                fill={PHOENIX.ember}
                stroke="#0D0D0D"
                strokeWidth={2}
                pointerEvents="none"
              />
            </>
          )}
        </Group>
        {/* Phase labels */}
        <text
          x={concentricX}
          y={height - 4}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          Concentric
        </text>
        <text
          x={eccentricX}
          y={height - 4}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          Eccentric
        </text>
      </svg>

      {/* Tooltip card */}
      {tooltipData && (
        <div
          className="absolute pointer-events-none bg-surface-2 border border-white/10 rounded-md px-3 py-2 text-xs shadow-lg"
          style={{
            left: tooltipLeft,
            top: (tooltipTop ?? 0) - 64,
            transform: "translateX(-50%)",
          }}
        >
          <div className="font-semibold text-white tabular-nums">
            {tooltipData.force} kg
          </div>
          <div className="text-muted-foreground tabular-nums">
            {tooltipData.velocity.toFixed(2)} m/s
          </div>
          <div
            className="text-xs font-medium mt-0.5"
            style={{ color: getVelocityZone(tooltipData.velocity).color }}
          >
            {getVelocityZone(tooltipData.velocity).name}
          </div>
        </div>
      )}
    </div>
  );
}

export function ForceCurveDemo() {
  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="eyebrow text-muted-foreground">LIVE DEMO</span>
          <h3 className="text-base font-medium text-white mt-0.5">
            Cable bench press — single rep
          </h3>
        </div>
        <span className="text-xs text-muted-foreground hidden sm:block">
          Hover to explore
        </span>
      </div>
      <div className="rounded-lg border border-white/[0.06] bg-surface-2 p-3">
        <ParentSize debounceTime={100}>
          {({ width }) => (
            <Chart width={Math.max(width, 300)} height={220} />
          )}
        </ParentSize>
      </div>
      <p className="text-xs text-muted-foreground mt-2 text-center">
        Force output and velocity zones from a single Vitruvian rep — this is what Phoenix Portal shows for every set.
      </p>
    </div>
  );
}
```

**Implementation notes for the agent:**
- The visx imports (`@visx/axis`, `@visx/scale`, `@visx/shape`, `@visx/tooltip`, `@visx/responsive`, `@visx/gradient`, `@visx/event`, `@visx/group`, `@visx/curve`) are already in the project's dependencies (check `node_modules/@visx/`). If any are missing, install with `npm install @visx/tooltip` (etc.).
- `d3-array` is used for `bisector`. It is a transitive dependency of visx, but should be added as a direct dependency to make the contract explicit: `npm install d3-array` and `npm install -D @types/d3-array` (if types are needed).
- The `PHOENIX.moltenSteel` value is `#374151` from `src/lib/colors.ts`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/app/components/landing/__tests__/ForceCurveDemo.test.tsx
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/components/landing/ForceCurveDemo.tsx src/app/components/landing/__tests__/ForceCurveDemo.test.tsx
git commit -m "feat: add interactive ForceCurveDemo for landing page

visx-based force curve showing a sample bench press rep with velocity
zone color coding, hover tooltip (force kg, velocity m/s, zone name),
and phase labels (concentric/eccentric). Uses hardcoded sample data.
Zones match project spec thresholds (EXPLOSIVE >= 1.0, FAST >= 0.75,
MODERATE >= 0.5, SLOW >= 0.25, GRIND < 0.25)."
```

---

### Task 5: Rewrite Landing Page Hero Section

**Why:** The hero currently uses a faded background image, atmospheric copy ("Your workouts, unlocked." / "Rise From the Ashes. Forge Your Strength."), and generic CTAs ("Get Started" / "View Plans"). The rewrite leads with product proof: a concrete headline, the ProductShowcase panels, aligned CTAs, and a proof row.

**Files:**
- Modify: `src/app/components/LandingPage.tsx:561-717` (hero section)
- Modify: `src/app/components/LandingPage.tsx:1-43` (imports)

- [ ] **Step 1: Update test expectations for new hero copy**

In `src/app/components/__tests__/LandingPage.test.tsx`, change:
```tsx
it("renders without crashing", () => {
  renderWithProviders(<LandingPage />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    /your workouts, unlocked\./i,
  );
});
```
To:
```tsx
it("renders without crashing", () => {
  renderWithProviders(<LandingPage />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    /see every rep as data/i,
  );
});

it("renders proof row capabilities", () => {
  renderWithProviders(<LandingPage />);
  expect(screen.getByText("Force curves")).toBeInTheDocument();
  expect(screen.getByText("Recovery signals")).toBeInTheDocument();
  expect(screen.getByText("Records")).toBeInTheDocument();
  expect(screen.getByText("Replay")).toBeInTheDocument();
});

it("renders product-aligned CTAs", () => {
  renderWithProviders(<LandingPage />);
  // "Preview dashboard" appears in hero AND CTA section (Task 8)
  const previewBtns = screen.getAllByRole("button", { name: /preview dashboard/i });
  expect(previewBtns.length).toBeGreaterThanOrEqual(1);
  // "Get the mobile app" links appear in hero AND CTA section
  const appLinks = screen.getAllByRole("link", { name: /get the mobile app/i });
  expect(appLinks.length).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/app/components/__tests__/LandingPage.test.tsx
```
Expected: FAIL — old heading text no longer matches

- [ ] **Step 3: Add imports for new components**

In `LandingPage.tsx`, add to imports (near line 42):
```tsx
import { ProductShowcase } from "./landing/ProductShowcase";
```

Remove the `EmberParticles` import:
```tsx
// DELETE: import { EmberParticles } from "./EmberParticles";
```

- [ ] **Step 4: Rewrite the hero section**

Replace the hero section (lines 617-717) with:
```tsx
{/* Hero Section */}
<section className="relative min-h-[80svh] md:min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8 pt-24">
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.6 }}
    className="text-center z-10 flex flex-col items-center max-w-4xl mx-auto"
  >
    <motion.h1
      className="text-5xl sm:text-6xl md:text-7xl tracking-tight font-family-display"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.15 }}
    >
      <span className="block text-white">
        See every rep as data.
      </span>
    </motion.h1>

    <motion.p
      className="mt-5 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3 }}
    >
      Force curves, recovery signals, PR trends, and session analysis
      — synced from the Project Phoenix app.
    </motion.p>

    <motion.div
      className="mt-8 flex flex-col sm:flex-row gap-3 justify-center items-stretch sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.45 }}
    >
      <Button
        size="lg"
        onClick={openAuth}
        className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-white border-0 btn-shimmer"
      >
        Preview dashboard
      </Button>
      <Button
        asChild
        size="lg"
        variant="outline"
        className="w-full sm:w-auto border border-white/15 text-white hover:bg-white/5"
      >
        <a
          href="https://github.com/nicholascross/ProjectPhoenix"
          target="_blank"
          rel="noopener noreferrer"
        >
          Get the mobile app
        </a>
      </Button>
    </motion.div>

    {/* Proof row */}
    <motion.div
      className="mt-6 flex items-center gap-4 sm:gap-6 text-sm text-muted-foreground"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.6 }}
    >
      {["Force curves", "Recovery signals", "Records", "Replay"].map((item) => (
        <span key={item} className="flex items-center gap-1.5">
          <span className="w-1 h-1 rounded-full bg-primary" aria-hidden="true" />
          {item}
        </span>
      ))}
    </motion.div>
  </motion.div>

  {/* Product showcase panels */}
  <motion.div
    className="mt-12 md:mt-16 w-full max-w-lg z-10"
    initial={{ opacity: 0, y: 24 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: 0.5, duration: 0.6 }}
  >
    <ProductShowcase />
  </motion.div>
</section>
```

**Key changes:**
- Removed `EmberParticles` from the return JSX (line 563: remove `<EmberParticles />`)
- Removed parallax transforms (`heroY`, `heroOpacity` style props)
- Removed phoenix-hero.png background image
- Removed breathing scroll indicator
- New headline is white text (not gradient) — cleaner, more confident
- CTAs are product-aligned: "Preview dashboard" (opens auth) + "Get the mobile app" (links to GitHub/download)
- Added proof row with 4 capability keywords
- Added ProductShowcase below hero text

**Note:** The `heroY`, `heroOpacity`, `useScroll`, and `useTransform` imports and variables (lines 82-85) can be removed since they're no longer used. Clean up the unused `breathing` import from `@/lib/animations` as well.

- [ ] **Step 5: Remove unused parallax code**

Remove or comment out these lines from the component body:
```tsx
// Lines 82-85 — remove these
const { scrollY } = useScroll();
const heroY = useTransform(scrollY, [0, 500], [0, -80]);
const heroOpacity = useTransform(scrollY, [0, 400], [1, 0]);
```

Update imports to remove unused motion hooks:
```tsx
// Change from:
import { motion, useScroll, useTransform } from "motion/react";
// To:
import { motion } from "motion/react";
```

Remove unused `breathing` import:
```tsx
// Change from:
import { breathing, tap } from "@/lib/animations";
// To:
import { tap } from "@/lib/animations";
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/app/components/__tests__/LandingPage.test.tsx
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/components/LandingPage.tsx src/app/components/__tests__/LandingPage.test.tsx
git commit -m "feat: rewrite landing page hero with product-first messaging

Replace atmospheric hero (background image, parallax, 'Your workouts, unlocked.')
with product-revealing hero ('See every rep as data.', ProductShowcase panels,
proof row). CTAs now align with product reality: 'Preview dashboard' + 'Get the
mobile app'. Remove EmberParticles, parallax transforms, and breathing indicator."
```

---

### Task 6: Rewrite Features Section

**Why:** "Built for serious athletes" and the current feature descriptions are generic motivational copy. The rewrite uses concrete, product-specific labels that tell visitors exactly what data they'll see.

**Files:**
- Modify: `src/app/components/LandingPage.tsx:196-239` (features data)
- Modify: `src/app/components/LandingPage.tsx:719-772` (features section JSX)

- [ ] **Step 1: Update test for new section heading**

In `LandingPage.test.tsx`, update the eyebrow label test:
```tsx
it("renders section eyebrow labels", () => {
  renderWithProviders(<LandingPage />);
  expect(screen.getByText("WHAT YOU GET")).toBeInTheDocument();
  expect(screen.getByText("PRICING")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/app/components/__tests__/LandingPage.test.tsx
```
Expected: FAIL — "FEATURES" exists, "WHAT YOU GET" does not

- [ ] **Step 3: Rewrite feature data array**

Replace the `features` array (lines 196-239):
```tsx
const features = [
  {
    icon: Cloud,
    title: "Sync & Backup",
    badge: "EMBER",
    description:
      "Workouts sync from the Project Phoenix mobile app automatically. Full history, searchable, exportable. Never lose a session.",
  },
  {
    icon: Trophy,
    title: "Records & Leaderboards",
    badge: "EMBER",
    description:
      "Personal records tracked per exercise, phase, and weight. See where you rank against other Vitruvian athletes on community leaderboards.",
  },
  {
    icon: Share2,
    title: "Routines & Cycles",
    badge: "FLAME",
    description:
      "Build training routines with supersets, AMRAP, and PR scaling. Organize into periodized cycles. Share with the community.",
  },
  {
    icon: Activity,
    title: "Analytics & Trends",
    badge: "FLAME",
    description:
      "Volume trends, muscle group distribution, training load, and progressive overload tracking across every exercise and time period.",
  },
  {
    icon: Target,
    title: "Biomechanics & Asymmetry",
    badge: "INFERNO",
    description:
      "Cable A/B force comparison catches left-right imbalances at the 2% threshold. Full biomechanics dashboard with velocity-based training zones.",
  },
  {
    icon: Play,
    title: "Session Replay",
    badge: "INFERNO",
    description:
      "50Hz telemetry playback of every rep. Scrub through sets on a Canvas timeline, overlay force curves, and spot fatigue patterns.",
  },
];
```

- [ ] **Step 4: Rewrite features section header**

Replace the features section header JSX (around lines 725-739):
```tsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true }}
  className="text-center mb-16"
>
  <p className="eyebrow text-primary mb-3">WHAT YOU GET</p>
  <h2 className="text-3xl sm:text-4xl mb-4 text-white font-family-display">
    What your machine captures — finally visible.
  </h2>
  <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
    Every rep generates force, velocity, and timing data. Phoenix Portal
    turns it into actionable training intelligence.
  </p>
</motion.div>
```

Note the heading is slightly smaller (`text-3xl sm:text-4xl` instead of `text-4xl sm:text-5xl`) to reduce visual competition with the hero.

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/app/components/__tests__/LandingPage.test.tsx
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/components/LandingPage.tsx src/app/components/__tests__/LandingPage.test.tsx
git commit -m "feat: rewrite features section with concrete product labels

Replace 'Built for serious athletes' with 'What your machine captures —
finally visible.' Rewrite all 6 feature descriptions to be data-specific:
Sync & Backup, Records & Leaderboards, Routines & Cycles, Analytics & Trends,
Biomechanics & Asymmetry, Session Replay. Change eyebrow from FEATURES to
WHAT YOU GET."
```

---

### Task 7: Clean Up Pricing Section

**Why:** "Choose Your Path" is generic. The pricing cards use heavy gradients and glow. The rewrite makes pricing cleaner and more editorial — less gradient, sharper borders, concrete heading.

**Files:**
- Modify: `src/app/components/LandingPage.tsx:774-873` (pricing section)

- [ ] **Step 1: Rewrite pricing section header**

Replace the pricing header (around lines 777-790):
```tsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true }}
  className="text-center mb-16"
>
  <p className="eyebrow text-primary mb-3">PRICING</p>
  <h2 className="text-3xl sm:text-4xl mb-4 text-white font-family-display">
    Plans
  </h2>
  <p className="text-lg text-muted-foreground">
    Each tier unlocks deeper analysis.
  </p>
</motion.div>
```

- [ ] **Step 2: Simplify pricing card styling**

Replace the Card className logic (around lines 802-807):
```tsx
<Card
  className={`p-8 h-full flex flex-col ${
    tier.highlight
      ? "bg-surface-2 border-primary border ring-1 ring-primary/20"
      : "bg-surface-1 border-white/[0.06]"
  }`}
>
```

Key changes:
- Remove `bg-gradient-to-br` from all cards
- Highlighted card: solid `bg-surface-2` with single primary border (not double + ring-4)
- Non-highlighted: `bg-surface-1` with subtle white border
- Less gradient, more structure

- [ ] **Step 3: Simplify the highlighted CTA button**

Replace the highlighted tier CTA button (around line 862):
```tsx
tier.highlight
  ? "w-full bg-primary hover:bg-primary/90 border-0"
  : "w-full border border-white/15 text-white hover:bg-white/5"
```

Remove `shadow-lg shadow-primary/50` from the highlighted button — it creates the "glowing CTA" effect that reads as AI-generated.

- [ ] **Step 4: Simplify the RECOMMENDED badge**

Replace the RECOMMENDED div (around lines 809-812):
```tsx
{tier.highlight && (
  <div className="mb-4 px-3 py-0.5 bg-primary/15 text-primary text-xs font-medium rounded-full text-center w-fit mx-auto border border-primary/25">
    RECOMMENDED
  </div>
)}
```

Removed the gradient background — now uses a subtle fill with border.

- [ ] **Step 5: Verify build**

```bash
cd C:/Users/dasbl/AndroidStudioProjects/Phoenix\ App\ Monorepo/phoenix-portal
npm run build
```
Expected: SUCCESS

- [ ] **Step 6: Commit**

```bash
git add src/app/components/LandingPage.tsx
git commit -m "style: clean up pricing section — less gradient, more editorial

Replace 'Choose Your Path' with 'Plans'. Remove gradient backgrounds from
pricing cards. Simplify highlighted tier to solid surface + single border.
Remove glow from CTA buttons. Subtle RECOMMENDED badge instead of
gradient pill."
```

---

### Task 8: Rewrite CTA Section and Footer

**Why:** "Fan the flames" is the most obvious phoenix-metaphor moment on the page. The CTA section should explain the sync relationship (mobile app captures data, portal displays it) and provide product-aligned actions.

**Files:**
- Modify: `src/app/components/LandingPage.tsx:875-928` (CTA section)
- Modify: `src/app/components/LandingPage.tsx:930-1044` (footer)

- [ ] **Step 1: Rewrite CTA section**

Replace the CTA section (lines 875-928):
```tsx
{/* CTA Section */}
<section className="relative py-24 px-4 sm:px-6 lg:px-8">
  <div className="max-w-3xl mx-auto text-center">
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
    >
      <h2 className="text-3xl sm:text-4xl mb-4 text-white font-family-display">
        Start syncing workouts.
      </h2>
      <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
        Connect the Project Phoenix mobile app, complete a workout, and
        your data flows here automatically. Force curves, recovery,
        records — everything updates in real time.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center items-stretch sm:items-center">
        <Button
          asChild
          size="lg"
          className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-white border-0"
        >
          <a
            href="https://github.com/nicholascross/ProjectPhoenix"
            target="_blank"
            rel="noopener noreferrer"
          >
            Get the mobile app
          </a>
        </Button>
        <Button
          size="lg"
          variant="outline"
          onClick={openAuth}
          className="w-full sm:w-auto border border-white/15 text-white hover:bg-white/5"
        >
          Preview dashboard
        </Button>
      </div>
      <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-4 text-sm text-muted-foreground">
        <a
          href="https://ko-fi.com/vitruvianredux"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-primary transition-colors"
        >
          Support on Ko-fi
        </a>
      </div>
    </motion.div>
  </div>
</section>
```

Key changes:
- Removed `Flame` icon (was being used purely for atmosphere)
- Removed gradient background (`bg-gradient-to-b from-amber-900/20`)
- Removed gradient CTA buttons — using solid primary and outline
- Primary CTA is "Get the mobile app" (aligned with product reality)
- Secondary is "Preview dashboard"
- Ko-fi demoted to a text link below

- [ ] **Step 2: Clean up footer tagline**

In the footer (around line 940), change:
```tsx
<p className="text-muted-foreground text-sm">
  Rise From the Ashes. Forge Your Strength.
</p>
```
To:
```tsx
<p className="text-muted-foreground text-sm">
  Performance data for Vitruvian athletes.
</p>
```

- [ ] **Step 3: Clean up unused Flame import**

If `Flame` is no longer used in the component after removing it from the CTA section, remove it from the lucide-react import at the top of the file.

Check if `Flame` is used anywhere else in the component. If not:
```tsx
// Remove Flame from this import
import {
  Activity,
  ArrowRight, // Also check if still used — was in old "Get Started" button
  Cloud,
  ExternalLink, // Check if still used — was in old Ko-fi button
  // Flame, — REMOVE
  Loader2,
  Mail,
  Play,
  Share2,
  Target,
  Trophy,
} from "lucide-react";
```

Also check `ArrowRight` and `ExternalLink` — if no longer used, remove them too.

- [ ] **Step 4: Run tests and build**

```bash
npx vitest run src/app/components/__tests__/LandingPage.test.tsx && npm run build
```
Expected: PASS, build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/app/components/LandingPage.tsx
git commit -m "feat: rewrite CTA section and footer copy

Replace 'Fan the flames' with 'Start syncing workouts.' Explain the
mobile-to-portal sync flow concretely. Align CTAs with product reality:
'Get the mobile app' (primary) + 'Preview dashboard' (secondary).
Remove gradient backgrounds and Flame icon. Update footer tagline to
'Performance data for Vitruvian athletes.'"
```

---

### Task 9: Integrate ForceCurveDemo Into Landing Page

**Why:** The interactive force curve is the "signature interaction" that differentiates this from a static feature list. It goes between features and pricing to demonstrate what the analytics actually look like.

**Files:**
- Modify: `src/app/components/LandingPage.tsx` (add demo section)

- [ ] **Step 1: Add ForceCurveDemo import**

Add to imports:
```tsx
import { ForceCurveDemo } from "./landing/ForceCurveDemo";
```

- [ ] **Step 2: Add demo section between features and pricing**

After the features `</section>` closing tag and before the pricing `<section>`, add:
```tsx
{/* Interactive Demo Section */}
<section className="relative py-20 px-4 sm:px-6 lg:px-8">
  <div className="max-w-7xl mx-auto">
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="text-center mb-10"
    >
      <p className="eyebrow text-primary mb-3">TRY IT</p>
      <h2 className="text-3xl sm:text-4xl mb-3 text-white font-family-display">
        Explore a real force curve.
      </h2>
      <p className="text-lg text-muted-foreground max-w-xl mx-auto">
        This is one rep of sample data. The full portal shows every
        set, every session, with velocity zones and fatigue detection.
      </p>
    </motion.div>
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: 0.15 }}
    >
      <ForceCurveDemo />
    </motion.div>
  </div>
</section>
```

- [ ] **Step 3: Add test for demo section**

Add to `LandingPage.test.tsx`:
```tsx
it("renders interactive demo section", () => {
  renderWithProviders(<LandingPage />);
  expect(screen.getByText("TRY IT")).toBeInTheDocument();
  expect(screen.getByText(/explore a real force curve/i)).toBeInTheDocument();
});
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/app/components/__tests__/LandingPage.test.tsx
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/components/LandingPage.tsx src/app/components/__tests__/LandingPage.test.tsx
git commit -m "feat: integrate interactive ForceCurveDemo into landing page

Add 'TRY IT' section between features and pricing with the interactive
force curve demo. Visitors can hover to explore force/velocity data
from a sample rep, immediately demonstrating the product's data depth."
```

---

### Task 10: Remove Landing Page Gradient Border From Feature Cards

**Why:** The `card-landing-feature` class uses a gradient border technique (padding-box + border-box) that creates the "AI-coded" aesthetic. Replacing with a simple subtle border makes the cards feel more professional and less decorative.

**Files:**
- Modify: `src/styles/theme.css:444-459` (card-landing-feature utility)

- [ ] **Step 1: Simplify card-landing-feature**

Replace the `.card-landing-feature` definition:
```css
/* Landing feature card — clean panel, subtle hover lift */
.card-landing-feature {
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: var(--surface-2);
  box-shadow: var(--shadow-sm);
  transition: transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease;
}
.card-landing-feature:hover {
  transform: translateY(-2px);
  border-color: rgba(255, 107, 53, 0.2);
  box-shadow: var(--shadow-md);
}
```

Key changes:
- Removed gradient border technique entirely
- Solid `surface-2` background instead of gradient
- Hover shows a subtle ember border highlight instead of heavy glow
- Hover lift reduced from 3px to 2px

- [ ] **Step 2: Verify build**

```bash
npm run build
```
Expected: SUCCESS

- [ ] **Step 3: Commit**

```bash
git add src/styles/theme.css
git commit -m "style: simplify landing feature cards — remove gradient border

Replace gradient border-box technique with simple white/6% border.
Hover now shows subtle ember border instead of heavy glow box-shadow.
Lift reduced from 3px to 2px. Solid surface-2 background."
```

---

### Task 11: Final Verification and Type Check

**Files:** All modified files

- [ ] **Step 1: Run full test suite**

```bash
cd C:/Users/dasbl/AndroidStudioProjects/Phoenix\ App\ Monorepo/phoenix-portal
npm test
```
Expected: All tests pass (including updated LandingPage tests and new component tests)

- [ ] **Step 2: Run TypeScript type check**

```bash
npm run typecheck
```
Expected: No type errors

- [ ] **Step 3: Run Biome lint**

```bash
npx biome check src/app/components/LandingPage.tsx src/app/components/landing/ src/styles/theme.css src/lib/colors.ts
```
Expected: No lint errors. If any, fix with `npx biome check --write`.

- [ ] **Step 4: Run production build**

```bash
npm run build
```
Expected: Build succeeds. Check dist output size hasn't grown unreasonably (visx components were already in the bundle).

- [ ] **Step 5: Visual verification — run dev server**

```bash
npm run dev
```

Check in browser:
1. **Landing hero**: White "See every rep as data." headline, concise subtitle, two CTAs, proof row, ProductShowcase panels below
2. **Features section**: "WHAT YOU GET" eyebrow, concrete feature labels, subtle card hover (no gradient border)
3. **Interactive demo**: Force curve renders, hover tooltip works, phase labels visible
4. **Pricing**: "Plans" heading, clean cards without gradient backgrounds, subtle RECOMMENDED badge
5. **CTA section**: "Start syncing workouts." heading, product-aligned CTAs, no gradient background
6. **Footer**: Updated tagline
7. **Sidebar** (login required): Subtle active state, reduced glow
8. **Overall**: Reduced ambient glow, no reddish haze, cards feel sharper

- [ ] **Step 6: Commit any remaining fixes**

```bash
git add src/app/components/LandingPage.tsx src/app/components/landing/ src/app/components/__tests__/LandingPage.test.tsx src/styles/theme.css src/lib/colors.ts
git commit -m "fix: final verification cleanup for landing page overhaul"
```

---

## Follow-Up Plans (Not In Scope)

These were identified in the design critique but are separate work streams:

1. **Dashboard Redesign** — Layout restructure (status strip + hero workout + secondary rail), empty state redesign (momentum builders instead of failure states), streak card demotion, sync banner quieting, weekly volume sparkline above the fold.

2. **Workout History Redesign** — Calendar enrichment (activity dots, volume tints, PR badges per day), right-side detail drawer on day selection, heatmap view mode, list view mode, smaller grid cells with richer data.

3. **Analytics Hub Redesign** — Hero insight banner ("Volume up 23% over 30 days"), KPI context lines ("vs 30-day average"), sparklines in stat cards, Activity Sources compression, horizontal bar chart for muscle groups (replacing donut), chart readability improvements.

4. **Public Page Prerendering** — SSG/prerender for landing, FAQ, terms, privacy pages. Requires build pipeline changes (vite-ssg or @prerenderer/rollup-plugin) and Cloudflare Pages configuration. Important for SEO and accessibility but architecturally separate.

5. **Copy Audit Across App Interior** — Replace motivational copy ("Let's make today count. Your strength awaits.") with operational language ("Synced 12 min ago. 1 workout planned. Recovery 72.") across Dashboard, WorkoutHistory, and Analytics.
