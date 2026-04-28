# Reliability

Reliability covers migrations, sync behavior, billing operations, and incident
response.

## Migrations

Database changes must be committed as idempotent files in
`supabase/migrations/` and applied with Supabase migration tooling.

Do not:

- run schema changes through the Supabase dashboard SQL editor;
- mark migrations applied with `supabase migration repair` unless the SQL was
  already executed;
- commit non-idempotent DDL.

The migration CI clean-applies migrations into a fresh Supabase stack and fails
on file-vs-applied count mismatches.

## Operations References

- [Operations runbook](runbooks/operations.md)
- [Billing incident response](runbooks/billing-incident-response.md)
- [Paddle simulation testing](runbooks/paddle-simulation-testing.md)
- [Mobile sync contract review](review/phase-3-sync-contract.md)
- [Performance and ops review](review/phase-6-performance-ops.md)

## Observability

Sentry initializes only after cookie consent. A local full observability stack is
not part of this first Harness alignment pass and is tracked as future quality
work.
