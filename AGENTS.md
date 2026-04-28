# AGENTS.md

Phoenix Portal is the React web companion dashboard for Project Phoenix. It
syncs workout data through Supabase, exposes analytics and builders in the
portal UI, and uses Paddle for subscription billing.

This file is a short map. Canonical project knowledge lives in `docs/`.

## Start Here

- Repo map: `docs/index.md`
- Architecture: `docs/ARCHITECTURE.md`
- Engineering standards: `docs/ENGINEERING_STANDARDS.md`
- Frontend and design: `docs/FRONTEND.md`
- Testing: `docs/TESTING.md`
- Quality baseline: `docs/QUALITY.md`
- Reliability and operations: `docs/RELIABILITY.md`
- Security: `docs/SECURITY.md`

## Commands

```bash
npm run dev        # Vite dev server at http://localhost:5173
npm run lint       # Biome lint and format check
npm run typecheck  # TypeScript check
npm test           # Vitest unit and integration tests
npm run build      # Production build
npm run test:e2e   # Playwright E2E tests
npm run verify     # Full local verification suite
```

Sync-specific commands:

```bash
npm run test:sync       # Mocked sync tests
npm run test:sync:live  # Live Supabase sync tests; requires secrets
npm run gen:types       # Regenerate Supabase database types
```

## Working Rules

- Keep repository knowledge in tracked files, not chat history or local-only
  scratch files.
- Prefer focused edits to existing files and follow the local patterns before
  introducing new abstractions.
- Parse untrusted or external data at boundaries using schemas or typed SDKs.
- Write Supabase schema changes only as idempotent migrations in
  `supabase/migrations/`.
- Treat files under `docs/archive/` as historical context, not active guidance.
- Run the relevant tests after code changes. For broad changes, run
  `npm run verify`.

## Architecture Map

- `src/app/` contains routes, layout, UI components, and app-local hooks.
- `src/queries/` and `src/mutations/` contain TanStack Query server-state
  access.
- `src/hooks/`, `src/providers/`, and `src/stores/` contain shared runtime,
  context, and client state.
- `src/lib/` contains framework-light domain utilities and integration helpers.
- `src/schemas/` contains Zod schemas and shared data contract types.
- `supabase/functions/` contains Deno Edge Functions and `_shared` helpers.
- `tests/sync/` contains mobile sync contract tests.
- `e2e/` contains Playwright user-flow tests.

## Harness Checks

This repo encodes agent-facing standards mechanically:

```bash
npm run check:harness
```

The checks validate repo knowledge structure, architecture boundaries, file-size
budgets, and documented baselines. Update `docs/quality/harness-baseline.json`
only when intentionally accepting pre-existing debt or retiring fixed debt.

## Persistent Memory

The Daem0n memory tools referenced by older local instructions may not be
available in every environment. If they are unavailable, continue with tracked
repo knowledge as the source of truth and document durable decisions in `docs/`.
