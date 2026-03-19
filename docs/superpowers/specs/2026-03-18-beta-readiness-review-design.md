# Beta Readiness Review — Comprehensive E2E Audit

**Date:** 2026-03-18
**Status:** Approved
**Type:** Review Plan (Audit-and-Fix)
**Target:** Soft launch (production-grade, real billing via Paddle)
**Timeline:** Flexible — prioritize thoroughness over speed

---

## Overview

A 7-phase, risk-ordered end-to-end review of Phoenix Portal to determine beta launch readiness. Covers frontend, backend (18 Edge Functions), security, billing, mobile sync, third-party integrations, performance, and operational readiness.

**Approach:** Risk-Based (Critical Path First) with audit-and-fix methodology — issues found are fixed and verified within the same phase, not deferred to a backlog.

**Scope:**
- Phoenix Portal (this repo) — React/TypeScript web dashboard
- Project Phoenix MP (mobile app at `github.com/9thLevelSoftware/Project-Phoenix-MP`, branch `MVP`) — sync contract review only
- Supabase backend — Edge Functions, database schema, RLS policies, Auth
- Paddle billing — live but undertested, requires sandbox mode for testing
- Third-party integrations — Strava, Fitbit, Garmin, Hevy, Liftosaur (code-complete, none connected)

---

## Codebase Health Snapshot (Pre-Review)

| Domain | Grade | Key Finding |
|--------|-------|-------------|
| Frontend Architecture | A- | Enterprise-grade routing, clean state mgmt, Analytics.tsx = 2,048 lines |
| Backend (18 Edge Functions) | B+ | Solid auth/webhooks, schema mismatch risk (Stripe->Paddle), no mobile sync payload limits |
| Security | 8.5/10 | Strong auth/CSRF/CSP, no critical vulns. Missing server-side rate limiting |
| Testing | C+ | ~11% file coverage (31/273). E2E covers basics but misses critical flows |
| Dependencies | Warning | 9 HIGH severity vulns (all transitive/build-time), ~30 outdated packages |
| CI/CD | A | 5 parallel jobs, proper artifacts, concurrency controls |

### Top Risk Areas
1. Paddle schema migration — webhook upserts may reference non-existent columns
2. Test coverage gaps — no tests for mutations, most query hooks, RoutineBuilder, CycleBuilder
3. No server-side rate limiting — application-layer only
4. Mobile sync push — no payload size limits, could exceed 10s Edge Function timeout
5. Delete-account — no rollback on partial cascade failure
6. npm vulnerabilities — 9 HIGH in build toolchain

### Edge Function Inventory (18 functions)

All Edge Functions that must be covered across review phases:

**Billing (3):** `paddle-webhooks`, `paddle-cancel-subscription`, `paddle-update-subscription`
**OAuth (4):** `initiate-oauth`, `strava-oauth`, `fitbit-oauth`, `garmin-oauth`
**Sync (6):** `strava-sync`, `fitbit-sync`, `hevy-sync`, `liftosaur-sync`, `garmin-webhook`, `process-sync-queue`
**Mobile (2):** `mobile-sync-push`, `mobile-sync-pull`
**Account (1):** `delete-account`
**Integrations (1):** `disconnect-integration`
**Analytics (1):** `generate-insights`

Shared utilities (not Edge Functions): `_shared/cors.ts`, `_shared/requireSubscription.ts`

---

## Phase Structure

```
Phase 0 --> Phase 1 --> Phase 2 --> Phase 3 --> Phase 4 -+
                                                          +--> Phase 6
                                                Phase 5 -+
```

- Phases 0->1->2->3->4 are **sequential** (each builds on the previous)
- Phases 4 and 5 can run in **parallel** (independent domains)
- Phase 6 requires both 4 and 5 complete

**Total: 7 phases, ~15-21 sessions, 9 unique agent specializations**

---

## Agent Roster (9 specialists)

| Agent | Phases Active | Primary Responsibility |
|-------|--------------|----------------------|
| Backend Architect | 1, 2, 3, 5, 6 | Schema, Edge Functions, data integrity, query performance |
| Security Engineer | 1, 2, 5 | Auth paths, RLS, CORS, token security, vulnerability remediation |
| API Tester | 1, 3, 5 | Webhook testing, sync contracts, provider flow verification |
| DevOps Automator | 0, 1, 6 | Dependencies, CI/CD, monitoring, alerting, runbook |
| Senior Developer | 0 | Baseline sweep, static analysis, documentation |
| Frontend Developer | 3, 4, 6 | Component tests, a11y, mobile verification, PWA |
| Code Reviewer | 2, 4 | Error sanitization, component decomposition, quality |
| Evidence Collector | 4 | Screenshot evidence for empty states, gates, mobile |
| Performance Benchmarker | 6 | Bundle analysis, Lighthouse, CWV, cold starts, load testing |

---

## Exit Criteria Classification

Exit criteria are tagged as either **BLOCKER** (must pass for launch) or **NON-BLOCKER** (should pass, but can launch with documented accepted risk and remediation timeline).

**Rule of thumb:**
- Security, data integrity, billing correctness, and auth = BLOCKER
- Performance targets, code quality metrics, and decomposition = NON-BLOCKER
- Test coverage minimum = BLOCKER (minimum threshold); stretch targets = NON-BLOCKER

---

## Phase 0: Baseline Sweep

**Purpose:** Establish clean, measured starting point for all subsequent phases.
**Agent Team:** DevOps Automator + Senior Developer
**Estimated sessions:** 1

### Tasks

| # | Task | Agent | Verification |
|---|------|-------|-------------|
| 0.1 | Dependency remediation — `npm audit`, fix all HIGH/CRITICAL. Pin resolutions where `--force` needed. Verify build passes. | DevOps Automator | `npm audit` returns 0 high/critical |
| 0.2 | Baseline test run — Full Vitest + Playwright. Record pass/fail counts, capture flaky tests. | Senior Developer | Test results documented with counts |
| 0.3 | Static analysis sweep — `npm run typecheck` + Biome. Catalogue all warnings/errors (document, don't fix). | Senior Developer | Warning inventory file created |
| 0.4 | Outdated dependency audit — `npm outdated`, flag packages >2 major versions behind. | DevOps Automator | Inventory with risk ratings |
| 0.5 | Environment parity check — Verify `.env.example` matches all `import.meta.env` and `Deno.env.get()` references across the codebase. | Senior Developer | Gap report produced |
| 0.6 | CLAUDE.md update — Update CLAUDE.md to reflect current state: 18 Edge Functions (not 13), Paddle billing (not Stripe), correct query/mutation hook counts, add Paddle env vars, add new Edge Functions to the inventory. This is critical because every subsequent agent session reads CLAUDE.md first. | Senior Developer | CLAUDE.md accurate and committed |
| 0.7 | Database migration health check — Verify all migrations apply cleanly, no pending migrations, no conflicts between Stripe-era and Paddle-era schema changes. | DevOps Automator | All migrations verified, no orphaned columns |

### Exit Criteria
- Clean build, test baseline documented — **BLOCKER**
- No HIGH npm vulnerabilities — **BLOCKER**
- Environment variable inventory complete — **BLOCKER**
- CLAUDE.md updated and accurate — **BLOCKER**
- Migration health confirmed — **BLOCKER**

---

## Phase 1: Paddle Billing E2E

**Purpose:** Verify the live Paddle billing pipeline is financially correct.
**Agent Team:** Backend Architect (lead) + Security Engineer + API Tester
**Estimated sessions:** 2-3

**Critical context:** Paddle is live with real money flowing but not completely tested. All testing MUST occur in sandbox mode.

### Tasks

| # | Task | Agent | Verification |
|---|------|-------|-------------|
| 1.0 | Sandbox mode activation — Document live credentials as backup. Switch Edge Functions + frontend + webhook verification to sandbox. All three layers must switch together (`PADDLE_ENVIRONMENT`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `VITE_PADDLE_CLIENT_TOKEN`, all price ID env vars). | Backend Architect + DevOps Automator | Sandbox test event received and processed; live credentials backed up |
| 1.1 | Schema migration audit — Verify Stripe->Paddle migration complete. Confirm `paddle-webhooks` upsert columns exist in actual DB schema. Check for orphaned Stripe columns (`stripe_customer_id`, `stripe_subscription_id`) causing silent failures. | Backend Architect | All upsert columns verified against actual schema |
| 1.2 | Webhook handler correctness — Review all 6 subscription event handlers (`subscription.created`, `subscription.updated`, `subscription.canceled`, `subscription.paused`, `subscription.resumed`, `subscription.past_due`). Verify each maps correctly to subscription state + tier. | Backend Architect | Truth table: event -> expected DB state -> expected UI state |
| 1.3 | Idempotency verification — Confirm `last_event_id` prevents duplicate processing. Test replay and out-of-order event scenarios (e.g., `updated` arrives before `created`). | API Tester | Tests passing for replay + out-of-order |
| 1.4 | Price ID -> tier mapping — Fix CSV split without `.trim()`. Verify all 6 price ID env vars (EMBER/FLAME/INFERNO x monthly/annual) resolve correctly. Test whitespace edge case. | Backend Architect | Fix applied + whitespace edge case test passing |
| 1.5 | Webhook signature verification — Confirm HMAC-SHA256 timing-safe comparison. Verify raw body read before JSON parse. Test malformed/missing signatures. | Security Engineer | Invalid/missing sig returns 401 |
| 1.6 | Subscription tier gating audit — Trace full path: `paddle-webhooks` -> subscriptions table -> `requireSubscription()` -> `SubscriptionGate` component -> UI. Verify no stale cache scenarios where UI shows wrong tier. | Backend Architect | End-to-end trace documented, cache invalidation verified |
| 1.7 | Upgrade/downgrade flow — Review `paddle-update-subscription`. Verify proration logic, immediate tier change, no state where user has old tier after paying for new. | API Tester | Tests for EMBER->FLAME, FLAME->EMBER, same-tier period change |
| 1.8 | Cancellation flow — Review `paddle-cancel-subscription`. Verify cancel-at-period-end behavior, grace period access, eventual revert to FREE. | API Tester | Cancel -> access until period end -> FREE revert |
| 1.9 | Paddle CORS cleanup — Remove `Access-Control-Allow-Origin: "*"` from webhook endpoint. Webhooks are server-to-server and don't need CORS. | Security Engineer | CORS wildcard removed |
| 1.10 | Error recovery — Review error paths in webhook handler. What happens if handler throws mid-processing? Add transaction safety where needed. Verify Paddle retry behavior on 500 responses. | Backend Architect | Error paths documented, transactions added |
| 1.11 | Billing incident response plan — Document: what to do if a webhook misbehaves post-launch with real money. Include: how to identify affected users, how to manually fix subscription state, how to issue Paddle refunds, how to reconcile portal state with Paddle dashboard. | Backend Architect | Billing incident runbook written and committed |
| 1.12 | Restore live mode — Restore live Paddle credentials. Verify webhook connectivity with Paddle health check (no real transaction). Document sandbox<->live switching procedure. | DevOps Automator | Live restored, switching runbook written |

### Exit Criteria
- All 6 event types have documented behavior + test coverage — **BLOCKER**
- Schema confirmed consistent (no orphaned Stripe columns) — **BLOCKER**
- Price ID parsing resilient to whitespace — **BLOCKER**
- Idempotency proven with replay tests — **BLOCKER**
- Upgrade/downgrade/cancel flows verified E2E — **BLOCKER**
- No financial data loss scenarios — **BLOCKER**
- Billing incident response plan committed — **BLOCKER**

---

## Phase 2: Security Audit + Dependency Remediation

**Purpose:** Harden to production-grade security for a public-facing, billing-enabled application.
**Agent Team:** Security Engineer (lead) + Backend Architect + Code Reviewer
**Estimated sessions:** 3-4

### Edge Function Auth Audit Checklist

All 18 functions must be verified in task 2.2:
- [ ] `paddle-webhooks` (JWT disabled by design — uses HMAC signature instead)
- [ ] `paddle-cancel-subscription` (JWT required)
- [ ] `paddle-update-subscription` (JWT required)
- [ ] `initiate-oauth` (JWT required)
- [ ] `strava-oauth` (callback — state token validation, no JWT)
- [ ] `fitbit-oauth` (callback — state token validation, no JWT)
- [ ] `garmin-oauth` (callback — state token validation, no JWT)
- [ ] `strava-sync` (JWT required)
- [ ] `fitbit-sync` (JWT required)
- [ ] `hevy-sync` (JWT required)
- [ ] `liftosaur-sync` (JWT required)
- [ ] `garmin-webhook` (webhook — signature verification, no JWT)
- [ ] `process-sync-queue` (scheduled/internal — verify invocation auth)
- [ ] `mobile-sync-push` (JWT required)
- [ ] `mobile-sync-pull` (JWT required)
- [ ] `delete-account` (JWT required)
- [ ] `disconnect-integration` (JWT required)
- [ ] `generate-insights` (JWT required)

### Tasks

| # | Task | Agent | Verification |
|---|------|-------|-------------|
| 2.1 | RLS policy comprehensive audit — Every table: RLS enabled, policies for CRUD, `(select auth.uid())` pattern for performance, premium-feature tables (analytics, biomechanics) tier-gated at DB level, not just client-side. | Security Engineer | Matrix: table x operation = policy or documented exception |
| 2.2 | Edge Function auth audit — All 18 functions per checklist above: JWT validated (except webhooks/callbacks), user ID from token not request body, service_role never exposed, proper 401/403 codes. | Security Engineer | Every function checked off with auth path documented |
| 2.3 | CORS hardening — Fix empty-string Allow-Origin in `_shared/cors.ts` (return 403 on disallowed origins). Remove localhost from allowed origins when `ENVIRONMENT=production`. Verify `Vary: Origin` on all responses. | Backend Architect | Unknown origins rejected with 403, localhost blocked in prod |
| 2.4 | CSP tightening — Investigate nonce-based CSP to replace `unsafe-inline` in script-src (required by Paddle.js). If not feasible, document accepted risk with justification. | Security Engineer | CSP tightened or accepted-risk documented with justification |
| 2.5 | Input validation sweep — All 18 Edge Functions: body size limits, type validation, SQL injection check, malformed JSON handling. **Priority:** add payload size limits to `mobile-sync-push` (currently unlimited). | Security Engineer | Payload limits added, all inputs validated |
| 2.6 | Server-side rate limiting — Implement using Supabase-native approach: `rate_limit_tracking` table with sliding window checks in Edge Function middleware (extends existing pattern in `process-sync-queue`). If Supabase-native is insufficient for auth endpoints, document the gap and recommend Cloudflare rate limiting rules as follow-up. Must cover: auth attempts, sync triggers, community actions (comments, votes, reports). | Backend Architect | Rate limiting active on auth, sync triggers, community actions |
| 2.7 | Error message sanitization — Audit all `toast.error(error.message)` calls in `/src/mutations/`. Replace raw Supabase/Paddle error messages with user-friendly messages. Ensure no stack traces or internal details reach browser in production. | Code Reviewer | No mutation exposes raw backend error text |
| 2.8 | OAuth token security review — Verify: `oauth_tokens` table has no RLS (service-role only), tokens never in API responses to client, refresh handles revocation gracefully, Garmin never-expiring OAuth 1.0a tokens have validation-before-use strategy. | Security Engineer | Token isolation confirmed, Garmin strategy implemented |
| 2.9 | Delete-account hardening — Add transaction safety to deletion cascade in `delete-account` Edge Function. If storage cleanup or community anonymization fails mid-way, no partial-delete state. Implement saga pattern or atomic transaction. | Backend Architect | Simulated mid-cascade failure produces no partial states |
| 2.10 | Sensitive data exposure scan — Verify: no secrets in git history (scan with trufflehog or similar), `.env` in `.gitignore`, Sentry doesn't capture PII, `console.log`/`console.error` calls don't leak tokens in production, source maps not publicly accessible. | Security Engineer | Clean scan |
| 2.11 | Cookie & localStorage audit — Verify nothing sensitive stored client-side. Sidebar cookie has appropriate flags. `blockedUserIds` in localStorage can't be manipulated to bypass content safety (server-side enforcement exists). | Security Engineer | All client storage documented |
| 2.12 | npm vulnerability resolution — Fix remaining HIGH/CRITICAL from Phase 0 that required `--force`. Test for breaking changes, especially `vite-plugin-pwa`. Pin safe resolutions in `package.json` overrides if needed. | Backend Architect | `npm audit` clean, build + tests pass |
| 2.13 | GDPR compliance verification — Verify `src/lib/export/data-export.ts`: (a) all user data tables included in export, (b) sensitive fields (tokens, billing IDs) properly excluded, (c) export handles large datasets without timeout, (d) export format is machine-readable (JSON). Also verify cookie consent flow in `src/lib/consent.ts` is GDPR-compliant (explicit opt-in, not pre-checked). | Security Engineer | Export includes all user data, excludes sensitive fields, consent flow is opt-in |
| 2.14 | Public page content verification — Verify `/privacy`, `/terms`, and `/faq` pages: (a) contain real content (not placeholder), (b) privacy policy covers data collection, Paddle billing, Supabase storage, Sentry monitoring, (c) terms reference subscription billing and cancellation rights. | Code Reviewer | All public pages have real, relevant content |

### Exit Criteria
- Every table has documented RLS coverage — **BLOCKER**
- All 18 Edge Function auth paths verified — **BLOCKER**
- CORS rejects unknown origins, no localhost in prod — **BLOCKER**
- Server-side rate limiting active on public endpoints — **BLOCKER**
- No raw error messages exposed to users — **BLOCKER**
- Delete-account is atomic (no partial states) — **BLOCKER**
- `npm audit` clean — **BLOCKER**
- GDPR export verified correct — **BLOCKER**
- Cookie consent is opt-in — **BLOCKER**
- Privacy/terms pages have real content — **BLOCKER**
- CSP tightened or accepted-risk documented — **NON-BLOCKER** (current CSP is functional, `unsafe-inline` is a hardening opportunity)
- Security findings document with accepted-risk justifications — **BLOCKER**

---

## Phase 3: Mobile Sync Pipeline Validation

**Purpose:** Verify the contract between Portal and mobile app. Core value proposition — workout data from mobile -> Supabase -> portal in real-time.
**Agent Team:** Backend Architect (lead) + API Tester + Frontend Developer
**Estimated sessions:** 2-3

**Context:** Mobile app repo at `github.com/9thLevelSoftware/Project-Phoenix-MP` (branch: MVP)

### Tasks

| # | Task | Agent | Verification |
|---|------|-------|-------------|
| 3.1 | Schema contract analysis — Compare Supabase table schemas (from migrations) against: (a) what `mobile-sync-push` expects to receive, (b) what `mobile-sync-pull` sends back, (c) what portal Zod schemas in `src/schemas/transforms.ts` expect to parse. Identify type mismatches, nullable vs required conflicts, missing fields. | Backend Architect | Contract matrix: field x mobile write x portal read = match or gap |
| 3.2 | Mobile app sync client review — Review MVP branch of Project Phoenix MP: (a) payload shapes, (b) field names and data types, (c) how it calls mobile-sync-push/pull, (d) sync triggers (manual vs automatic). | API Tester | Mobile payloads documented, compared to Edge Function expectations |
| 3.3 | mobile-sync-push stress testing — Test: (a) large first-sync (months of history), (b) 10s Edge Function timeout, (c) interrupted writes. Add payload size validation + pagination strategy for large syncs. | Backend Architect | Size limits added, timeout tested, partial-write recovery |
| 3.4 | mobile-sync-pull delta logic — Verify `since` timestamp: (a) no data missed between syncs, (b) timezone consistency (UTC everywhere?), (c) deleted records communicated back to mobile, (d) concurrent edits from both sides don't conflict. | Backend Architect | Delta sync tested, timezone handling verified |
| 3.5 | Realtime broadcast verification — Full flow: mobile writes to DB -> Broadcast on `sync:{userId}` -> portal `useRealtimeSync` -> TanStack Query cache invalidation -> UI re-render. Verify: tier gating (EMBER+ only), reconnection after interruption, no stale data. | Frontend Developer | E2E flow traced, reconnection tested |
| 3.6 | Offline/retry resilience — Test: (a) mobile pushes but portal offline, (b) push fails mid-flight, (c) pull returns partial. Verify graceful degradation in each case. | API Tester | Each failure scenario tested |
| 3.7 | Data integrity validation — For `workout_sessions` -> `session_exercises` -> `exercise_sets` -> `rep_summaries`: (a) FK enforcement, (b) cascade deletes correct, (c) orphans impossible via push endpoint, (d) portal query joins match FK relationships. | Backend Architect | FK integrity verified, orphans impossible |
| 3.8 | Sync queue processor review — Review `process-sync-queue`: (a) rate limits per provider, (b) exponential backoff on failures, (c) max retry limit (permanently-failed tasks stop retrying), (d) queue isolation (one provider's failures don't block another). | Backend Architect | All mechanisms verified |

### Exit Criteria
- Schema contract documented with no unresolved mismatches — **BLOCKER**
  - **If mismatches require mobile app changes:** Document the mismatch, create a tracked issue in the mobile repo, and implement a portal-side workaround (defensive parsing with fallback defaults) to avoid blocking launch. The portal must be resilient to the current mobile payload shape.
- Payload size limits enforced on mobile-sync-push — **BLOCKER**
- Delta sync gap-free — **BLOCKER**
- Realtime broadcast works E2E with cache invalidation — **BLOCKER**
- Failure scenarios handled gracefully — **BLOCKER**
- Data integrity verified across workout hierarchy — **BLOCKER**

---

## Phase 4: Frontend Stability + Test Coverage

**Purpose:** Bring user-facing layer to production quality. Close the gap between "well-structured" (A- architecture) and "verified correct" (11% test coverage).
**Agent Team:** Frontend Developer (lead) + Code Reviewer + Evidence Collector
**Estimated sessions:** 3-4

**Can run in parallel with Phase 5.**

### Tasks

| # | Task | Agent | Verification |
|---|------|-------|-------------|
| 4.1 | Critical component tests — RoutineBuilder, CycleBuilder, SessionReplay, Billing/Subscription UI. Happy path, empty states, validation errors, loading states. | Frontend Developer | Tests passing for all 4 component families |
| 4.2 | Mutation hook tests — At least 6/10 mutation hooks: subscription changes, routine CRUD, cycle CRUD, community actions (comments, votes, reports). Verify optimistic updates and rollback on failure. | Frontend Developer | 6+ mutation hooks tested |
| 4.3 | Query hook tests — At least 8/18 query hooks: workouts, analytics, subscriptions, integrations, routines, cycles, records, community. Loading/error/empty states, cache key correctness. | Frontend Developer | 8+ query hooks tested |
| 4.4 | Empty state audit — Every data-driven page (Dashboard, Analytics, WorkoutHistory, PersonalRecords, Routines, Cycles, Community, Challenges) with zero data. Meaningful empty state or CTA? Crashes? This is the day-one new user experience. | Evidence Collector | Screenshot evidence of every empty state, crashes fixed, CTAs added |
| 4.5 | Error boundary verification — Test: (a) component throw during render, (b) async error in useEffect, (c) mutation rejection. Each produces user-recoverable state (not blank screen). | Frontend Developer | Each error type tested, recovery confirmed |
| 4.6 | SubscriptionGate UX audit — Every gate instance: free users see teasers (not blank), upgrade CTA links to correct Paddle checkout, tier names consistent (EMBER/FLAME/INFERNO), no premium content leaks to wrong tier. | Evidence Collector | Every gate verified with per-tier screenshots |
| 4.7 | Large component decomposition — **Analytics.tsx** (2,048 lines): extract chart subcomponents into `src/app/components/analytics/`. **CycleBuilder.tsx** (1,456 lines) and **RoutineBuilder.tsx** (1,416 lines): extract logical subcomponents if it improves testability. | Code Reviewer + Frontend Developer | Analytics.tsx <800 lines; CycleBuilder and RoutineBuilder each assessed with extraction applied if >1,200 lines post-assessment; no behavioral regression in any |
| 4.8 | Accessibility hardening — (a) Verify Radix Dialog focus trapping, (b) add `aria-describedby` to form validation messages, (c) verify toast notifications have `role="status"`, (d) run axe-core on top 5 pages and fix all critical/serious violations. | Frontend Developer | axe-core: 0 critical/serious on Dashboard, Analytics, Routines, Community, Profile |
| 4.9 | Mobile responsiveness verification — Add mobile viewport (375px) tests: (a) MobileBottomNav renders correctly, (b) Dashboard mobile variant, (c) RoutineBuilder usable on mobile, (d) Paddle checkout overlay on small screens, (e) Community feed readable. | Evidence Collector | Mobile screenshots for 5 critical flows, all pass |
| 4.10 | Deprecated API cleanup — Fix Recharts `Cell` deprecation in Analytics.tsx. Scan full codebase for other deprecated API usage. | Code Reviewer | Zero deprecation warnings in build output |
| 4.11 | E2E critical path expansion — New E2E tests: (a) routine creation -> save -> verify in list, (b) cycle creation -> save -> verify, (c) subscription gate behavior (free vs paid), (d) session detail view with data. | Frontend Developer | 4 new E2E tests passing |

### Exit Criteria
- Statement coverage >= 40% on files in `src/mutations/`, `src/queries/`, and the 4 critical component families (RoutineBuilder, CycleBuilder, SessionReplay, Billing) — **BLOCKER**
- All empty states verified and improved — **BLOCKER**
- Error boundaries confirmed working — **BLOCKER**
- Subscription gates verified per tier with evidence — **BLOCKER**
- Analytics.tsx decomposed to <800 lines — **NON-BLOCKER** (quality improvement, not correctness)
- CycleBuilder/RoutineBuilder assessed and extracted if warranted — **NON-BLOCKER**
- axe-core clean on top 5 pages — **BLOCKER** (accessibility is a legal/compliance concern)
- Mobile verified on critical flows — **BLOCKER**
- 4+ new E2E tests passing — **BLOCKER**

---

## Phase 5: Third-Party Integration Readiness

**Purpose:** Verify code-complete but unconnected integrations (Strava, Fitbit, Garmin, Hevy, Liftosaur) for correctness, security, and resilience before provider setup.
**Agent Team:** Backend Architect (lead) + API Tester + Security Engineer
**Estimated sessions:** 2-3

**Can run in parallel with Phase 4.**

### Tasks

| # | Task | Agent | Verification |
|---|------|-------|-------------|
| 5.1 | OAuth flow — Strava — Full trace: `initiate-oauth` -> Strava authorize -> `strava-oauth` callback -> token storage in `oauth_tokens` -> `strava-sync` data fetch. Verify: CSRF state validated + single-use, correct grant_type, minimal scopes (read-only). | Backend Architect | Flow documented end-to-end, validation confirmed |
| 5.2 | OAuth flow — Fitbit — Same trace as 5.1. Additional: Fitbit uses Basic auth (`Authorization: Basic base64(client_id:client_secret)`) for token exchange. Verify header construction. | Backend Architect | Basic auth verified, flow documented |
| 5.3 | OAuth 1.0a — Garmin — Three-legged HMAC-SHA1 flow. Verify: (a) request token -> authorize -> access token handshake, (b) HMAC-SHA1 signature generation, (c) nonce uniqueness, (d) temporary request token storage in `oauth_tokens`, (e) never-expiring tokens — strategy for detecting external revocation. | Backend Architect + Security Engineer | Signature verified, revocation strategy documented |
| 5.4 | Non-OAuth — Hevy & Liftosaur — Hevy: API key auth, PRO required. Liftosaur: Bearer token, Liftoscript format parsing. Verify: (a) keys stored securely in `oauth_tokens` (server-only), (b) correct auth headers, (c) `liftosaur-sync` handles malformed Liftoscript gracefully. | Backend Architect + API Tester | Auth verified, malformed data handled gracefully |
| 5.5 | Token refresh resilience — Strava/Fitbit: (a) expired token triggers refresh before sync, (b) refresh failure marks `token_expired` in UI, (c) concurrent syncs don't double-refresh (race condition), (d) refresh token rotation handled (new refresh token stored). | Backend Architect | Each scenario tested, race analysis documented |
| 5.6 | Sync data normalization — Each provider returns different shapes. Verify `external_activities` receives consistent data from: Strava (JSON), Fitbit (JSON), Hevy (JSON), Liftosaur (Liftoscript). Check: timezone parsing, exercise name mapping, unit conversion. | API Tester | Normalization mapping documented per provider |
| 5.7 | Rate limit accuracy — Current limits: Strava 80/15min, Fitbit 120/60min, Garmin 40/60min, Hevy 40/60min. Verify against current provider API documentation (limits change). Add Strava burst limit (10/min micro-limit within 100/15min macro-limit). | API Tester | Limits match current docs, burst limits added |
| 5.8 | Disconnect/revoke cleanup — Review `disconnect-integration` Edge Function: (a) tokens deleted from `oauth_tokens`, (b) provider revoke endpoint called if available, (c) pending sync tasks canceled, (d) `user_integrations` updated, (e) no orphaned `external_activities`. | Security Engineer | Disconnect clean, no orphaned data |
| 5.9 | Garmin webhook readiness — Review `garmin-webhook` Edge Function (approval pending): (a) webhook signature verification, (b) payload parsing, (c) duplicate event handling, (d) pre-approval behavior (return 200 but no-op? or 404?). | Backend Architect | Handler reviewed, pre-approval behavior documented |
| 5.10 | Integration UI review — Frontend integration management: connect/disconnect, status indicators, error states, sync history. Verify per provider: correct status (connected/disconnected/error/syncing), disconnect confirmation, user-friendly sync errors. | API Tester | UI states verified: 5 providers x all statuses |

### Exit Criteria
- All 5 auth flows documented and verified — **BLOCKER**
- Token refresh handles all edge cases — **BLOCKER**
- Rate limits match current provider documentation — **NON-BLOCKER** (integrations not live yet; verify before each provider goes live)
- Disconnect cleanly removes all traces — **BLOCKER**
- Garmin webhook ready for approval process — **NON-BLOCKER** (approval pending, not launch-blocking)
- Integration UI correct for every scenario — **BLOCKER**
- Dormant endpoints not exploitable — **BLOCKER**

---

## Phase 6: Performance + Operational Readiness

**Purpose:** Final gate. Verify it works well under load and you have tooling to monitor, debug, and respond post-launch.
**Agent Team:** Performance Benchmarker (lead) + DevOps Automator + Frontend Developer
**Estimated sessions:** 2-3

**Requires Phases 4 and 5 complete.**

### Tasks

| # | Task | Agent | Verification |
|---|------|-------|-------------|
| 6.1 | Bundle size analysis — `ANALYZE=true npm run build` with rollup-visualizer. Document total bundle size, per-chunk sizes. Target: initial load <300KB gzipped. If exceeded, identify optimization opportunities and implement if straightforward. | Performance Benchmarker | Report generated; if >300KB, optimizations applied or documented with justification |
| 6.2 | Lighthouse audit — 5 pages: Landing, Dashboard, Analytics, Routines, Community. Targets: Perf >= 85, A11y >= 90, BP >= 90, SEO >= 80. Fix critical findings. If targets not met, document specific remediation plan with timeline. | Performance Benchmarker | Reports for all 5 pages; scores meet targets or remediation plan committed |
| 6.3 | Core Web Vitals — LCP, INP, CLS on Dashboard (authenticated) + Landing (unauthenticated). All "Good" per Google thresholds. | Performance Benchmarker | CWV documented, all Good or remediation plan |
| 6.4 | Edge Function cold start profiling — Critical functions: `paddle-webhooks`, `mobile-sync-push`, `mobile-sync-pull`, `process-sync-queue`. Target: <3s cold start. If exceeded, investigate import optimization. | Performance Benchmarker | Cold/warm latency documented per function |
| 6.5 | Database query performance — Identify top 10 most frequent queries (dashboard load, workout list, analytics). Verify: (a) appropriate indexes exist, (b) no N+1 patterns in TanStack Query hooks, (c) RLS overhead acceptable, (d) large tables use pagination. | Backend Architect | Top 10 queries profiled, missing indexes added |
| 6.6 | PWA and offline behavior — Verify: (a) service worker installs, (b) cached pages work offline, (c) online/offline transitions graceful, (d) cache busting on new deploys (no stale app). | Frontend Developer | PWA tested, cache busting confirmed |
| 6.7 | Sentry monitoring verification — Verify: (a) error capture works after cookie consent, (b) source maps upload correctly, (c) source maps deleted after upload (not public), (d) 10% sample rate appropriate for expected traffic, (e) React 19 handlers wired (`onUncaughtError`, `onCaughtError`, `onRecoverableError`). | DevOps Automator | Test error visible in Sentry with source maps |
| 6.8 | Alerting and observability — Evaluate and implement minimum viable alerting for: (a) Paddle webhook failures, (b) sync queue stuck/failed tasks, (c) Edge Function error rate spikes, (d) auth failure spikes. | DevOps Automator | Alerting active for webhooks, sync queue, Edge Function errors |
| 6.9 | Light load testing — Simulate: (a) 50 concurrent Dashboard loads, (b) 10 concurrent mobile sync pushes, (c) 5 concurrent Paddle webhook events. Verify no cascading failures, connection pool exhaustion, or timeout spikes. | Performance Benchmarker | Load test passes at expected beta scale |
| 6.10 | Build & deploy pipeline — Full CI end-to-end: all 5 jobs pass, production build with real env vars, Cloudflare Pages deploy, Edge Function deploy, rollback procedure tested. | DevOps Automator | Full CI green, deploy successful, rollback tested |
| 6.11 | Operational runbook — Produce concise runbook: (a) Paddle sandbox<->live switching, (b) failed webhook debugging, (c) stuck sync queue investigation, (d) subscription state force-refresh, (e) deployment rollback, (f) manual GDPR deletion if Edge Function fails, (g) billing incident response (cross-ref Phase 1 runbook). | DevOps Automator | Runbook committed to repo |

### Exit Criteria
- Bundle size documented — **NON-BLOCKER** (optimization, not correctness)
- Lighthouse scores meet targets or remediation planned — **NON-BLOCKER**
- CWV in "Good" range — **NON-BLOCKER**
- Edge Function cold starts <3s for critical functions — **BLOCKER** (>3s means webhook timeouts)
- Database queries profiled with indexes — **BLOCKER**
- PWA verified — **NON-BLOCKER**
- Sentry confirmed working with source maps — **BLOCKER** (need observability at launch)
- Minimum viable alerting active — **BLOCKER**
- Load test passes at beta scale — **BLOCKER**
- CI/CD fully verified, rollback tested — **BLOCKER**
- Operational runbook committed — **BLOCKER**

---

## Final Deliverables

1. **Phase reports** — Each phase produces findings: issues found, fixes applied, accepted risks
2. **Go/No-Go checklist** — Binary launch-blocking criteria across all phases (all BLOCKER items)
3. **Operational runbook** — From Phase 6, committed to repo
4. **Billing incident runbook** — From Phase 1, committed to repo
5. **Test coverage report** — Before/after metrics (Phase 0 baseline vs Phase 4 completion)
6. **Security findings document** — From Phase 2, with accepted-risk justifications

---

## Launch Decision

After all 7 phases complete:
- If all **BLOCKER** exit criteria pass -> **green light for beta launch**
- **NON-BLOCKER** items that don't pass are documented with remediation timeline in the Go/No-Go checklist
- If any **BLOCKER** remains unresolved -> documented with remediation plan and estimated effort before re-evaluation
- Accepted risks documented with justification and monitoring strategy
