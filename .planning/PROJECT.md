# Phoenix Portal

## What This Is

A premium web companion dashboard for Project Phoenix — a community rescue project for Vitruvian Trainer workout machines. The portal gives subscribers deep workout analytics, biomechanics visualizations, community routine sharing, and a unified fitness data hub that integrates with third-party platforms. All workout control happens in the mobile app; the portal is where subscribers analyze, share, and connect.

## Core Value

Premium subscribers see data and insights about their training that they cannot get anywhere else — force curves, velocity trends, muscle balance analysis, and community-driven workout programming — making the subscription feel indispensable.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Inferred from existing codebase. -->

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
- ✓ Mobile-responsive layout with bottom nav — existing (with known bugs)
- ✓ Dark theme with Phoenix color palette (Ember, Flame, Gold, Forge) — existing
- ✓ 50+ shadcn/ui component primitives — existing
- ✓ Achievement celebration animations (PR, badge, streak, challenge) — existing

### Active

<!-- Current scope. Building toward these. -->

- [ ] Fix critical bugs and tech debt from codebase review (foundation)
- [ ] Supabase authentication (email/password, Google, Apple sign-in)
- [ ] Cloud sync — real data replacing all mock data via Supabase JS SDK + RLS
- [ ] Premium analytics — force curves, velocity profiles, per-rep quality scores, ROM analysis
- [ ] VBT (velocity-based training) zone visualization and auto-regulation insights
- [ ] Biomechanics dashboard — asymmetry detection, muscle balance, movement quality trends
- [ ] 50Hz telemetry replay — session playback with position/velocity/power streams
- [ ] Community hub — browse, search, upvote/downvote shared routines and cycles
- [ ] Community hub — featured creators, trending routines, staff picks curation
- [ ] Community hub — creator profiles with stats and reputation
- [ ] Third-party integrations — Google Health, Apple Health, Hevy
- [ ] Third-party integrations — Strava, Fitbit, Garmin, MyFitnessPal (and more)
- [ ] Subscription tier gating — FREE/PHOENIX/ELITE feature access in portal
- [ ] Stripe checkout integration for web subscriptions
- [ ] Realtime sync notifications — portal updates when mobile syncs

### Out of Scope

- Chat / direct messaging — requires moderation infrastructure, high ongoing cost
- Workout control — all machine control stays in the mobile app
- Mobile app development — this milestone is portal (web) only
- ML/AI features — all "intelligence" is statistical (per roadmap decision)
- Offline mode — portal requires internet connection
- Admin dashboard — defer to future milestone
- Video content / workout demonstrations — high storage cost, low ROI for v1

## Context

**Existing codebase state:** 20K+ LOC React/Vite SPA with 100% mock data, zero API integration, and 62+ known issues from comprehensive review (6 critical, 18 high). The UI shell exists for most features but nothing connects to real data.

**Mobile app (Project Phoenix MP):** Production beta v0.4.1 with real users, 273 KMP files, 15+ SQLDelight tables with sync-ready columns, complete BLE protocol (Nordic UART, 50Hz telemetry). Currently collecting per-rep biomechanics, force curves, and VBT data via Specs 01 and 02.

**Backend migration in progress:** Mobile app is migrating from Railway custom backend to Supabase (auth, PostgreSQL with RLS, Edge Functions, Realtime channels). Spec 05 defines 18 Supabase tables, 5 Edge Functions, and 4 Realtime channels. Portal will read directly from Supabase tables via JS SDK + RLS (NOT through mobile sync endpoints).

**Integration plan (Spec 05):** Portal needs `supabaseClient.ts`, `AuthProvider.tsx`, Stripe integration. Portal subscribes to `sync:{userId}` Realtime channel to know when mobile syncs new data. Same Supabase project, same user accounts, platform-specific JWT tokens.

**Subscription model:** FREE / PHOENIX ($9.99/mo) / ELITE ($19.99/mo). Stripe for web, RevenueCat for mobile. Subscription status flows from Supabase `subscriptions` table.

**Known data model mismatches:** Workout modes (web generic vs Android specific), weight representation (per-cable vs total), PR types, exercise categories, badge definitions, MetricSample storage format (rows vs JSONB). These must be aligned during integration.

## Constraints

- **Tech stack**: React 18 + Vite + TypeScript + Tailwind v4 + shadcn/ui — established, not changing
- **Backend**: Supabase (strong preference) — auth, DB, Edge Functions, Realtime
- **Payments**: Stripe for web subscriptions
- **View-only**: Portal never controls the workout machine — display and analyze only
- **No moderation**: Community features limited to sharing/voting — no user-generated text content requiring moderation
- **Data source**: All workout data originates from mobile app, synced to Supabase, read by portal
- **Independence**: Portal roadmap is independent from mobile's Phase 3 backend timeline — build what we can now, connect when ready

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fix tech debt before features | 6 critical + 18 high bugs, 100MB unused deps, broken mobile nav — unstable foundation | — Pending |
| Supabase for backend | Already chosen for mobile migration (Spec 05), portal shares same project | — Pending |
| Stripe for web billing | RevenueCat is mobile-only, Stripe handles web subscriptions | — Pending |
| No chat/moderation | High ongoing cost, community value comes from routine sharing not messaging | — Pending |
| Independent portal roadmap | Portal can build UI, mock integrations, and prep data layer without waiting for mobile backend | — Pending |
| Statistical analytics only | No ML infrastructure exists — all "intelligence" uses linear regression, moving averages, trend analysis | — Pending |
| Reddit + curated community model | Upvote/downvote + featured creators + trending — community-driven with editorial highlights | — Pending |
| Cast wide net on integrations | Google Health, Apple Health, Hevy, Strava, Fitbit, Garmin, MyFitnessPal — as many as feasible | — Pending |

---
*Last updated: 2026-02-15 after initialization*
