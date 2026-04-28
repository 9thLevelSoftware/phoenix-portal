# Quality

Quality work in this repo should make future agent runs easier, not just make a
single patch pass.

## Baseline Policy

Known structural debt is recorded in `quality/harness-baseline.json`.

- Existing debt may be baselined with a clear reason.
- New violations fail `npm run check:architecture`.
- Stale baseline entries fail and should be removed when the underlying issue is
  fixed.

## Current Debt Themes

- Several React page components are larger than the target file budget.
- A few Supabase Edge Functions are larger than the target file budget.
- Historical planning and brainstorm artifacts were migrated to `docs/archive/`
  and should not be used as active guidance.

## Cleanup Loop

When touching a baselined file for related work, prefer to retire the baseline
entry by extracting focused components, helpers, or shared Edge Function logic.
Do not perform broad unrelated refactors just to satisfy the budget.

## Standards Checks

```bash
npm run check:repo-knowledge
npm run check:architecture
npm run check:harness
```
