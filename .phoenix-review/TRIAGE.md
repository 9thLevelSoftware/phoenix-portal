# Phoenix Review — Validation Triage

Living triage for the 568 findings in `CONSOLIDATED-REPORT.md`. Each finding is validated
against **current source** before any fix, because the original review analyzed files in
isolation and missed cross-file mitigations (later migrations, Deno's `any` catch typing, etc.).

Verdicts: **CONFIRMED** (real, fix it) · **PARTIAL** (real but narrower/different than described) ·
**FALSE-POSITIVE** (not a real issue) · **ALREADY-FIXED** (real once, resolved by later code).

This doc grows per theme as each PR validates + fixes its cluster.

---

## Critical findings (all 9) — validated

| ID | Verdict | Evidence |
|----|---------|----------|
| F221–F226 (parity-sync RPC privilege) | **ALREADY-FIXED** | `20260517173000_security_scan_rls_privilege_fixes.sql` REVOKEs EXECUTE from PUBLIC/anon/authenticated, GRANTs only `service_role`. Adding `auth.uid()=p_user_id` would break service-role internals. |
| F222 (BIGINT vs UUID id params) | **ALREADY-FIXED** | Corrected to `UUID[]`/`UUID` in `20260428234500_fix_parity_sync_uuid_badges_prs.sql`. |
| F357 (process-sync-queue race) | **PARTIAL → PR-4** | Real TOCTOU window exists, but not "non-conditional statements"; fix = conditional claim `WHERE status='pending'` + lease. |
| F291 (fitbit-sync deno check) | **CONFIRMED → PR-1 (DONE)** | Real `deno check` failure, but root cause is `ReturnType<typeof createClient>` collapsing payloads to `never` (TS2345), not the catch block. Fixed via `DbClient` alias. |
| F294 (hevy-sync deno check) | **FALSE-POSITIVE** | hevy-sync **passes** `deno check`; Deno types catch vars as `any`, so `err.message` is not a type error. Catch still hardened in PR-1 for safety. |
| F298 (liftosaur-sync deno check) | **FALSE-POSITIVE** | Same as F294 — liftosaur-sync passes `deno check`. Catch hardened in PR-1. |

## High findings — migrations sub-cluster — validated

| ID | Verdict | Evidence |
|----|---------|----------|
| F219 (leaderboard RPCs SECURITY INVOKER) | **FALSE-POSITIVE** | `SECURITY INVOKER` is correct — RLS enforced per caller (`20260412_leaderboard_functions.sql`). |
| F215 / F228 (creator_stats security-definer view) | **ALREADY-FIXED** | `WITH (security_invoker = true)` in `20260324120000_fix_security_definer_views.sql`. |
| F216 / F217 (gamification/RPG/badge RLS) | **FALSE-POSITIVE** | Owner-only `auth.uid()=user_id` policies exist (`20260302120000_sync_compat_rpg_gamification.sql`). |
| F323 (decryptOAuthSecret plaintext) | **FALSE-POSITIVE** | Defensive by design; throws if encrypted token present but key missing. |

---

## PR-1 — Edge-function type safety + deno check gate (DONE)

Root cause: helper params annotated `ReturnType<typeof createClient>` resolve the client's
default generics to a collapsed `SupabaseClient<unknown, …, never, never, …>`, so every
`.insert()/.update()` payload is typed `never` (TS2345/TS2353). The original `check:edge-functions`
gate only type-checked 2 of 22 functions, so this never surfaced in CI.

| ID | Verdict | Resolution |
|----|---------|-----------|
| F291 | CONFIRMED | `DbClient = SupabaseClient<any,any,any>` alias for helper params in `fitbit-sync`. |
| F294, F298 | FALSE-POSITIVE (deno) | Catch blocks still hardened with shared `errorMessage()` for robustness. |
| F073 | CONFIRMED | `check:edge-functions` now discovers **all** `supabase/functions/*/index.ts` and runs `deno check --node-modules-dir=auto`. |
| (review-missed) | CONFIRMED | Same `never`-collapse found and fixed in `mobile-integration-sync` and `process-sync-queue` — only caught because the gate was widened. |

New shared util: `supabase/functions/_shared/errorMessage.ts` (`errorMessage(unknown): string`).
Verification: `node scripts/check-edge-functions.mjs` → exit 0 across all 22 functions.

Post-review tweaks (gemini-code-assist on PR #80, both valid): `errorMessage()` now reads
`.message` off plain objects (PostgrestError); `discoverEntrypoints()` filters with `existsSync`.

---

## PR-2 — Silent persistence failures & sync data-loss (DONE, first batch)

Root cause: provider sync functions advanced `last_sync_at` (the incremental cutoff) and/or marked
the queue completed even when per-row upserts failed, so the next delta sync skipped the dropped
rows permanently. Token rotations were persisted without checking the write. Fix pattern: track a
`failedCount`, and on any failure set `status='error'` + return non-2xx WITHOUT advancing
`last_sync_at` — the queue processor retries and upserts are idempotent (`onConflict`).

| ID | Verdict | Resolution |
|----|---------|-----------|
| F297 (hevy) | CONFIRMED | Track failures; 502 + no `last_sync_at` advance on partial failure. |
| F302 (liftosaur) | CONFIRMED | Same pattern. |
| F279 (strava per-activity) | CONFIRMED | Don't advance `last_sync_at` when `errors.length>0`; 502. |
| F278 (strava token rotation) | CONFIRMED | Capture `oauth_tokens` update error; mark error + 500 instead of continuing with unpersisted rotated token. |
| F292 (fitbit token rotation) | CONFIRMED | Capture token persist error in `refreshTokenIfNeeded`; throw. |
| F354 (mobile-integration) | CONFIRMED | `persistActivities` returns failure count; callers skip `last_sync_at` advance + 502. |
| F263 (paddle-webhooks) | CONFIRMED | Capture `.maybeSingle()` error; return 500 so Paddle retries with full ordering context. |

### Read-error propagation follow-up (closed)

| ID | Verdict | Resolution |
|----|---------|-----------|
| F350 (mobile-sync-pull child reads) | ALREADY-FIXED | Every read now returns a 500 on `error` (via the `readFailure()` helper / explicit `if (…Error) return new Response(…500…)`); the function no longer continues and returns `success` after a failed read. |
| F310 (generate-insights reads) | ALREADY-FIXED | All data queries (sessions, exercises, PRs, exercise_progress, streak) capture their `error` and return 500. |
| F315 (compute-rankings reads) | ALREADY-FIXED | All weekly/user ranking queries capture and check `error`; the one exception (target-profile participation check) fails closed with a 403 — safe for an authz gate. |
| F328 (requireSubscription lookup) | ALREADY-FIXED | `.maybeSingle()` error now returns a retryable 503 (`fix(F328)`), and unknown tier/status is rejected (`fix(F329)`) instead of silently downgrading to FREE. |
| F355 (mobile-integration-sync stored-token lookup) | CONFIRMED — DONE | Lookup used `.single()` and dropped `error`, so a transient DB failure was misreported as "No API key found. Connect the integration first." Switched to `.maybeSingle()` with an explicit error branch returning a retryable 500; a genuinely-missing row still falls through to the existing 400. |

---

## PR-3 — Data-layer integrity & auth (DONE, first batch: security/stability)

| ID | Verdict | Resolution |
|----|---------|-----------|
| F157 (useUpdateRoutine ownership) | CONFIRMED | Added `.eq("user_id", user.id)` + `.select("id").maybeSingle()` row check (mirrors delete/favorite). |
| F160 (useSaveSessionNotes ownership) | CONFIRMED | Added `useAuth`, `.eq("user_id", user.id)`, and a matched-row check. |
| F455 (fetchWithAuthRetry recursion) | CONFIRMED | Skip retry for `/auth/v1/` endpoints + `refreshInFlight` re-entrancy guard. |

Test mocks in `routines.test.tsx` updated for the new ownership-checked update chain.

### PR-3 batch 2 — zero-row-update-success (DONE)

All confirmed; each mutation now `.select(...).maybeSingle()` and throws when no row matched.

| ID | Mutation | Resolution |
|----|----------|-----------|
| F136 | `useCancelDeletion` (account.ts) | Throw "No pending deletion request to cancel." |
| F138 | `useLeaveChallenge` / `useCompleteChallenge` (challenges.ts) | Throw when not a participant. |
| F141 | `useUpdateComment` (comments.ts) | `count` was always null (no `.select()`), so the edit-window guard never fired; now `.select().maybeSingle()`. |
| F142 | `useDeleteComment` (comments.ts) | Throw when no comment matched id+user. |
| F147 | `useDeleteSharedContent` (community.ts) | Throw when no shared row matched; also collapsed the routine/cycle branches. |
| F152 | `useArchiveGoal` (goals.ts) | Throw when no goal matched id+user. |
| F155 | `useUpdateProfile` (profile.ts) | Throw "Profile not found for this user." |

Test mocks updated in account/comments/community/goals test files for the new chains (59 pass).

### PR-3 batch 3 — atomic mutations

| ID | Verdict | Resolution |
|----|---------|-----------|
| F148 (useSaveCycle) | CONFIRMED | Parent-cleanup: delete the orphaned `training_cycles` row if `cycle_days` insert fails. |
| F156 (useSaveRoutine) | CONFIRMED | Parent-cleanup: delete the orphaned `routines` row if `routine_exercises` insert fails. |
| F149/F150 (useUpdateCycle), F158 (useUpdateRoutine) | CONFIRMED — DONE | New idempotent migration `20260628120000_atomic_routine_cycle_replace_rpcs.sql` adds SECURITY INVOKER RPCs `update_routine_with_exercises` / `update_cycle_with_days` that do the parent update + child delete/replace in one transaction, scoped to `auth.uid()`. Mutations rewired to `supabase.rpc(...)`; signatures added to `database.types.ts`; tests mock `rpc`. Migration validated by the Supabase preview branch + migrations CI gate. |

---

## PR-4 — Concurrency / atomicity in edge functions (DONE, first batch)

| ID | Verdict | Resolution |
|----|---------|-----------|
| F357 (sync-queue claim race) | PARTIAL→CONFIRMED | Conditional claim: `UPDATE … WHERE id AND status='pending' RETURNING`; skip the task if another invocation already won it. |
| F358 (stuck `processing` no recovery) | CONFIRMED | Reclaim `processing` tasks older than a 5-min lease back to `pending` before fetching. |

### PR-4 batch 2

| ID | Verdict | Resolution |
|----|---------|-----------|
| F264 (Paddle webhook ordering race) | CONFIRMED — DONE | New migration `20260628130000_atomic_paddle_subscription_event.sql` adds `apply_subscription_event` (SECURITY DEFINER, service_role-only) doing an `INSERT … ON CONFLICT (user_id) DO UPDATE … WHERE incoming.last_event_occurred_at > stored` — the write only lands when the event is strictly newer. paddle-webhooks calls it; a lost ordering race returns 200 `stale`. |

### PR-4 batch 3 — F343 push delete+replace atomicity (dedicated pass)

| ID | Verdict | Resolution |
|----|---------|-----------|
| F343 (push exercise delete+replace not atomic) | CONFIRMED — DONE | mobile-sync-push deleted all `exercises` for the affected sessions (CASCADE removing sets/rep_summaries/rep_telemetry) then re-inserted in separate statements; a failure after the delete permanently destroyed the user's data. New idempotent migration `20260628150000_atomic_replace_session_children.sql` adds `replace_session_children` (SECURITY DEFINER, service_role-only) folding the delete + all four child inserts into one transaction (`ON CONFLICT (id) DO UPDATE` preserves idempotent re-sync). The edge function builds + ownership-checks the child rows, then performs the swap with one RPC call. Column types verified against live schema (note `exercises.exercise_id` is TEXT, not UUID; `database.types.ts` was stale on that column). Migration clean-applied on the Supabase preview branch. |

### PR-4 batch 4 — remaining concurrency/atomicity

| ID | Verdict | Resolution |
|----|---------|-----------|
| F311 (generate-insights delete+insert) | CONFIRMED — DONE | Cached `user_insights` for a (user, period) were refreshed by DELETE-then-INSERT in two statements; a failure after the delete wiped the cache until next regen. New migration `20260628160000_atomic_insights_and_disconnect_rpcs.sql` adds `replace_user_insights` (SECURITY DEFINER, service_role-only) doing delete+insert in one transaction; the function calls it via one `rpc`. |
| F303 (disconnect-integration partial state) | CONFIRMED — DONE | Token delete + integration-state reset + sync-queue cancel ran concurrently (Promise.all) outside a transaction, so a partial failure could strand the account (tokens gone but still flagged connected). Same migration adds `disconnect_integration` (SECURITY DEFINER, service_role-only) folding all three writes into one transaction; the function calls it via one `rpc`. |
| F359 (provider rate-limit check-then-act) | MITIGATED | The core harm — two concurrent cron runs double-processing the same task — is eliminated by the F357 atomic claim (`UPDATE … WHERE status='pending' RETURNING`): only one invocation wins each row. The residual (both runs passing the provider rate-limit gate and processing *different* tasks) is bounded by the scheduled single-instance cron and the per-task claim; a distributed rate-limit lock is not warranted. No code change. |

Both RPCs compiled cleanly on the Supabase preview branch.

---

## Post-workflow integration fixes (user-flagged P1/P2 + Codex review)

| ID | Verdict | Resolution |
|----|---------|-----------|
| P1 — legacy PR dedupe (personalRecordRow.ts) | CONFIRMED — DONE | mobile-sync-push indexed existing `personal_records` only by their id-key, so legacy set-derived payload rows (no `id`) never matched and the non-dedicated insert path re-created duplicate derived PR rows every re-sync. Added `personalRecordDerivedIdentityKey()`; existing rows are now indexed under BOTH their id-key and derived key. |
| P2 — profile filter owner binding (AuthProvider) | CONFIRMED — DONE | `setOwnerUser` existed but was never called, so a rehydrated `activeProfileId` from a previous user could survive a user switch and feed routine/cycle/community import mutations. `applySession` now calls `useProfileFilterStore.setOwnerUser(nextUser?.id ?? null)` on every auth transition. |
| Codex — workouts.ts `_none_` UUID sentinel | CONFIRMED — DONE | Replaced both `["_none_"]` sentinels in the sets queries (session + comparison detail) with conditional empty-array handling; `exercise_id` is a UUID column and PostgREST rejects the sentinel for zero-exercise sessions. |
| Codex P2 — useSubscription entitlement carry-over | CONFIRMED — DONE | `placeholderData: keepPreviousData` carried a row across a query-key (user) change, briefly exposing the prior account's `isPremium`/tier to the new/anonymous session. Scoped the carry-over to a matching user id (default caching already covers same-key refetch errors). |
| Codex P2 — garmin-oauth unbounded pending-token decrypt | CONFIRMED — DONE | Callback filtered pending request tokens on `token_expires_at IS NULL`, but permanent OAuth 1.0a tokens also use `null`, so every callback decrypted all connected Garmin users' tokens. Pending tokens now carry a short non-null expiry; the lookup scans only non-expired pending rows. |

---

## PR-11 — UI resilience & copy (started: stale tier copy)

| ID | Verdict | Resolution |
|----|---------|-----------|
| F420 (FAQ stale tiers) | CONFIRMED | Rewrote FAQ to the three current tiers (Ember $5 / Flame $15 / Inferno $25) from `pricing.ts`. |
| F410 (legacy "Phoenix and Elite") | CONFIRMED | Goals + ComparisonView now say "Flame and Inferno". |
| F368 (FREE goal-limit gate) | CONFIRMED — RESOLVED | User: no free tier exists, so the phantom free goal must not exist. `maxGoals` non-subscriber branch `: 1` → `: 0`; gate unchanged. |
| F368 server-side (Codex P2) | CONFIRMED — DONE | The client gate alone was bypassable: the `check_goal_limit()` BEFORE INSERT trigger still granted FREE one active goal, so a direct Supabase insert could create a paid-only goal. New migration `20260628170000_goal_limit_no_free_tier.sql` mirrors the client tier model in the trigger (INFERNO unlimited, EMBER/FLAME 3, FREE/unknown 0). |
| F343 telemetry gating (self-review) | CONFIRMED — DONE | Self-review of the F343 atomic replace found rep_telemetry was not gated by the LWW acceptance filter; a rejected session's telemetry references a non-inserted set, and now that the replace is atomic the FK violation rolls back the WHOLE push. Telemetry is now gated to the accepted set ids (mirroring exercises/sets/rep_summaries). |
| F410 copy (re-correction) | CONFIRMED | Goal tracking + workout comparison gate on `isPremium = isEntitled` = ANY paid tier (Ember+), so copy now says "available to subscribers", not "Flame and Inferno". |
| F358 retry_count (Codex P2) | CONFIRMED | Stale-task reclaim now increments `retry_count` and marks `permanently_failed` at `MAX_RETRIES` instead of requeuing a deterministically-crashing task forever. |
