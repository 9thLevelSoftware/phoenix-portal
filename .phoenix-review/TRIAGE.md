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
