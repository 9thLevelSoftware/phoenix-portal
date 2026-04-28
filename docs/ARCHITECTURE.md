# Architecture

Phoenix Portal is a Vite React app with Supabase as the backend boundary and
Paddle for billing.

## Layers

- `src/schemas/`: boundary schemas and shared data contract types. Keep this
  dependency-light; schemas can depend on Zod and generated database types.
- `src/lib/`: framework-light domain logic, integrations, formatting, exports,
  Supabase client setup, and pure utilities.
- `src/queries/`: TanStack Query read models. These modules may call Supabase
  and parse responses through schemas.
- `src/mutations/`: write flows and cache invalidation. These modules may call
  Supabase, use query keys, and issue user-facing toasts.
- `src/hooks/`, `src/providers/`, `src/stores/`: runtime composition, app
  context, realtime subscriptions, and client state.
- `src/app/`: routes, layouts, components, UI primitives, and app-local hooks.
- `supabase/functions/`: Deno Edge Functions. Shared code belongs in
  `supabase/functions/_shared/`.

## Dependency Direction

Lower layers must stay independent of UI and React app composition:

- Schemas do not import app, hooks, providers, stores, queries, or mutations.
- Lib does not import app, hooks, providers, stores, queries, or mutations.
- Queries, mutations, hooks, providers, and stores do not import `src/app`.
- App code may depend on lower layers.
- Edge Functions may import external Deno/npm/jsr modules and `_shared` helpers,
  but not sibling Edge Functions or portal UI code.
- Portal source must not import `supabase/functions/` code. Edge Functions run
  in Deno and must stay isolated from the browser/Vite runtime; violations are
  reported as `import-boundary` failures.

These rules are enforced by `npm run check:architecture`.

## Boundary Parsing

External data must be parsed or typed at the boundary:

- Supabase query results should use generated database types and/or Zod schemas.
- Third-party integration payloads should normalize through provider-specific
  parsers.
- Edge Function request bodies should be validated before persistence.

## Migrations

All database changes must be idempotent SQL migrations in
`supabase/migrations/`. Do not apply schema changes through the Supabase
dashboard SQL editor. See [Reliability](RELIABILITY.md).
