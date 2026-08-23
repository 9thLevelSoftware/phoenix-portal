# Phoenix Portal Agent Guide

Use this file as the short map for Codex/Symphony workspaces. Prefer the
linked source files over guessing when scope or behavior is unclear.

## Project Map

- `README.md`: product overview, stack, development commands, and deployment
  context.
- `WORKFLOW.md`: Symphony runtime config, Linear state routing, workpad format,
  validation policy, and PR handoff rules.
- `docs/runbooks/symphony.md`: operator setup and runner checklist.
- `docs/review/go-no-go-checklist.md`: historical 2026-03-18 GO (**not HEAD**).
  Re-derive launch readiness from FP-1–FP-12 and CI; do not treat that
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
