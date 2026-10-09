# RCA Review: `get_percentile_rank` migration policy conflict

## Verdict

**PR 224's migration is out of contract with the repository's existing database-security policy; the policy tests are not stale on the evidence available.** The function's new `auth.uid()` check is useful defense-in-depth and can be retained, but it does not itself authorize browser execution under this repository's explicit SECURITY DEFINER allow-list. `get_percentile_rank` is treated as a cross-user/aggregate surface and is not allow-listed. No tracked application TypeScript caller invokes this RPC; the benchmark query code reads `community_benchmarks` directly (`src/queries/benchmarks.ts:5-35`).

The `SET search_path = ''` choice is stricter than the captured `public, pg_temp` path in isolation; it is not, by itself, evidence of a security vulnerability. It nevertheless contradicts the exact captured-definition contract and the test fixture. The grant of EXECUTE to `authenticated` is the material policy violation. Making this browser-callable would be a deliberate policy change, not merely a stale-test fix, and would require a reviewed allow-list change plus synchronized tests, migration policy, and production grant-check expectations. PR 224 changed only the migration file (PR 224 file list); those policy surfaces were not updated.

## Evidence and reasoning

1. **The expected state is explicit and cross-checked.** `supabase/tests/database/dashboard_capture.test.sql:26-68` records `public.get_percentile_rank(uuid, text, text)` as SECURITY DEFINER with `search_path = public, pg_temp`; lines 71-83 require captured definers to be executable by `service_role` and not by `anon` or `authenticated`. Lines 508-515 assert authenticated cannot execute this RPC, and lines 570-573 assert service-role access.
2. **The allow-list excludes this function.** `supabase/tests/database/definer_function_grants.test.sql:38-70` compares all client-executable SECURITY DEFINER functions against an exact allow-list that omits `get_percentile_rank`; lines 75-94 separately require the captured definer to exist and retain `service_role` execution. `20260920000100_lockdown_definer_function_grants.sql:38-48, 613-660, 782-847` likewise labels the function dangerous and revokes `PUBLIC`, `anon`, and `authenticated` unless it is on that allow-list. It is not.
3. **The capture migration independently fixes the function's definition and grants.** `20260920000200_capture_dashboard_functions_and_cron.sql:25-45` says the eight captured SECURITY DEFINER functions are service-role-only and notes no application/Edge/mobile caller. Lines 117-129 show the capture helper revoking from `PUBLIC`, `anon`, and `authenticated`, then granting only `service_role` for definers. Lines 519-551 capture this function with `SET search_path TO 'public', 'pg_temp'`; lines 1087-1124 include it in the lockdown assertion.
4. **The later reconciliation migration repeats the same grant policy.** `20260920007600_reconcile_prod_schema_drift.sql:90-108` calls itself the final allow-list word, lists `get_percentile_rank` in its dangerous set, and only the declared browser allow-list receives authenticated execution. Its block at lines 341-403 revokes all three client grants and grants service-role access to unlisted functions.
5. **PR 224's SQL conflicts with those contracts.** In the current re-stamped file, `SET search_path = ''` is at line 12, the caller-ID check at lines 20-24, and the end grants at lines 95-98 revoke PUBLIC/anon but grant authenticated as well as service_role. The check blocks a normal authenticated JWT from supplying another user's ID, but it does not make the function part of the repository's approved browser allow-list or update that policy. In particular, the function reads community aggregates and private per-user tables under definer rights.
6. **No current UI/RPC dependency requires browser EXECUTE.** A scoped search of tracked TS/TSX/JS files found only the generated function type, not an application call. `src/queries/benchmarks.ts` queries the benchmark table directly. That does not prove a future authenticated RPC is unsafe; it means there is no present consumer that justifies overriding the existing least-privilege contract.

## Migration ordering

The migration order explains the regression but should not be used as the repair:

| Placement | Effect on a clean apply |
| --- | --- |
| After `20260920000100`, `20260920000200`, and `20260920007600` (the current `20260926120000` placement) | The late `CREATE OR REPLACE` replaces the captured body/path with PR 224's body/path. It then grants `authenticated` after the prior lockdowns. There is no later policy migration to undo either change; the catalog/grant tests fail. |
| Before `20260920000200` capture | The capture migration recreates the captured function, sets `public, pg_temp`, and reapplies service-role-only grants. Tests can pass, but only because the capture overwrites PR 224's function implementation and intended authorization change. This is not a valid way to retain PR 224's behavior. |
| After `20260920000200` but before `20260920007600` | The 07600 lockdown would remove authenticated execution from the unlisted definer, but it does not reset this function's existing search_path. With PR 224's current empty setting, the exact path assertion still fails. If the path were also changed to `public, pg_temp`, the later lockdown would make the final tests pass by undoing the grant. That is still fragile ordering-dependent policy enforcement. |

Therefore, order can make some or all assertions appear green by overwriting or counteracting PR 224, but that is not a sound fix. Keep the migration after the latest main migration as required, and make its own final state conform to policy. Do not move it before the 20260920 lockdown/capture migrations to get a green run.

## Minimal correct SQL change

In `supabase/migrations/20260926120000_harden_get_percentile_rank.sql`:

- Change line 12 to `SET search_path = 'public', 'pg_temp'` to match the checked-in capture contract.
- Retain the body and the `auth.uid()` guard as defense-in-depth if desired; they do not grant authenticated callers access. The guard is not a substitute for the ACL.
- Replace lines 95-98 with:

```sql
REVOKE ALL ON FUNCTION public.get_percentile_rank(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_percentile_rank(UUID, TEXT, TEXT)
  TO service_role;
```

The explicit authenticated revoke matters because `CREATE OR REPLACE FUNCTION` preserves existing privileges; the migration must leave the intended ACL rather than relying on whatever grants existed before it. Do not add `get_percentile_rank` to the browser allow-list or weaken the existing tests as part of this fix. These changes align the final catalog state with the captured path, the service-role-only assertion, the authenticated-denial behavior, and the definer allow-list. I did not run the local Supabase/pgTAP suite, so this is a source-backed expected result, not a claim that CI was rerun and passed.

## Version stamp and production boundary

`AGENTS.md:88-90` requires a rebased migration to be stamped after the latest migration on `main`, except when that migration is already applied to production. In the inspected tree, the latest migration on `origin/main` is `20260926100000_repair_epoch_zero_sessions.sql`; the current `20260926120000_harden_get_percentile_rank.sql` is later, unique, and follows the rule. The latest-file guidance in `CLAUDE.md:403-418` also requires new migrations after the newest existing file. **For a not-yet-applied re-stamped migration, `20260926120000` is the right placement.** The 20260920 migrations are earlier; placing this migration before them conflicts with the rule and lets their capture/lockdown overwrite or mask its behavior.

The repository/security verdict and the SQL needed for a clean apply do not require production inspection. **Whether it is permissible to re-stamp the historical PR 224 migration for production does require operator knowledge.** The repo says production migrations are applied by one human operator (`AGENTS.md:67-72`; `CLAUDE.md:405-416`), and the re-stamp exception is explicit. Before changing a production-applied migration's version or telling the operator to push, establish whether the PR 224 SQL was actually applied/recorded and which migration the existing `20260821120000` history row represents. Because the two files shared one primary-key version, the version value alone is not enough to assume which body was executed; inspect the row's available name/statements and the operator's deployment record, and confirm the live function definition, `proconfig` search_path, and effective grants. A history row alone also does not prove the live function body matches it.

If the operator confirms the latecomer was not applied, use the unique post-main stamp `20260926120000` with the corrected SQL. If it was already applied, do not silently rewrite its historical version: preserve that record and use a distinct forward corrective migration after the current latest version, with operator-approved history handling. No production database or credentials were accessed for this review.

## Scope and verification

Read-only review of the supplied clone at commit `4f36db8` (parent `243a1a6`, `origin/main`), the named migration/test files, repo instructions, and read-only PR 224 metadata. `git diff --check 243a1a6..HEAD` was clean. The only required file created by this review is this findings document; no repository source, migration, test, or GitHub state was changed.