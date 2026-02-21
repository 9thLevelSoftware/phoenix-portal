# Architecture Research

**Domain:** Premium fitness analytics dashboard — visual overhaul of existing React 19 + Tailwind v4 + shadcn/ui app
**Researched:** 2026-02-20
**Confidence:** HIGH

---

## Standard Architecture

### Current System vs Target System

```
CURRENT (v1.1)
┌─────────────────────────────────────────────────────────────────┐
│                     AppLayout (routes/AppLayout.tsx)             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Navigation (horizontal top bar, 13 items, overflows)    │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  <Outlet />  (each page owns: min-h-screen, pb-20 md:pb- │   │
│  │               8, max-w-7xl mx-auto px-4 sm:px-6 lg:px-8) │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  MobileBottomNav (fixed bottom, 4 primary + More drawer) │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

Pages duplicate: min-h-screen, pb-20 md:pb-8, max-w-7xl, px-4 sm:px-6 lg:px-8
Mobile variants: DashboardMobile, AnalyticsMobile, CommunityMobile, ChallengeMobile
                 rendered via useIsMobile() JS hook with flash-on-first-render risk

TARGET (v1.2)
┌─────────────────────────────────────────────────────────────────┐
│                     AppLayout (routes/AppLayout.tsx)             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  SidebarProvider (shadcn/ui, collapsible="icon")          │   │
│  │  ┌────────────┐  ┌──────────────────────────────────┐   │   │
│  │  │  AppSidebar│  │  main.flex-1.overflow-auto        │   │   │
│  │  │  (logo,    │  │  ┌────────────────────────────┐  │   │   │
│  │  │   nav,     │  │  │  PageShell (shared padding, │  │   │   │
│  │  │   user,    │  │  │  max-width, page header)    │  │   │   │
│  │  │   streak)  │  │  │  <Outlet />                 │  │   │   │
│  │  └────────────┘  │  └────────────────────────────┘  │   │   │
│  │                  └──────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  MobileBottomNav (unchanged — kept CSS-only responsive)  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

Pages use: <PageShell title="..." subtitle="..." actions={...}>
Mobile switching: CSS media queries in PageShell/cards replace useIsMobile()
```

---

## Component Boundaries

### What Changes vs What Stays

| Component | Status | Change Required |
|-----------|--------|-----------------|
| `Navigation.tsx` | **Replace** | Delete; replaced by `AppSidebar.tsx` |
| `AppLayout.tsx` | **Modify** | Wrap in `SidebarProvider`; add `AppSidebar`; `main` tag for content area |
| `PageShell.tsx` | **Create** | New shared shell — eliminates `max-w-7xl`/`pb-20` duplication |
| `MobileBottomNav.tsx` | **Keep** | No changes; already correct |
| `ui/sidebar.tsx` | **Keep** | Already installed, 725 lines, full shadcn/ui implementation |
| `AppSidebar.tsx` | **Create** | New sidebar nav using shadcn/ui `Sidebar*` primitives |
| `ui/card.tsx` | **Extend** | Add `StatCard`, `MetricCard` variants above base `Card` |
| `lib/animations.ts` | **Create** | Shared Framer Motion variant presets |
| `DashboardMobile.tsx` | **Delete** | Absorbed into CSS-responsive `Dashboard.tsx` |
| `mobile/AnalyticsMobile.tsx` | **Delete** | Absorbed into CSS-responsive `Analytics.tsx` |
| `mobile/CommunityMobile.tsx` | **Delete** | Absorbed into CSS-responsive `Community.tsx` |
| `mobile/ChallengesMobile.tsx` | **Delete** | Absorbed into CSS-responsive `Challenges.tsx` |
| All page components (13+) | **Light touch** | Remove `min-h-screen`, `pb-20 md:pb-8`, `max-w-7xl mx-auto px-*` — PageShell owns these |

---

## Recommended Project Structure

```
src/
├── app/
│   ├── components/
│   │   ├── ui/
│   │   │   ├── sidebar.tsx         # Already installed — do NOT modify
│   │   │   ├── card.tsx            # Add StatCard, MetricCard exports
│   │   │   └── ...                 # All other shadcn primitives unchanged
│   │   ├── shell/                  # New folder for layout components
│   │   │   ├── AppSidebar.tsx      # Sidebar nav using shadcn Sidebar* primitives
│   │   │   └── PageShell.tsx       # Shared page container (max-w, padding, header)
│   │   ├── Dashboard.tsx           # Page owns data + composition only
│   │   ├── Analytics.tsx           # Remove isMobile branch; CSS handles it
│   │   └── ...
│   ├── hooks/
│   │   └── useIsMobile.ts          # Deprecate for layout; keep only for chart sizing
│   └── routes/
│       └── AppLayout.tsx           # Add SidebarProvider + AppSidebar
├── lib/
│   ├── animations.ts               # NEW: shared Framer Motion variant presets
│   └── colors.ts                   # Unchanged
└── styles/
    └── theme.css                   # sidebar-* tokens already exist — use them
```

---

## Architectural Patterns

### Pattern 1: AppSidebar with shadcn/ui SidebarProvider

**What:** Replace the 13-item horizontal `Navigation.tsx` with `AppSidebar.tsx` using the already-installed shadcn/ui sidebar. Wrap `AppLayout` in `SidebarProvider`. Use `collapsible="icon"` mode so the sidebar collapses to icon-only on narrow windows without hiding content.

**When to use:** Desktop-primary apps where primary nav belongs in a persistent sidebar. Phoenix already has all the sidebar CSS tokens in `theme.css` (`--sidebar`, `--sidebar-foreground`, `--sidebar-accent`, etc.).

**Key integration point:** `SidebarProvider` must wrap the entire layout region, not just the sidebar itself. The `main` content area gets `className="flex-1 overflow-auto"` as a sibling of `<Sidebar>`. `MobileBottomNav` stays unchanged — the sidebar hides on mobile via the `isMobile` detection built into `useSidebar()`.

**Example:**
```typescript
// src/app/routes/AppLayout.tsx (modified)
import { SidebarProvider } from "@/app/components/ui/sidebar";
import { AppSidebar } from "@/app/components/shell/AppSidebar";

export function AppLayout() {
  useRealtimeSync();
  useNotificationSync();
  useStreakSync();
  useCelebrationTriggers();
  const { needsOnboarding, needsWhatsNew, completeOnboarding, dismissWhatsNew } = useOnboarding();

  return (
    <div className="min-h-screen bg-surface-0">
      <OfflineBanner />
      <SidebarProvider defaultOpen={true}>
        <AppSidebar />
        <main className="flex-1 overflow-auto">
          {needsOnboarding && <OnboardingOverlay onComplete={() => completeOnboarding.mutate()} />}
          {needsWhatsNew && <WhatsNewBanner onDismiss={() => dismissWhatsNew.mutate()} />}
          <ErrorBoundary FallbackComponent={PageErrorFallback}>
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </SidebarProvider>
      <MobileBottomNav />
      <CelebrationOverlay />
      <Toaster />
    </div>
  );
}
```

**Confidence:** HIGH — shadcn/ui sidebar is already installed at `src/app/components/ui/sidebar.tsx` (725 lines). Sidebar CSS tokens exist in `theme.css`. The `collapsible="icon"` mode collapses to `--sidebar-width-icon: 3rem` automatically.

---

### Pattern 2: PageShell — Shared Page Container

**What:** Create a `PageShell` component that owns all repeated layout concerns. Every authenticated page wraps its content in `<PageShell>` instead of repeating `min-h-screen bg-background pb-20 md:pb-8` + `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8`.

**Why:** The audit found `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` repeated in 30+ locations across the codebase with inconsistent `py` values (some use `py-6`, some `py-8`). Centralizing this in one component allows v1.2 to change padding/width for the entire app in one line.

**When to use:** All authenticated page route components. The landing page (`LandingPage.tsx`) is excluded — it has its own layout.

**Trade-off:** Pages with full-bleed sections (e.g., Session Replay canvas) need an escape hatch. Accept a `flush` prop that removes the max-width constraint.

**Example:**
```typescript
// src/app/components/shell/PageShell.tsx
interface PageShellProps {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  flush?: boolean; // full-bleed, no max-width
  children: React.ReactNode;
}

export function PageShell({ title, subtitle, actions, flush = false, children }: PageShellProps) {
  return (
    <div className="min-h-full pb-20 md:pb-8">
      <div className={flush ? "" : "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"}>
        {(title || actions) && (
          <div className="flex items-center justify-between mb-8">
            {title && (
              <div>
                <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
                {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
              </div>
            )}
            {actions && <div className="flex items-center gap-3">{actions}</div>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
```

**Confidence:** HIGH — standard pattern in every mature React dashboard (Linear, Vercel, Stripe). The current codebase has the duplication problem clearly; this solves it.

---

### Pattern 3: Shared Animation Variant Presets

**What:** Extract all per-component Framer Motion animation inline values into a single `src/lib/animations.ts` file. Every page component currently defines its own `initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.1 }}` inline. This cannot be changed globally.

**When to use:** Any component that uses Framer Motion. Import presets, don't inline values.

**Key presets to define:**
- `fadeUp` — page section entrance (opacity + y slide, 0.3s ease-out)
- `staggerContainer` / `staggerItem` — list animations with coordinated parent-child timing
- `pageTransition` — full-page enter/exit for route changes via `AnimatePresence`
- `springHover` — spring-physics hover for cards (scale: 1.02, shadow intensify)
- `statCount` — number counting entrance animation for stat cards

**Example:**
```typescript
// src/lib/animations.ts
import type { Variants, Transition } from "motion/react";

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
};

export const pageTransition: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: "easeOut" } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15 } },
};

export const springHover = {
  scale: 1.02,
  transition: { type: "spring", stiffness: 400, damping: 20 },
};

export const defaultTransition: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 30,
};
```

**Confidence:** HIGH — Framer Motion variants are officially documented as the recommended way to share and propagate animation states across component trees. The v11 variants API is stable.

---

### Pattern 4: Page Transition via AnimatePresence in AppLayout

**What:** Wrap `<Outlet />` in `<AnimatePresence mode="wait">` with a `key={location.pathname}`. Each page's root element becomes a `<motion.div>` using the `pageTransition` preset. This gives smooth fade-up transitions on route change.

**When to use:** All authenticated routes. Not the landing page (SPA-style transitions look wrong on marketing pages).

**Trade-off:** `mode="wait"` means the old page fades out before the new one fades in — this adds ~150ms to perceived route change time. Acceptable for a premium feel; it's what Whoop and Strava use. Avoid `mode="sync"` which causes overlap artifacts.

**Example:**
```typescript
// In AppLayout.tsx
import { AnimatePresence } from "motion/react";
import { useLocation } from "react-router";

// Inside render:
const location = useLocation();

<AnimatePresence mode="wait" initial={false}>
  <Outlet key={location.pathname} />
</AnimatePresence>
```

Each page root:
```typescript
// In Dashboard.tsx (and all pages)
import { motion } from "motion/react";
import { pageTransition } from "@/lib/animations";

return (
  <motion.div variants={pageTransition} initial="initial" animate="animate" exit="exit">
    <PageShell title="Dashboard">
      {/* content */}
    </PageShell>
  </motion.div>
);
```

**Confidence:** MEDIUM — the pattern is standard and documented (AnimatePresence with Outlet + location.pathname key). The React 19 concurrent mode interaction with AnimatePresence needs to be validated during implementation; Framer Motion v11 claims improved React 19 compatibility but this is partially from web search only.

---

### Pattern 5: CSS-First Responsive Strategy — Replace useIsMobile() for Layout

**What:** Stop using the JS `useIsMobile()` hook to swap between full desktop and mobile component variants. Use Tailwind v4 responsive utilities (`md:` prefix) and container queries (`@container`) to make single components responsive.

**Why:** `useIsMobile()` initializes to `false` (SSR-safe default), then flips to `true` after a `useEffect`. This causes a flash where the desktop component renders briefly on mobile. The hook also means maintaining two separate component files per feature.

**When to keep useIsMobile():** Legitimate uses remain for chart dimension sizing (canvas-based components like session replay need actual pixel dimensions), and for the `useSidebar()` hook's internal mobile detection. Do not use it for component swapping.

**CSS-first responsive strategy:**
- Page layout: `md:` viewport breakpoints (sidebar shows/hides at `md`)
- Card grids: `grid-cols-1 md:grid-cols-2 lg:grid-cols-4`
- Component internals: `@container` queries (Tailwind v4 built-in, no plugin needed)
- Sidebar: hidden on mobile via shadcn's built-in `isMobile` detection (uses `useSidebar`)
- `MobileBottomNav`: stays; it's already `md:hidden`

**Migration path:**
1. `DashboardMobile.tsx` → merge unique mobile widgets into `Dashboard.tsx` using `md:` classes
2. `AnalyticsMobile.tsx` → simplify chart layout with responsive grid in `Analytics.tsx`
3. `CommunityMobile.tsx` → responsive card/list toggle in `Community.tsx`
4. `ChallengesMobile.tsx` → responsive layout in `Challenges.tsx`

**Confidence:** HIGH — Tailwind v4 container queries are built-in (no `@tailwindcss/container-queries` plugin needed). The CSS-first approach is documented as the Tailwind v4 recommended pattern.

---

### Pattern 6: Card Component Hierarchy

**What:** The existing `ui/card.tsx` is a generic `<Card>` primitive. Feature pages need opinionated card variants that encode design decisions (surface level, padding size, hover behavior). Define these as composable wrappers above the base `Card`, not modifications to it.

**Card surface levels (maps to existing CSS vars):**
- Level 0: `bg-surface-1 border-border` — default content card
- Level 1: `bg-surface-2 border-secondary` — nested card (stats inside a section card)
- Overlay: `bg-surface-overlay` — popovers, modals (unchanged, handled by shadcn)

**New card variants to create:**

```typescript
// Additions to ui/card.tsx (or src/app/components/shell/cards.tsx)

// StatCard — single metric with label, trend arrow
export function StatCard({ label, value, trend, icon: Icon, className }: StatCardProps) {
  return (
    <Card className={cn(
      "p-5 bg-gradient-to-br from-surface-2 to-surface-1",
      "border-border hover:border-primary/40 transition-colors",
      "shadow-sm hover:shadow-md",
      className
    )}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-semibold text-foreground mt-1">{value}</p>
          {trend && <TrendBadge value={trend} />}
        </div>
        {Icon && <Icon className="w-5 h-5 text-icon-accent" />}
      </div>
    </Card>
  );
}

// SectionCard — grouped content block with title
export function SectionCard({ title, action, children, className }: SectionCardProps) {
  return (
    <Card className={cn("bg-surface-1 border-border", className)}>
      {title && (
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium">{title}</CardTitle>
            {action}
          </div>
        </CardHeader>
      )}
      <CardContent>{children}</CardContent>
    </Card>
  );
}
```

**Confidence:** HIGH — this pattern (semantic variants above a base primitive) is the standard shadcn/ui extension model. The existing surface CSS tokens in `theme.css` already exist; these cards just use them consistently.

---

## Data Flow

### Layout Data Flow (v1.2)

```
AppLayout mounts
    ↓
SidebarProvider (collapsible state, isMobile detection)
    ├── AppSidebar reads: useAuth, useUIStore(streak), useSidebar()
    │   └── Renders nav items as SidebarMenu → SidebarMenuItem → SidebarMenuButton
    │       with NavLink asChild for React Router integration
    └── main.flex-1
        └── Suspense + AnimatePresence(mode="wait")
            └── <Outlet key={location.pathname} />
                └── Dashboard | Analytics | ... (each as motion.div + PageShell)
```

### Responsive Layout State

```
Viewport width
    ↓ (CSS media query, no JS)
md breakpoint triggers:
  - Sidebar: visible (uses SidebarProvider state for open/collapsed)
  - MobileBottomNav: hidden (md:hidden)
  - Page content: padding adjusts via Tailwind md: utilities

SidebarProvider cookie persistence:
  - SIDEBAR_COOKIE_NAME = "sidebar_state"
  - Stores expanded/collapsed preference between sessions
```

---

## Migration Path (Build Order)

This is the dependency-safe order. Each step is independently deployable.

### Step 1: Foundation — Shared tokens and animation presets
**Files:** `src/lib/animations.ts` (create)
**Why first:** Zero risk — new file, no existing component changes. All subsequent steps import from here.

### Step 2: Card hierarchy — StatCard, SectionCard
**Files:** `src/app/components/ui/card.tsx` or new `src/app/components/shell/cards.tsx`
**Why second:** Other pages import these. Define once, migrate pages later.
**Risk:** Low — additive only, existing `Card` usage unaffected.

### Step 3: PageShell — Shared page container
**Files:** `src/app/components/shell/PageShell.tsx` (create)
**Why third:** Must exist before pages can adopt it.
**Risk:** Low — additive until pages switch to it.

### Step 4: AppSidebar — New nav component
**Files:** `src/app/components/shell/AppSidebar.tsx` (create)
**Dependencies:** `ui/sidebar.tsx` (already installed), `theme.css` sidebar tokens (already exist)
**Why fourth:** Created before AppLayout uses it; allows isolated testing.

### Step 5: AppLayout rewire — Sidebar + AnimatePresence
**Files:** `src/app/routes/AppLayout.tsx` (modify)
**Why fifth:** Depends on AppSidebar (Step 4). This is the highest-risk change — it affects every authenticated route. Must be done in one commit.
**Risk:** HIGH — test all 26 routes after this change. Particularly test:
  - Mobile layout (sidebar must not show; MobileBottomNav must show)
  - Print layout (`data-print-hide` attributes must survive restructuring)
  - CelebrationOverlay placement (must remain above all content)
  - WhatsNewBanner and OnboardingOverlay z-index in new structure

### Step 6: Dashboard — First page migration
**Files:** `src/app/components/Dashboard.tsx`, `DashboardMobile.tsx` (delete)
**Why sixth:** Highest-visibility page, validates PageShell + CSS responsive approach before applying to all pages.
**Pattern:** Remove `useIsMobile()` branch; merge `DashboardMobile.tsx` unique widgets into responsive grid classes.

### Step 7: Remaining pages — Parallel migration
**Files:** Analytics, Community, Challenges, PersonalRecords, WorkoutHistory, Goals, Recovery, Biomechanics, Profile, Routines, Cycles, Integrations, Comparison
**Why last:** Low risk once Steps 3–5 are proven. Each page is an independent change.
**Delete:** `mobile/AnalyticsMobile.tsx`, `mobile/CommunityMobile.tsx`, `mobile/ChallengesMobile.tsx` after their parents absorb responsive logic.

---

## Integration Points

### Between New Shared Components and Existing Pages

| New Component | Integrates With | Integration Method |
|---------------|-----------------|-------------------|
| `AppSidebar` | `ui/sidebar.tsx` | Import `Sidebar`, `SidebarContent`, etc. from shadcn primitives |
| `AppSidebar` | `useUIStore` | Read streak count for streak display in sidebar footer |
| `AppSidebar` | React Router `NavLink` | Use `asChild` prop on `SidebarMenuButton` to delegate to `NavLink` |
| `PageShell` | All 13+ page components | Each page wraps content; remove duplicated layout classes |
| `lib/animations.ts` | All page components | Import `fadeUp`, `staggerContainer`, etc.; remove inline values |
| `AnimatePresence` | `AppLayout` + all pages | AppLayout wraps Outlet; pages return `motion.div` as root |
| `StatCard` | Dashboard, Analytics, Goals, Recovery, Biomechanics | Drop-in replacement for repeated `Card` + metric pattern |
| `SectionCard` | Dashboard, WorkoutHistory, Community | Replaces ad-hoc `Card` with header divs |

### NavLink + SidebarMenuButton Integration

The shadcn `SidebarMenuButton` accepts `asChild` which passes its styles to the child element. This lets React Router's `NavLink` handle the active state while shadcn handles the visual affordance:

```typescript
<SidebarMenuItem>
  <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
    <NavLink to={item.path}>
      <item.icon />
      <span>{item.label}</span>
    </NavLink>
  </SidebarMenuButton>
</SidebarMenuItem>
```

The `isActive` prop needs to be computed outside since `SidebarMenuButton` does not have access to router state. Use `useLocation()` in the parent.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Putting Layout Logic in Page Components

**What people do:** Each page has its own `min-h-screen`, `pb-20 md:pb-8`, `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` — as Phoenix currently has in 30+ locations.
**Why it's wrong:** Changing the app's max-width or safe-area padding requires editing 30+ files. Mobile bottom nav height is hardcoded as `pb-20` in every page.
**Do this instead:** `PageShell` owns all layout primitives. Pages own only their content.

### Anti-Pattern 2: JS-Driven Component Swapping for Responsive Layout

**What people do:** `const isMobile = useIsMobile(); if (isMobile) return <ComponentMobile />;` — as Phoenix has in Analytics, Community, Challenges, Comparison.
**Why it's wrong:** Initializes `false`, then `true` after `useEffect` — causes a hydration flash. Doubles the component count. Changes to shared logic must be made in two places.
**Do this instead:** Use Tailwind `md:` responsive utilities and `@container` queries. One component handles both layouts. Delete the `*Mobile.tsx` variants.

### Anti-Pattern 3: Inline Animation Values on Every Component

**What people do:** `initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.1 }}` inlined in 40+ components.
**Why it's wrong:** Cannot change the app's animation timing system without hunting through 40+ files. Drift occurs — different delays, different y values, different easing functions on each page.
**Do this instead:** `lib/animations.ts` exports named presets. `initial="hidden" animate="visible" variants={fadeUp}` in components. One file controls the entire motion design.

### Anti-Pattern 4: Modifying ui/sidebar.tsx

**What people do:** Edit the shadcn `sidebar.tsx` primitive to customize colors or behavior.
**Why it's wrong:** `ui/sidebar.tsx` is generated by shadcn CLI and gets overwritten on upgrades. Customizations are lost.
**Do this instead:** Customize via `theme.css` CSS variables (`--sidebar`, `--sidebar-accent`, etc. — these already exist). Build `AppSidebar.tsx` as a composition layer on top of the unchanged primitives.

### Anti-Pattern 5: SidebarProvider Outside AppLayout

**What people do:** Wrap the entire `<BrowserRouter>` or `<Routes>` in `SidebarProvider` to make it globally available.
**Why it's wrong:** Lands public routes (landing page, privacy, reset password) inside the sidebar layout. Public pages need no sidebar.
**Do this instead:** `SidebarProvider` goes inside `AppLayout`, which is already nested inside `ProtectedRoute`. Public routes are outside this tree.

---

## Risk Areas

| Risk Area | Risk Level | Description | Mitigation |
|-----------|-----------|-------------|------------|
| AppLayout restructure (Step 5) | HIGH | Wrapping content in `SidebarProvider` + flex layout touches every authenticated route | Manual smoke test all 26 routes; Playwright tests for auth flow |
| Print layout | MEDIUM | `data-print-hide` on `Navigation` hides top nav during print; sidebar structure changes this | Verify `@media print` CSS still hides sidebar correctly; add `data-print-hide` to `AppSidebar` |
| MobileBottomNav z-index | MEDIUM | Currently fixed position above content; sidebar flex layout could create stacking context conflicts | Test on real mobile device after AppLayout change; check z-index ordering |
| CelebrationOverlay rendering | MEDIUM | Currently at end of AppLayout div; new flex structure might clip absolute positioning | Verify overlay covers full viewport in new layout |
| AnimatePresence + Suspense interaction | MEDIUM | `AnimatePresence` and `Suspense` together can conflict — exiting element may complete animation before data loads | Wrap AnimatePresence around Suspense, not inside it; test with network throttling |
| useIsMobile flash deletion | LOW | Removing `useIsMobile()` component swaps might reveal CSS gaps on edge-case viewport sizes | Test all migrated pages at 768px exactly (the boundary) |
| `DashboardMobile` unique widgets | LOW | `DashboardMobile.tsx` has some mobile-specific widgets not in `Dashboard.tsx` | Audit unique content before deleting; port to responsive grid in `Dashboard.tsx` |

---

## Scalability Considerations

This is a UI overhaul within an existing fixed-scope app. Scalability concerns are component-count and maintainability, not infrastructure.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (40+ components) | PageShell + AppSidebar centralizes layout — changes need only 1–2 files |
| +10 new pages | Each new page drops in `<PageShell>` + `<motion.div variants={pageTransition}>` — zero layout work |
| New nav sections | `AppSidebar.tsx` uses `SidebarGroup` for grouping; add a group with label, items slot in |
| New card types | Extend `cards.tsx` with new semantic variant; existing pages unaffected |

---

## Sources

- [shadcn/ui Sidebar Component Documentation](https://ui.shadcn.com/docs/components/sidebar) — HIGH confidence; official docs
- [shadcn/ui Sidebar Blocks](https://ui.shadcn.com/blocks/sidebar) — HIGH confidence; official examples
- [Motion (Framer Motion) React Animation Docs](https://motion.dev/docs/react-animation) — HIGH confidence; official docs
- [Tailwind CSS v4 Responsive Design](https://tailwindcss.com/docs/responsive-design) — HIGH confidence; official docs
- [Tailwind CSS v4 Container Queries — SitePoint](https://www.sitepoint.com/tailwind-css-v4-container-queries-modern-layouts/) — MEDIUM confidence; verified against official docs
- [AnimatePresence with Outlet — Medium](https://medium.com/@antonio.falcescu/animating-react-pages-with-react-router-dom-outlet-and-framer-motion-animatepresence-bd5438b3433b) — MEDIUM confidence; community article, pattern corroborated by Motion official docs
- [Sidebar layouts CSS Grid vs Flexbox](https://akashhamirwasia.com/blog/how-to-and-not-to-build-sidebar-layouts/) — MEDIUM confidence; technical blog, patterns match MDN guidance
- `src/app/components/ui/sidebar.tsx` — HIGH confidence; actual codebase (725 lines, already installed)
- `src/styles/theme.css` — HIGH confidence; actual codebase (sidebar-* tokens already defined)

---

*Architecture research for: Phoenix Portal v1.2 Premium Visual Overhaul*
*Researched: 2026-02-20*
