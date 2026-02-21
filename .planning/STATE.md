# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-20)

**Core value:** Premium subscribers see data and insights about their training that they cannot get anywhere else -- force curves, velocity trends, muscle balance analysis, and community-driven workout programming -- making the subscription feel indispensable.
**Current focus:** v1.2 Premium Visual Overhaul — Phase 20: Gap Closure & Tech Debt

## Current Position

Phase: 20 of 20 (Gap Closure & Tech Debt)
Plan: 1 of 2 in current phase — plan 01 complete
Status: In progress
Last activity: 2026-02-21 — 20-01 complete (stripped bg-background from AppLayout shell, SidebarInset overridden with bg-transparent, all 16 authenticated page root wrappers cleaned — 38 instances removed; body::before ambient ember/flame glow now unoccluded through full render stack)

Progress: [███░░░░░░░] 15% (v1.2)

## Performance Metrics

**Velocity (v1.0):**
- Total plans completed: 41
- Average duration: 3 min
- Total execution time: ~2 hours

**Velocity (v1.1):**
- Total plans completed: 22
- Average duration: 6.0 min
- Total execution time: ~131 min

**Velocity (v1.2):**
- Total plans completed: 6
- Average duration: ~4.3 min
- Total execution time: ~26 min

## Accumulated Context

### Decisions

All v1.0 and v1.1 decisions archived in PROJECT.md Key Decisions table.

**v1.2 Phase 14 decisions (from 14-01):**
- Inter Variable loaded with full wght axis (0,100..900;1,100..900) to unlock non-standard weights 450 and 625
- Bebas Neue removed entirely — not used anywhere in the app
- fonts.css uses @theme block (not @layer base) so Tailwind v4 generates html/:host font-family rule automatically
- SVG fontFamily must use literal string "Inter, system-ui, sans-serif" — CSS vars don't resolve in SVG presentation attributes
- h2 weight 625 (non-standard variable font weight) provides perceptible distinction from h1(700) and h3(500)
- AppLayout gets relative z-[10] for Plan 02 compatibility with ambient glow body layers

**v1.2 Phase 14 decisions (from 14-02):**
- Tailwind shadow utilities require standalone @theme block (not @theme inline) — @theme inline only bridges existing vars, does not generate utility values
- Circular var() self-references in @theme inline removed — they were no-ops; standalone @theme defines actual shadow values
- SVG feTurbulence grain texture embedded as inline data URI — zero external file dependency, survives production build
- body::before/::after use position: fixed to cover full viewport on scroll; AppLayout z-10 keeps content above z-0/z-1 glow layers
- .border-secondary override uses !important in @layer base to override Tailwind utilities layer specificity

**v1.2 Phase 16 decisions (from 16-02):**
- Gradient text (bg-clip-text text-transparent) reserved for hero h1 only — 2 instances globally: LandingPage hero h1 and Dashboard welcome h1 username span
- Section h1/h2 headers across all pages use solid text-white — not gradient
- Brand/logo spans (AppSidebar, Navigation, auth dialogs, footer) use solid text-primary
- Stat number displays (PR values, volume totals, PR counts) use text-primary — not gradient
- Celebration modal h2 headlines use text-white — gradient in modal context does not signal hero status
- ChallengeWon dynamic config.gradient template literal removed — replaced with static text-white

**v1.2 Phase 16 decisions (from 16-01):**
- card-primary backdrop-filter applies desktop-only (min-width: 768px) — mobile blur budget consumed by MobileBottomNav + sticky header
- GoalDashboardWidget and RecoveryDashboardWidget render Cards internally — card-primary applied inside widget files, not at Dashboard call site
- card-landing-feature uses padding-box/border-box background shorthand for gradient borders (border-image breaks border-radius)
- Feature icons use rounded-full bg-primary/15 ring-1 ring-primary/30 (Role A) vs. gradient square (Role C for action CTAs)
- backdrop-blur-sm added to DialogOverlay baseline; auth dialog backdrop-blur-xl acceptable as overlay displaces other layers

**v1.2 Phase 15 decisions (from 15-03):**
- MobileBottomNav primary bar: Dashboard, Workouts, Analytics, Community, More (5 items) — Profile moved to More drawer
- More drawer grouped into Training/Social/Account with eyebrow labels, not flat list
- Mobile variants merged via block md:hidden / hidden md:block (not responsive grid) — markup was fundamentally different between mobile and desktop
- useCommunityRealtime() called once at top-level Community component — CommunityDesktop inner function dissolved
- Mobile component files deleted after merge: DashboardMobile, AnalyticsMobile, CommunityMobile, ChallengesMobile

**v1.2 Phase 15 decisions (from 15-02):**
- PageShell import uses @/app/components/ui/utils (not @/lib/utils — no utils.ts exists in src/lib/)
- Sticky-header pages apply PageShell only to content section — sticky gradient headers must remain full-bleed
- SessionDetail and ComparisonView skipped — use max-w-5xl and sticky headers, different width constraint
- Four plan file names (GoalsDashboard, RecoveryDashboard, IntegrationsDashboard, SubscriptionPage) not found in codebase — actual files use max-w-4xl intentionally

**v1.2 Phase 15 decisions (from 15-01):**
- Auto-collapse uses isAutoCollapsing ref flag to distinguish viewport-driven collapse from user toggle — prevents localStorage overwrite during auto-collapse
- SidebarProvider placed inside AppLayout (ProtectedRoute boundary), not at router root — sidebar not visible on LandingPage
- Navigation.tsx kept with deprecation comment rather than deleted — safe to remove after Phase 15 verification
- useAutoCollapse defined inside AppSidebar.tsx (co-located) — keeps collapse logic adjacent to sidebar component
- localStorage key "phoenix-sidebar-preferred-open" is source of truth for user preference; SidebarProvider cookie reflects current visual state
- NavLink with useLocation() for isActive detection (not NavLink render prop) — avoids asChild anti-pattern

**v1.2 Phase 20 decisions (from 20-01):**
- SidebarInset overridden with bg-transparent at call site in AppLayout — shadcn primitive sidebar.tsx not edited (per Phase 15 pattern)
- LandingPage, PrivacyPolicy, ResetPassword retain bg-background — they are outside AppLayout boundary and require their own opaque background
- Sticky headers with bg-background/95 are intentionally untouched — /95 opacity modifier provides frosted glass effect, not the same as root wrapper opaque blocks
- Authenticated page root wrappers use min-h-screen without bg-background — background provided by body via @apply in theme.css

Key v1.2 constraints from research:
- Max 3 backdrop-blur layers per viewport simultaneously — GPU overload on mobile otherwise
- AnimatePresence requires useOutlet() not <Outlet> for React Router v7 — exit animations never fire with <Outlet>
- visx ChartTheme.ts hex constants are permanent — SVG cannot resolve CSS vars in presentation attributes; do NOT replace with var(--primary)
- Bundle gate: main chunk must stay under 100KB after every phase; run npm run build + rollup-plugin-visualizer as pre-merge check
- Phase 18 depends on Phase 15 (sidebar must be stable before chart widths are touched) — do not run chart and sidebar PRs in parallel
- SidebarProvider must live inside AppLayout (inside ProtectedRoute), not at router root

### Pending Todos

None.

### Blockers/Concerns

**Non-blocking items for human verification (carried forward from v1.1):**
- Stripe checkout/portal/webhooks (needs Stripe test environment)
- OAuth flows with real credentials (Strava, Fitbit, Garmin)
- Session replay animations and mobile layout (needs live testing)
- 11 Supabase Edge Functions (needs deployment)
- TOOL-09: database.types.ts — Supabase schema only has user_subscriptions deployed; run migrations then `npm run gen:types`
- 17 authenticated E2E tests skip without SUPABASE_TEST_EMAIL/PASSWORD env vars
- Recovery ACWR thresholds may need sport-science validation for cable resistance training

**v1.2 Phase 15 items resolved:**
- Sidebar state deduplication: RESOLVED — SidebarProvider cookie handles visual state, localStorage handles user preference, Zustand NOT used for sidebar state

## Session Continuity

Last session: 2026-02-21
Stopped at: Completed 20-01-PLAN.md — ambient glow unblocked: bg-background stripped from AppLayout shell + 16 authenticated page root wrappers (38 instances)
Resume file: N/A
