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

Remaining in theme (read-error propagation, lower data-loss risk): F350 (mobile-sync-pull child
reads), F310/F315 (rankings), F328 (shared subscription lookup), F355 (stored-token lookup) —
queued as a follow-up batch in this theme.

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
| F149/F150 (useUpdateCycle), F158 (useUpdateRoutine) | CONFIRMED — pending | UPDATE delete+reinsert is not recoverable by cleanup (old children already gone); needs a transactional Postgres RPC. Next: a migration with `replace_cycle_days`/`replace_routine_exercises` (or parent+children upsert) RPCs, idempotent per CLAUDE.md. |

---

## PR-4 — Concurrency / atomicity in edge functions (DONE, first batch)

| ID | Verdict | Resolution |
|----|---------|-----------|
| F357 (sync-queue claim race) | PARTIAL→CONFIRMED | Conditional claim: `UPDATE … WHERE id AND status='pending' RETURNING`; skip the task if another invocation already won it. |
| F358 (stuck `processing` no recovery) | CONFIRMED | Reclaim `processing` tasks older than a 5-min lease back to `pending` before fetching. |

Remaining in theme (deferred): F264 (atomic Paddle webhook ordering — needs conditional-upsert
RPC), F343 (push exercise delete+replace transaction), F303/F311/F359.

---

## PR-11 — UI resilience & copy (started: stale tier copy)

| ID | Verdict | Resolution |
|----|---------|-----------|
| F420 (FAQ stale tiers) | CONFIRMED | Rewrote FAQ to the three current tiers (Ember $5 / Flame $15 / Inferno $25) from `pricing.ts`. |
| F410 (legacy "Phoenix and Elite") | CONFIRMED | Goals + ComparisonView now say "Flame and Inferno". |
| F368 (FREE goal-limit gate) | CONFIRMED — RESOLVED | User: no free tier exists, so the phantom free goal must not exist. `maxGoals` non-subscriber branch `: 1` → `: 0`; gate unchanged. |
| F410 copy (re-correction) | CONFIRMED | Goal tracking + workout comparison gate on `isPremium = isEntitled` = ANY paid tier (Ember+), so copy now says "available to subscribers", not "Flame and Inferno". |
| F358 retry_count (Codex P2) | CONFIRMED | Stale-task reclaim now increments `retry_count` and marks `permanently_failed` at `MAX_RETRIES` instead of requeuing a deterministically-crashing task forever. |
