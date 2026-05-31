# CLAUDE.md

> Legacy note: this file is Claude-specific project guidance. Codex and
> Symphony workspaces should use `AGENTS.md` and `WORKFLOW.md` as the current
> operating contract, with this file treated as supplemental historical context.

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
- **TanStack Query 5** for server state (25 query files incl. keys.ts, 11 mutation hooks)
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
- **Client state:** Zustand 5 stores (5 stores) in `src/stores/`
- **Server state:** TanStack Query with Supabase client, 25 query files in `src/queries/`, 11 mutation hooks in `src/mutations/`
- **Auth state:** AuthProvider context with Supabase Auth

### Component Organization
```
src/
├── app/
│   ├── components/
│   │   ├── [Feature].tsx          # Feature pages (Dashboard, Analytics, etc.)
│   │   ├── [Feature]Mobile.tsx    # Mobile variants
│   │   ├── ui/                    # shadcn/ui primitives (50+)
│   │   ├── routine-builder/       # Routine creation subcomponents
│   │   ├── cycle-builder/         # Training cycle subcomponents
│   │   ├── session-replay/        # Session replay components
│   │   ├── mobile/                # Mobile-specific implementations
│   │   └── __tests__/             # Component unit tests
│   ├── routes/                    # Route definitions, AppLayout, ProtectedRoute
│   └── hooks/                     # useAuth, useIsMobile, usePWAInstall
├── hooks/                         # 14 hooks: useRealtimeSync, useSubscription, useStreak, etc.
├── queries/                       # TanStack Query hooks (25 files incl. keys.ts)
├── mutations/                     # Mutation hooks (11 files)
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
22 Supabase Edge Functions in `supabase/functions/`:
- **Billing (5):** paddle-webhooks, paddle-cancel-subscription, paddle-update-subscription, paddle-refresh-subscription, paddle-checkout-custom-data
- **OAuth (4):** initiate-oauth, strava-oauth, fitbit-oauth, garmin-oauth
- **Sync (6):** strava-sync, fitbit-sync, hevy-sync, liftosaur-sync, garmin-webhook, process-sync-queue
- **Mobile (3):** mobile-sync-push, mobile-sync-pull, mobile-integration-sync
- **Account (1):** delete-account
- **Integrations (1):** disconnect-integration
- **Analytics (1):** generate-insights
- **Rankings (1):** compute-rankings

### Mobile Sync Edge Function Patterns

**mobile-sync-push** (`supabase/functions/mobile-sync-push/index.ts`):
- Accepts batched workout sessions with nested exercises, sets, rep summaries
- Uses `upsert` with `onConflict: 'id'` for all entities (last push wins on server)
- Validates payload size (max 10MB), array sizes (max 10,000 items)
- Rate limited: 10 requests per minute per user
- Requires EMBER subscription tier or higher
- Broadcasts `sync_complete` event for realtime portal updates

**mobile-sync-pull** (`supabase/functions/mobile-sync-pull/index.ts`):
- Returns data modified since `lastSync` timestamp (delta sync)
- Cursor-based pagination with 100 entities per page (max 500)
- Entity order: sessions -> routines -> cycles -> badges -> stats
- Uses composite cursor (updated_at, id) for stable ordering across pages
- Child entities fetched based on parent presence, not their own timestamps

### Sync Test Infrastructure

**Test Modes:**
- **Mock mode (default)**: `MOCK_EDGE_FUNCTIONS=true` in `vitest.config.ts`
- **Live mode**: `MOCK_EDGE_FUNCTIONS=false` requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

**Running tests:**
```bash
npm test                                    # All tests with mocks
npm test -- tests/sync/                     # Just sync tests
MOCK_EDGE_FUNCTIONS=false npm test          # Live mode against real Supabase
```

**Test files:**
- `tests/sync/transforms.test.ts` — Weight ×2 transforms (39 tests)
- `tests/sync/mode-transform.test.ts` — Workout mode round-trips (43 tests)
- `tests/sync/multi-device.test.ts` — Concurrent device scenarios (12 tests)
- `tests/sync/hierarchy.test.ts` — Nested entity integrity (35 tests)
- `tests/sync/helpers/mock-edge-functions.ts` — Mock implementation

### 1RM Estimate Parity (PARITY-CRITICAL)
- Estimated 1RM is computed on MOBILE (hybrid: Brzycki reps<=10, Epley reps>10) and shipped as `estimatedOneRepMaxKg` per exercise. The edge function stores it verbatim in `exercise_progress.estimated_1rm_kg`.
- `supabase/functions/_shared/exerciseProgressRows.ts#estimateOneRepMaxKg` and `src/lib/biomechanics.ts#estimateOneRepMax` are FALLBACKS only and MUST match the mobile formula. Mirror any change in the Project-Phoenix-MP counterpart (`OneRepMaxCalculator.estimate`).
- `personal_records` holds max-weight/max-volume PRs (a different metric) — never relabel them as "1RM". Record-type label maps (`csv.ts`, `RecordsTab.tsx`) key on the UPPERCASE DB values (`MAX_WEIGHT`, `MAX_VOLUME`, `1RM`).

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

## Migration Workflow Discipline

Non-negotiable rules to prevent schema drift (as discovered 2026-04-20 when 5 migrations were recorded in `schema_migrations` but their DDL was absent from prod):

### DO
- Write every schema change as a migration file in `supabase/migrations/`.
- Keep every DDL statement **idempotent** (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DO $$ ... IF NOT EXISTS ... $$`). A migration must be safe to re-run.
- Push migrations with `supabase db push` (or `supabase migration up`). This is the only path that executes SQL *and* records it in `schema_migrations`.
- Verify the artifact exists in prod after push (e.g. `SELECT 1 FROM information_schema.columns WHERE ...`).
- If the `.github/workflows/migrations.yml` PR gate fails, fix the migration — do not bypass.

### DO NOT
- **Never** run schema changes through the Supabase dashboard SQL editor. Dashboard runs bypass `supabase_migrations.schema_migrations`, and any subsequent `supabase db pull` will mark them applied without running them — the exact footgun that broke `routine_exercises.is_bodyweight`, `creator_stats`, and the benchmarks RLS policies.
- **Never** run `supabase migration repair --status applied <version>` unless you have **already executed** the DDL against the target DB and are only correcting tracking metadata. Repair inserts a bare row into `schema_migrations` with null `name`/`statements` — it runs zero SQL.
- **Never** run `supabase db pull` against a DB that had manual dashboard changes. It captures state but invents migration rows whose statements were never executed.
- **Never** commit a migration that depends on non-idempotent DDL. Partial apply = stuck forever.

### When drift is suspected
1. Compare local files: `ls supabase/migrations/*.sql`.
2. Compare tracked rows: `SELECT version, name, array_length(statements,1) FROM supabase_migrations.schema_migrations ORDER BY version;`.
3. Any row with `name IS NULL` or `statements IS NULL` is a bare-repaired ghost — its DDL may or may not have executed.
4. For each ghost, check whether its artifacts exist (`information_schema.columns`, `pg_views`, `pg_policies`, `pg_proc`).
5. Write a reconciliation migration that reapplies only the **missing** artifacts using idempotent DDL; leave already-present artifacts alone (especially views/tables of different `relkind` than the migration assumed — see the `creator_stats` materialized-view incident).

### CI coverage
- `.github/workflows/migrations.yml` — clean-applies every migration into a fresh Supabase stack on any PR that touches `supabase/migrations/`. Fails on file-vs-applied count mismatch.
- Follow-up not yet wired: a scheduled `supabase db diff --linked --schema public` that alerts on prod drift. Requires `SUPABASE_ACCESS_TOKEN` + DB password secrets.
