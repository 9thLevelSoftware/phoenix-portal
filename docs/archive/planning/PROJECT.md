# Phoenix Portal

## What This Is

A production-ready premium web companion dashboard for Project Phoenix — a community rescue project for Vitruvian Trainer workout machines. The portal gives subscribers deep workout analytics, biomechanics visualizations, community routine sharing with comments, session replay with telemetry playback, goal tracking with celebrations, recovery readiness scoring, workout comparison, and a unified fitness data hub integrating with Strava, Fitbit, Garmin, and Hevy. Installable as a PWA with offline detection and auto-update. All workout control happens in the mobile app; the portal is where subscribers analyze, share, and connect.

## Core Value

Premium subscribers see data and insights about their training that they cannot get anywhere else — force curves, velocity trends, muscle balance analysis, and community-driven workout programming — making the subscription feel indispensable.

## Requirements

### Validated

- ✓ Landing page with Phoenix branding and feature showcase — existing
- ✓ Dashboard with workout summary, streak tracking, and quick stats — existing
- ✓ Workout history list with session details — existing
- ✓ Personal records tracking and display — existing
- ✓ Analytics page with charts (volume, frequency, muscle groups) — existing
- ✓ Routine browsing and routine builder with drag-and-drop — existing
- ✓ Training cycle viewer and cycle builder — existing
- ✓ Challenges page with progress tracking — existing
- ✓ Community page with activity feed — existing
- ✓ User profile page with settings — existing
- ✓ Mobile-responsive layout with bottom nav — existing
- ✓ Dark theme with Phoenix color palette (Ember, Flame, Gold, Forge) — existing
- ✓ 50+ shadcn/ui component primitives — existing
- ✓ Achievement celebration animations (PR, badge, streak, challenge) — existing
- ✓ All critical bugs fixed (hooks, RAF leak, AnimatePresence, NaN, duplicate nav) — v1.0
- ✓ Unused dependencies removed (100MB: MUI, emotion, react-dnd, etc.) — v1.0
- ✓ Vitest test framework with baseline tests and error boundaries — v1.0
- ✓ Code splitting with React.lazy/Suspense for all page components — v1.0
- ✓ Logo optimized to WebP, fonts via preconnect — v1.0
- ✓ Supabase auth (email/password, Google, Apple sign-in) — v1.0
- ✓ Full mock-to-real data migration across all pages — v1.0
- ✓ TanStack Query with Zod validation/transform layer — v1.0
- ✓ Realtime sync bridge (mobile → portal) — v1.0
- ✓ React Router v7 with 26 routes and deep linking — v1.0
- ✓ Zustand state management replacing prop drilling — v1.0
- ✓ Mobile bottom nav with More drawer (all pages accessible) — v1.0
- ✓ Stripe subscriptions (FREE/PHOENIX/ELITE) with checkout and portal — v1.0
- ✓ Subscription gating at UI + database (RLS) level — v1.0
- ✓ Force curve visualization with visx (LTTB downsampling, gradient fills) — v1.0
- ✓ VBT analytics with zone classification (strength/power/speed) — v1.0
- ✓ Asymmetry detection with L/R threshold flagging — v1.0
- ✓ Power output and ROM trend charts — v1.0
- ✓ Biomechanics dashboard (PHOENIX-gated) with muscle heatmap and consistency calendar — v1.0
- ✓ Exercise progress charts with weekly/monthly summary reports — v1.0
- ✓ Community hub with browse, search, filter, sort, infinite scroll — v1.0
- ✓ Optimistic voting with realtime mute-window coordination — v1.0
- ✓ Share dialog, save-to-library, featured creators, creator profiles — v1.0
- ✓ Session replay with Canvas 2D telemetry playback (ELITE-gated) — v1.0
- ✓ Rep quality scoring and fatigue detection — v1.0
- ✓ Strava OAuth integration with activity sync — v1.0
- ✓ Fitbit OAuth + Garmin OAuth 1.0a with webhook handler — v1.0
- ✓ Hevy integration (CSV import + API key) — v1.0
- ✓ Integration management page (ELITE-gated) — v1.0
- ✓ Sync queue with rate limiting and exponential backoff — v1.0
- ✓ CSV data export for workout history and personal records (all tiers) — v1.0
- ✓ Bundle optimized from 676KB to 71KB main chunk — v1.0

- ✓ React 19 + Vite 7 + Biome 2.4 zero errors + TypeScript strict mode — v1.1
- ✓ Sentry v10 with React 19 error hooks (onUncaughtError, onCaughtError, onRecoverableError) — v1.1
- ✓ Complete Phoenix design system: CSS variable tokens, elevation/typography/radius/icon scales, dual-token pattern — v1.1
- ✓ All 14+ dead buttons wired to real actions with unsaved changes dialog — v1.1
- ✓ RoutineBuilder + CycleBuilder save to Supabase with confirmed mutation pattern — v1.1
- ✓ Dashboard streak, profile stats, settings all wired to real Supabase queries — v1.1
- ✓ DashboardMobile renders on mobile devices with premium widgets — v1.1
- ✓ Auth modal with Radix Dialog focus trap, ARIA, keyboard nav + password reset flow — v1.1
- ✓ EmptyState pattern deployed across 6+ feature pages — v1.1
- ✓ All demo/placeholder data removed — every component shows real data or empty states — v1.1
- ✓ Goal setting: frequency, volume, PR goals with progress rings and celebration animations — v1.1
- ✓ 3-step onboarding overlay for new users, What's New banner for v1.0 users, FeatureHint tooltips — v1.1
- ✓ Recovery readiness dashboard: ACWR algorithm, 14-day data gate, contributing factors, tier gating — v1.1
- ✓ Community comments: flat-list threads with realtime subscription, 5-min edit window, RLS + rate limiting — v1.1
- ✓ Workout comparison: side-by-side deltas, session picker, mobile A/B tabs, PHOENIX/ELITE gating — v1.1
- ✓ Smart workout widget: reads real cycle data, shows next workout day on Dashboard — v1.1
- ✓ Session print reports with @media print CSS and Phoenix branding — v1.1
- ✓ PWA: installable, offline banner, auto-update service worker, install prompt after 3 sessions — v1.1
- ✓ Playwright E2E tests + @axe-core WCAG audit with contrast fixes — v1.1
- ✓ Bundle visualizer with rollup-plugin-visualizer — v1.1

### Active

<!-- Current milestone: v1.3 MVP Launch -->

## Current Milestone: v1.3 MVP Launch

**Goal:** Take Phoenix Portal from code-complete to publicly deployed on Cloudflare Pages at https://phoenix-portal.com — fix blockers, configure infrastructure, deploy Edge Functions, verify end-to-end flows, and roll out integrations as provider approvals arrive.

**Target areas:**
- Hard blocker: fix config.toml (stripe-webhooks → revenuecat-webhooks)
- Cloudflare Pages: wrangler.toml, _redirects, _headers (security headers + CSP)
- Coming Soon badges for Fitbit/Garmin on Integrations page
- Footer cleanup: remove placeholder items without working destinations
- Infrastructure: Supabase secrets, 14 Edge Function deployments, DNS
- RevenueCat webhook configuration for mobile billing
- Strava OAuth setup (instant approval)
- Fitbit/Garmin developer program submissions (1-6 week approval)
- End-to-end verification: auth, sync, subscriptions, OAuth, CORS

### Out of Scope

- Chat / direct messaging — requires moderation infrastructure, high ongoing cost
- Workout control — all machine control stays in the mobile app
- ML/AI features — all "intelligence" is statistical (per roadmap decision)
- Offline mode — portal requires internet connection; PWA is for installability and caching only
- Admin dashboard — defer to future milestone
- Video content / workout demonstrations — high storage cost, low ROI
- Custom exercise creation — breaks muscle mapping, volume tracking, and force curve analysis
- Coach/client management — two-sided marketplace, massive scope for companion dashboard
- Light mode / theme toggle — app is dark-only by design; .dark block deleted in v1.1
- React Compiler — stable but opt-in; defer evaluation to v1.2 after React 19 stabilizes
- Nested comment threads — flat-list only in v1.1; nested replies deferred to v1.2
- HRV-based recovery score — requires wearable sensor data not available from Vitruvian machine

## Context

**Shipped v1.1 with 41,920 LOC TypeScript across 266 modified files.**

Tech stack: React 19 + Vite 7 + TypeScript (strict) + Tailwind CSS v4 + shadcn/ui + Recharts 3 + visx + Framer Motion + TanStack Query + Zustand + React Router v7 + Supabase (auth, DB, Edge Functions, Realtime) + Stripe + Sentry v10 + Biome 2.4 + Playwright.

Production build: 95.69KB main entry chunk (34.46KB gzip), 15+ lazy-loaded pages, vendor chunk groups, PWA service worker with auto-update.

26 routes, 3 Zustand stores, 4 realtime hooks (sync, subscription, community votes, comments), 12+ query files with Zod validation, 5 new feature pages (Goals, Recovery, Comparison, Onboarding, Session Reports).

**Known items requiring human verification:**
- RevenueCat entitlement IDs must match `elite`/`phoenix` (case-insensitive) in webhook handler
- OAuth flows with real credentials (Strava at launch; Fitbit/Garmin when approved)
- Session replay animations and mobile layout (needs live testing)
- 14 Supabase Edge Functions (needs deployment — Phase 22)
- Mobile app must target production Supabase for sync pipeline verification
- 17 authenticated E2E tests skip without SUPABASE_TEST_EMAIL/PASSWORD env vars
- Recovery ACWR thresholds may need sport-science validation for cable resistance training

## Constraints

- **Tech stack**: React 19 + Vite 7 + TypeScript (strict) + Tailwind v4 + shadcn/ui + Biome 2.4 — established, not changing
- **Backend**: Supabase — auth, DB, Edge Functions, Realtime
- **Payments**: RevenueCat for mobile subscriptions (webhook → Supabase Edge Function)
- **View-only**: Portal never controls the workout machine — display and analyze only
- **Community**: Comments allowed (flat-list, RLS-gated, rate-limited) — no DMs, no nested threads
- **Data source**: All workout data originates from mobile app, synced to Supabase, read by portal
- **Recovery disclaimer**: ACWR scores are training load indicators only — descriptive language, no imperative commands
- **Formatting**: Biome standard — tabs, double quotes, semicolons, 80-char width

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fix tech debt before features | 6 critical + 18 high bugs, 100MB unused deps — unstable foundation | ✓ Good — clean foundation enabled fast feature dev |
| Supabase for backend | Already chosen for mobile migration (Spec 05), portal shares same project | ✓ Good — consistent data layer |
| Stripe → RevenueCat migration | Mobile-first billing via App Store/Play Store; RevenueCat webhooks update portal tier | ✓ Good — unified billing |
| Cloudflare Pages over Vercel | Cloudflare DNS already in use; Pages auto-deploys, simpler stack | Pending — v1.3 |
| Cloudflare auto-deploy (no CI gate) | CI is solid (5 jobs); auto-deploy on push to main acceptable risk | Pending — v1.3 |
| Full Cloudflare config in repo | wrangler.toml + _redirects + _headers committed for infrastructure-as-code | Pending — v1.3 |
| Remove placeholder footer items | Strip non-functional spans for cleaner launch; add links back when destinations exist | Pending — v1.3 |
| Coming Soon badges for Fitbit/Garmin | Ship with Strava active; gate Fitbit/Garmin behind badges while awaiting approval | Pending — v1.3 |
| No chat/moderation | High ongoing cost, community value comes from routine sharing not messaging | ✓ Good — avoided scope creep |
| Independent portal roadmap | Portal built UI + integrations without waiting for mobile backend | ✓ Good — shipped in 29 days |
| Statistical analytics only | No ML infrastructure — uses linear regression, moving averages, trends | ✓ Good — simple, no infra overhead |
| Reddit + curated community model | Upvote/downvote + featured creators + trending | ✓ Good — engagement without moderation |
| Cast wide net on integrations | Strava, Fitbit, Garmin, Hevy — as many as feasible | ✓ Good — 4 providers + CSV fallback |
| Auth modal overlay on landing | Single-page UX, no separate login route | ✓ Good — clean flow |
| visx for force curves, Recharts for trends | visx handles 3000+ data points; Recharts for simpler charts | ✓ Good — right tool for each job |
| Canvas 2D for session replay | React reconciliation too slow for 50Hz animation | ✓ Good — smooth playback |
| Custom SVG body outline for heatmap | No third-party library, keeps bundle small | ✓ Good — 0 extra deps |
| Broadcast channel for realtime sync | Matches mobile app architecture (not postgres_changes) | ✓ Good — consistent pattern |
| WEIGHT_MULTIPLIER=2 in Zod transforms | Per-cable to total weight conversion centralized | ✓ Good — single source of truth |
| manualChunks for vendor splitting | Split 676KB main to 71KB + vendor groups | ✓ Good — under 500KB target |
| Strict upgrade sequence (P9) | react-day-picker → Tailwind → Vite → Recharts → dnd-kit → React 19 | ✓ Good — avoided cascading failures |
| Delete .dark CSS block first (P9) | Block silently overwrites Phoenix palette with oklch grays | ✓ Good — unblocked design system |
| Dual-token pattern (P9) | CSS vars for Tailwind/inline, hex constants for SVG/motion | ✓ Good — clean separation of concerns |
| Confirmed mutations over optimistic (P10) | Toast confirms success; no speculative UI | ✓ Good — simpler, more reliable |
| Flat-list comments only (P11) | No nesting; soft-delete via deleted_at column | ✓ Good — simple, avoids recursive query complexity |
| ACWR with conservative thresholds (P11) | 14-day gate, 25-75% clamp until 30 days, descriptive only | ✓ Good — medical liability protection |
| RLS in migration files (P11) | community_comments RLS must ship with table creation | ✓ Good — prevents security gap window |
| @dnd-kit/react@0.3.0 new API (P9) | DragDropProvider+useSortable replaces old DndContext pattern | ⚠️ Revisit — API is pre-1.0, may change |
| --legacy-peer-deps for visx (P9) | visx works at runtime but has outdated React peer deps | ⚠️ Revisit — watch for visx React 19 update |
| Biome warn-level rules (P9) | 12 pre-existing rules at warn instead of 148 biome-ignore comments | ⚠️ Revisit — promote to error as code matures |

---
*Last updated: 2026-03-15 after v1.3 milestone start*
