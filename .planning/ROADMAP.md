# Roadmap: Phoenix Portal

## Overview

Phoenix Portal transforms from a mock-data prototype into a premium fitness analytics dashboard. The journey begins by stabilizing 62+ known bugs (Phase 0), then builds the authenticated data foundation (Phase 1), replaces the fragile navigation architecture (Phase 2), and establishes subscription gating (Phase 3). With infrastructure complete, four feature phases execute in parallel: premium biomechanics analytics (Phase 4), community hub (Phase 5), session replay (Phase 6), and third-party integrations with data export (Phase 7). Every phase delivers a coherent, user-verifiable capability.

## Phases

**Phase Numbering:**
- Integer phases (0, 1, 2, ...): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

**Dependency Structure:**
```
Phase 0 (Stabilization)
    |
    v
Phase 1 (Auth & Data)
    |
    v
Phase 2 (Navigation & State)
    |
    v
Phase 3 (Subscriptions & Payments)
    |
    +--> Phase 4 (Premium Analytics)  --> Phase 6 (Session Replay)
    |
    +--> Phase 5 (Community Hub)
    |
    +--> Phase 7 (Integrations & Export)
```

Phases 4, 5, and 7 can execute in parallel after Phase 3 completes. Phase 6 depends on Phase 4.

- [x] **Phase 0: Stabilization** - Fix 62+ bugs, remove dead dependencies, add test framework and error boundaries (completed 2026-02-15)
- [ ] **Phase 1: Authentication & Data Layer** - Supabase auth, real data replacing all mocks, realtime sync bridge
- [ ] **Phase 2: Navigation & State Management** - React Router, Zustand, deep linking, proper mobile nav
- [ ] **Phase 3: Subscriptions & Payments** - Stripe checkout, tier gating at UI and database level, upgrade flows
- [ ] **Phase 4: Premium Analytics** - Force curves, VBT zones, asymmetry detection, biomechanics dashboard
- [ ] **Phase 5: Community Hub** - Browse, share, vote on routines; creator profiles; trending content
- [ ] **Phase 6: Session Replay & Advanced VBT** - 50Hz telemetry playback, rep quality scoring, fatigue detection
- [ ] **Phase 7: Integrations & Data Export** - Third-party fitness service connections, CSV export, integration management

## Phase Details

### Phase 0: Stabilization
**Goal**: The application runs without critical errors, loads fast, and has a safety net for future refactoring
**Depends on**: Nothing (first phase)
**Requirements**: STAB-01, STAB-02, STAB-03, STAB-04, STAB-05, STAB-06, STAB-07, STAB-08, STAB-09, STAB-10, STAB-11, STAB-12
**Success Criteria** (what must be TRUE):
  1. Application loads without console errors or warnings from broken hooks, conditional rendering, or memory leaks
  2. npm install completes without warnings about unused/misplaced dependencies, and production bundle is under 500KB gzipped
  3. Running `npm test` executes a passing test suite with at least one test per page component
  4. Each page component is lazy-loaded (visible in network tab as separate chunks) and wrapped in an error boundary that catches rendering failures gracefully
  5. Logo loads in under 200ms on 3G throttle, and fonts render without layout shift from @import blocking
**Plans**: 3 plans

Plans:
- [x] 00-01-PLAN.md -- Fix all critical React bugs and clean up dependencies/package.json
- [x] 00-02-PLAN.md -- Set up Vitest test framework, implement code splitting, and add error boundaries
- [x] 00-03-PLAN.md -- Optimize logo to WebP and replace CSS @import fonts with preconnect/link tags

### Phase 1: Authentication & Data Layer
**Goal**: Users sign in with real accounts and see their actual workout data from Supabase instead of mock data
**Depends on**: Phase 0
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, DATA-07, DATA-08, DATA-09, DATA-10, DATA-11, DATA-12, DATA-13
**Success Criteria** (what must be TRUE):
  1. User can create an account (email/password, Google, or Apple), log in, and stay logged in across browser refreshes
  2. User can log out from any page and is redirected to the login screen
  3. Dashboard, Workout History, Personal Records, Analytics, Routines, and Training Cycles pages all display real data from Supabase (no mock data remains in any page component)
  4. When the mobile app syncs a new workout, the portal automatically reflects the updated data within seconds without manual refresh
  5. Weight values, workout modes, and PR types display correctly with proper unit conversions (no doubled/halved weights from per-cable vs total mismatch)
**Plans**: 7 plans

Plans:
- [ ] 01-01-PLAN.md -- Supabase client setup, stub type generation, and environment configuration
- [ ] 01-02-PLAN.md -- AuthProvider, login/signup UI, and session management
- [ ] 01-03-PLAN.md -- TanStack Query setup, query key factory, and Zod transform layer
- [ ] 01-04-PLAN.md -- Dashboard and Workout History data migration (mock to Supabase)
- [ ] 01-05-PLAN.md -- Personal Records, Analytics, Routines, and Training Cycles data migration
- [ ] 01-06-PLAN.md -- Realtime sync bridge and SessionDetail data loading
- [ ] 01-07-PLAN.md -- Gap closure: Add logout buttons to Profile and Navigation (AUTH-05)

### Phase 2: Navigation & State Management
**Goal**: Users navigate the portal via URLs with browser back/forward support, and all pages are accessible from both desktop and mobile navigation
**Depends on**: Phase 1
**Requirements**: NAV-01, NAV-02, NAV-03, NAV-04, NAV-05, NAV-06, NAV-07
**Success Criteria** (what must be TRUE):
  1. Every page has a unique URL path that can be bookmarked, shared, and opened directly
  2. Browser back and forward buttons navigate between previously visited pages correctly
  3. Mobile bottom navigation provides access to all portal pages (not limited to 5 of 9)
  4. Unauthenticated users are redirected to the login page when accessing any protected route
  5. App.tsx no longer contains page-switching useState hooks or prop-drilled navigation handlers
**Plans**: 3 plans

Plans:
- [ ] 02-01-PLAN.md -- React Router v7 + Zustand setup, route definitions, ProtectedRoute, AppLayout
- [ ] 02-02-PLAN.md -- Navigation and MobileBottomNav migration to NavLink + Zustand + More drawer
- [ ] 02-03-PLAN.md -- Page component prop removal (useParams/useNavigate replacing callbacks)

### Phase 3: Subscriptions & Payments
**Goal**: Users can subscribe to PHOENIX or ELITE tiers via Stripe, and premium content is gated at both the UI and database level
**Depends on**: Phase 2
**Requirements**: SUB-01, SUB-02, SUB-03, SUB-04, SUB-05, SUB-06, SUB-07, SUB-08, SUB-09, SUB-10
**Success Criteria** (what must be TRUE):
  1. FREE user can initiate checkout for PHOENIX ($14.99/mo or $149.99/yr) or ELITE ($24.99/mo or $249.99/yr) and complete payment via Stripe
  2. After subscribing, premium content unlocks immediately without manual refresh or re-login
  3. FREE user attempting to access gated content sees an upgrade prompt with clear tier comparison, not a blank page or error
  4. Subscription tier is enforced at the database level -- a FREE user cannot retrieve premium data even by calling the Supabase API directly
  5. User can manage their subscription (cancel, change plan) through the Stripe Customer Portal accessible from their profile
**Plans**: 4 plans

Plans:
- [ ] 03-01-PLAN.md -- Supabase migration (subscriptions table, RLS, tier helper) and Stripe Edge Functions (checkout, portal, webhooks)
- [ ] 03-02-PLAN.md -- Client subscription infrastructure (stripe.ts, useSubscription hook, SubscriptionGate, TierBadge, database types)
- [ ] 03-03-PLAN.md -- PricingPlans page with tier cards, billing toggle, checkout integration, and TierBadge in navigation
- [ ] 03-04-PLAN.md -- UpgradePrompt component, Profile subscription management, and checkout return handling

### Phase 4: Premium Analytics
**Goal**: Subscribers see biomechanics insights no other consumer platform provides -- force curves, velocity profiles, asymmetry detection, and exercise-level progress
**Depends on**: Phase 3
**Requirements**: BIO-01, BIO-02, BIO-03, BIO-04, BIO-05, BIO-06, BIO-07, BIO-08, BIO-09, BIO-10, BIO-11, BIO-12, BIO-13
**Success Criteria** (what must be TRUE):
  1. User can view per-rep force curves for any exercise in a session, rendered smoothly with visx (no browser freezing on sets with 3000+ telemetry points)
  2. User can see left vs right cable asymmetry percentage for each exercise, with visual flagging when imbalance exceeds 10%
  3. User can view VBT analytics (mean/peak velocity per rep) with zone classification labels (strength/power/speed) per set
  4. Biomechanics dashboard page is accessible to PHOENIX+ subscribers and shows power output, ROM trends, muscle heatmap, and consistency calendar
  5. Exercise-level progress charts show weight, volume, and estimated 1RM trends over time with weekly/monthly summary reports
**Plans**: 6 plans

Plans:
- [ ] 04-01-PLAN.md -- Install visx/downsample, create LTTB utility, VBT zones, biomechanics calcs, Zod schemas, query factories
- [ ] 04-02-PLAN.md -- Force curve visualization with visx (gradient fills, per-rep rendering, shared chart theme)
- [ ] 04-03-PLAN.md -- VBT velocity profile and power output chart components
- [ ] 04-04-PLAN.md -- Asymmetry gauge with L/R threshold flagging and ROM trend chart
- [ ] 04-05-PLAN.md -- Biomechanics dashboard page (PHOENIX-gated), muscle heatmap, consistency calendar, route registration
- [ ] 04-06-PLAN.md -- Exercise progress charts (Recharts) and weekly/monthly summary report cards

### Phase 5: Community Hub
**Goal**: Users browse, share, and vote on community routines and cycles, with featured creators and trending content driving engagement
**Depends on**: Phase 3
**Requirements**: COMM-01, COMM-02, COMM-03, COMM-04, COMM-05, COMM-06, COMM-07, COMM-08, COMM-09
**Success Criteria** (what must be TRUE):
  1. Any user can browse the community feed, search by name, and filter by muscle group, goal, or difficulty
  2. PHOENIX+ subscribers can share their routines/cycles to the community and see them appear in the feed
  3. Users can upvote/downvote shared content, and vote counts update in realtime without page refresh
  4. Community feed supports hot/top/new sorting, and a featured creators section highlights staff picks and trending routines
  5. User can view creator profiles (total shares, upvotes, featured count) and save community routines to their own library
**Plans**: 4 plans

Plans:
- [ ] 05-01-PLAN.md -- Community data layer (types, schemas, queries, store, realtime hook, debounce hook)
- [ ] 05-02-PLAN.md -- Feed page with cards, tabs, search, filter, sort, detail drawer (desktop + mobile)
- [ ] 05-03-PLAN.md -- Vote mutations with optimistic updates, share dialog, save mutations, realtime mute window
- [ ] 05-04-PLAN.md -- Featured creators horizontal scroll, creator profiles, save-to-library integration

### Phase 6: Session Replay & Advanced VBT
**Goal**: ELITE subscribers can replay workout sessions with synchronized 50Hz telemetry visualization, rep quality scores, and fatigue detection
**Depends on**: Phase 4
**Requirements**: REPLAY-01, REPLAY-02, REPLAY-03, REPLAY-04, REPLAY-05, REPLAY-06, REPLAY-07, REPLAY-08
**Success Criteria** (what must be TRUE):
  1. User can open any past session and play back the telemetry data with synchronized force curve and velocity profile animations
  2. Playback controls (play, pause, speed adjustment, scrub slider) respond immediately and keep force/velocity charts in sync
  3. Individual rep boundaries are visually highlighted during playback, and each rep shows a composite quality score
  4. Fatigue detection flags sets where velocity drops more than 20%, with a visible indicator on the timeline
  5. Session replay is gated behind ELITE tier and renders via Canvas 2D (no browser jank on mobile devices)
**Plans**: TBD

Plans:
- [ ] 06-01: Zustand replay store and Canvas 2D rendering pipeline
- [ ] 06-02: Telemetry playback with synchronized force/velocity scrubbing
- [ ] 06-03: Rep boundary detection, quality scoring, and fatigue detection
- [ ] 06-04: Playback controls, ELITE tier gating, and mobile optimization

### Phase 7: Integrations & Data Export
**Goal**: Users connect third-party fitness services and export their data, with all synced data displayed alongside Phoenix workouts
**Depends on**: Phase 3
**Requirements**: INT-01, INT-02, INT-03, INT-04, INT-05, INT-06, INT-07, INT-08, INT-09, INT-10, INT-11, EXP-01, EXP-02, EXP-03
**Success Criteria** (what must be TRUE):
  1. User can view an integration management page showing all available services with connect/disconnect buttons and last sync status
  2. User can connect Strava via OAuth and see synced workouts appear in their analytics alongside Phoenix workout data
  3. Apple Health and Google Health Connect sync paths are documented as mobile-only flows, with data visible in the portal after mobile sync
  4. Third-party data is normalized to Phoenix format and displayed in analytics charts without format inconsistencies
  5. Any user (all tiers) can export workout history and personal records as CSV files from their profile
**Plans**: TBD

Plans:
- [ ] 07-01: Integration management page and data normalization layer
- [ ] 07-02: Strava OAuth Edge Function and workout sync
- [ ] 07-03: Hevy integration (API or CSV import)
- [ ] 07-04: Fitbit and Garmin OAuth Edge Functions and sync
- [ ] 07-05: Apple Health and Google Health Connect documentation and display
- [ ] 07-06: Rate limit tracking, sync queue, and ELITE tier gating
- [ ] 07-07: CSV data export (workout history and personal records, all tiers)

## Progress

**Execution Order:**
Phases 0 through 3 execute sequentially. After Phase 3 completes, Phases 4, 5, and 7 can execute in parallel. Phase 6 executes after Phase 4.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Stabilization | 3/3 | Complete | 2026-02-15 |
| 1. Authentication & Data Layer | 0/7 | Planned | - |
| 2. Navigation & State Management | 0/3 | Not started | - |
| 3. Subscriptions & Payments | 0/4 | Not started | - |
| 4. Premium Analytics | 0/6 | Not started | - |
| 5. Community Hub | 0/4 | Planned | - |
| 6. Session Replay & Advanced VBT | 0/4 | Not started | - |
| 7. Integrations & Data Export | 0/7 | Not started | - |
