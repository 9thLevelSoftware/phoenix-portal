# RLS Policy Audit Matrix

**Phase:** 2.1 -- Database Security (Row Level Security)
**Date:** 2026-03-18
**Auditor:** Security Engineer (automated review of 28 migration files)
**Scope:** All `public` schema tables created across `supabase/migrations/*.sql`

---

## Summary

| Metric | Count |
|--------|-------|
| Total tables in public schema | 37 |
| Tables with RLS enabled | 37 |
| Tables with zero policies (service-role only) | 2 |
| Intentional public-read tables | 7 |
| Security gaps found | 9 |
| CRITICAL findings | 0 |
| HIGH findings | 3 |
| MEDIUM findings | 3 |
| LOW findings | 2 |
| INFO findings | 1 |

---

## Complete RLS Matrix

### Legend

- **uid()** = policy uses `auth.uid() = user_id` (or equivalent `= id` for profiles)
- **(select uid())** = uses the optimized `(select auth.uid()) = user_id` wrapper (initPlan caching)
- **auth** = restricted to `TO authenticated` role
- **public** = `USING (true)` -- any authenticated user can read all rows
- **tier-gated** = policy includes `user_subscription_tier()` check
- **parent-join** = policy uses subquery to join parent table for ownership check
- **FOR ALL** = single policy covers SELECT, INSERT, UPDATE, DELETE
- **--** = no policy exists for this operation
- **svc** = service-role only (no authenticated-role policy; service_role bypasses RLS)

### Core User Data

| # | Table | RLS | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|-------|-----|--------|--------|--------|--------|-------|
| 1 | `profiles` | YES | uid() = id | -- | uid() = id | -- | Created by `handle_new_user()` trigger (SECURITY DEFINER). No INSERT policy needed -- trigger runs as definer. No DELETE policy -- cascade from auth.users. Has duplicate policy names from migrations 00001 + 00002 (see GAP-08). |
| 2 | `subscriptions` | YES | uid() | -- | -- | -- | SELECT only. All writes via Edge Functions (service-role). Realtime-enabled. |

### Workout Data (Sync Targets)

| # | Table | RLS | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|-------|-----|--------|--------|--------|--------|-------|
| 3 | `workout_sessions` | YES | uid() | uid() | uid() | -- | UPDATE added in `20260222_session_notes.sql`. No DELETE policy (see GAP-01). |
| 4 | `exercises` | YES | (select uid()) auth | (select uid()) auth | -- | -- | Denormalized user_id added in `20260304`. No UPDATE/DELETE (see GAP-02). |
| 5 | `sets` | YES | (select uid()) | (select uid()) auth | -- | -- | Denormalized user_id from `20260228`. No UPDATE/DELETE (see GAP-02). |
| 6 | `personal_records` | YES | uid() | -- | -- | -- | SELECT only. No INSERT policy (see GAP-03). |
| 7 | `rep_summaries` | YES | (select uid()) | (select uid()) auth | -- | -- | Denormalized user_id from `20260228`. Premium data -- no tier gating at DB level (see GAP-04). |
| 8 | `rep_telemetry` | YES | (select uid()) | (select uid()) auth | -- | -- | Denormalized user_id from `20260228`. Premium data -- no tier gating at DB level (see GAP-04). |
| 9 | `exercise_progress` | YES | uid() | uid() | -- | -- | SELECT + INSERT only. No UPDATE/DELETE. |

### Routine & Cycle Builder

| # | Table | RLS | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|-------|-----|--------|--------|--------|--------|-------|
| 10 | `routines` | YES | uid() | uid() | uid() | uid() | Full CRUD. Well-protected. |
| 11 | `routine_exercises` | YES | parent-join (FOR ALL) | parent-join (FOR ALL) | parent-join (FOR ALL) | parent-join (FOR ALL) | Uses `routine_id IN (SELECT id FROM routines WHERE user_id = auth.uid())`. Single FOR ALL policy. |
| 12 | `training_cycles` | YES | uid() | uid() | uid() | uid() | Full CRUD. Well-protected. |
| 13 | `cycle_days` | YES | parent-join (FOR ALL) | parent-join (FOR ALL) | parent-join (FOR ALL) | parent-join (FOR ALL) | Uses `cycle_id IN (SELECT id FROM training_cycles WHERE user_id = auth.uid())`. Single FOR ALL policy. |

### Community & Social

| # | Table | RLS | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|-------|-----|--------|--------|--------|--------|-------|
| 14 | `shared_routines` | YES | public auth | uid() | uid() | uid() | Public read for all authenticated users. DELETE added in `20260318_community_fixes.sql`. |
| 15 | `shared_cycles` | YES | public auth | uid() | uid() | uid() | Public read for all authenticated users. DELETE added in `20260318_community_fixes.sql`. |
| 16 | `community_votes` | YES | public auth | uid() | -- | uid() | Public read. No UPDATE (vote is boolean -- insert/delete only). Correct design. |
| 17 | `community_comments` | YES | public auth (non-deleted) | uid() + tier-gated | uid() (5-min window) | uid() | INSERT requires EMBER/FLAME/INFERNO tier. SELECT filters `deleted_at IS NULL`. Rate-limited via trigger (5/hour). |
| 18 | `saved_community_items` | YES | uid() | uid() | -- | uid() | No UPDATE needed (save/unsave is insert/delete). Correct design. |
| 19 | `creator_follows` | YES | public (no role restriction) | uid() = follower_id | -- | uid() = follower_id | SELECT uses `USING (true)` without `TO authenticated` (see GAP-05). |
| 20 | `content_reports` | YES | (select uid()) auth | (select uid()) auth | -- | -- | No UPDATE/DELETE -- reports are immutable. Correct design. |
| 21 | `user_blocks` | YES | (select uid()) auth | (select uid()) auth | -- | (select uid()) auth | No UPDATE -- blocks are create/delete only. Correct design. |

### Gamification & RPG

| # | Table | RLS | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|-------|-----|--------|--------|--------|--------|-------|
| 22 | `rpg_attributes` | YES | (select uid()) auth | (select uid()) auth | (select uid()) auth | -- | No DELETE -- RPG attributes persist. Correct design. |
| 23 | `earned_badges` | YES | (select uid()) auth | (select uid()) auth | -- | (select uid()) auth | No UPDATE -- badges are earned/revoked. Correct design. |
| 24 | `gamification_stats` | YES | (select uid()) auth | (select uid()) auth | (select uid()) auth | -- | No DELETE -- stats accumulate. Correct design. |
| 25 | `challenges` | YES | public auth | -- | -- | -- | Read-only for authenticated users. Seed data inserted via migration. No INSERT/UPDATE/DELETE for users. Correct design -- challenges are system-managed. |
| 26 | `challenge_participants` | YES | uid() | uid() | -- | -- | No UPDATE/DELETE (see GAP-06). Users cannot leave challenges or update completion. |

### User Settings & Onboarding

| # | Table | RLS | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|-------|-----|--------|--------|--------|--------|-------|
| 27 | `user_onboarding` | YES | uid() | uid() | uid() | -- | No DELETE -- onboarding state persists. Correct design. |
| 28 | `user_goals` | YES | uid() | uid() | uid() | uid() | Full CRUD. Goal limit enforced via `check_goal_limit()` trigger (FREE=1, paid=3). |
| 29 | `deletion_requests` | YES | (select uid()) auth | (select uid()) auth | (select uid()) auth | -- | No DELETE -- cancellation is via UPDATE to 'cancelled' status. Correct design. |

### Integrations & Sync

| # | Table | RLS | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|-------|-----|--------|--------|--------|--------|-------|
| 30 | `user_integrations` | YES | uid() | uid() | uid() | uid() | Full CRUD. Token columns removed in `20260227_oauth_security.sql` (migrated to oauth_tokens). |
| 31 | `sync_queue` | YES | uid() | uid() | -- | -- | No UPDATE/DELETE for authenticated users. Service-role updates status. Correct design (see GAP-07). |
| 32 | `rate_limit_tracking` | YES | auth.role() = 'authenticated' | -- | -- | -- | All writes via service-role (Edge Functions). Authenticated users can read rate limits. Correct design. |
| 33 | `external_activities` | YES | uid() | uid() | uid() | uid() | Full CRUD. Well-protected. |

### OAuth Security (Service-Role Only)

| # | Table | RLS | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|-------|-----|--------|--------|--------|--------|-------|
| 34 | `oauth_tokens` | YES | -- (svc) | -- (svc) | -- (svc) | -- (svc) | INTENTIONAL: Zero policies. RLS enabled but no policies = deny all for anon/authenticated. Service-role bypasses RLS. Stores sensitive OAuth credentials. |
| 35 | `oauth_states` | YES | -- (svc) | -- (svc) | -- (svc) | -- (svc) | INTENTIONAL: Zero policies. CSRF state tokens with 10-minute expiry. Server-only access. |

### Analytics (New - 2026-03-18)

| # | Table | RLS | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|-------|-----|--------|--------|--------|--------|-------|
| 36 | `user_insights` | YES | uid() | svc (jwt role check) | svc (jwt role check) | svc (jwt role check) | SELECT for own insights. FOR ALL policy gated by `auth.jwt() ->> 'role' = 'service_role'` for writes. |
| 37 | `community_benchmarks` | YES | public (no role restriction) | svc (jwt role check) | svc (jwt role check) | svc (jwt role check) | Public read (anonymized aggregate data). FOR ALL policy for service-role writes. SELECT uses `USING (true)` without `TO authenticated` (see GAP-05). |

---

## Views (Not Subject to RLS Directly)

| View | Underlying Tables | Notes |
|------|-------------------|-------|
| `telemetry_points` | `rep_telemetry` | Alias view (`SELECT * FROM rep_telemetry`). Inherits rep_telemetry RLS. |
| `creator_stats` | `profiles`, `shared_routines`, `shared_cycles` | Aggregated view. RLS applied to underlying tables during query execution. |

---

## Intentional Exceptions (Verified)

### 1. `oauth_tokens` -- No Policies (Service-Role Only)
**Status:** CORRECT
**Justification:** This table stores sensitive OAuth access tokens and refresh tokens. The `20260227_oauth_security.sql` migration explicitly documents this design: "Enable RLS but grant NO select/insert/update/delete to authenticated role. Only service_role can access." Token columns were removed from `user_integrations` and migrated here.
**Verification:** RLS is enabled. Zero policies exist. Service-role bypasses RLS automatically.

### 2. `oauth_states` -- No Policies (Service-Role Only)
**Status:** CORRECT
**Justification:** CSRF state tokens for OAuth flows. 10-minute expiry. Only Edge Functions need read/write access.

### 3. `subscriptions` -- SELECT Only
**Status:** CORRECT
**Justification:** All subscription mutations come from Paddle webhook Edge Functions running with service-role key. Users should never directly write to subscription state. The `user_subscription_tier()` SECURITY DEFINER function provides read access for RLS policy evaluation.

### 4. `challenges` -- SELECT Only
**Status:** CORRECT
**Justification:** Challenges are system-managed content seeded via migrations. Users participate through `challenge_participants`, not by modifying challenge definitions.

### 5. `rate_limit_tracking` -- SELECT Only (Authenticated)
**Status:** CORRECT
**Justification:** Edge Functions update rate limits via service-role. Authenticated users can read to display rate limit status in the UI.

### 6. `profiles` -- No INSERT Policy
**Status:** CORRECT
**Justification:** Profile rows are created by the `handle_new_user()` trigger (SECURITY DEFINER) on `auth.users` INSERT. The trigger runs with elevated privileges, bypassing RLS. There is no user-initiated profile creation flow.

### 7. `content_reports` -- No UPDATE/DELETE
**Status:** CORRECT
**Justification:** Reports are immutable once submitted. This prevents users from retracting reports after moderator review begins.

---

## Gaps Found

### GAP-01: `workout_sessions` Missing DELETE Policy
**Severity:** LOW
**Table:** `workout_sessions`
**Current state:** SELECT, INSERT, UPDATE policies exist. No DELETE policy.
**Impact:** Users cannot delete workout sessions through the PostgREST API. If session deletion is a feature requirement (e.g., GDPR data management, accidental sync), this is a functional gap. If deletion is handled via `ON DELETE CASCADE` from `auth.users`, this is intentional.
**Risk:** Low -- absence of DELETE prevents unauthorized data removal. However, if a user needs to delete individual sessions (not full account deletion), this blocks the operation.
**Recommendation:** Confirm whether individual session deletion is a product requirement. If yes, add:
```sql
CREATE POLICY "Users can delete own sessions"
  ON workout_sessions FOR DELETE
  USING ((select auth.uid()) = user_id);
```

### GAP-02: `exercises` and `sets` Missing UPDATE/DELETE Policies
**Severity:** LOW
**Tables:** `exercises`, `sets`
**Current state:** Both have SELECT and INSERT policies only.
**Impact:** Once synced, exercises and sets cannot be modified or deleted by authenticated users via PostgREST. This is likely intentional -- workout data is synced from mobile and treated as immutable on the portal side.
**Risk:** Low -- immutability is a reasonable design choice for synced data. CASCADE DELETE from `workout_sessions` handles cleanup.
**Recommendation:** Document this as intentional design. If portal-side editing of workout data is planned, policies will be needed.

### GAP-03: `personal_records` Missing INSERT/UPDATE/DELETE Policies
**Severity:** MEDIUM
**Table:** `personal_records`
**Current state:** SELECT policy only. No INSERT, UPDATE, or DELETE policies.
**Impact:** Personal records cannot be written by authenticated users via PostgREST. If the mobile app syncs PRs using the authenticated user's JWT (not service-role), INSERT will be silently denied by RLS.
**Risk:** If mobile sync uses the anon key with user JWT for PR writes, those writes will fail silently. If mobile sync uses service-role, no impact.
**Recommendation:** Add INSERT policy for defense-in-depth, consistent with the pattern established in `20260304_exercises_denorm_insert_rls.sql` for exercises/sets/rep_summaries/rep_telemetry:
```sql
CREATE POLICY "Users can insert own records"
  ON personal_records FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
```

### GAP-04: Premium Data (rep_summaries, rep_telemetry) Not Tier-Gated at DB Level
**Severity:** MEDIUM
**Tables:** `rep_summaries`, `rep_telemetry`
**Current state:** RLS policies check ownership only (`user_id = auth.uid()`). No subscription tier check.
**Impact:** Any authenticated user (including FREE tier) can query their own biomechanics data (velocity, force, power, asymmetry) and raw telemetry via PostgREST. Premium gating is enforced only client-side via `SubscriptionGate` component.
**Risk:** A technically skilled user can bypass the client-side paywall by querying Supabase directly:
```javascript
supabase.from('rep_summaries').select('*').eq('user_id', userId)
```
This bypasses the `SubscriptionGate` component entirely.
**Business impact:** Revenue leakage for premium features. Users on FREE tier can access EMBER/FLAME-tier biomechanics data.
**Recommendation:** Two options:
1. **(Preferred) Add tier-gated RLS policies:**
```sql
CREATE POLICY "Premium users can view rep summaries"
  ON rep_summaries FOR SELECT
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND public.user_subscription_tier() IN ('EMBER', 'FLAME', 'INFERNO')
  );
```
2. **(Alternative) Accept as design decision:** Document that premium gating is client-side only and accept the risk that technically sophisticated users can bypass it. This is a common pattern in B2C apps where the client-side UX is the primary enforcement mechanism.

**Note:** The same pattern applies to `exercise_progress` -- analytics data accessible to all tiers at DB level. Evaluate whether this is also premium content.

### GAP-05: `creator_follows` and `community_benchmarks` SELECT Policy Missing Role Restriction
**Severity:** MEDIUM
**Tables:** `creator_follows`, `community_benchmarks`
**Current state:**
- `creator_follows`: `USING (true)` with no `TO authenticated` clause
- `community_benchmarks`: `USING (true)` with no `TO authenticated` clause
**Impact:** The `anon` role (unauthenticated requests) can read all follows and all benchmark data. While Supabase's default behavior blocks unauthenticated access unless the anon key is used, any request with the anon key (which is public in the frontend bundle) can enumerate all follow relationships and benchmark data.
**Risk for `creator_follows`:** Exposes social graph data (who follows whom) to unauthenticated scrapers using the public anon key. This is an information disclosure concern.
**Risk for `community_benchmarks`:** Lower risk -- benchmarks are anonymized aggregate data. But principle of least privilege says restrict to authenticated.
**Recommendation:** Add `TO authenticated` to both policies:
```sql
-- creator_follows
DROP POLICY "Users can view follows" ON creator_follows;
CREATE POLICY "Users can view follows"
  ON creator_follows FOR SELECT TO authenticated
  USING (true);

-- community_benchmarks
DROP POLICY "Anyone can read benchmarks" ON community_benchmarks;
CREATE POLICY "Anyone can read benchmarks"
  ON community_benchmarks FOR SELECT TO authenticated
  USING (true);
```

### GAP-06: `challenge_participants` Missing DELETE Policy
**Severity:** HIGH
**Table:** `challenge_participants`
**Current state:** SELECT and INSERT policies only. No UPDATE or DELETE.
**Impact:** Once a user joins a challenge, they cannot leave. The `completed_at` field cannot be updated by the user. If challenge withdrawal is a feature requirement, this is blocking.
**Risk:** Users may join challenges accidentally and have no way to unjoin. From a UX perspective this is poor, but from a security perspective the absence of DELETE prevents abuse (rapid join/leave to manipulate leaderboards).
**Recommendation:** Add UPDATE policy for `completed_at` field and consider DELETE:
```sql
CREATE POLICY "Users can update own participation"
  ON challenge_participants FOR UPDATE
  USING (user_id = (select auth.uid()));

-- Only if withdrawal is a feature:
CREATE POLICY "Users can leave challenges"
  ON challenge_participants FOR DELETE
  USING (user_id = (select auth.uid()));
```

### GAP-07: `sync_queue` Missing UPDATE Policy for Service-Role Documentation
**Severity:** INFO (documentation gap, not security gap)
**Table:** `sync_queue`
**Current state:** Authenticated users have SELECT and INSERT. No UPDATE or DELETE. Service-role handles status transitions.
**Impact:** None -- service-role bypasses RLS. However, there is no explicit documentation that UPDATE/DELETE is service-role only.
**Recommendation:** Add a SQL comment for clarity:
```sql
COMMENT ON TABLE sync_queue IS
  'Sync task queue. Users can view/create tasks. Status updates (processing, completed, failed) '
  'are performed by Edge Functions via service_role key (bypasses RLS).';
```

### GAP-08: `profiles` Table Has Duplicate Policy Names
**Severity:** HIGH
**Table:** `profiles`
**Current state:** Migration `00001_create_subscriptions.sql` creates:
- `"Users read own profile"` (SELECT)
- `"Users update own profile"` (UPDATE)

Migration `00002_base_schema.sql` creates (with IF NOT EXISTS guard):
- `"Users can view own profile"` (SELECT)
- `"Users can update own profile"` (UPDATE)

Both pairs have identical logic (`auth.uid() = id`). The conditional in 00002 uses `pg_policies` lookup, so whether duplicates exist depends on migration execution order.
**Impact:** If both sets exist, PostgreSQL evaluates all matching policies with OR logic for the same operation. Since both SELECT policies are identical, this is functionally harmless but indicates migration hygiene issues.
**Risk:** Duplicate policies increase query planning overhead (minor) and create confusion during audits. More critically, if someone drops the "wrong" policy thinking it is the active one, they could leave the table unprotected.
**Recommendation:** Consolidate to a single set of policies. Drop the older names:
```sql
DROP POLICY IF EXISTS "Users read own profile" ON profiles;
DROP POLICY IF EXISTS "Users update own profile" ON profiles;
```

### GAP-09: `user_insights` Service-Role Policy Uses JWT Check Instead of Relying on Bypass
**Severity:** HIGH
**Table:** `user_insights`, `community_benchmarks`
**Current state:** Both tables have a `FOR ALL` policy with:
```sql
USING (auth.jwt() ->> 'role' = 'service_role')
```
**Impact:** This policy pattern is problematic. The `service_role` key bypasses RLS entirely -- it never evaluates policies. So this `FOR ALL` policy will never match for actual service-role requests (they skip RLS). Meanwhile, for authenticated users, `auth.jwt() ->> 'role'` returns `'authenticated'`, not `'service_role'`, so this policy will never grant access to authenticated users either.
**Risk:** The FOR ALL policy is effectively dead code. It appears to grant service-role write access through policies, but service-role already bypasses RLS. The real risk is that this creates a false sense of security -- someone reading the migration might think "service-role writes are governed by this policy" when in fact they are ungoverned (which is the correct behavior for service-role, but the policy is misleading).
**More importantly:** If the intent was to allow authenticated users with elevated privileges to write insights (e.g., an admin dashboard), this policy will silently deny those writes.
**Recommendation:** Remove the misleading FOR ALL policies and add SQL comments:
```sql
-- Remove dead-code policies
DROP POLICY IF EXISTS "Service role can manage insights" ON user_insights;
DROP POLICY IF EXISTS "Service role can manage benchmarks" ON community_benchmarks;

-- Document intent
COMMENT ON TABLE user_insights IS
  'Training insights generated by rule engine via service_role (bypasses RLS). '
  'Users can SELECT own insights only.';
```

---

## Performance Observations

### Optimized Policies (Using `(select auth.uid())` Wrapper)

The following tables use the Supabase-recommended `(select auth.uid())` initPlan caching pattern, which provides approximately 20x performance improvement over bare `auth.uid()`:

- `sets` (SELECT, INSERT)
- `rep_summaries` (SELECT, INSERT)
- `rep_telemetry` (SELECT, INSERT)
- `exercises` (SELECT, INSERT)
- `rpg_attributes` (SELECT, INSERT, UPDATE)
- `earned_badges` (SELECT, INSERT, DELETE)
- `gamification_stats` (SELECT, INSERT, UPDATE)
- `content_reports` (SELECT, INSERT)
- `user_blocks` (SELECT, INSERT, DELETE)
- `deletion_requests` (SELECT, INSERT, UPDATE)

### Non-Optimized Policies (Bare `auth.uid()`)

The following tables still use bare `auth.uid()` without the `(select ...)` wrapper:

- `profiles` (SELECT, UPDATE)
- `subscriptions` (SELECT)
- `routines` (SELECT, INSERT, UPDATE, DELETE)
- `training_cycles` (SELECT, INSERT, UPDATE, DELETE)
- `workout_sessions` (SELECT, INSERT, UPDATE)
- `personal_records` (SELECT)
- `exercise_progress` (SELECT, INSERT)
- `shared_routines` (INSERT, UPDATE, DELETE)
- `shared_cycles` (INSERT, UPDATE, DELETE)
- `community_votes` (INSERT, DELETE)
- `saved_community_items` (SELECT, INSERT, DELETE)
- `user_integrations` (SELECT, INSERT, UPDATE, DELETE)
- `sync_queue` (SELECT, INSERT)
- `external_activities` (SELECT, INSERT, UPDATE, DELETE)
- `user_onboarding` (SELECT, INSERT, UPDATE)
- `user_goals` (SELECT, INSERT, UPDATE, DELETE)
- `user_insights` (SELECT)
- `challenge_participants` (SELECT, INSERT)
- `creator_follows` (INSERT, DELETE)

**Recommendation:** Low priority, but for tables with high row counts (`workout_sessions`, `exercises`, `sets`, `routines`), consider migrating to the `(select auth.uid())` pattern in a future optimization pass. The `routine_exercises` and `cycle_days` FOR ALL policies use subquery joins which are inherently more expensive -- these are acceptable given the low row count per user.

---

## Subscription Tier Enforcement Summary

| Enforcement Point | Location | Mechanism |
|-------------------|----------|-----------|
| Comment posting | `community_comments` INSERT policy | `user_subscription_tier() IN ('EMBER', 'FLAME', 'INFERNO')` -- DB-level |
| Goal limit | `user_goals` INSERT trigger | `check_goal_limit()` trigger -- DB-level (FREE=1, paid=3) |
| Biomechanics data | Client-side only | `SubscriptionGate` component -- NO DB-level enforcement |
| Analytics features | Client-side only | `SubscriptionGate` component -- NO DB-level enforcement |
| Session replay | Client-side only | `SubscriptionGate` component -- NO DB-level enforcement |
| Integrations | Client-side only | `SubscriptionGate` component -- NO DB-level enforcement |

**Assessment:** Only 2 of 6 premium features are enforced at the database level. The remaining 4 rely entirely on client-side gating, which can be bypassed by any user who can make direct Supabase API calls (the anon key is embedded in the frontend JavaScript bundle). See GAP-04 for details.

---

## SECURITY DEFINER Functions

The following functions run with elevated privileges (owner's permissions, not caller's):

| Function | Purpose | Risk Assessment |
|----------|---------|-----------------|
| `user_subscription_tier()` | Returns current user's subscription tier | LOW -- reads only, uses `auth.uid()` for scoping |
| `check_comment_rate_limit()` | Enforces 5 comments/hour limit | LOW -- trigger-only, reads comment count |
| `check_goal_limit()` | Enforces goal count per tier | LOW -- trigger-only, reads goal count |
| `update_comment_count()` | Maintains denormalized comment_count | LOW -- trigger-only, increments/decrements counters |
| `update_vote_count()` | Maintains denormalized vote_count | LOW -- trigger-only, increments/decrements counters |
| `handle_new_user()` | Auto-creates profile on signup | MEDIUM -- INSERTs into profiles, but uses `ON CONFLICT DO NOTHING` and is limited to `auth.users` trigger |

All SECURITY DEFINER functions are trigger-bound or query-helpers, limiting their attack surface. None accept arbitrary user input beyond what the trigger provides.

---

## Consolidated Findings by Severity

### CRITICAL (0)

No critical RLS findings. All tables have RLS enabled. No tables are fully open to unauthenticated access (though see GAP-05 for weak enforcement).

### HIGH (3)

| ID | Finding | Tables | Action Required |
|----|---------|--------|----------------|
| GAP-06 | Missing DELETE/UPDATE on challenge_participants | `challenge_participants` | Add policies if withdrawal/completion is a feature |
| GAP-08 | Duplicate policy names on profiles | `profiles` | Drop legacy policy names from 00001 |
| GAP-09 | Dead-code service-role FOR ALL policies | `user_insights`, `community_benchmarks` | Remove misleading policies, add comments |

### MEDIUM (3)

| ID | Finding | Tables | Action Required |
|----|---------|--------|----------------|
| GAP-03 | personal_records has no INSERT policy | `personal_records` | Add INSERT policy for defense-in-depth |
| GAP-04 | Premium data not tier-gated at DB level | `rep_summaries`, `rep_telemetry` | Add tier-gated SELECT policies or accept risk |
| GAP-05 | Policies missing TO authenticated restriction | `creator_follows`, `community_benchmarks` | Add TO authenticated to SELECT policies |

### LOW (2)

| ID | Finding | Tables | Action Required |
|----|---------|--------|----------------|
| GAP-01 | No DELETE policy on workout_sessions | `workout_sessions` | Add if individual session deletion is a feature |
| GAP-02 | No UPDATE/DELETE on exercises/sets | `exercises`, `sets` | Document as intentional (immutable sync data) |

### INFO (1)

| ID | Finding | Tables | Action Required |
|----|---------|--------|----------------|
| GAP-07 | sync_queue missing documentation | `sync_queue` | Add table comment documenting service-role writes |

---

## Migration Files Reviewed

| File | Tables Affected | Key RLS Operations |
|------|----------------|-------------------|
| `00001_create_subscriptions.sql` | profiles, subscriptions | Initial RLS + policies |
| `00002_base_schema.sql` | routines, training_cycles, workout_sessions, exercises, sets, personal_records, rep_summaries, rep_telemetry, shared_routines, shared_cycles, community_votes, saved_community_items | Initial RLS + policies, telemetry_points view |
| `20260216_integrations.sql` | user_integrations, sync_queue, rate_limit_tracking, external_activities | Full CRUD policies |
| `20260217_phase10_tables.sql` | routine_exercises, cycle_days, challenges, challenge_participants | FOR ALL policies, public read challenges |
| `20260218_phase11_comments.sql` | community_comments | Tier-gated INSERT, 5-min edit window, soft delete |
| `20260219_phase11_goals.sql` | user_goals | Full CRUD, goal limit trigger |
| `20260220_phase11_onboarding.sql` | user_onboarding | SELECT/INSERT/UPDATE |
| `20260221_exercise_progress_and_creator_stats.sql` | exercise_progress | SELECT/INSERT, creator_stats view |
| `20260222120000_session_notes.sql` | workout_sessions | Added UPDATE policy |
| `20260222_creator_follows.sql` | creator_follows | Public SELECT, follower-scoped INSERT/DELETE |
| `20260227_oauth_security.sql` | oauth_tokens, oauth_states | Zero policies (service-role only) |
| `20260228_rls_denormalization.sql` | sets, rep_summaries, rep_telemetry | Denormalized user_id, replaced multi-hop policies |
| `20260301_deletion_support.sql` | deletion_requests, community_comments, shared_routines, shared_cycles | GDPR deletion, CASCADE to SET NULL |
| `20260302120000_sync_compat_rpg_gamification.sql` | rpg_attributes, earned_badges, gamification_stats | Initial policies (later replaced) |
| `20260302130000_sync_compat_superset_perset.sql` | routine_exercises, sets, workout_sessions | Column additions only |
| `20260302_community_safety.sql` | content_reports, user_blocks | SELECT/INSERT policies, blocker-scoped |
| `20260303_revenuecat_schema_migration.sql` | subscriptions | Schema evolution, no RLS changes |
| `20260304120000_mode_wire_format_migration.sql` | routine_exercises, workout_sessions | Data migration only |
| `20260304130000_sync_compat_quality_fixes.sql` | rpg_attributes, earned_badges, gamification_stats | Replaced with (select auth.uid()) + TO authenticated |
| `20260304_exercises_denorm_insert_rls.sql` | exercises, sets, rep_summaries, rep_telemetry | Denormalized exercises.user_id, added INSERT policies |
| `20260315_vote_count_trigger.sql` | community_votes | Trigger only, no RLS changes |
| `20260316_align_tier_names.sql` | subscriptions, community_comments | Tier name alignment |
| `20260317_paddle_schema_fix.sql` | subscriptions | Schema evolution, no RLS changes |
| `20260317143000_routine_exercise_bodyweight_duration.sql` | routine_exercises | Column additions only |
| `20260318_community_fixes.sql` | shared_routines, shared_cycles, community_comments, profiles | Added DELETE policies, FK fixes, comment tier fix |
| `20260318_insights_benchmarks.sql` | user_insights, community_benchmarks | New tables with service-role patterns |
| `20260318_demo_data_seed.sql` | exercises, personal_records, workout_sessions, rep_summaries | Data seed only |
| `20260318120000_fix_period_end_nullable.sql` | subscriptions | Schema fix only |
