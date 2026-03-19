# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Phoenix Portal is a React web companion dashboard for Project Phoenix, a community rescue project for Vitruvian Trainer workout machines. It supports both viewing synced data and creating routines/cycles that sync back to the mobile app. It is a full-stack application with a Supabase backend (PostgreSQL, Auth, Realtime, Storage), 18 Edge Functions, and Paddle subscription billing (Merchant of Record for EU/AU tax compliance).

## Commands

```bash
npm run dev        # Start Vite dev server at http://localhost:5173
npm run build      # Production build to /dist
npm test           # Run Vitest unit tests
npm run typecheck  # TypeScript type checking
npm run test:e2e   # Run Playwright E2E tests
npm run gen:types  # Regenerate Supabase types (requires SUPABASE_PROJECT_REF env var)
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in values:
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anon/public key
- `VITE_PADDLE_CLIENT_TOKEN` - Paddle client-side SDK token
- `VITE_PADDLE_ENVIRONMENT` - sandbox or production
- `VITE_PADDLE_EMBER_MONTHLY_PRICE_ID` through `VITE_PADDLE_INFERNO_ANNUAL_PRICE_ID` - 6 Paddle price IDs (one per tier/interval combination)
- `SENTRY_DSN` - Sentry error monitoring DSN (optional; only initialized if user accepts cookies)

## Architecture

### Tech Stack
- **Vite 7** with React 19 and TypeScript
- **Tailwind CSS v4** with @tailwindcss/vite plugin
- **shadcn/ui** components (50+ Radix UI primitives in `src/app/components/ui/`)
- **Zustand 5** for client state (4 stores)
- **TanStack Query 5** for server state (19 query hooks, 10 mutation hooks)
- **Zod 4** for runtime schema validation
- **React Router v7** with lazy-loaded routes
- **Recharts 3** + **@visx** for data visualization
- **Framer Motion** (motion package) for animations with reduced-motion support
- **Supabase** for database, auth, realtime, storage, and Edge Functions
- **Paddle** for subscription billing (Merchant of Record; webhooks, overlay checkout, subscription management)
- **Sentry** for error monitoring (conditionally initialized based on cookie consent)
- **Biome 2.4** for linting and formatting
- **Vitest 4** + Testing Library for unit/integration tests
- **Playwright 1.58** for E2E tests

### Path Alias
`@` maps to `./src` (configured in vite.config.ts and tsconfig.json)

### State Management
- **Client state:** Zustand 5 stores (celebration, community, replay, UI) in `src/stores/`
- **Server state:** TanStack Query with Supabase client, query hooks in `src/queries/`, mutation hooks in `src/mutations/`
- **Auth state:** AuthProvider context with Supabase Auth

### Component Organization
```
src/
├── app/
│   ├── components/
│   │   ├── [Feature].tsx          # Feature pages (Dashboard, Analytics, etc.)
│   │   ├── [Feature]Mobile.tsx    # Mobile variants
│   │   ├── ui/                    # shadcn/ui primitives (50+)
│   │   ├── celebrations/          # Achievement animations
│   │   ├── routine-builder/       # Routine creation subcomponents
│   │   ├── cycle-builder/         # Training cycle subcomponents
│   │   ├── session-replay/        # Session replay components
│   │   ├── mobile/                # Mobile-specific implementations
│   │   └── __tests__/             # Component unit tests
│   ├── routes/                    # Route definitions, AppLayout, ProtectedRoute
│   └── hooks/                     # useAuth, useIsMobile, usePWAInstall
├── hooks/                         # 13 hooks: useRealtimeSync, useSubscription, useStreak, etc.
├── queries/                       # TanStack Query hooks (20 files incl. keys.ts)
├── mutations/                     # Mutation hooks (10 files)
├── schemas/                       # Zod validation schemas (7 files)
├── providers/                     # AuthProvider, QueryProvider
├── stores/                        # Zustand stores (4 stores)
├── lib/
│   ├── supabase.ts               # Supabase client
│   ├── pricing.ts                # Tier pricing source of truth
│   ├── sentry.ts                 # Sentry initialization (cookie-consent-gated)
│   ├── export/                    # GDPR data export
│   ├── integrations/              # OAuth client helpers
│   └── __tests__/                 # Library unit tests
├── styles/                        # Theme CSS, Tailwind config
└── test/                          # Test setup + utilities
```

### Data Flow
- **Database:** Supabase (PostgreSQL with RLS policies)
- **Auth:** Supabase Auth with email/password, managed via AuthProvider
- **Realtime:** Supabase Broadcast for mobile-to-portal sync
- **Payments:** Paddle overlay checkout via client SDK, Edge Functions for webhook handling and subscription management

### Mobile-to-Portal Sync Pipeline
1. User completes workout on mobile app
2. Mobile app writes workout data to `workout_sessions` table (via Supabase client)
3. Mobile app sends Supabase Broadcast event on channel `sync:{userId}` with event type `sync_complete`
4. Portal's `useRealtimeSync` hook (in `src/hooks/useRealtimeSync.ts`) listens for Broadcast events
5. On receiving `sync_complete`, hook invalidates relevant TanStack Query caches (workouts, records, analytics, routines, cycles)
6. UI components re-render with fresh data from cache refetch

### Edge Functions
18 Supabase Edge Functions in `supabase/functions/`:
- **Billing (3):** paddle-webhooks, paddle-cancel-subscription, paddle-update-subscription
- **OAuth (4):** initiate-oauth, strava-oauth, fitbit-oauth, garmin-oauth
- **Sync (6):** strava-sync, fitbit-sync, hevy-sync, liftosaur-sync, garmin-webhook, process-sync-queue
- **Mobile (2):** mobile-sync-push, mobile-sync-pull
- **Account (1):** delete-account
- **Integrations (1):** disconnect-integration
- **Analytics (1):** generate-insights

### Styling
- Dark theme by default (background: #0D0D0D)
- Phoenix color palette in `src/styles/theme.css`:
  - Primary/Ember: `#FF6B35`
  - Flame Red: `#DC2626`
  - Gold: `#F59E0B`
  - Forge Green: `#10B981`
- Custom animations: `animate-flame-flicker`, `animate-ember-rise`, `animate-phoenix-glow`
- CSS variables exposed via `@theme inline` for Tailwind v4

### Navigation Flow
1. `LandingPage` (unauthenticated) -- also /privacy, /terms, /faq as public routes
2. `Dashboard` (authenticated default)
3. Feature pages via desktop `Navigation` (grouped dropdown menus) or `MobileBottomNav` (mobile)
4. Detail views (SessionDetail, RoutineBuilder, CycleBuilder, SessionReplay) from list pages

### Mobile Responsiveness
- 768px breakpoint for mobile detection
- Separate mobile component variants exist for Dashboard, Analytics, Challenges, Community
- `MobileBottomNav` replaces desktop Navigation on small screens

## Key Files
- `src/app/routes/index.tsx` - Route definitions and lazy imports
- `src/providers/AuthProvider.tsx` - Authentication state management
- `src/providers/QueryProvider.tsx` - TanStack Query configuration
- `src/hooks/useRealtimeSync.ts` - Mobile-to-portal sync listener
- `src/lib/supabase.ts` - Supabase client configuration
- `src/lib/pricing.ts` - Subscription tier pricing (single source of truth)
- `src/styles/theme.css` - Phoenix color palette and custom animations
- `vite.config.ts` - Path aliases, plugins, test configuration

## Testing
- **Unit/Integration:** Vitest with jsdom, Testing Library React. Tests in `src/app/components/__tests__/` and `src/lib/__tests__/`
- **E2E:** Playwright with Chromium. Tests in `e2e/` directory
- **Linting:** Biome for formatting and lint rules

## The Daem0n's Covenant

This project is bound to Daem0n for persistent AI memory. Observe this protocol:

### At Session Dawn
- Commune with `get_briefing(project_path="C:/Users/dasbl/WebstormProjects/phoenix-portal")` immediately when powers manifest
- Heed any warnings or failed approaches before beginning work

### Before Alterations
- Cast `context_check("your intention", project_path="...")` before modifications
- Cast `recall_for_file("path", project_path="...")` when touching specific scrolls
- Acknowledge any warnings about past failures

### After Decisions
- Cast `remember(category, content, rationale, file_path, project_path="...")` to inscribe decisions
- Use categories: decision, pattern, warning, learning

### After Completion
- Cast `record_outcome(memory_id, outcome, worked, project_path="...")` to seal the memory
- ALWAYS record failures (worked=false) - they illuminate future paths

See Summon_Daem0n.md for the complete Grimoire.
