# Phoenix Portal Knowledge Map

Phoenix Portal is the React web dashboard for Project Phoenix. It uses Supabase
for auth, Postgres, realtime, storage, and Edge Functions, and Paddle for
subscription billing.

Use this file as the repo-local table of contents. Historical material lives in
`archive/` and is not active guidance.

## Canonical Docs

- [Architecture](ARCHITECTURE.md): source layout, dependency direction, and
  boundary rules.
- [Engineering Standards](ENGINEERING_STANDARDS.md): Harness-style working
  standards for agents and humans.
- [Frontend](FRONTEND.md): UI, routing, state, and design-system rules.
- [Testing](TESTING.md): unit, sync, E2E, and CI validation expectations.
- [Quality](QUALITY.md): file-size budgets, baseline policy, and cleanup loop.
- [Reliability](RELIABILITY.md): operations, migrations, and incident links.
- [Security](SECURITY.md): auth, RLS, subscriptions, secrets, and audit links.

## Important Existing References

- [Operations runbook](runbooks/operations.md)
- [Billing incident response](runbooks/billing-incident-response.md)
- [Paddle simulation testing](runbooks/paddle-simulation-testing.md)
- [Mobile sync contract review](review/phase-3-sync-contract.md)
- [Security pentest report](review/2026-03-28-security-pentest-report.md)
- [RLS matrix](review/phase-2-rls-matrix.md)
- [Edge functions security audit](edge-functions-security-audit.md)
- [DTO drift matrix](dto-drift-matrix.md)

## Active Source Trees

- `src/app/`: React routes, layouts, UI components, and app-local hooks.
- `src/queries/`: TanStack Query read models.
- `src/mutations/`: TanStack Query write flows.
- `src/hooks/`: shared runtime hooks.
- `src/providers/`: app providers and context.
- `src/stores/`: Zustand client-state stores.
- `src/lib/`: domain utilities and integration helpers.
- `src/schemas/`: Zod schemas and data contract types.
- `supabase/functions/`: Edge Functions and shared Deno helpers.
- `tests/sync/`: mobile sync contract tests.
- `e2e/`: Playwright user-flow tests.

## Historical Archives

- `archive/planning/`: migrated `.planning` artifacts.
- `archive/superpowers/`: migrated `.superpowers` brainstorm artifacts.
- `superpowers/`: older checked-in Superpowers plans/specs retained as
  historical context until they are reviewed and either archived or promoted.
