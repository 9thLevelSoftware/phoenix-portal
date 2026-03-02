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


---

# === v1.3 Research (from main) ===

# Architecture: RevenueCat Billing Migration

**Domain:** Stripe-to-RevenueCat subscription migration for a React/Supabase web portal
**Researched:** 2026-02-28
**Overall Confidence:** MEDIUM-HIGH

## Executive Summary

Phoenix Portal currently uses Stripe for web-based subscription billing with 3 Edge Functions (checkout, portal, webhooks), a `subscriptions` table, and a `user_subscription_tier()` helper function used in RLS policies. The mobile app already writes to a separate `user_subscriptions` table with RevenueCat data. The migration consolidates billing to RevenueCat as the single source of truth, making the portal a subscription status **consumer** rather than a billing initiator.

The core architectural change: replace Stripe's "portal initiates checkout, webhook writes status" pattern with RevenueCat's "mobile app initiates purchase, webhook syncs status to portal DB" pattern. The portal stops being a checkout flow and becomes a status display.

---

## Current Architecture (Stripe)

### Data Flow: Purchase to Portal Display

```
User clicks "Subscribe" on /pricing
        |
        v
PricingPlans.tsx -> redirectToCheckout(priceId)
        |
        v
src/lib/stripe.ts -> supabase.functions.invoke("stripe-checkout")
        |
        v
Edge Function: stripe-checkout
  - Authenticates user via JWT
  - Creates/looks up Stripe customer
  - Creates Stripe Checkout Session
  - Returns checkout URL
        |
        v
User completes payment on Stripe-hosted page
        |
        v
Stripe sends webhook POST to stripe-webhooks Edge Function
  - Verifies signature with STRIPE_WEBHOOK_SIGNING_SECRET
  - Handles: checkout.session.completed, subscription.updated/deleted,
             invoice.paid, invoice.payment_failed
  - Writes to `subscriptions` table using service_role_key (bypasses RLS)
        |
        v
subscriptions table updated (tier, status, period dates)
        |
        v
Supabase Realtime (postgres_changes) fires
        |
        v
useSubscription hook receives change, invalidates TanStack Query
        |
        v
SubscriptionGate re-evaluates, UI updates
```

### Existing Components Inventory

| Component | File | Role | Migration Impact |
|-----------|------|------|-----------------|
| `stripe-checkout` | `supabase/functions/stripe-checkout/index.ts` | Creates Checkout Session | **DELETE** |
| `stripe-portal` | `supabase/functions/stripe-portal/index.ts` | Opens billing management | **DELETE** |
| `stripe-webhooks` | `supabase/functions/stripe-webhooks/index.ts` | Processes 5 event types | **REPLACE** with `revenuecat-webhooks` |
| `delete-account` | `supabase/functions/delete-account/index.ts` | Cancels Stripe sub on deletion | **MODIFY** - remove Stripe cancellation |
| `src/lib/stripe.ts` | Client-side Stripe helpers | `redirectToCheckout`, `openCustomerPortal` | **DELETE** |
| `src/hooks/useSubscription.ts` | Reads `subscriptions` table | Returns tier/status/period | **MODIFY** - read new table schema |
| `src/app/components/PricingPlans.tsx` | Checkout flow with price IDs | Subscribe buttons call Stripe | **REWRITE** - "subscribe in app" CTAs |
| `src/app/components/Profile.tsx` | "Manage Subscription" button | Calls `openCustomerPortal()` | **MODIFY** - change to app redirect |
| `src/app/components/SubscriptionGate.tsx` | Tier gating wrapper | Reads `useSubscription` | **NO CHANGE** (reads same interface) |
| `src/app/components/UpgradePrompt.tsx` | Upgrade CTA card | Links to /pricing | **MODIFY** - "open in app" CTA |
| `src/lib/pricing.ts` | TIER_PRICING config | Price amounts per tier | **MODIFY** - prices may change, remove Stripe price IDs |
| `src/app/components/TermsOfService.tsx` | Legal text | References Stripe | **MODIFY** - update billing provider text |
| `src/app/components/PrivacyPolicy.tsx` | Legal text | References Stripe 3 times | **MODIFY** - update to RevenueCat |
| `src/lib/export/data-export.ts` | GDPR export | Excludes `stripe_customer_id` | **MODIFY** - exclude `revenuecat_customer_id` |
| `src/lib/__tests__/stripe-webhook-handlers.test.ts` | Webhook handler tests | Tests Stripe event handling | **DELETE** and replace |
| `00001_create_subscriptions.sql` | Migration | Creates subscriptions table | **NEW MIGRATION** to alter |
| `20260228_rls_denormalization.sql` | Migration | Deprecates `user_subscriptions` | **SUPERSEDED** - un-deprecate |

### Existing Database Schema

**`subscriptions` table (Stripe-powered):**
```sql
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT UNIQUE NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('FREE', 'PHOENIX', 'ELITE')),
  status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'incomplete')),
  price_id TEXT NOT NULL,
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);
```

**`user_subscriptions` table (RevenueCat, mobile-written, currently "deprecated"):**
```sql
-- Already exists in DB with these columns:
id UUID, user_id UUID, revenuecat_customer_id TEXT, product_id TEXT,
subscription_status TEXT, expires_at TIMESTAMPTZ, last_verified_at TIMESTAMPTZ,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

**`user_subscription_tier()` helper (used in RLS):**
```sql
CREATE OR REPLACE FUNCTION public.user_subscription_tier()
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT tier FROM public.subscriptions
     WHERE user_id = auth.uid()
     AND status IN ('active', 'trialing')
     LIMIT 1),
    'FREE'
  );
$$;
```

**RLS policies using `user_subscription_tier()`:**
- `community_comments` INSERT policy: requires `user_subscription_tier() IN ('PHOENIX', 'ELITE')`
- `user_goals` enforce_goal_limits trigger: checks tier for goal count limits

---

## Target Architecture (RevenueCat)

### Design Decision: Webhooks + Database, NOT REST API Polling

**Why webhooks as primary, not REST API:**
1. RevenueCat webhooks deliver within 5-60 seconds of events (cancellation within 2 hours)
2. REST API polling would need to run on every page load or on a timer -- wasteful and slower
3. The existing architecture already follows webhook-to-DB pattern (Stripe does the same thing)
4. Supabase Realtime on the subscriptions table already pushes changes to the UI instantly
5. REST API v1 `/v1/subscribers/{app_user_id}` remains available as a **fallback verifier**, not the primary source

**Confidence:** HIGH -- this matches the existing pattern and RevenueCat's recommended architecture.

### Critical Prerequisite: app_user_id = Supabase auth.uid

The mobile app MUST configure RevenueCat with the Supabase `auth.uid` as the `app_user_id`. This is the bridge between RevenueCat events and Supabase user records.

**Verification needed:** Confirm the mobile app calls `Purchases.logIn(supabaseUser.id)` after authentication. If the mobile app uses anonymous IDs (`$RCAnonymousID:...`), the webhook `app_user_id` will not match any Supabase user, and the entire integration breaks.

**Confidence:** MEDIUM -- the existing `user_subscriptions` table has a `user_id` column referencing the Supabase user, which strongly suggests the mobile app already uses Supabase UIDs. But this must be verified.

### Data Flow: Purchase to Portal Display (New)

```
User subscribes in mobile app (App Store / Play Store)
        |
        v
RevenueCat SDK processes purchase
RevenueCat identifies user by app_user_id (= Supabase auth.uid)
        |
        v
RevenueCat sends webhook POST to revenuecat-webhooks Edge Function
  - Validates Authorization header (shared secret)
  - Parses event: INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, etc.
  - Maps entitlement_ids to tier (["phoenix"] -> "PHOENIX", ["elite"] -> "ELITE")
  - Upserts into `subscriptions` table using service_role_key
        |
        v
subscriptions table updated (tier, status, expiration)
        |
        v
Supabase Realtime (postgres_changes) fires
        |
        v
useSubscription hook receives change, invalidates TanStack Query
        |
        v
SubscriptionGate re-evaluates, UI updates
        |
        (Existing flow from here is UNCHANGED)
```

### New Edge Function: revenuecat-webhooks

```
supabase/functions/revenuecat-webhooks/index.ts
```

**Responsibilities:**
1. Validate `Authorization` header against `REVENUECAT_WEBHOOK_SECRET`
2. Parse the event from `request.body.event`
3. Extract `app_user_id` (this IS the Supabase user UUID)
4. Map event type to subscription state change
5. Upsert into `subscriptions` table

**RevenueCat webhook event mapping:**

| RevenueCat Event | Action | Resulting Status |
|-----------------|--------|-----------------|
| `INITIAL_PURCHASE` | Upsert subscription row | `active` (or `trialing` if `period_type === "TRIAL"`) |
| `RENEWAL` | Update period dates, confirm active | `active` |
| `CANCELLATION` | Set `cancel_at_period_end = true` | `active` (still has access until period end) |
| `UNCANCELLATION` | Set `cancel_at_period_end = false` | `active` |
| `EXPIRATION` | Revoke access | `canceled` |
| `BILLING_ISSUE` | Flag billing problem | `past_due` |
| `PRODUCT_CHANGE` | Update tier based on new entitlements | `active` |
| `SUBSCRIPTION_EXTENDED` | Push out expiration date | `active` |
| `REFUND_REVERSED` | Restore access | `active` |
| `TEST` | Log and return 200 | (no DB change) |

**Authentication:** RevenueCat does not use cryptographic signing like Stripe. Instead, you configure a static authorization header in the RevenueCat dashboard. The Edge Function validates this header value.

```typescript
// Pseudocode for webhook auth
const authHeader = req.headers.get("Authorization");
if (authHeader !== `Bearer ${Deno.env.get("REVENUECAT_WEBHOOK_SECRET")}`) {
  return new Response("Unauthorized", { status: 401 });
}
```

**Confidence:** HIGH -- RevenueCat docs explicitly describe this auth model.

### Entitlement-to-Tier Mapping

RevenueCat uses "entitlements" as an abstraction layer over products. The webhook payload includes `entitlement_ids` (array of strings). Configure in RevenueCat dashboard:

| RevenueCat Entitlement ID | Phoenix Portal Tier | Products Attached |
|--------------------------|--------------------|--------------------|
| `phoenix` | `PHOENIX` | `com.phoenix.monthly`, `com.phoenix.annual` |
| `elite` | `ELITE` | `com.elite.monthly`, `com.elite.annual` |
| (none active) | `FREE` | (no active subscription) |

**Mapping logic in the webhook handler:**

```typescript
function mapEntitlementsToTier(entitlementIds: string[] | null): string {
  if (!entitlementIds || entitlementIds.length === 0) return "FREE";
  if (entitlementIds.includes("elite")) return "ELITE";
  if (entitlementIds.includes("phoenix")) return "PHOENIX";
  return "FREE";
}
```

**Why entitlement-based, not product-based:** Products are platform-specific (`com.ios.phoenix.monthly` vs `com.android.phoenix.monthly`). Entitlements abstract across platforms. Since Phoenix Portal serves users from both iOS and Android, entitlements are the correct mapping key.

**Confidence:** HIGH -- this is RevenueCat's explicitly recommended pattern.

### Database Schema Changes

**Option A (Recommended): Evolve the existing `subscriptions` table**

Rename Stripe columns, add RevenueCat columns, preserve the table name so all existing code (`useSubscription`, RLS function, Realtime subscription) continues working with minimal changes.

```sql
-- Migration: Migrate subscriptions table from Stripe to RevenueCat
BEGIN;

-- Step 1: Drop Stripe-specific constraints and columns
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_stripe_subscription_id_key;
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS stripe_customer_id;
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS stripe_subscription_id;
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS price_id;

-- Step 2: Add RevenueCat-specific columns
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS revenuecat_customer_id TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS product_id TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS entitlement_ids TEXT[];
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS store TEXT;  -- APP_STORE, PLAY_STORE, STRIPE, etc.
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS environment TEXT DEFAULT 'PRODUCTION';

-- Step 3: Relax NOT NULL on period columns (RevenueCat may not always send both)
ALTER TABLE public.subscriptions ALTER COLUMN current_period_start DROP NOT NULL;

-- Step 4: Add idempotency tracking
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS last_event_id TEXT;

COMMIT;
```

**Why Option A over creating a new table:**
- `useSubscription` already reads from `subscriptions` with the correct column names (`tier`, `status`, `current_period_end`, `cancel_at_period_end`)
- `user_subscription_tier()` already queries `subscriptions` -- no RLS changes needed
- Supabase Realtime is already configured on `subscriptions`
- All query keys, hooks, and components reference the same data shape

**Option B (NOT recommended): Switch to `user_subscriptions` table**

The mobile app already writes to `user_subscriptions`, but this table has a different schema (no `tier` column, uses `subscription_status` instead of `status`, no `cancel_at_period_end`). Switching would require changing every consumer.

**Confidence:** HIGH for Option A -- minimal blast radius.

### Updated `user_subscription_tier()` Function

The function already works correctly -- it reads `tier` from `subscriptions` where `status IN ('active', 'trialing')`. Since the webhook handler writes the same `tier` values (`FREE`, `PHOENIX`, `ELITE`) and the same `status` values (`active`, `trialing`, `canceled`, `past_due`), **no change is needed** to this function.

```sql
-- EXISTING -- NO CHANGES REQUIRED
CREATE OR REPLACE FUNCTION public.user_subscription_tier()
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT tier FROM public.subscriptions
     WHERE user_id = auth.uid()
     AND status IN ('active', 'trialing')
     LIMIT 1),
    'FREE'
  );
$$;
```

**Confidence:** HIGH -- the function is tier/status agnostic regarding the billing provider.

### RLS Policy Impact

**No RLS policy changes needed.** All tier-gating RLS policies call `user_subscription_tier()`, which reads from the `subscriptions` table. As long as the webhook handler writes correct `tier` and `status` values to that same table, all policies continue to work.

Policies affected (no changes, just listing for awareness):
- `community_comments` INSERT: `user_subscription_tier() IN ('PHOENIX', 'ELITE')`
- `user_goals` trigger: checks `user_subscription_tier()` for goal count limits

**Confidence:** HIGH.

---

## Component-Level Changes

### Files to DELETE (6 files)

| File | Reason |
|------|--------|
| `supabase/functions/stripe-checkout/index.ts` | No web checkout with RevenueCat |
| `supabase/functions/stripe-portal/index.ts` | No web billing portal |
| `supabase/functions/stripe-webhooks/index.ts` | Replaced by `revenuecat-webhooks` |
| `src/lib/stripe.ts` | No Stripe client-side SDK needed |
| `src/lib/__tests__/stripe-webhook-handlers.test.ts` | Tests for deleted handler |
| `@stripe/stripe-js` npm dependency | No longer needed |

### Files to CREATE (3 files)

| File | Purpose |
|------|---------|
| `supabase/functions/revenuecat-webhooks/index.ts` | New webhook handler for RevenueCat events |
| `supabase/migrations/YYYYMMDD_revenuecat_migration.sql` | Schema migration (drop Stripe cols, add RC cols) |
| `src/lib/__tests__/revenuecat-webhook-handlers.test.ts` | Tests for new webhook handler |

### Files to MODIFY (10 files)

| File | Change | Scope |
|------|--------|-------|
| `src/hooks/useSubscription.ts` | Minor: statuses stay same, types unchanged. May simplify if `trialing` is not used by RC | Small |
| `src/app/components/PricingPlans.tsx` | Major rewrite: remove checkout flow, show "Subscribe in App" CTAs, remove PRICE_IDS, remove Stripe import | Large |
| `src/app/components/Profile.tsx` | Remove `openCustomerPortal()` call, replace "Manage Subscription" with "Manage in App" or deep link | Medium |
| `src/app/components/UpgradePrompt.tsx` | Change CTA from "View Plans" link to "Subscribe in App" message | Small |
| `src/lib/pricing.ts` | Keep tier structure, potentially update prices, remove Stripe price ID references (they are in PricingPlans, not here) | Small |
| `src/app/components/TermsOfService.tsx` | Update "Stripe" references to "RevenueCat" / "App Store / Google Play" | Small |
| `src/app/components/PrivacyPolicy.tsx` | Update 3 Stripe references | Small |
| `src/lib/export/data-export.ts` | Change `stripe_customer_id` exclusion to `revenuecat_customer_id` | Small |
| `supabase/functions/delete-account/index.ts` | Remove Stripe subscription cancellation block (RevenueCat handles cancellation via app stores) | Medium |
| `src/lib/database.types.ts` | Regenerate after migration (`npm run gen:types`) | Auto-generated |

### Files UNCHANGED (critical to verify)

| File | Why Unchanged |
|------|--------------|
| `src/app/components/SubscriptionGate.tsx` | Reads `useSubscription()` which returns same interface |
| `src/app/components/TierBadge.tsx` | Reads `useSubscription()` |
| `src/queries/keys.ts` | Query key structure unchanged |
| All feature components using `useSubscription` | 10+ components -- all read the same hook interface |
| All `user_subscription_tier()` RLS consumers | Function signature unchanged |

### Environment Variables

**Remove:**
- `VITE_STRIPE_PUBLISHABLE_KEY`
- `VITE_STRIPE_PHOENIX_MONTHLY_PRICE_ID`
- `VITE_STRIPE_PHOENIX_ANNUAL_PRICE_ID`
- `VITE_STRIPE_ELITE_MONTHLY_PRICE_ID`
- `VITE_STRIPE_ELITE_ANNUAL_PRICE_ID`
- `STRIPE_SECRET_KEY` (Edge Function secret)
- `STRIPE_WEBHOOK_SIGNING_SECRET` (Edge Function secret)
- `STRIPE_PHOENIX_MONTHLY_PRICE_ID` (Edge Function secret)
- `STRIPE_PHOENIX_ANNUAL_PRICE_ID` (Edge Function secret)
- `STRIPE_ELITE_MONTHLY_PRICE_ID` (Edge Function secret)
- `STRIPE_ELITE_ANNUAL_PRICE_ID` (Edge Function secret)

**Add:**
- `REVENUECAT_WEBHOOK_SECRET` (Edge Function secret) -- shared secret for webhook auth header
- `REVENUECAT_API_KEY` (Edge Function secret, optional) -- for REST API fallback verification

**No client-side (VITE_) env vars needed** -- the portal never talks to RevenueCat directly. All communication goes through the webhook Edge Function writing to Supabase.

---

## Patterns to Follow

### Pattern 1: Entitlement-Based Tier Mapping (not Product-Based)

**What:** Map RevenueCat entitlement IDs to portal tiers, not product IDs to tiers.
**When:** Processing every webhook event that includes `entitlement_ids`.
**Why:** Products are platform-specific; entitlements are cross-platform. A user subscribing on iOS and Android gets the same entitlement.

```typescript
// GOOD: Entitlement-based
function mapEntitlementsToTier(entitlementIds: string[] | null): string {
  if (!entitlementIds?.length) return "FREE";
  if (entitlementIds.includes("elite")) return "ELITE";
  if (entitlementIds.includes("phoenix")) return "PHOENIX";
  return "FREE";
}

// BAD: Product-based (fragile, platform-specific)
function mapProductToTier(productId: string): string {
  // Must maintain mapping for every platform x billing period combination
  const map = {
    "com.ios.phoenix.monthly": "PHOENIX",
    "com.android.phoenix.monthly": "PHOENIX",
    "com.ios.phoenix.annual": "PHOENIX",
    // ... grows linearly with products
  };
}
```

### Pattern 2: Idempotent Webhook Processing

**What:** Track the last processed event ID per user to handle duplicate deliveries.
**When:** Every webhook event.
**Why:** RevenueCat documentation explicitly warns about rare duplicate deliveries.

```typescript
// Check for duplicate before processing
const { data: existing } = await supabase
  .from("subscriptions")
  .select("last_event_id")
  .eq("user_id", appUserId)
  .single();

if (existing?.last_event_id === event.id) {
  return new Response(JSON.stringify({ received: true, duplicate: true }), {
    status: 200,
  });
}

// Include event ID in upsert
await supabase.from("subscriptions").upsert({
  user_id: appUserId,
  last_event_id: event.id,
  // ... other fields
}, { onConflict: "user_id" });
```

### Pattern 3: Preserve the useSubscription Interface

**What:** Keep the `SubscriptionData` return type identical so all 10+ consumer components need zero changes.
**When:** Modifying `useSubscription.ts`.

```typescript
// This interface MUST NOT CHANGE:
interface SubscriptionData {
  tier: SubscriptionTier;           // "FREE" | "PHOENIX" | "ELITE"
  status: SubscriptionStatus;       // "active" | "past_due" | "canceled" | "trialing" | "incomplete" | "none"
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  isLoading: boolean;
  isPremium: boolean;
  isElite: boolean;
}
```

The existing `fetchSubscription` function reads from `subscriptions` table with columns `tier`, `status`, `current_period_end`, `cancel_at_period_end`. As long as the migration preserves these column names (which it does -- we only drop Stripe-specific columns and add RC-specific ones), the hook works unchanged.

### Pattern 4: Graceful Degradation for Missing Subscription

**What:** If a user has no row in `subscriptions`, treat as FREE tier.
**When:** New users who have not subscribed, or during migration window.
**Why:** The existing `useSubscription` already does this with `.maybeSingle()` returning null = FREE. The `user_subscription_tier()` function does this with COALESCE. Maintain this.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Polling RevenueCat REST API on Every Page Load

**What:** Calling `GET /v1/subscribers/{app_user_id}` from the portal to check entitlements.
**Why bad:** Adds latency to every page load, creates API rate limit risk, adds a network dependency that does not exist in the current architecture. The database is the source of truth for the portal.
**Instead:** Use webhooks to write to the database. The portal reads the database. REST API is only for emergency verification or admin tooling.

### Anti-Pattern 2: Installing @revenuecat/purchases-js

**What:** Adding the RevenueCat Web SDK (purchases-js) to the portal.
**Why bad:** The Web SDK is for initiating purchases on the web. The portal explicitly does NOT handle purchases -- billing happens in the mobile app. Installing it adds bundle weight for zero functionality, and creates a confusing code path that will never be used.
**Instead:** The portal only needs to READ subscription status from Supabase. No RevenueCat client SDK needed.

### Anti-Pattern 3: Splitting Subscriptions Across Two Tables

**What:** Reading from `user_subscriptions` (mobile-written) for some things and `subscriptions` (webhook-written) for others.
**Why bad:** Two sources of truth that can disagree. RLS policies reference one table, hooks reference another. Race conditions between mobile writes and webhook writes.
**Instead:** One table (`subscriptions`), one writer (the webhook Edge Function), multiple readers (hook, RLS function, data export).

### Anti-Pattern 4: Mapping product_id Instead of entitlement_ids

**What:** Using `event.product_id` to determine tier instead of `event.entitlement_ids`.
**Why bad:** Product IDs are platform-specific and change when you add new billing periods or platforms. Entitlements are stable identifiers configured once in the RevenueCat dashboard.
**Instead:** Always use `entitlement_ids` for tier mapping. Fall back to product_id only if entitlement_ids is unexpectedly empty (and log a warning).

---

## Recommended Architecture Diagram

```
+-------------------+     +---------------------+     +------------------+
|   Mobile App      |     |    RevenueCat        |     |  Supabase        |
|                   |     |                      |     |                  |
| User subscribes   |---->| Processes purchase   |     |                  |
| via App Store /   |     | Manages entitlements |     |                  |
| Play Store        |     |                      |     |                  |
|                   |     | Sends webhook ------->|---->| Edge Function:   |
| Sets app_user_id  |     | POST with event JSON |     | revenuecat-      |
| = auth.uid        |     | + Auth header        |     | webhooks         |
+-------------------+     +---------------------+     |                  |
                                                       | Validates auth   |
                                                       | Maps entitlements|
                                                       | Upserts to       |
                                                       | subscriptions    |
                                                       | table            |
                                                       +--------+---------+
                                                                |
                                                    Realtime (postgres_changes)
                                                                |
                                                       +--------v---------+
                                                       |  Phoenix Portal  |
                                                       |                  |
                                                       | useSubscription  |
                                                       | hook reads DB    |
                                                       |                  |
                                                       | SubscriptionGate |
                                                       | gates features   |
                                                       |                  |
                                                       | RLS policies use |
                                                       | user_subscription|
                                                       | _tier() function |
                                                       +------------------+
```

---

## Scalability Considerations

| Concern | Current (100s of users) | At 10K users | At 100K users |
|---------|------------------------|--------------|---------------|
| Webhook volume | < 10/day | ~100/day | ~1000/day |
| Edge Function cold starts | Negligible | Negligible | Still fine -- webhooks are async |
| Realtime connections | ~10 concurrent | ~500 concurrent | May need channel multiplexing |
| `user_subscription_tier()` RLS calls | Fast (indexed) | Fast (indexed) | Fast (indexed, SECURITY DEFINER cached) |
| Stale subscription data | < 60s via webhook | < 60s via webhook | < 60s via webhook, add REST API cron for safety |

At 100K+ users, consider adding a nightly cron job (Supabase pg_cron or scheduled Edge Function) that batch-verifies subscription statuses via RevenueCat REST API v1 to catch any missed webhooks.

---

## Migration Strategy: Zero-Downtime Transition

### Phase 1: Add RevenueCat webhook handler (alongside Stripe)

Both systems active. Portal reads from same `subscriptions` table. New migration adds RevenueCat columns without removing Stripe columns. This allows testing the webhook handler without breaking existing Stripe users.

### Phase 2: Verify webhook flow end-to-end

Test with a real RevenueCat sandbox subscription. Confirm:
- Webhook arrives at Edge Function
- `app_user_id` matches Supabase user
- Subscription row is created/updated correctly
- `useSubscription` hook picks up the change
- `SubscriptionGate` gates correctly
- RLS policies enforce tier correctly

### Phase 3: Migrate UI (remove Stripe checkout flow)

Replace `PricingPlans.tsx` checkout with "subscribe in app" CTAs. Remove `openCustomerPortal()` calls. Update `Profile.tsx` subscription management section.

### Phase 4: Remove Stripe infrastructure

Delete Stripe Edge Functions, `src/lib/stripe.ts`, Stripe npm dependency. Run migration to drop Stripe columns. Remove Stripe environment variables.

### Phase 5: Clean up

Update legal pages (Terms, Privacy). Update data export. Update delete-account function. Regenerate database types.

---

## Webhook Handler Implementation Sketch

```typescript
// supabase/functions/revenuecat-webhooks/index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function mapEntitlementsToTier(entitlementIds: string[] | null): string {
  if (!entitlementIds?.length) return "FREE";
  // Check highest tier first (ELITE > PHOENIX)
  if (entitlementIds.includes("elite")) return "ELITE";
  if (entitlementIds.includes("phoenix")) return "PHOENIX";
  return "FREE";
}

function mapEventToStatus(
  eventType: string,
  periodType?: string
): string | null {
  switch (eventType) {
    case "INITIAL_PURCHASE":
      return periodType === "TRIAL" ? "trialing" : "active";
    case "RENEWAL":
    case "UNCANCELLATION":
    case "SUBSCRIPTION_EXTENDED":
    case "REFUND_REVERSED":
      return "active";
    case "EXPIRATION":
      return "canceled";
    case "BILLING_ISSUE":
      return "past_due";
    case "CANCELLATION":
      // User still has access until period end -- status stays active,
      // but cancel_at_period_end becomes true
      return null; // handled separately
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  // 1. Validate authorization
  const authHeader = req.headers.get("Authorization");
  const expectedSecret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  // 2. Parse event
  const body = await req.json();
  const event = body.event;

  if (!event || !event.type) {
    return new Response(JSON.stringify({ error: "Invalid payload" }), {
      status: 400,
    });
  }

  // 3. Handle TEST event
  if (event.type === "TEST") {
    console.log("RevenueCat test webhook received");
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  // 4. Extract user ID
  const appUserId = event.app_user_id;
  if (!appUserId) {
    console.error("No app_user_id in event");
    return new Response(JSON.stringify({ error: "Missing app_user_id" }), {
      status: 400,
    });
  }

  try {
    // 5. Handle CANCELLATION specially (user keeps access, just will not renew)
    if (event.type === "CANCELLATION") {
      await supabase
        .from("subscriptions")
        .update({
          cancel_at_period_end: true,
          updated_at: new Date().toISOString(),
          last_event_id: event.id,
        })
        .eq("user_id", appUserId);

      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // 6. Map event to status
    const status = mapEventToStatus(event.type, event.period_type);
    if (!status) {
      console.log(`Unhandled event type: ${event.type}`);
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // 7. Map entitlements to tier
    const tier = mapEntitlementsToTier(event.entitlement_ids);

    // 8. Upsert subscription
    await supabase.from("subscriptions").upsert(
      {
        user_id: appUserId,
        revenuecat_customer_id: event.original_app_user_id ?? appUserId,
        tier,
        status,
        product_id: event.product_id,
        entitlement_ids: event.entitlement_ids ?? [],
        store: event.store,
        environment: event.environment,
        current_period_end: event.expiration_at_ms
          ? new Date(event.expiration_at_ms).toISOString()
          : null,
        current_period_start: event.purchased_at_ms
          ? new Date(event.purchased_at_ms).toISOString()
          : null,
        cancel_at_period_end:
          event.type === "UNCANCELLATION" ? false : undefined,
        updated_at: new Date().toISOString(),
        last_event_id: event.id,
      },
      { onConflict: "user_id" }
    );
  } catch (err) {
    console.error(`Error processing ${event.type}:`, err);
    return new Response(JSON.stringify({ error: "Handler failed" }), {
      status: 500,
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
```

---

## Suggested Build Order

Based on dependency analysis, this is the recommended implementation sequence:

| Step | Task | Depends On | Rationale |
|------|------|-----------|-----------|
| 1 | Database migration (add RC columns, keep Stripe columns temporarily) | Nothing | Foundation -- everything else reads from this table |
| 2 | Create `revenuecat-webhooks` Edge Function | Step 1 | Core integration point -- needs table ready |
| 3 | Deploy and test webhook with RevenueCat sandbox | Steps 1-2 | Validate the entire server-side pipeline before touching UI |
| 4 | Write webhook handler tests | Step 2 | Test coverage before UI changes |
| 5 | Modify `PricingPlans.tsx` (remove checkout, add "subscribe in app") | Step 3 verified | Largest UI change; depends on webhook being proven |
| 6 | Modify `Profile.tsx` (remove Manage Subscription portal) | None (parallel with 5) | Independent of webhook |
| 7 | Modify `UpgradePrompt.tsx` | None (parallel with 5) | Independent |
| 8 | Modify `delete-account` Edge Function (remove Stripe block) | None (parallel with 5) | Independent |
| 9 | Delete Stripe Edge Functions + `src/lib/stripe.ts` | Steps 5-7 complete | Only after all Stripe imports removed |
| 10 | Database migration: drop Stripe columns | Step 9 | Only after all Stripe code deleted |
| 11 | Remove `@stripe/stripe-js` npm dependency | Step 9 | Only after all Stripe imports gone |
| 12 | Update legal pages (Terms, Privacy) | None (parallel with 9) | Content change only |
| 13 | Update data export exclusions | Step 10 | Needs new column names |
| 14 | Regenerate database types (`npm run gen:types`) | Step 10 | Needs final schema |
| 15 | Update `useSubscription.ts` if needed | Step 10 | May need minor type adjustments |
| 16 | Remove Stripe env vars from `.env.example`, Edge Function secrets | Step 9 | Cleanup |
| 17 | Add RC env vars to `.env.example`, Edge Function secrets | Step 2 | Can do early |

**Critical path:** Steps 1 -> 2 -> 3 -> 5 -> 9 -> 10 -> 14

---

## Open Questions Requiring Human Verification

1. **Does the mobile app set `app_user_id` to the Supabase `auth.uid`?** If not, the webhook `app_user_id` will not match any row in auth.users, breaking the entire integration. This is the single biggest risk.

2. **What are the exact entitlement IDs configured in RevenueCat?** The architecture assumes `"phoenix"` and `"elite"` but the actual values need to be confirmed from the RevenueCat dashboard.

3. **Does the mobile app currently use the `user_subscriptions` table for anything critical?** The migration drops reliance on this table. If the mobile app reads from it, we need to coordinate.

4. **Are there existing RevenueCat sandbox credentials for testing?** The webhook handler needs to be tested with real RevenueCat events, not just unit tests.

5. **Should the portal support deep links to mobile app subscription management?** iOS has `itms-apps://apps.apple.com/account/subscriptions`, Android has `https://play.google.com/store/account/subscriptions`. These could replace the "Manage Subscription" button.

---

## Sources

- [RevenueCat Webhook Event Types and Fields](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields) -- HIGH confidence
- [RevenueCat Webhooks Configuration](https://www.revenuecat.com/docs/integrations/webhooks) -- HIGH confidence
- [RevenueCat Sample Events](https://www.revenuecat.com/docs/integrations/webhooks/sample-events) -- HIGH confidence
- [RevenueCat Common Webhook Flows](https://www.revenuecat.com/docs/integrations/webhooks/event-flows) -- HIGH confidence
- [RevenueCat API v1 Subscribers](https://www.revenuecat.com/docs/api-v1) -- MEDIUM confidence (doc page did not render fully)
- [RevenueCat Identifying Customers](https://www.revenuecat.com/docs/customers/identifying-customers) -- HIGH confidence
- [RevenueCat Entitlements](https://www.revenuecat.com/docs/getting-started/entitlements) -- HIGH confidence
- [RevenueCat Web SDK](https://www.revenuecat.com/docs/web/web-billing/web-sdk) -- HIGH confidence (confirmed NOT needed)
- [RevenueCat Community: Webhook + Supabase](https://community.revenuecat.com/third-party-integrations-53/error-extracting-app-user-id-from-webhook-in-supabase-400-user-id-not-found-6557) -- MEDIUM confidence
- [RevenueCat Community: Entitlements in v1 vs v2](https://community.revenuecat.com/general-questions-7/entitlements-in-api-v1-vs-v2-6080) -- MEDIUM confidence
