# Database Migrations Review

Scope: reviewed all 69 assigned files under `supabase/migrations/` for RLS policy correctness, privilege escalation, data integrity, and schema drift.

Files with no actionable findings are omitted below.

## Summary

- Findings: 23
- Critical: 5
- High: 8
- Medium: 10
- Low: 0

## Findings

### `supabase/migrations/00001_create_subscriptions.sql`

#### Finding 1
- Category: failure-point
- Severity: medium
- Line numbers: 61-74
- Description: `public.user_subscription_tier()` is declared `SECURITY DEFINER` without a fixed `search_path`. Because it references `public.subscriptions` but does not set `search_path`, the function is vulnerable to search-path hijacking/linter failures until a later migration rewrites it.
- Suggested fix direction: Define the function with `SET search_path = ''` and schema-qualify every referenced object, including `public.subscriptions` and `auth.uid()`.

### `supabase/migrations/20260216_integrations.sql`

#### Finding 2
- Category: failure-point
- Severity: high
- Line numbers: 14-17, 27-41
- Description: `user_integrations` stores `access_token`, `refresh_token`, `token_expires_at`, and `api_key`, while the RLS policies allow the owning authenticated user to select, insert, update, and delete the whole row. In a browser/PostgREST client, this exposes long-lived provider credentials to client-side JavaScript and lets clients write untrusted provider credential material.
- Suggested fix direction: Keep OAuth/API credentials in a server-only table with no authenticated role privileges, expose only non-secret connection metadata to clients, and perform token writes from service-role Edge Functions.

### `supabase/migrations/20260218_phase11_comments.sql`

#### Finding 3
- Category: bug
- Severity: high
- Line numbers: 42-49, 112-131
- Description: The comment update policy allows owners to update any column on their own comment within five minutes, including `item_id` and `item_type`. The count trigger then decrements using `NEW.item_id`/`NEW.item_type` on soft delete, so a user can retarget a comment and corrupt `comment_count` on the original and new shared item.
- Suggested fix direction: Make `item_id` and `item_type` immutable after insert with a `BEFORE UPDATE` trigger, and use `OLD.item_id`/`OLD.item_type` when decrementing counters on soft delete.

#### Finding 4
- Category: failure-point
- Severity: medium
- Line numbers: 60-75, 112-131
- Description: `check_comment_rate_limit()` and `update_comment_count()` are `SECURITY DEFINER` functions without an explicit safe `search_path`, and they reference unqualified tables. This is a search-path hijack and Supabase security-linter failure point.
- Suggested fix direction: Add `SET search_path = ''` to both functions and schema-qualify all table/function references.

### `supabase/migrations/20260219_phase11_goals.sql`

#### Finding 5
- Category: bug
- Severity: medium
- Line numbers: 29-31, 44-62
- Description: The insert policy is named `Premium users can create goals`, but it only checks `user_id = auth.uid()`. The trigger enforces count limits by tier, but it does not prevent FREE users from creating goals; it allows one active goal for FREE users.
- Suggested fix direction: Decide whether FREE users should be allowed one goal. If not, add an explicit tier check in the insert policy or trigger; if yes, rename the policy/comment to match the actual behavior.

### `supabase/migrations/20260221_exercise_progress_and_creator_stats.sql`

#### Finding 6
- Category: failure-point
- Severity: high
- Line numbers: 43-70
- Description: `creator_stats` is created as a normal view, which is security-definer by default in Postgres. It reads `profiles`, `shared_routines`, and `shared_cycles` through the view owner rather than the caller, which can bypass table RLS/profile visibility assumptions and is explicitly the class of issue later addressed by security-invoker view migrations.
- Suggested fix direction: Create the view with `WITH (security_invoker = true)` or expose only a deliberately public, security-barrier profile surface and grant the view narrowly.

### `supabase/migrations/20260302120000_sync_compat_rpg_gamification.sql`

#### Finding 7
- Category: failure-point
- Severity: high
- Line numbers: 40-61
- Description: `earned_badges` allows authenticated users to insert and delete their own badges directly. If badges are achievement/entitlement signals, a client can self-award or remove achievements without server-side validation.
- Suggested fix direction: Move badge awarding/deletion behind service-role RPCs or Edge Functions that validate achievement criteria. Authenticated clients should normally have SELECT-only access.

#### Finding 8
- Category: failure-point
- Severity: high
- Line numbers: 8-33, 68-91
- Description: `rpg_attributes` and `gamification_stats` allow authenticated users to insert/update their own progression and aggregate statistics directly. That makes server-derived progression, level, XP, streak, and volume counters client-authoritative and tamperable.
- Suggested fix direction: Restrict direct writes for server-derived fields; accept raw workout/sync inputs from clients and compute progression/statistics in trusted service-role code or validated RPCs.

### `supabase/migrations/20260318150000_insights_benchmarks.sql`

#### Finding 9
- Category: failure-point
- Severity: medium
- Line numbers: 39-45
- Description: `community_benchmarks` uses `FOR SELECT USING (true)` without `TO authenticated`, so the policy applies to PUBLIC, including anon, on an aggregate benchmark table. A later migration restricts this to authenticated users, but this file creates an anon-readable policy.
- Suggested fix direction: Add `TO authenticated` to the benchmark read policy unless anonymous benchmark access is explicitly intended and documented.

### `supabase/migrations/20260412_leaderboard_functions.sql`

#### Finding 10
- Category: bug
- Severity: high
- Line numbers: 9-35, 45-82, 92-124
- Description: The leaderboard RPCs are `SECURITY INVOKER`, but they query RLS-protected `personal_records`, `exercises`, and `profiles`. Under an authenticated caller, RLS will generally restrict these tables to the caller's own rows, so global leaderboards and arbitrary `target_user_id` rank lookups cannot see the full participant population.
- Suggested fix direction: Use a carefully audited `SECURITY DEFINER` function with `SET search_path = ''` and explicit filtering on public leaderboard participation, or maintain a server-computed leaderboard table that is safe for authenticated users to read.

#### Finding 11
- Category: failure-point
- Severity: medium
- Line numbers: 179-189
- Description: `update_leaderboard_events_updated_at()` is `SECURITY DEFINER` with `SET search_path = public`. Including a mutable schema in a definer function's search path is a Supabase linter/security issue.
- Suggested fix direction: Use `SET search_path = ''` and schema-qualify `now()`/objects where needed, or make the trigger function `SECURITY INVOKER` if definer privileges are unnecessary.

### `supabase/migrations/20260420234500_parity_sync_rpc_functions.sql`

#### Finding 12
- Category: failure-point
- Severity: critical
- Line numbers: 12-111, 120-174, 183-247, 256-297, 306-357
- Description: All five parity sync RPCs are `SECURITY DEFINER`, accept `p_user_id`, and filter rows by `p_user_id` without checking `p_user_id = auth.uid()` or restricting execution to `service_role`. PostgreSQL grants EXECUTE on new functions to PUBLIC by default unless revoked, so any exposed authenticated/anon RPC caller could request another user's sessions, routines, cycles, badges, or personal records.
- Suggested fix direction: Revoke EXECUTE from PUBLIC/anon/authenticated in the same migration, grant only `service_role`, or add explicit `auth.uid() = p_user_id` authorization checks if these RPCs are meant for direct client use. Also use `SET search_path = ''` with schema-qualified names.

#### Finding 13
- Category: error
- Severity: high
- Line numbers: 256-265, 306-314
- Description: `get_badges_excluding_ids` and `get_personal_records_excluding_ids` declare `BIGINT` IDs and `BIGINT[]` known-id parameters even though `earned_badges.id` and `personal_records.id` are UUIDs in earlier migrations. The function result shape does not match the table schema and will fail at runtime.
- Suggested fix direction: Use UUID return and parameter types for both RPCs and drop incompatible overloads.

### `supabase/migrations/20260421000100_fix_sessions_rpc_routine_session_id_type.sql`

#### Finding 14
- Category: failure-point
- Severity: critical
- Line numbers: 8-104
- Description: The replacement `get_sessions_excluding_ids` remains `SECURITY DEFINER`, still accepts arbitrary `p_user_id`, and has no `auth.uid()`/role check or immediate EXECUTE revoke. This reintroduces the cross-user session read vulnerability while fixing the return type.
- Suggested fix direction: Restrict EXECUTE to `service_role` in this migration or enforce `p_user_id = auth.uid()` inside the function before returning rows.

### `supabase/migrations/20260421001000_fix_sessions_rpc_column_types.sql`

#### Finding 15
- Category: failure-point
- Severity: critical
- Line numbers: 7-103
- Description: The second replacement `get_sessions_excluding_ids` again preserves the unauthenticated `SECURITY DEFINER`/arbitrary `p_user_id` pattern. It fixes column types but leaves the function callable in a way that can bypass RLS and read another user's workout sessions.
- Suggested fix direction: Pair the type fix with explicit EXECUTE revokes/grants or in-function authorization.

### `supabase/migrations/20260427200000_fix_parity_sync_stale_routines_cycles.sql`

#### Finding 16
- Category: failure-point
- Severity: critical
- Line numbers: 26-86, 95-165
- Description: The new stale-aware routines/cycles RPC overloads are also `SECURITY DEFINER`, accept arbitrary `p_user_id`, and do not restrict execution or compare against `auth.uid()`. They can bypass RLS for another user's routines and training cycles.
- Suggested fix direction: Restrict the overloads to service-role callers or add explicit caller/user authorization checks before querying.

### `supabase/migrations/20260428234500_fix_parity_sync_uuid_badges_prs.sql`

#### Finding 17
- Category: failure-point
- Severity: critical
- Line numbers: 7-48, 53-104
- Description: The UUID-corrected badge and personal-record RPCs keep the same `SECURITY DEFINER` plus arbitrary `p_user_id` pattern and do not revoke public/authenticated EXECUTE in the migration. This leaves cross-user badge and PR reads possible until a later security-scan migration revokes these functions.
- Suggested fix direction: Revoke EXECUTE from PUBLIC/anon/authenticated and grant only service_role, or check `auth.uid() = p_user_id` inside the function.

### `supabase/migrations/20260420194722_schema_drift_reconciliation.sql`

#### Finding 18
- Category: stub
- Severity: medium
- Line numbers: 1-3
- Description: This is a stub that says the real migration was applied remotely and adds `is_bodyweight`/`duration_seconds` plus benchmark RLS changes, but it does not apply those changes locally. A fresh database built only from repository migrations will drift from production.
- Suggested fix direction: Replace the stub with an idempotent migration that performs the documented schema/RLS changes, or add a follow-up migration that reconciles fresh installs.

### `supabase/migrations/20260420203522_creator_stats_security_invoker.sql`

#### Finding 19
- Category: stub
- Severity: high
- Line numbers: 1-3
- Description: This stub documents a remote conversion of `creator_stats` to `security_invoker = true` but does not perform it locally. Fresh databases will retain the earlier security-definer view behavior.
- Suggested fix direction: Add the actual `CREATE OR REPLACE VIEW ... WITH (security_invoker = true)` migration to local history.

### `supabase/migrations/20260420210411_comprehensive_dashboard_drift_reconciliation.sql`

#### Finding 20
- Category: stub
- Severity: medium
- Line numbers: 1-3
- Description: This stub claims remote creation of `goal_snapshots`, `overload_suggestions`, `telemetry_analysis`, and `wearable_daily_summaries` plus column additions, but applies none of it locally. Fresh local/staging databases will miss dashboard objects present in production.
- Suggested fix direction: Replace with idempotent DDL for the documented tables/columns or create a real reconciliation migration immediately after it.

### `supabase/migrations/20260503160018_remote_history_reconciliation.sql`

#### Finding 21
- Category: stub
- Severity: medium
- Line numbers: 1-11
- Description: The migration intentionally does `NULL` to match a production-only migration version. That unblocks deployment history but permanently hides whatever schema/data change production version `20260503160018` actually performed from fresh database rebuilds.
- Suggested fix direction: Add a companion reconciliation migration with the real DDL/data changes from the production migration, or document and verify that the production migration was truly a no-op.

### `supabase/migrations/20260503162322_remote_history_reconciliation.sql`

#### Finding 22
- Category: stub
- Severity: medium
- Line numbers: 1-11
- Description: Same as the prior reconciliation file: the repository records the remote version with a no-op block, but does not reproduce the production schema/data change for fresh databases.
- Suggested fix direction: Add an idempotent reconciliation migration for the actual production changes or confirm the remote migration had no schema/data effect.

### `supabase/migrations/20260526120000_community_snapshots_and_imports.sql`

#### Finding 23
- Category: failure-point
- Severity: medium
- Line numbers: 469-473, 516-517, 549-554
- Description: `import_shared_cycle()` casts JSON snapshot fields directly to `INT`/`NUMERIC` (for example `(v_snapshot ->> 'duration_weeks')::INT` and `(v_day ->> 'weight_adjustment')::NUMERIC`). Shared snapshots can be creator-controlled data; malformed numeric strings will throw and make imports fail for every viewer of that shared item.
- Suggested fix direction: Validate JSON field types before casting, use guarded regex/type checks, or normalize snapshots at write time so import RPCs fail gracefully with a clear validation error.

## Review Notes

- Later migrations do fix several earlier issues, especially search paths and RPC grants. Findings are still attached to the files where the risky behavior is introduced because this task reviews individual migration files and fresh/partial applies can expose those gaps.
- No code was modified; this report only documents issues.
