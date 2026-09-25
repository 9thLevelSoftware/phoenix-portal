## Status: PARTIAL FIX — does NOT unblock the merge gate on its own

This PR fixes the **duplicate version stamp** only. Running it revealed a **second, deeper defect in #224** that still fails `Clean apply from empty DB`. See "What remains" below.

## Problem 1 — duplicate version stamp (FIXED here)

Two migrations shared version `20260821120000`:

| File | Added |
|---|---|
| `20260821120000_routine_exercise_drop_set.sql` | 2026-08-21 (#104) |
| `20260821120000_harden_get_percentile_rank.sql` | 2026-09-24 (#224) |

```
ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
Key (version)=(20260821120000) already exists.
```

Pre-existing on `main` (run 36047923769). Renamed the #224 file to `20260926120000_harden_get_percentile_rank.sql`.

**Why the #104 file keeps its version:** it is the original occupant and is **not idempotent** (`ALTER TABLE ... ADD COLUMN`) — it must never be re-applied. The #224 file is fully idempotent (`CREATE OR REPLACE FUNCTION` + `REVOKE`/`GRANT`, no data mutation), so it is safe to move.

150 migrations, 150 distinct stamps, 0 duplicates. Pure `git mv`, no SQL changed.

## What remains — #224 conflicts with this repo's own policy tests

With the collision cleared, CI now reaches the pgTAP suite and fails 4 tests. All four trace to `harden_get_percentile_rank`:

| Test | Repo expects | #224 does |
|---|---|---|
| `each captured function pins exactly its expected search_path` | `search_path = 'public, pg_temp'` | `SET search_path = ''` |
| `captured SECURITY DEFINER functions are service_role-only` | service_role-only | `GRANT EXECUTE ... TO authenticated` |
| `authenticated cannot execute get_percentile_rank` | denied | granted |
| `only allow-listed SECURITY DEFINER functions are executable` | not in allow-list | executable by authenticated |

**Neither side is obviously wrong** — #224 adds an in-function per-user auth check and tightens `search_path`, while the policy tests require `public, pg_temp` + service_role-only. Reconciling them is a **security-policy decision for the migration owner** (AGENTS.md: prod migrations are applied by a single named owner).

## Recommendation

1. Merge this PR (uncontroversial: removes the collision, nothing else).
2. Migration owner decides on #224: either rework `harden` to comply with the definer-function policy, or update the policy tests to encode the new intent.
3. Note: `Clean apply from empty DB` was **not** a required status check, which is how #224 merged red. It is now required (added alongside this work).

Related: phoenix-portal#226
