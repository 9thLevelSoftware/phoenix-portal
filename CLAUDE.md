# CLAUDE.md

> Legacy note: this file is Claude-specific project guidance. Codex and
> Symphony workspaces should use `AGENTS.md` and `WORKFLOW.md` as the current
> operating contract, with this file treated as supplemental historical context.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Phoenix Portal is a React web companion dashboard for Project Phoenix, a community project supporting Phoenix-compatible fitness machines. It supports both viewing synced data and creating routines/cycles that sync back to the mobile app. It is a full-stack application with a Supabase backend (PostgreSQL, Auth, Realtime, Storage), a set of Supabase Edge Functions, and Paddle subscription billing (Merchant of Record for EU/AU tax compliance).

The first-principles axioms this codebase is judged against are in
[`docs/axioms.md`](docs/axioms.md) (FP-1…FP-8). Read them before changing
auth, billing, sync, deletion/export or migrations.

## Commands

```bash
npm run dev        # Start Vite dev server at http://localhost:5173
npm run build      # Production build to /dist
npm test           # Vitest unit/integration suite (mock Edge by default)
npm run typecheck  # tsc -p over every tsconfig project; fails on errors not in typecheck-baseline.json
npm run typecheck:baseline  # Rewrite typecheck-baseline.json from the current state
npm run test:e2e   # Playwright E2E (mocked REST; scripts/run-playwright-e2e.mjs)
npm run test:sync       # tests/sync/ with MOCK_EDGE_FUNCTIONS=true
npm run test:sync:live  # tests/sync/live/ against a preview project (dispatch-only)
npm run check:edge-functions  # deno check over every Edge Function
npm run test:edge             # Deno handler tests (in-process doubles, no stack)
npm run test:edge:integration # Only the "integration: " tests, against a local stack
npm run supabase -- <args>  # Pinned Supabase CLI (version in .supabase-cli-version)
npm run test:db          # Full pgTAP suite against the local stack (CI: migrations.yml)
npm run gen:types:local  # Regenerate src/lib/database.types.ts from the migrated local DB
npm run gen:types:check  # Fail if database.types.ts drifts from the migrations (CI gate)
npm run verify           # lint + typecheck + test + build + sourcemap/config asserts
```

### Generated types

Regenerating types after a migration change: `npm run supabase -- start`, then
`npm run supabase -- db reset --no-seed`, then `npm run gen:types:local`, and
commit the file. Never hand-edit `database.types.ts`; put refinements the
generator cannot express (nullable RPC args, PostgREST version) in
`src/lib/database.ts`. `npm run gen:types` (hosted project via
`SUPABASE_PROJECT_REF`) produces prod-shaped types that CI will reject.

### Typecheck

The root `tsconfig.json` is a solution file (`"files": []` plus three project
references), so **`tsc --noEmit` over it compiles an empty program and exits 0
without checking anything.** Never use it as a gate.

`npm run typecheck` runs `scripts/typecheck.mjs`, which type-checks each
project explicitly (`tsc -p tsconfig.app.json|tsconfig.node.json|tsconfig.test.json
--noEmit`) and compares the errors against `typecheck-baseline.json`
(counts per project, file and error code). It fails only on errors not in the
baseline, so the pre-existing backlog does not block a PR. When you fix
errors, shrink the baseline with `npm run typecheck:baseline` and commit it;
never regenerate it to absorb a new error. The `test` project re-reports some
`app` errors, so one fix can lower two counts.

### Edge Function tests

`npm run test:edge` runs the Deno handler suites with in-process doubles and no
database. Real-SQL suites are opt-in by naming convention: a test named
`"integration: …"` and gated with `ignore: localIntegrationEnvironment === null`
is skipped by `test:edge` and selected by `test:edge:integration`, which needs a
local stack (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)
and fails unless every selected test actually executed. A gated test *without*
the `integration: ` prefix silently never runs anywhere.

## Environment Variables

`.env.example` is the list; copy it to `.env.local` and confirm each value.
Never read or quote the contents of a `.env*` file — variable **names** only.

Browser bundle (`VITE_`-prefixed, embedded at build time — never put a secret here):
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_ENVIRONMENT` (`sandbox`, or empty for production)
- `VITE_PADDLE_EMBER_MONTHLY_PRICE_ID` … `VITE_PADDLE_INFERNO_ANNUAL_PRICE_ID` (one per tier × interval)
- `VITE_SENTRY_DSN` — read by `src/lib/sentry.ts`; Sentry only initializes when the DSN is set **and** the user accepted cookies. (`SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` are build-time only, read by `vite.config.ts` for sourcemap upload.)

Edge Function secrets (Supabase Dashboard → Edge Functions → Secrets; read with
`Deno.env.get`, never `VITE_`):
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENVIRONMENT`
- `SUPABASE_PUBLIC_URL` — the externally reachable functions origin. `initiate-oauth`, `complete-oauth` and `strava-oauth` build their redirect URI from it and fall back to `SUPABASE_URL`; `_shared/oauthTokenCrypto.ts` also mixes it into key derivation. (`fitbit-oauth` and `garmin-oauth` are disabled and read no env; see Edge Functions.)
- `APP_URL` — the portal origin the OAuth callbacks redirect back to (`${APP_URL}/integrations?…`, default `http://localhost:5173`) and one of the allowed CORS origins in `_shared/cors.ts`. There is no `PORTAL_URL`.
- `PADDLE_API_KEY` (server API calls from `delete-account` and the three `paddle-*-subscription` functions), `PADDLE_WEBHOOK_SECRET`, `PADDLE_CUSTOM_DATA_SECRET`, `PADDLE_ENVIRONMENT`, `PADDLE_EMBER_PRICE_IDS` / `PADDLE_FLAME_PRICE_IDS` / `PADDLE_INFERNO_PRICE_IDS`
- `CRON_SECRET` — the shared secret for pg_cron-invoked functions, compared in constant time against the `x-cron-secret` header by `_shared/cronSecret.ts`. `process-sync-queue` still accepts the legacy names `PROCESS_SYNC_QUEUE_SECRET` and `CRON_SYNC_QUEUE_SECRET`, but only when `CRON_SECRET` is unset; nothing else does. The DB half is the Vault secret `edge_cron_secret` used by `private.invoke_edge_function` (KD-10).
- `SYNC_LWW_ENABLED` — cold-start flag in `supabase/functions/_shared/flags.ts`, `"false"` unless the secret is exactly `true`. Flipping it requires a redeploy; there is no runtime refresh. Its production value is not recorded in this repo — ask the operator rather than assuming.
- `SYNC_PUSH_TRANSACTION` — cold-start flag in the same file, `"false"` unless exactly `true`. When on, `mobile-sync-push` runs its whole write sequence in one Postgres transaction (F-014, `_shared/pushTransaction.ts`): a failure part-way commits nothing, and the `sync_complete` broadcast happens only after COMMIT. It connects with `SUPABASE_DB_URL` (provided by Supabase to Edge Functions); if that connection cannot be opened the push falls back to per-call writes and logs `PushTransactionUnavailable`. The response contract is identical either way.
- `OAUTH_TOKEN_ENCRYPTION_KEY`, `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET`, `FITBIT_CLIENT_ID` / `FITBIT_CLIENT_SECRET`, `GARMIN_CONSUMER_KEY` / `GARMIN_CONSUMER_SECRET`, `GARMIN_WEBHOOK_SECRET` (the webhook 503s without it). The Fitbit client secrets are still read by `complete-oauth`, `fitbit-sync` and `_shared/providerRevoke.ts`, the Garmin consumer secrets only by `_shared/providerRevoke.ts`; the disabled `fitbit-oauth` / `garmin-oauth` callbacks read none.

Tooling only: `SUPABASE_PROJECT_REF` and the `SUPABASE_AUTH_*` values used by
`npm run auth:social:push`; `LINEAR_API_KEY` for Symphony.

## Architecture

### Tech Stack
- **Vite 7** with React 19 and TypeScript
- **Tailwind CSS v4** with @tailwindcss/vite plugin
- **shadcn/ui** components (50+ Radix UI primitives in `src/app/components/ui/`)
- **Zustand 5** for client state
- **TanStack Query 5** for server state
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
- **Client state:** Zustand stores in `src/stores/`
- **Server state:** TanStack Query over the Supabase client — query option factories in `src/queries/` (keys in `src/queries/keys.ts`), mutation hooks in `src/mutations/`
- **Auth state:** AuthProvider context with Supabase Auth

### Component Organization

Directory map only — counts go stale, so run `ls` rather than trusting a number here.

```
src/
├── app/
│   ├── components/
│   │   ├── [Feature].tsx          # Feature pages (Dashboard, Analytics, …)
│   │   ├── [Feature]Mobile.tsx    # Mobile variants
│   │   ├── ui/                    # shadcn/ui primitives
│   │   ├── analytics/ charts/ community/ integrations/ landing/
│   │   ├── modals/ profile/ figma/
│   │   ├── routine-builder/       # Routine creation subcomponents
│   │   ├── cycle-builder/         # Training cycle subcomponents
│   │   ├── session-replay/        # Session replay components
│   │   └── __tests__/             # Component unit tests
│   ├── routes/                    # index.tsx, AppLayout, ProtectedRoute, SubscribedRoute
│   └── hooks/                     # useAuth, useIsMobile, usePWAInstall, usePreferredWeightUnit, …
├── hooks/                         # useRealtimeSync, useSubscription, useStreak, …
├── queries/                       # TanStack Query option factories + keys.ts
├── mutations/                     # Mutation hooks
├── schemas/                       # Zod validation schemas
├── providers/                     # AuthProvider, QueryProvider
├── stores/                        # Zustand stores
├── lib/
│   ├── supabase.ts               # Supabase client
│   ├── pricing.ts                # Tier pricing source of truth
│   ├── sentry.ts                 # Sentry initialization (cookie-consent-gated)
│   ├── build/                     # Build-time metadata
│   ├── export/                    # GDPR data export
│   ├── integrations/              # OAuth client helpers
│   ├── units/                     # Weight units + the KD-8 load display adapter
│   └── __tests__/                 # Library unit tests
├── styles/                        # Theme CSS, Tailwind config
└── test/                          # Test setup + utilities
```

There is **no** `src/app/components/mobile/` directory; mobile variants are
`*Mobile.tsx` files beside their desktop counterparts (and under
`analytics/`).

### Data Flow
- **Database:** Supabase (PostgreSQL with RLS policies)
- **Auth:** Supabase Auth with email/password, managed via AuthProvider
- **Realtime:** Supabase Broadcast for mobile-to-portal sync
- **Payments:** Paddle overlay checkout via client SDK, Edge Functions for webhook handling and subscription management

### Mobile-to-Portal Sync Pipeline
1. User completes workout on mobile app
2. Mobile app POSTs the session graph to `mobile-sync-push` (Edge upsert; not a browser PostgREST write)
3. Edge broadcasts `sync_complete` on private channel `sync:{userId}`
4. Portal's `useRealtimeSync` hook (in `src/hooks/useRealtimeSync.ts`) listens on that exact topic
5. On receiving `sync_complete`, hook invalidates relevant TanStack Query caches (workouts, records, analytics, routines, cycles, insights, …)
6. UI components re-render with fresh data from cache refetch

`rep_telemetry` and `exercise_progress` snapshots used by session replay are **portal-only**. `mobile-sync-pull` does not return telemetry; do not add a telemetry pull in this stack.

### Edge Functions

Every deployed function has a directory under `supabase/functions/` **and** a
`[functions.<name>]` block in `supabase/config.toml` carrying its explicit
`verify_jwt`. `ls supabase/functions` is the source of truth; the list below is
a map, not a count.

- **Billing:** paddle-webhooks, paddle-cancel-subscription, paddle-update-subscription, paddle-refresh-subscription, paddle-checkout-custom-data
- **OAuth:** initiate-oauth, complete-oauth, strava-oauth, fitbit-oauth and garmin-oauth (both disabled: 410 Gone for every request until the provider launches, `_shared/disabledOAuthCallback.ts`)
- **Provider sync:** strava-sync, fitbit-sync, hevy-sync, liftosaur-sync, garmin-webhook, process-sync-queue
- **Mobile:** mobile-sync-push, mobile-sync-pull, mobile-integration-sync
- **Account / GDPR:** delete-account, export-user-data
- **Integrations:** disconnect-integration
- **Analytics:** generate-insights
- **Rankings:** compute-rankings

`initiate-oauth` and `complete-oauth` are `verify_jwt = true`; the three
provider callbacks (`strava-oauth`, `fitbit-oauth`, `garmin-oauth`) are
`false` because the provider redirects a browser to them with no JWT. The
Fitbit and Garmin callbacks do nothing but answer 410 (NF-46).
`complete-oauth` is the session-bound completion endpoint (KD-13): binding the
provider grant to the completing user's own JWT is its entire purpose.

`generate-insights` is `verify_jwt = false` because pg_cron reaches it through
`private.invoke_edge_function` with no JWT (KD-10/KD-14). It authenticates
itself, accepting *either* a constant-time `x-cron-secret` match (for
`{mode:'batch'}`) *or* a user JWT it verifies with `auth.getUser()` and then
gates at FLAME — neither credential can reach the other path, and anything
else is a 401. Its schedule is created by
`supabase/migrations/20260920006400_schedule_generate_insights.sql`.
`compute-rankings` is also `verify_jwt = false` but takes the other route: it
requires an `Authorization` header and verifies the caller itself, 401ing
without one. **A gateway `verify_jwt = false` never means "unauthenticated" —
read the handler.**

### The mobile sync contract

Read `supabase/functions/mobile-sync-push/index.ts` and
`.../mobile-sync-pull/index.ts` before changing anything here. `docs/dto-drift-matrix.md`
and `docs/multi-device-test-design.md` are historical: they describe the
pre-tombstone, pre-LWW-clock push and are **not** the current contract.

**Two clocks, and they are not interchangeable.**
- `client_updated_at` is the **LWW key**: the pushing device's own clock for a
  mobile-authored version, `now()` for a portal edit. A push whose DTO carries
  no `updatedAt` is dated at receipt, not left null.
- `updated_at` is **server-owned** and is the **pull cursor / ordering key**.
  Nothing on the device may write it.
- The sessions pull reports `client_updated_at ?? updated_at` as the DTO's
  `updatedAt` (the fallback covers rows written before the `20260920002100`
  backfill) while its cursor stays on `updated_at`. Routine and cycle DTOs
  still report `updated_at` — routines as epoch ms, cycles as an ISO string.
- `rejections[].serverUpdatedAt` is the **stored LWW key** — the
  `client_updated_at` the push lost to — for `sessions`, `routines` **and**
  `cycles`. Cycles used to report the server clock here; since `20260920002100`
  / `…2101` they do not. It is not a cursor and must never be compared with
  `cycleVersions` / `baseUpdatedAt`, which stay on `updated_at`. It is `null`
  when there is no row to report.
  The same response object also carries `externalActivities`, `rpgAttributes`
  and `gamificationStats` rejection lists. Those come from
  `upsert_external_activity_lww` / `upsert_rpg_attributes_lww` /
  `upsert_gamification_stats_lww`, which `20260920002100`/`…2101` did **not**
  rewrite, so their `serverUpdatedAt` is still the server-clock `updated_at`.
  Treat the field name as per-entity, not global.

**mobile-sync-push** (`supabase/functions/mobile-sync-push/index.ts`):
- Batched sessions with nested exercises, sets, rep summaries and telemetry,
  plus routines, cycles, badges, PRs, custom exercises and profile preferences.
- Request body cap is `MAX_MOBILE_SYNC_REQUEST_BYTES` = **9,500,000 bytes**
  (`_shared/profilePreferenceContract.ts`), enforced on `content-length` *and*
  while streaming. Per-entity arrays are capped at 10,000. Rate limit is 10
  requests per 60s per user. Requires EMBER or higher.
- **Not** a uniform `upsert onConflict: 'id'` any more:
  - sessions and routines go through `upsert_workout_session_lww` /
    `upsert_routine_lww` when `SYNC_LWW_ENABLED`, and a plain PostgREST upsert
    otherwise — both paths write `client_updated_at`;
  - training cycles **always** go through
    `merge_training_cycles_from_push(p_user_id, p_cycles, p_use_lww)`, which
    preserves portal-only configuration the phone does not know about, ignores
    a structure the portal has edited since the device's `baseUpdatedAt`, and
    returns `accepted` / `structure_applied` / the stored keys;
  - session children (exercises, sets, rep summaries, telemetry **and**
    `exercise_progress`) are replaced by `replace_session_children` in one
    transaction, so a partial child write cannot lose data.
- A `user_id` transition on `workout_sessions` / `routines` / `training_cycles`
  raises 42501 from a DB trigger (`20260920002102`), whichever path writes it.
- Deletes are explicit: `deletedRoutineIds` / `deletedCycleIds` are tombstoned,
  and a push that tries to re-create a tombstoned id gets it back under
  `skippedDeleted` instead of resurrecting the row.
- Broadcasts `sync_complete` on the private channel `sync:{userId}`.

**mobile-sync-pull** (`supabase/functions/mobile-sync-pull/index.ts`):
- Parity sync: sessions, routines, cycles, badges and PRs always go through the `*_excluding_ids` RPCs (rows not in `knownEntityIds`; sessions/routines/cycles also re-send known rows changed since `lastSync - 2 min`; empty known ids = whole profile; `lastSync: 0` = everything). Other `lastSync` filters also use `lastSync - 2 min`
- Cursor-based pagination with 75 entities per page (max 300)
- Entity order: sessions -> routines -> cycles -> badges -> stats
- Uses composite cursor (updated_at, id) for stable ordering across pages
- Child entities fetched based on parent presence, not their own timestamps
- **Parity only — the legacy timestamp-mode pull is gone.** Sessions, routines,
  cycles, badges and PRs always go through the `*_excluding_ids` RPCs: rows not
  in `knownEntityIds`, plus (for sessions/routines/cycles) known rows changed
  since `lastSync - 2 min`. Empty or absent known ids means the whole profile,
  so a pre-parity client sending `lastSync > 0` with no known ids gets
  everything rather than a delta. `lastSync: 0` returns everything.
- Every `lastSync` filter (the stale arm, tombstones, stats, external
  activities, custom exercises) subtracts `STALE_OVERLAP_MS` = 2 minutes, so a
  write that committed after the previous `syncTime` is re-delivered. Mobile
  merges duplicates idempotently.
- Cursor pagination, 75 entities per page (max 300), composite cursor
  `(updated_at, id)`. `ENTITY_ORDER` is
  `sessions → routines → cycles → badges → stats → personalRecords → customExercises`.
- Deletes come back in two different shapes, so do not generalise:
  - routines and cycles are hard-deleted and reported as id lists
    (`deletedRoutineIds` / `deletedCycleIds`) on the **first page only**
    (`cursor === null`), over the same 2-minute overlap. A reported id may be
    one the device never held (a portal create-rollback), so clients treat the
    lists as "delete if present";
  - personal records are soft-deleted, so a tombstoned row the device already
    knows is re-sent **inside** `personalRecords` via
    `get_personal_record_tombstones` — the parity RPC alone would exclude it
    forever because the device already has the id.
- Children are fetched from parent presence, not their own timestamps.
- `rep_telemetry` and the `exercise_progress` snapshots session replay uses are
  **portal-only**. The pull does not return telemetry; do not add a telemetry
  pull in this stack.

### Sync Test Infrastructure

**Test Modes:**
- **Mock mode (default)**: `MOCK_EDGE_FUNCTIONS=true` in `vitest.config.ts`
- **Live mode**: `npm run test:sync:live` (`MOCK_EDGE_FUNCTIONS=false`,
  `SYNC_LIVE_TESTS=true`) runs `tests/sync/live/` against an isolated Supabase
  preview project — never production.

**Running tests:**
```bash
npm run test:sync          # tests/sync/ with mocks
npm test                   # the whole Vitest suite
npm run test:edge          # Deno handler tests for the Edge Functions
npm run test:edge:integration  # real-SQL "integration: " tests, local stack only
```

**Where things live** (`tests/sync/README.md` has the full tree):
- `tests/sync/transforms/` — `weight-transform.test.ts` (per-cable loads and
  the display adapter), `mode-transform.test.ts`, `velocity-zones.test.ts`
- `tests/sync/round-trip/` — `workout-roundtrip.test.ts`, `entity-roundtrip.test.ts`
- `tests/sync/multi-device.test.ts`, `hierarchy.test.ts`, `pull-pagination.test.ts`,
  `cycle-deletion.test.ts`, `conflicts/`, `batch/`
- `tests/sync/helpers/mock-edge-functions.ts` — the mock implementation

### Loads are per cable (KD-8)

Every stored weight and volume is **per cable**, exactly as the phone shows it.
There is no `WEIGHT_MULTIPLIER` and nothing is doubled —
`src/lib/units/noWeightMultiplier.test.ts` fails the build if the constant (or
a renamed literal `2` standing in for it) comes back. Display goes through
`src/lib/units/loadDisplay.ts`: the per-cable figure is always primary, and a
total is shown beside it only when `exercises.cable_count` is exactly 1 or 2.
`NULL` means unknown — show per cable only, never assume two cables.

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
3. Feature pages via desktop `AppSidebar` or `MobileBottomNav` (mobile). Ember Training includes Goals and Recovery.
4. Detail views (SessionDetail, RoutineBuilder, CycleBuilder) from list pages. Session Replay is Flame and entered from Session Detail.

### Mobile Responsiveness
- 768px breakpoint for mobile detection
- Mobile-specific components exist only for Analytics (`analytics/Mobile*Tab.tsx`,
  `analytics/MobileChartCard.tsx`), the calendar (`CalendarWidgetMobile.tsx`) and
  navigation (`MobileBottomNav.tsx`); Dashboard, Challenges and Community are
  single responsive components
- `MobileBottomNav` replaces desktop `AppSidebar` on small screens

## Key Files
- `src/app/routes/index.tsx` - Route definitions and lazy imports
- `src/providers/AuthProvider.tsx` - Authentication state management
- `src/providers/QueryProvider.tsx` - TanStack Query configuration
- `src/hooks/useRealtimeSync.ts` - Mobile-to-portal sync listener
- `src/lib/supabase.ts` - Supabase client configuration
- `src/lib/pricing.ts` - Subscription tier pricing (single source of truth)
- `src/styles/theme.css` - Phoenix color palette and custom animations
- `vite.config.ts` - Path aliases, plugins, test configuration

### Training cycle progression

A cycle's progression **frequency is a number of completed cycles, not weeks**:
`MIN_FREQUENCY_CYCLES`/`MAX_FREQUENCY_CYCLES` in `src/schemas/transforms.ts`
bound it to 1–10, and `MOBILE_DEFAULT_FREQUENCY_CYCLES` is 2 to match the
phone. Separately, mobile decodes `training_cycles.progression_settings` as
`Map<String,String>` without leniency, so **every value written into that JSONB
must be a string** or the phone drops the cycle's progression entirely; a DB
trigger normalises writes, but do not rely on it in new code.

## Testing
- **Unit/Integration:** Vitest with jsdom, Testing Library React. Tests live
  beside their subject in `__tests__/` directories, plus `tests/sync/` and
  `tests/security/`.
- **Edge Functions:** Deno. `npm run test:edge` (doubles) and
  `npm run test:edge:integration` (real SQL, `integration: ` prefix, local
  stack).
- **Database:** pgTAP in `supabase/tests/database/`, run by `npm run test:db`
  (a bare `supabase test db`, which globs the whole directory — a non-TAP file
  anywhere under `supabase/tests/` fails the run).
- **E2E:** Playwright with Chromium. Tests in `e2e/`.
- **Linting:** Biome for formatting and lint rules.

## Migration Workflow Discipline

Non-negotiable rules to prevent schema drift (as discovered 2026-04-20 when 5 migrations were recorded in `schema_migrations` but their DDL was absent from prod):

**Single migration owner** (release-plan decision, Operator Action 3): the human operator applies production migrations with `supabase db push`. The Supabase GitHub App's migration step is not relied on (its `main` record has shown `MIGRATIONS_FAILED` since 2026-03-16, and prod migrations have been applied out-of-band). If this decision changes, update this line, `AGENTS.md`, and the `deploy-edge-functions.yml` header together. For the order of migrations, Edge Functions, SPA, and mobile releases, follow `AGENTS.md` -> "Release order"; the Edge deploy workflow refuses to deploy while any local migration is unapplied in prod.

### DO
- Write every schema change as a migration file in `supabase/migrations/`.
- Keep every DDL statement **idempotent** (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DO $$ ... IF NOT EXISTS ... $$`). A migration must be safe to re-run.
- Push migrations with `supabase db push` (or `supabase migration up`). This is the only path that executes SQL *and* records it in `schema_migrations`.
- Verify the artifact exists in prod after push (e.g. `SELECT 1 FROM information_schema.columns WHERE ...`).
- If the `.github/workflows/migrations.yml` PR gate fails, fix the migration — do not bypass.
- Timestamp a new migration **after the newest existing file** (`ls supabase/migrations | tail -1`). The older `202609200NNN00_<name>.sql` convention (NNN = PR number) sorts *before* `20260920120000` and `20260920190625`, so a new file named that way runs before functions those files create and a `CREATE OR REPLACE` of them is silently undone.
- If a migration sets a `SET LOCAL` guard (`lock_timeout`, `statement_timeout`), wrap the whole file in an explicit `BEGIN;` … `COMMIT;`. Without it the setting only lives for the statement that sets it and the guard is inert (NF-40).
- After any migration change, regenerate `src/lib/database.types.ts` (`npm run gen:types:local` against a freshly reset local stack) and commit it **in the same commit and at every level of a stacked PR** — `migrations.yml` runs `gen:types:check` at each commit it tests.

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

Six workflows in `.github/workflows/`. Read the file rather than a step's
`name:` when it matters — names go stale faster than `run:` lines.

- **`ci.yml`** — on every push and PR to `main`. Jobs: `dependency-audit`
  (`npm run audit:security`), `lint` (Biome), `typecheck` (`npm run typecheck`,
  the baseline-comparing checker described under "Typecheck"),
  `edge-functions` (`npm run check:edge-functions` then `npm run test:edge`,
  which runs **every** Edge handler suite, not just mobile-sync), `unit-test`
  (`npm test`), `e2e` (`npm run test:e2e`, Playwright against mocked REST, plus
  `npm run test:e2e:pwa`), and `build` (production build plus
  `assert:no-sourcemaps` and `assert:bundle-budget`). It never runs on stacked
  PRs whose base is not `main`.
- **`migrations.yml`** — on PRs and `main` pushes that touch
  `supabase/migrations/**`, `supabase/tests/**`, `supabase/config.toml`,
  `database.types.ts` or the CLI/type tooling. Clean-applies every migration
  into a fresh stack (`db reset --no-seed`, seed disabled), then fails on a
  file-vs-applied count mismatch, on any pgTAP failure (bare `supabase test db`
  over the whole suite), and when `npm run gen:types:check` shows
  `database.types.ts` drifting from the migrated schema. Order: count check,
  sync-queue backlog triage (which re-applies `20260920003100` and then
  restores the production shape with a second `db reset --no-seed`, because
  re-applying individual migrations would clobber later definitions), the
  pgTAP suite plus a test-count floor
  (`PGTAP_TEST_FLOOR`), the types check, the definer-grant guard on its own,
  and the `scripts/migration-gating/run.sh` checks for `20260920007600`.
- **`edge-integration.yml`** — the real-SQL Deno tests. `pull_request` has no
  `paths:` filter (so it always reports and is safe as a required check); a
  `changes` job decides whether the heavy job runs. It starts a local stack,
  applies every migration, and runs `npm run test:edge:integration` **three
  times**: once per `SYNC_LWW_ENABLED` value, because the push handler has a
  separate write path for each and the production value is unknown, and once
  more with `SYNC_PUSH_TRANSACTION=true` so every push test also runs through
  the single-transaction path. Only the local stack's demo keys and its own
  `SUPABASE_DB_URL` are used.
- **`sync-tests.yml`** — `npm run test:sync` in mock mode on PRs and `main`
  pushes touching the sync surface. Live mode (`npm run test:sync:live`) is
  `workflow_dispatch`-only against an isolated preview project.
- **`deploy-edge-functions.yml`** — deploys on `main` pushes that touch
  `supabase/functions/**` or `supabase/config.toml`, and on
  `workflow_dispatch`. Two gates run before any upload: a `verify` job
  (`check:edge-functions` + `test:edge` on that exact commit) and
  "Gate on prod migrations", which fails and names the versions when any local
  migration is not yet applied in prod. That keeps the order migration → Edge
  code. Main-only guard plus the `production` environment secrets below.
- **`prod-migration-drift.yml`** — daily (`17 6 * * *`),
  `workflow_dispatch`, and `main` pushes that change the workflow itself. Never
  runs on PRs: forks cannot reach the prod secrets. It runs
  `supabase migration list --linked` against prod and fails its own run with a
  remediation recipe when a local migration is unapplied, and separately checks
  (read-only) that no `public` SECURITY DEFINER function is executable by
  anon/authenticated outside the allow-list in
  `20260920000100_lockdown_definer_function_grants.sql`.
  **Detector only — it gates nothing;** `deploy-edge-functions.yml` runs its own
  copy of the migration check as the actual gate. The drift class it surfaces is
  the one demonstrated by `9thLevelSoftware/Project-Phoenix-MP#602`; pushing the
  missing migration and verifying the reporter path stay operator work.
  Required `production` environment secrets (shared with the deploy workflow):
  `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROD_PROJECT_REF`,
  `SUPABASE_PROD_DB_PASSWORD`. Protect that environment with main-only branch
  restrictions and reviewers; both workflows also carry an in-repo
  `refs/heads/main` guard before any secret-consuming step.

The Supabase CLI version is pinned in `.supabase-cli-version` and reached
through `npm run supabase -- <args>`; the workflows install that exact version.
