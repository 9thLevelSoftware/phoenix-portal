# Phoenix Portal

## What This Is

A premium web companion dashboard for Project Phoenix — a community rescue project for Vitruvian Trainer workout machines. The portal gives subscribers deep workout analytics, biomechanics visualizations, community routine sharing, session replay with telemetry playback, and a unified fitness data hub integrating with Strava, Fitbit, Garmin, and Hevy. All workout control happens in the mobile app; the portal is where subscribers analyze, share, and connect.

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

### Active

<!-- Next milestone scope — to be defined via /gsd:new-milestone -->

(None yet — run `/gsd:new-milestone` to define v1.1 scope)

### Out of Scope

- Chat / direct messaging — requires moderation infrastructure, high ongoing cost
- Workout control — all machine control stays in the mobile app
- ML/AI features — all "intelligence" is statistical (per roadmap decision)
- Offline mode — portal requires internet connection
- Admin dashboard — defer to future milestone
- Video content / workout demonstrations — high storage cost, low ROI
- Custom exercise creation — breaks muscle mapping, volume tracking, and force curve analysis
- Coach/client management — two-sided marketplace, massive scope for companion dashboard

## Context

**Shipped v1.0 with 31,459 LOC TypeScript across 208 files.**

Tech stack: React 18 + Vite 6 + TypeScript + Tailwind CSS v4 + shadcn/ui + Recharts + visx + Framer Motion + TanStack Query + Zustand + React Router v7 + Supabase (auth, DB, Edge Functions, Realtime) + Stripe.

Production build: 71KB main entry chunk, 15 lazy-loaded pages, 8 vendor chunk groups, largest lazy chunk 395KB.

26 routes, 3 Zustand stores (UI, replay, community), 3 realtime hooks (sync, subscription, community votes), 12 query files with Zod validation.

**Known items requiring human verification:**
- Stripe checkout/portal/webhooks (needs Stripe test environment)
- OAuth flows with real credentials (Strava, Fitbit, Garmin)
- Session replay animations and mobile layout (needs live testing)
- 11 Supabase Edge Functions (needs deployment)

## Constraints

- **Tech stack**: React 18 + Vite + TypeScript + Tailwind v4 + shadcn/ui — established, not changing
- **Backend**: Supabase — auth, DB, Edge Functions, Realtime
- **Payments**: Stripe for web subscriptions
- **View-only**: Portal never controls the workout machine — display and analyze only
- **No moderation**: Community features limited to sharing/voting — no user-generated text content requiring moderation
- **Data source**: All workout data originates from mobile app, synced to Supabase, read by portal

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fix tech debt before features | 6 critical + 18 high bugs, 100MB unused deps — unstable foundation | ✓ Good — clean foundation enabled fast feature dev |
| Supabase for backend | Already chosen for mobile migration (Spec 05), portal shares same project | ✓ Good — consistent data layer |
| Stripe for web billing | RevenueCat is mobile-only, Stripe handles web subscriptions | ✓ Good — clean checkout flow |
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

---
*Last updated: 2026-02-16 after v1.0 milestone*
