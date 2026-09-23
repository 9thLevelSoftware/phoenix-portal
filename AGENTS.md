# Phoenix Portal Agent Guide

Use this file as the short map for Codex/Symphony workspaces. Prefer the
linked source files over guessing when scope or behavior is unclear.

## Project Map

- `README.md`: product overview, stack, development commands, and deployment
  context.
- `WORKFLOW.md`: Symphony runtime config, Linear state routing, workpad format,
  validation policy, and PR handoff rules.
- `docs/axioms.md`: the eight first-principles axioms (FP-1…FP-8) this codebase
  is judged against. Read them before changing auth, billing, sync,
  deletion/export or migrations.
- `CLAUDE.md`: the long-form map — commands, the mobile sync contract,
  environment variables, CI coverage and migration discipline.
- `docs/runbooks/symphony.md`: operator setup and runner checklist.
- `docs/review/go-no-go-checklist.md`: historical 2026-03-18 GO (**not HEAD**).
  Re-derive launch readiness from `docs/axioms.md` and CI; do not treat that
  checklist as a current pass.
- `.github/workflows/ci.yml`: pull request validation gates.

## Working Rules

- Start from the Linear issue scope and keep changes focused.
- Do not read or modify `.env`, `.env.local`, or production credentials.
- Prefer existing app patterns, shadcn/Radix UI components, TanStack Query
  hooks, Zod schemas, and Supabase helpers over new abstractions.
- Treat pre-existing failures as real signals. Fix them when they are in scope;
  otherwise record the command, failure, and reason they are out of scope.
- Use Conventional Commit subjects: `feat:`, `fix:`, `refactor:`, `test:`, or
  `docs:`.

## Validation

Default before handoff:

```bash
npm run verify:full
```

Run `npm run test:sync` for sync, Edge Function, schema, DTO, or
migration-adjacent work. For migrations, commit idempotent SQL files under
`supabase/migrations/`; do not use the Supabase dashboard SQL editor for schema
changes.
Add, for the work it touches:

```bash
npm run test:sync   # sync, DTO or schema-transform work
npm run test:edge   # ANY change under supabase/functions/ (Deno handler tests)
npm run test:db     # migrations or pgTAP (needs a local Supabase stack)
```

`npm run check:edge-functions` type-checks the Edge Functions and is the
cheapest first signal after touching one.

Caveat: `npm run typecheck` runs `tsc --noEmit` over a solution `tsconfig.json`
with `"files": []`, so it compiles an empty program and always passes. Use
`npx tsc -b --force` when you need real coverage, and compare against the
pre-existing backlog rather than expecting zero.

For migrations, commit idempotent SQL files under `supabase/migrations/`; do
not use the Supabase dashboard SQL editor for schema changes.

## Release order

Three pipelines ship independently: prod migrations (applied by the human
operator with `supabase db push`, the single migration owner per the release
plan's Operator Action 3 decision, after a rolled-back rehearsal against prod;
the Supabase GitHub App's production migration step must stay disabled, or a
merge to `main` applies migrations to prod unrehearsed; see CLAUDE.md ->
"Migration Workflow Discipline"), Edge Functions (`deploy-edge-functions.yml` on
merge to `main`), and the SPA (Cloudflare, on merge). Changes that span them
follow expand/contract order:

1. **Migration first, additive only.** Add columns, tables, functions, or new
   RPC parameters with defaults; never remove or rename something a deployed
   caller still uses in the same release.
2. **Edge caller next.** An Edge Function that uses a new DB object may merge
   with or after its migration, but it cannot reach prod early: the deploy
   workflow's migration gate fails while any local migration is missing from
   prod. The operator applies the migration with `supabase db push`, verifies
   it, then re-runs "Deploy Edge Functions" via `workflow_dispatch`.
3. **SPA caller in a later PR.** Cloudflare deploys the SPA on merge with no
   gate, so SPA code never calls a DB object introduced in the same PR. Split
   it into a DB PR and a follow-up SPA PR that merges only after the migration
   is applied in prod.
4. **Re-stamp on rebase.** When rebasing a migration PR, rename the migration
   to a timestamp after the latest one on `main` so versions apply in order.
   Exception: a migration already applied to prod keeps its version.
5. **Mobile last.** A mobile release that depends on a portal change ships only
   after that portal change is deployed (Edge workflow green on that commit).
