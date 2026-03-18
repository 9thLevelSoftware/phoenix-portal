# Beta Readiness Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit and harden Phoenix Portal for production-grade soft launch — verify billing, security, sync, frontend stability, integrations, and operational readiness.

**Architecture:** 7-phase risk-ordered review. Each phase follows an investigate-document-fix-verify pattern. Phases 0-3 are sequential; 4 and 5 run in parallel; Phase 6 gates on both.

**Tech Stack:** React 19, TypeScript, Vite 7, Supabase (PostgreSQL + Edge Functions + Auth), Paddle billing, TanStack Query, Zustand, Vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-03-18-beta-readiness-review-design.md`

### Plan Structure Note

This plan has two levels of detail:

- **Phases 0-2** (highest risk: baseline, billing, security) are fully expanded with step-by-step instructions, exact line numbers, bash commands, and expected outputs. An agent with zero codebase knowledge can execute them directly.
- **Phases 3-6** (lower risk: sync, frontend, integrations, performance) provide file paths, key commands, and task summaries. **Agents dispatched to these tasks MUST read both this plan AND the spec** (`docs/superpowers/specs/2026-03-18-beta-readiness-review-design.md`) for full task descriptions, verification criteria, and BLOCKER/NON-BLOCKER classification.

This is intentional: the highest-risk phases get the most prescriptive guidance, while later phases allow agents to apply judgment within the well-defined task scope. Every task in every phase has exact file paths and a clear deliverable regardless of detail level.

**When dispatching agents to Phase 3-6 tasks**, include this in the prompt:
> "Read the full task description in the spec at `docs/superpowers/specs/2026-03-18-beta-readiness-review-design.md` (Phase N, Task N.N) for verification criteria and BLOCKER classification. Follow the investigate-document-fix-verify pattern used in earlier phases."

---

## File Map — Key Files Per Phase

### Phase 0 (Baseline)
- Modify: `package.json` (dependency fixes)
- Modify: `CLAUDE.md` (accuracy update)
- Create: `docs/review/phase-0-baseline-report.md`

### Phase 1 (Billing)
- Modify: `supabase/functions/paddle-webhooks/index.ts` (CORS, trim, transactions)
- Modify: `supabase/functions/paddle-cancel-subscription/index.ts` (review)
- Modify: `supabase/functions/paddle-update-subscription/index.ts` (review)
- Review: `supabase/migrations/00001_create_subscriptions.sql`
- Review: `supabase/migrations/20260317_paddle_schema_fix.sql`
- Review: `supabase/functions/_shared/requireSubscription.ts`
- Review: `src/app/components/SubscriptionGate.tsx`
- Review: `src/hooks/useSubscription.ts`
- Review: `src/lib/pricing.ts`
- Create: `docs/review/phase-1-billing-truth-table.md`
- Create: `docs/runbooks/billing-incident-response.md`
- Create: `docs/runbooks/paddle-sandbox-switching.md`

### Phase 2 (Security)
- Modify: `supabase/functions/_shared/cors.ts` (403 on unknown origins)
- Modify: `supabase/functions/delete-account/index.ts` (transaction safety)
- Modify: `src/mutations/*.ts` (error message sanitization — 10 files)
- Review: `supabase/migrations/*.sql` (all 27 migration files for RLS)
- Review: `public/_headers` (CSP)
- Review: `src/lib/export/data-export.ts` (GDPR)
- Review: `src/lib/consent.ts` (cookie consent)
- Create: `docs/review/phase-2-rls-matrix.md`
- Create: `docs/review/phase-2-auth-audit.md`
- Create: `docs/review/phase-2-security-findings.md`

### Phase 3 (Mobile Sync)
- Modify: `supabase/functions/mobile-sync-push/index.ts` (payload limits)
- Review: `supabase/functions/mobile-sync-pull/index.ts`
- Review: `supabase/functions/process-sync-queue/index.ts`
- Review: `src/hooks/useRealtimeSync.ts`
- Review: `src/schemas/transforms.ts`
- Create: `docs/review/phase-3-sync-contract.md`

### Phase 4 (Frontend)
- Modify: `src/app/components/Analytics.tsx` (decompose)
- Create: `src/app/components/analytics/*.tsx` (extracted charts)
- Create: `src/mutations/__tests__/*.test.ts` (6+ files)
- Create: `src/queries/__tests__/*.test.ts` (8+ files)
- Create: `src/app/components/__tests__/RoutineBuilder.test.tsx`
- Create: `src/app/components/__tests__/CycleBuilder.test.tsx`
- Create: `src/app/components/__tests__/SessionReplay.test.tsx`
- Create: `e2e/routine-creation.spec.ts`
- Create: `e2e/cycle-creation.spec.ts`
- Create: `e2e/subscription-gates.spec.ts`
- Create: `e2e/session-detail.spec.ts`

### Phase 5 (Integrations)
- Review: `supabase/functions/initiate-oauth/index.ts`
- Review: `supabase/functions/strava-oauth/index.ts`
- Review: `supabase/functions/fitbit-oauth/index.ts`
- Review: `supabase/functions/garmin-oauth/index.ts`
- Review: `supabase/functions/strava-sync/index.ts`
- Review: `supabase/functions/fitbit-sync/index.ts`
- Review: `supabase/functions/hevy-sync/index.ts`
- Review: `supabase/functions/liftosaur-sync/index.ts`
- Review: `supabase/functions/garmin-webhook/index.ts`
- Review: `supabase/functions/disconnect-integration/index.ts`
- Create: `docs/review/phase-5-integration-flows.md`

### Phase 6 (Performance + Ops)
- Create: `docs/review/phase-6-bundle-report.md`
- Create: `docs/review/phase-6-lighthouse-report.md`
- Create: `docs/runbooks/operations.md`
- Create: `docs/review/go-no-go-checklist.md`

---

## Phase 0: Baseline Sweep

**Agent team:** DevOps Automator + Senior Developer
**Entry requirement:** None (first phase)
**Estimated time:** 1 session

---

### Task 0.1: Dependency Remediation

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Run npm audit and document current state**

```bash
npm audit 2>&1 | tee docs/review/npm-audit-before.txt
```

Expected: Multiple HIGH/CRITICAL vulnerabilities listed.

- [ ] **Step 2: Attempt safe fixes first**

```bash
npm audit fix
```

- [ ] **Step 3: Check remaining vulnerabilities**

```bash
npm audit --audit-level=high
```

If HIGH/CRITICAL remain, attempt force fix on specific packages:

```bash
npm audit fix --force --dry-run
```

Review what `--force` would change. If it breaks `vite-plugin-pwa`, add overrides to `package.json` instead:

```json
"overrides": {
  "minimatch": ">=9.0.0",
  "rollup": ">=4.30.0"
}
```

- [ ] **Step 4: Verify build still works**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Verify tests still pass**

```bash
npm test
```

Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "fix: resolve HIGH/CRITICAL npm audit vulnerabilities"
```

---

### Task 0.2: Baseline Test Run

**Files:**
- Create: `docs/review/phase-0-baseline-report.md`

- [ ] **Step 1: Run full Vitest suite and capture output**

```bash
npm test -- --reporter=verbose 2>&1 | tee docs/review/vitest-baseline.txt
```

Record: total tests, passed, failed, skipped.

- [ ] **Step 2: Run Playwright E2E suite and capture output**

```bash
npx playwright test --reporter=list 2>&1 | tee docs/review/playwright-baseline.txt
```

Record: total tests, passed, failed, flaky (retried and passed).

- [ ] **Step 3: Document baseline in report**

Create `docs/review/phase-0-baseline-report.md` with:
- Date, git commit hash
- Vitest: X passed, Y failed, Z skipped
- Playwright: X passed, Y failed, Z flaky
- List any consistently failing tests with file paths

---

### Task 0.3: Static Analysis Sweep

- [ ] **Step 1: Run TypeScript type checking**

```bash
npm run typecheck 2>&1 | tee docs/review/typecheck-baseline.txt
```

Record total errors and warnings count.

- [ ] **Step 2: Run Biome lint check**

```bash
npx @biomejs/biome check . 2>&1 | tee docs/review/biome-baseline.txt
```

Record total warnings/errors by category.

- [ ] **Step 3: Append results to baseline report**

Add static analysis section to `docs/review/phase-0-baseline-report.md`.

---

### Task 0.4: Outdated Dependency Audit

- [ ] **Step 1: Generate outdated report**

```bash
npm outdated --long 2>&1 | tee docs/review/npm-outdated.txt
```

- [ ] **Step 2: Flag critical outdated packages**

In the baseline report, flag any package >2 major versions behind or with known deprecation notices. Rate as HIGH (security/breaking), MEDIUM (feature gaps), LOW (cosmetic).

---

### Task 0.5: Environment Parity Check

- [ ] **Step 1: Extract all env var references from frontend**

```bash
grep -r "import.meta.env" src/ --include="*.ts" --include="*.tsx" -h | grep -oP 'VITE_\w+' | sort -u
```

- [ ] **Step 2: Extract all env var references from Edge Functions**

```bash
grep -r "Deno.env.get" supabase/functions/ --include="*.ts" -h | grep -oP '"[A-Z_]+"' | sort -u
```

- [ ] **Step 3: Compare against .env.example**

Read `.env.example` and compare. Document any env vars referenced in code but missing from `.env.example`.

- [ ] **Step 4: Append gap report to baseline**

---

### Task 0.6: CLAUDE.md Update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Read current CLAUDE.md**

Identify all inaccuracies:
- "13 Edge Functions" -> should be 18
- Stripe references -> should be Paddle
- Query hook count -> should be 19 hook files + keys.ts
- Mutation hook count -> should be 10 files
- Missing Edge Functions from inventory (generate-insights, liftosaur-sync, mobile-sync-push, mobile-sync-pull, paddle-cancel-subscription, paddle-update-subscription, disconnect-integration)

- [ ] **Step 2: Update Edge Function section**

Replace the Edge Functions list with the accurate 18-function inventory grouped by category:
- Billing (3): paddle-webhooks, paddle-cancel-subscription, paddle-update-subscription
- OAuth (4): initiate-oauth, strava-oauth, fitbit-oauth, garmin-oauth
- Sync (6): strava-sync, fitbit-sync, hevy-sync, liftosaur-sync, garmin-webhook, process-sync-queue
- Mobile (2): mobile-sync-push, mobile-sync-pull
- Account (1): delete-account
- Integrations (1): disconnect-integration
- Analytics (1): generate-insights

- [ ] **Step 3: Update billing references**

Replace all Stripe references with Paddle. Update environment variables section to include Paddle vars.

- [ ] **Step 4: Update hook counts**

Correct TanStack Query hook count (19 query hook files + keys.ts, 10 mutation hook files).

- [ ] **Step 5: Verify and commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for accuracy — 18 Edge Functions, Paddle billing"
```

---

### Task 0.7: Database Migration Health Check

- [ ] **Step 1: List all migrations in order**

```bash
ls -1 supabase/migrations/*.sql
```

Verify 27 migration files, ordered by date prefix.

- [ ] **Step 2: Check for Stripe->Paddle schema consistency**

Read `supabase/migrations/00001_create_subscriptions.sql` (original schema) and `supabase/migrations/20260317_paddle_schema_fix.sql` (Paddle migration). Verify:
- `paddle_customer_id`, `paddle_subscription_id`, `price_id` columns added
- Legacy `revenuecat_customer_id`, `product_id`, `entitlement_ids`, `store` columns dropped
- Check if `stripe_customer_id` or `stripe_subscription_id` still exist (original schema line ~32-43)

- [ ] **Step 3: Verify upsert columns match schema**

Cross-reference the upsert payload in `supabase/functions/paddle-webhooks/index.ts:222-235` against the actual schema after all migrations. Every column in the upsert must exist in the table.

- [ ] **Step 4: Document findings in baseline report**

**Phase 0 Exit Gate:** All tasks complete? Baseline report at `docs/review/phase-0-baseline-report.md`? `npm audit` clean? CLAUDE.md committed? Proceed to Phase 1.

---

## Phase 1: Paddle Billing E2E

**Agent team:** Backend Architect (lead) + Security Engineer + API Tester
**Entry requirement:** Phase 0 complete
**Estimated time:** 2-3 sessions

**Testing approach:** Use Paddle's built-in **Simulations** feature (Developer Tools → Simulations) instead of a separate sandbox account. Simulations send test webhook events directly to the endpoint, testing the webhook handler logic without credential switching or duplicate product setup. For Task 1.3 (idempotency testing), the user will trigger simulations from the Paddle dashboard.

**Pre-requisite from Phase 0:** Fix DB-1 (stale Stripe columns in `src/lib/paddle.ts`) and DB-2 (`current_period_end` NOT NULL constraint) before billing testing begins. See Task 1.0A.

---

### Task 1.0A: Fix Phase 0 Database Issues (Pre-requisite)

- [ ] **Step 1: Fix DB-1 — stale Stripe column references in src/lib/paddle.ts**

Read `src/lib/paddle.ts` and find the `buildSubscriptionUpsert()` function. Replace `stripe_customer_id` with `paddle_customer_id` and `stripe_subscription_id` with `paddle_subscription_id`. Verify no other files reference these dropped column names.

- [ ] **Step 2: Fix DB-2 — relax current_period_end NOT NULL constraint**

Create a new migration `supabase/migrations/20260318_fix_period_end_nullable.sql`:
```sql
ALTER TABLE public.subscriptions ALTER COLUMN current_period_end DROP NOT NULL;
```

- [ ] **Step 3: Verify and commit**

```bash
npm run build && npm test
git add src/lib/paddle.ts supabase/migrations/20260318_fix_period_end_nullable.sql
git commit -m "fix: correct stale Stripe columns in paddle.ts, relax period_end NOT NULL"
```

### Task 1.0B: Verify Simulation Endpoint

- [ ] **Step 1: Check webhook destination in Paddle dashboard**

Ask the user to verify in Paddle → Developer Tools → Notifications that their webhook destination has Usage type "Platform and simulation" (not just "Platform"). This is required for simulations to work.

- [ ] **Step 2: Send a test simulation**

Ask the user to go to Developer Tools → Simulations → New Simulation → select "subscription.created" → send to their webhook endpoint. Check Supabase Edge Function logs for the event.

---

### Task 1.1: Schema Migration Audit

**Files:**
- Review: `supabase/migrations/00001_create_subscriptions.sql`
- Review: `supabase/migrations/20260303_revenuecat_schema_migration.sql`
- Review: `supabase/migrations/20260317_paddle_schema_fix.sql`
- Review: `supabase/functions/paddle-webhooks/index.ts:222-235`

- [ ] **Step 1: Trace the subscription schema evolution**

Read all three migration files in order. Document the final column set after all migrations apply.

- [ ] **Step 2: Verify upsert payload matches final schema**

The upsert at `paddle-webhooks/index.ts:222-235` writes these columns:
```
user_id, paddle_customer_id, paddle_subscription_id, tier, status,
price_id, current_period_start, current_period_end, cancel_at_period_end,
last_event_id, updated_at
```

Verify every column exists in the final schema. Check for any `stripe_customer_id` or `stripe_subscription_id` columns that might conflict.

- [ ] **Step 3: Query actual DB schema**

Run against Supabase SQL editor or via `mcp__claude_ai_Supabase__execute_sql`:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'subscriptions'
ORDER BY ordinal_position;
```

- [ ] **Step 4: Document findings**

Create `docs/review/phase-1-billing-truth-table.md`. Start with schema verification results.

---

### Task 1.2: Webhook Handler Correctness

**Files:**
- Review: `supabase/functions/paddle-webhooks/index.ts`

- [ ] **Step 1: Map all handled event types**

Read `paddle-webhooks/index.ts:167-174`. Currently handles:
```
subscription.created, subscription.updated, subscription.canceled,
subscription.paused, subscription.resumed, subscription.activated
```

Note: spec mentions `subscription.past_due` — verify if this is handled or falls through to unhandled.

- [ ] **Step 2: Build truth table**

For each event type, trace through the code and document:

| Event Type | Paddle Status | Portal Status (line 100-115) | Tier Mapping | cancel_at_period_end | Expected UI State |
|---|---|---|---|---|---|

- [ ] **Step 3: Verify status mapping edge cases**

Check `mapPaddleStatusToSubscriptionStatus()` at line 100-115:
- `paused` maps to `canceled` — is this correct for Paddle's semantics?
- `subscription.activated` is in handled list but has no special handling in the status mapper — verify it flows through `event.data.status` correctly
- `past_due` maps correctly?

- [ ] **Step 4: Document in truth table**

Append complete truth table to `docs/review/phase-1-billing-truth-table.md`.

---

### Task 1.3: Idempotency Verification

**Files:**
- Review: `supabase/functions/paddle-webhooks/index.ts:195-207`

- [ ] **Step 1: Analyze idempotency check**

The check at line 195-207 queries `last_event_id` for the user. If it matches the incoming event, returns 200 with `duplicate: true`.

Identify gaps:
- What if the same `event_id` arrives for a DIFFERENT user? (shouldn't happen per Paddle spec, but verify)
- What about out-of-order: `subscription.updated` (event_id=2) arrives, then `subscription.created` (event_id=1). The idempotency check would pass event_id=1 because it != event_id=2. But the `created` event would overwrite the `updated` state. Is this correct?

- [ ] **Step 2: Write test for idempotency**

Create `src/lib/__tests__/paddle-webhook-idempotency.test.ts`:
- Test: same event_id processed twice -> second is skipped
- Test: different event_ids for same user -> both processed
- Test: out-of-order events -> document whether this is safe

- [ ] **Step 3: Run tests**

```bash
npm test -- src/lib/__tests__/paddle-webhook-idempotency.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/__tests__/paddle-webhook-idempotency.test.ts
git commit -m "test: add Paddle webhook idempotency verification tests"
```

---

### Task 1.4: Price ID Trim Fix

**Files:**
- Modify: `supabase/functions/paddle-webhooks/index.ts:78-86`

- [ ] **Step 1: Identify the bug**

Read `paddle-webhooks/index.ts:77-93`. The `mapPriceIdToTier()` function splits price IDs by comma and filters empty strings, but does NOT trim whitespace. If an env var contains `"pri_123, pri_456"`, the second ID becomes `" pri_456"` (with leading space) and won't match.

- [ ] **Step 2: Fix by adding trim**

```typescript
// Before (line 78-86):
const infernoPriceIds = (Deno.env.get("PADDLE_INFERNO_PRICE_IDS") ?? "")
  .split(",")
  .filter(Boolean);

// After:
const infernoPriceIds = (Deno.env.get("PADDLE_INFERNO_PRICE_IDS") ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
```

Apply the same `.map(s => s.trim())` to all three tier price ID arrays.

- [ ] **Step 3: Verify build**

```bash
# Edge Functions don't use npm build, but verify no syntax errors
cat supabase/functions/paddle-webhooks/index.ts | head -100
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/paddle-webhooks/index.ts
git commit -m "fix: add trim() to Paddle price ID parsing to handle whitespace"
```

---

### Task 1.5: Webhook Signature Verification Review

**Files:**
- Review: `supabase/functions/paddle-webhooks/index.ts:14-69`

- [ ] **Step 1: Verify timing-safe comparison**

Read the `verifyPaddleSignature()` function at lines 22-69. Confirm:
- HMAC-SHA256 used (line 42-43)
- Payload format: `ts:rawBody` (line 47)
- Timing-safe comparison via XOR loop (lines 64-67)
- Length check before comparison (line 59)

- [ ] **Step 2: Verify raw body is read before parsing**

At line 135: `const rawBody = await req.text()` — this reads the raw body.
At line 157: `const event = JSON.parse(rawBody)` — this parses AFTER signature check.

Confirm the raw body is used for signature (line 148), not the parsed JSON. This is correct.

- [ ] **Step 3: Test edge cases**

Verify behavior for:
- Missing `Paddle-Signature` header -> should return 401 (line 141)
- Malformed signature header (no `ts=` or `h1=`) -> should return 401 (line 31 returns false)
- Valid format but wrong HMAC -> should return 401 (line 68 returns false)

- [ ] **Step 4: Document in truth table**

---

### Task 1.6: Subscription Tier Gating Audit

**Files:**
- Review: `supabase/functions/_shared/requireSubscription.ts`
- Review: `src/app/components/SubscriptionGate.tsx`
- Review: `src/hooks/useSubscription.ts` (or equivalent)
- Review: `src/queries/keys.ts` (subscription query key)

- [ ] **Step 1: Trace the full tier path**

1. Paddle webhook writes `tier` + `status` to `subscriptions` table
2. `requireSubscription.ts` queries `subscriptions` with `status IN ('active', 'trialing')` (line 42)
3. Frontend `useSubscription` hook queries the same table via TanStack Query
4. `SubscriptionGate` component reads the query result and gates UI

Verify: Is there a cache staleness window where the webhook updates the DB but the frontend still shows the old tier?

- [ ] **Step 2: Check cache invalidation**

Find where subscription data is invalidated after billing changes. Look for `queryClient.invalidateQueries` calls related to subscription query keys.

- [ ] **Step 3: Document the trace**

---

### Task 1.7: Upgrade/Downgrade Flow Review

**Files:**
- Review: `supabase/functions/paddle-update-subscription/index.ts`

- [ ] **Step 1: Read the full function**

Verify:
- JWT authentication is required
- New price ID is validated
- Paddle API is called to update the subscription
- Proration behavior is specified (immediate vs next billing period)
- Response includes the updated subscription state

- [ ] **Step 2: Test scenarios**

Document expected behavior for:
- EMBER -> FLAME (upgrade): immediate access? prorated charge?
- FLAME -> EMBER (downgrade): immediate or end-of-period?
- FLAME monthly -> FLAME annual: same tier, different billing period

---

### Task 1.8: Cancellation Flow Review

**Files:**
- Review: `supabase/functions/paddle-cancel-subscription/index.ts`

- [ ] **Step 1: Read the full function**

Verify:
- JWT authentication required
- Cancellation is "at period end" (not immediate)
- User retains access until `current_period_end`
- After period end, subscription reverts to FREE via webhook event

- [ ] **Step 2: Trace the full cancel lifecycle**

1. User clicks cancel -> `paddle-cancel-subscription` Edge Function called
2. Paddle API marks subscription as canceling at period end
3. Paddle sends `subscription.canceled` webhook at period end
4. `paddle-webhooks` processes it -> sets status to `canceled`, tier to... what?

**Key question:** Does the cancel webhook set tier to FREE, or does it keep the old tier with canceled status? If it keeps the old tier, does `requireSubscription` correctly deny access (it checks `status IN ('active', 'trialing')`)?

---

### Task 1.9: Paddle CORS Cleanup

**Files:**
- Modify: `supabase/functions/paddle-webhooks/index.ts:8-12`

- [ ] **Step 1: Identify the issue**

Line 8-12 has hardcoded `"Access-Control-Allow-Origin": "*"`. Webhooks are server-to-server (Paddle -> Supabase) and don't need CORS headers at all.

- [ ] **Step 2: Remove CORS wildcard**

Replace the hardcoded CORS headers with empty headers (or remove CORS entirely from webhook responses). The webhook only needs to return JSON, not CORS headers.

```typescript
// Before:
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// After:
const responseHeaders = {
  "Content-Type": "application/json",
};
```

Update all `headers: { ...corsHeaders, "Content-Type": "application/json" }` references to use `responseHeaders`.

- [ ] **Step 3: Remove OPTIONS handler**

The OPTIONS preflight handler (lines 121-123) is unnecessary for a webhook endpoint. Remove it.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/paddle-webhooks/index.ts
git commit -m "fix: remove unnecessary CORS wildcard from Paddle webhook endpoint"
```

---

### Task 1.10: Error Recovery Analysis

**Files:**
- Review: `supabase/functions/paddle-webhooks/index.ts:237-247`

- [ ] **Step 1: Analyze failure modes**

What happens if the upsert fails (line 237-247)?
- Returns 500 -> Paddle will retry (up to N times)
- Is the retry idempotent? Yes — `last_event_id` check prevents double-processing
- But: if the event partially writes (shouldn't happen with single upsert, but verify no multi-step writes)

- [ ] **Step 2: Check for multi-step operations**

Verify the webhook handler has NO operations between the idempotency check and the upsert. If there were (e.g., "update user profile, then upsert subscription"), a failure between steps would be non-atomic.

Currently: single upsert. This is already atomic. Document as safe.

- [ ] **Step 3: Document Paddle retry behavior**

Document: How many times does Paddle retry a failed webhook? What's the backoff? (Check Paddle docs). Is the retry interval compatible with the idempotency check?

---

### Task 1.11: Billing Incident Response Plan

**Files:**
- Create: `docs/runbooks/billing-incident-response.md`

- [ ] **Step 1: Write the runbook**

Document procedures for:
1. **Identifying affected users:** Query `subscriptions` table for mismatched states (e.g., `status = 'active'` but no matching Paddle subscription)
2. **Manually fixing subscription state:** SQL commands to update `tier`, `status`, `cancel_at_period_end`
3. **Reconciling with Paddle dashboard:** How to compare portal state vs Paddle dashboard state
4. **Issuing refunds:** Paddle dashboard procedure (portal doesn't handle refunds directly)
5. **Emergency webhook replay:** If webhooks were missed, how to re-trigger from Paddle

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/billing-incident-response.md
git commit -m "docs: add billing incident response runbook"
```

---

### Task 1.12: Document Simulation Testing Procedures

(Replaces original "Restore Live Mode" task — not needed since we're using Simulations instead of sandbox credential switching.)

- [ ] **Step 1: Write simulation testing guide**

Create `docs/runbooks/paddle-simulation-testing.md` documenting:
- How to access Paddle Simulations (Developer Tools → Simulations)
- How to set up webhook destination for simulation usage
- How to simulate each subscription event type
- How to verify event processing in Supabase Edge Function logs
- How to use simulations for future regression testing after code changes

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/paddle-simulation-testing.md
git commit -m "docs: add Paddle sandbox/live switching runbook"
```

**Phase 1 Exit Gate:** Truth table complete? Schema verified? Price ID fix committed? Idempotency tested? CORS wildcard removed? Runbooks committed? All Phase 1 BLOCKER criteria from spec met? Proceed to Phase 2.

---

## Phase 2: Security Audit + Hardening

**Agent team:** Security Engineer (lead) + Backend Architect + Code Reviewer
**Entry requirement:** Phase 1 complete
**Estimated time:** 3-4 sessions

---

### Task 2.1: RLS Policy Comprehensive Audit

**Files:**
- Review: All `supabase/migrations/*.sql` (27 files)
- Create: `docs/review/phase-2-rls-matrix.md`

- [ ] **Step 1: List all tables in the schema**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
```

- [ ] **Step 2: Check RLS enabled on each table**

```sql
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' ORDER BY tablename;
```

- [ ] **Step 3: List all RLS policies**

```sql
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public'
ORDER BY tablename, cmd;
```

- [ ] **Step 4: Build the RLS matrix**

Create `docs/review/phase-2-rls-matrix.md` with:

| Table | RLS Enabled | SELECT Policy | INSERT Policy | UPDATE Policy | DELETE Policy | Notes |
|---|---|---|---|---|---|---|

For each cell: policy name + brief description, or "NONE" (flag as risk).

- [ ] **Step 5: Verify premium tables have tier gating**

Check if tables like analytics data, biomechanics data have RLS policies that enforce subscription tier, or if they rely solely on client-side gating via `SubscriptionGate`.

- [ ] **Step 6: Commit**

```bash
git add docs/review/phase-2-rls-matrix.md
git commit -m "docs: add RLS policy audit matrix"
```

---

### Task 2.2: Edge Function Auth Audit

**Files:**
- Review: All 18 Edge Function `index.ts` files
- Create: `docs/review/phase-2-auth-audit.md`

- [ ] **Step 1: For each of the 18 Edge Functions, verify auth pattern**

Use the checklist from the spec. For each function, document:
- Auth method (JWT / HMAC signature / CSRF state token / none)
- How user_id is extracted (from JWT token or request body?)
- Whether service_role key is used (and if so, that it's never exposed)
- HTTP status codes on auth failure (401 or 403)

Pattern to look for in JWT-protected functions:
```typescript
const authHeader = req.headers.get('Authorization')!;
const supabase = createClient(URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
const { data: { user } } = await supabase.auth.getUser();
if (!user) return new Response(..., { status: 401 });
```

- [ ] **Step 2: Flag any function that extracts user_id from request body instead of JWT**

This would be a security issue — a user could impersonate another user.

- [ ] **Step 3: Verify `paddle-webhooks` has JWT disabled in config**

Read `supabase/config.toml` and verify JWT verification is disabled for the `paddle-webhooks` function (it uses HMAC signature verification instead).

- [ ] **Step 4: Document findings**

Create `docs/review/phase-2-auth-audit.md` with the completed checklist.

- [ ] **Step 5: Commit**

```bash
git add docs/review/phase-2-auth-audit.md
git commit -m "docs: add Edge Function auth audit results"
```

---

### Task 2.3: CORS Hardening

**Files:**
- Modify: `supabase/functions/_shared/cors.ts`

- [ ] **Step 1: Fix empty-string Allow-Origin**

Currently at line 24, disallowed origins get `''` as Allow-Origin. Change to return a 403 response or omit the header entirely.

```typescript
// Before:
'Access-Control-Allow-Origin': isAllowed ? origin : '',

// After:
...(isAllowed ? { 'Access-Control-Allow-Origin': origin } : {}),
```

This omits the header entirely for disallowed origins.

- [ ] **Step 2: Verify localhost is excluded in production**

Line 5-7 already checks `ENVIRONMENT !== 'production'` before adding localhost. Verify this is correctly set in production Supabase config.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/cors.ts
git commit -m "fix: omit CORS Allow-Origin header for disallowed origins"
```

---

### Task 2.4: CSP Review

**Files:**
- Review: `public/_headers`

- [ ] **Step 1: Read current CSP**

Document current `script-src` directive. Identify `'unsafe-inline'` — required by Paddle.js.

- [ ] **Step 2: Investigate nonce-based alternative**

Check if Paddle.js supports nonce-based CSP. If the script is loaded via `<script src="...">` (external), it could use a hash. If it uses inline scripts, nonce would be needed.

- [ ] **Step 3: Document decision**

If nonce is feasible, implement it. If not, document as accepted risk: "unsafe-inline required by Paddle.js SDK; mitigated by CSP restricting script sources to trusted domains."

---

### Task 2.5: Input Validation Sweep

**Files:**
- Modify: `supabase/functions/mobile-sync-push/index.ts` (add payload size limit)
- Review: All 18 Edge Functions for input validation

- [ ] **Step 1: Add payload size limit to mobile-sync-push**

At the top of the handler, before parsing the body:

```typescript
// Reject payloads larger than 5MB
const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10);
if (contentLength > 5 * 1024 * 1024) {
  return new Response(
    JSON.stringify({ error: 'Payload too large', maxSize: '5MB' }),
    { status: 413, headers: { ...cors, 'Content-Type': 'application/json' } }
  );
}
```

- [ ] **Step 2: Audit remaining functions for input validation**

For each Edge Function, check:
- Is the request body parsed safely? (try/catch around JSON.parse)
- Are required fields validated before use?
- Are string lengths bounded?
- Are numeric values range-checked?

- [ ] **Step 3: Commit payload limit fix**

```bash
git add supabase/functions/mobile-sync-push/index.ts
git commit -m "fix: add 5MB payload size limit to mobile-sync-push"
```

---

### Task 2.6: Server-Side Rate Limiting

**Files:**
- Review: `supabase/functions/process-sync-queue/index.ts` (existing rate limit pattern)
- Modify: Multiple Edge Functions (add rate limit checks)

- [ ] **Step 1: Review existing rate limit pattern**

Read how `process-sync-queue` uses `rate_limit_tracking` table. Document the pattern.

- [ ] **Step 2: Design rate limit middleware**

Create a shared utility `_shared/rateLimit.ts` that:
- Takes user_id, action name, and limits (requests per window)
- Queries `rate_limit_tracking` table
- Returns allowed/denied

- [ ] **Step 3: Apply to critical endpoints**

Priority endpoints:
- `delete-account` (1 request per hour per user)
- `mobile-sync-push` (10 requests per minute per user)
- Community actions via RLS/DB triggers (5 comments per hour)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/rateLimit.ts supabase/functions/*/index.ts
git commit -m "feat: add server-side rate limiting to public Edge Function endpoints"
```

---

### Task 2.7: Error Message Sanitization

**Files:**
- Modify: `src/mutations/comments.ts`
- Modify: `src/mutations/profile.ts`
- Modify: `src/mutations/workouts.ts`
- Modify: `src/mutations/routines.ts`
- Modify: `src/mutations/cycles.ts`
- Modify: `src/mutations/community.ts`
- Modify: `src/mutations/goals.ts`
- Modify: `src/mutations/account.ts`
- Modify: `src/mutations/challenges.ts`
- Modify: `src/mutations/integrations.ts`

- [ ] **Step 1: Find all raw error exposures**

```bash
grep -n "toast.error(error" src/mutations/*.ts
grep -n "toast.error(err" src/mutations/*.ts
```

- [ ] **Step 2: Replace with user-friendly messages**

For each `toast.error(error.message)`, replace with a generic user-friendly message:

```typescript
// Before:
onError: (error) => { toast.error(error.message) }

// After:
onError: (error) => {
  console.error('Mutation failed:', error);
  toast.error('Something went wrong. Please try again.');
}
```

For specific known errors (like rate limiting), use targeted messages:

```typescript
onError: (error) => {
  console.error('Comment creation failed:', error);
  if (error.message?.includes('rate')) {
    toast.error('You\'re posting too quickly. Please wait a moment.');
  } else {
    toast.error('Failed to post comment. Please try again.');
  }
}
```

- [ ] **Step 3: Verify no raw errors leak**

```bash
grep -n "toast.error(error\." src/mutations/*.ts
```

Expected: 0 matches (all replaced with generic messages).

- [ ] **Step 4: Commit**

```bash
git add src/mutations/*.ts
git commit -m "fix: sanitize error messages in all mutation hooks — no raw backend errors"
```

---

### Task 2.8: OAuth Token Security Review

**Files:**
- Review: `supabase/migrations/20260227_oauth_security.sql`
- Review: `supabase/functions/strava-oauth/index.ts` (token storage)
- Review: `supabase/functions/garmin-oauth/index.ts` (never-expiring tokens)

- [ ] **Step 1: Verify oauth_tokens has NO RLS**

```sql
SELECT rowsecurity FROM pg_tables WHERE tablename = 'oauth_tokens';
```

Expected: `false` (RLS disabled — service-role only access).

- [ ] **Step 2: Verify tokens never appear in API responses**

Search all Edge Functions for any response that includes token data:

```bash
grep -n "access_token\|refresh_token\|api_key" supabase/functions/*/index.ts
```

Verify these are only used in server-side operations, never returned in response bodies to the client.

- [ ] **Step 3: Document Garmin token strategy**

Garmin OAuth 1.0a tokens don't expire. Document a strategy: validate token before each sync by making a lightweight API call; if it fails with 401, mark integration as `token_expired`.

---

### Task 2.9: Delete-Account Hardening

**Files:**
- Modify: `supabase/functions/delete-account/index.ts`

- [ ] **Step 1: Identify the atomicity gap**

Current flow (read from file):
1. Delete storage objects (line 71-84) — wrapped in try/catch, continues on failure
2. Mark deletion request as executed (line 89-92) — NO error handling
3. Delete auth user (line 102) — cascades to all data

Problem: If step 2 fails, step 3 still runs. If step 3 fails after step 2 succeeds, the deletion request is marked executed but the user still exists.

- [ ] **Step 2: Add error handling to step 2**

```typescript
// After step 2, check for error:
const { error: updateError } = await supabaseAdmin
  .from('deletion_requests')
  .update({ status: 'executed', executed_at: new Date().toISOString() })
  .eq('id', request.id);

if (updateError) {
  console.error('Failed to mark deletion request as executed:', updateError);
  return new Response(
    JSON.stringify({ error: 'Failed to process deletion. Please try again.' }),
    { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
  );
}
```

- [ ] **Step 3: Add rollback on auth deletion failure**

If `deleteUser` fails after marking the request as executed, roll back:

```typescript
if (deleteError) {
  // Roll back the deletion request status
  await supabaseAdmin
    .from('deletion_requests')
    .update({ status: 'pending', executed_at: null })
    .eq('id', request.id);
  // ... existing error response
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/delete-account/index.ts
git commit -m "fix: add error handling and rollback to delete-account cascade"
```

---

### Task 2.10-2.14: Remaining Security Tasks

These follow the same investigate-document-fix-verify pattern. Each task is detailed in the spec at `docs/superpowers/specs/2026-03-18-beta-readiness-review-design.md`, section "Phase 2: Security Audit."

- [ ] **Task 2.10:** Sensitive data exposure scan — search git history, verify `.gitignore`, check Sentry config, audit console.log calls
- [ ] **Task 2.11:** Cookie & localStorage audit — enumerate all client-side storage, verify nothing sensitive
- [ ] **Task 2.12:** npm vulnerability resolution — fix any remaining HIGH/CRITICAL from Phase 0
- [ ] **Task 2.13:** GDPR compliance — verify `src/lib/export/data-export.ts` completeness, verify `src/lib/consent.ts` is opt-in
- [ ] **Task 2.14:** Public page content — verify `/privacy`, `/terms`, `/faq` have real content covering Paddle billing

After all tasks: Create `docs/review/phase-2-security-findings.md` with accepted-risk justifications.

```bash
git add docs/review/phase-2-security-findings.md
git commit -m "docs: add Phase 2 security findings with accepted-risk justifications"
```

**Phase 2 Exit Gate:** RLS matrix complete? All 18 auth paths verified? CORS hardened? Rate limiting active? Error messages sanitized? Delete-account atomic? GDPR verified? Proceed to Phase 3.

---

## Phase 3: Mobile Sync Pipeline Validation

**Agent team:** Backend Architect (lead) + API Tester + Frontend Developer
**Entry requirement:** Phase 2 complete
**Estimated time:** 2-3 sessions

Detailed tasks follow the spec. Key deliverable: `docs/review/phase-3-sync-contract.md`

### Task 3.1-3.8: Sync Pipeline Tasks

Each task is fully specified in the design spec. Key implementation notes:

- [ ] **Task 3.1:** Schema contract — compare `mobile-sync-push/index.ts` interfaces (lines 9-50) against migration schemas and `src/schemas/transforms.ts`
- [ ] **Task 3.2:** Mobile app review — clone `github.com/9thLevelSoftware/Project-Phoenix-MP` branch `MVP`, find the sync client code, document payload shapes
- [ ] **Task 3.3:** Payload limits — already partly addressed in Task 2.5 (5MB limit). Now test: what happens with 500+ sessions in a single push? Does it timeout?
- [ ] **Task 3.4:** Delta sync — read `mobile-sync-pull/index.ts`, verify `since` parameter handling and timezone consistency
- [ ] **Task 3.5:** Realtime broadcast — trace `useRealtimeSync.ts` hook, verify `sync:{userId}` channel subscription and cache invalidation
- [ ] **Task 3.6:** Offline resilience — document what happens when portal receives push while offline (answer: data lands in DB, portal fetches on next load via TanStack Query)
- [ ] **Task 3.7:** Data integrity — verify FKs in `00002_base_schema.sql` for the workout hierarchy
- [ ] **Task 3.8:** Sync queue — read `process-sync-queue/index.ts`, verify rate limits, backoff, max retries

**Phase 3 Exit Gate:** Contract matrix complete? Payload limits enforced? Delta sync verified? Realtime broadcast works? Proceed to Phase 4 (and optionally Phase 5 in parallel).

---

## Phase 4: Frontend Stability + Test Coverage

**Agent team:** Frontend Developer (lead) + Code Reviewer + Evidence Collector
**Entry requirement:** Phase 3 complete
**Can run in PARALLEL with Phase 5**
**Estimated time:** 3-4 sessions

### Task 4.1: Critical Component Tests

**Files:**
- Create: `src/app/components/__tests__/RoutineBuilder.test.tsx`
- Create: `src/app/components/__tests__/CycleBuilder.test.tsx`
- Create: `src/app/components/__tests__/SessionReplay.test.tsx`
- Create: `src/app/components/__tests__/SubscriptionGate.test.tsx`

For each component, test:
- Renders without crashing (smoke test)
- Empty/loading state renders correctly
- User interaction triggers expected behavior
- Validation errors display correctly

Use `renderWithProviders()` from `src/test/test-utils.tsx` which provides MemoryRouter + QueryClientProvider.

### Task 4.2: Mutation Hook Tests

**Files:**
- Create: `src/mutations/__tests__/routines.test.ts`
- Create: `src/mutations/__tests__/cycles.test.ts`
- Create: `src/mutations/__tests__/comments.test.ts`
- Create: `src/mutations/__tests__/community.test.ts`
- Create: `src/mutations/__tests__/goals.test.ts`
- Create: `src/mutations/__tests__/account.test.ts`

For each, test:
- Successful mutation calls Supabase correctly
- Error handling shows user-friendly message (from Task 2.7 fix)
- Cache invalidation triggers on success

### Task 4.3: Query Hook Tests

**Files:**
- Create: `src/queries/__tests__/workouts.test.ts`
- Create: `src/queries/__tests__/analytics.test.ts`
- Create: `src/queries/__tests__/routines.test.ts`
- Create: `src/queries/__tests__/cycles.test.ts`
- Create: `src/queries/__tests__/records.test.ts`
- Create: `src/queries/__tests__/integrations.test.ts`
- Create: `src/queries/__tests__/insights.test.ts`
- Create: `src/queries/__tests__/profile.test.ts`

For each, test:
- Query key structure matches `src/queries/keys.ts`
- Loading state renders skeleton/spinner
- Error state renders error message
- Empty data renders appropriate empty state

### Tasks 4.4-4.11: Frontend Quality Tasks

Each task is fully specified in the design spec. Key implementation notes:

- [ ] **Task 4.4:** Empty states — visit each page with mock empty responses, screenshot, fix any crashes
- [ ] **Task 4.5:** Error boundaries — inject errors into components, verify recovery
- [ ] **Task 4.6:** SubscriptionGate — test with FREE/EMBER/FLAME/INFERNO mock subscriptions
- [ ] **Task 4.7:** Analytics decomposition — extract chart components to `src/app/components/analytics/`
- [ ] **Task 4.8:** A11y — run `npx playwright test e2e/a11y.spec.ts`, fix critical/serious violations
- [ ] **Task 4.9:** Mobile — add Playwright tests at 375px viewport width
- [ ] **Task 4.10:** Deprecated APIs — fix Recharts `Cell` import in Analytics.tsx
- [ ] **Task 4.11:** E2E expansion — 4 new test files in `e2e/`

**Phase 4 Exit Gate:** Coverage >= 40% on critical paths? Empty states fixed? Error boundaries confirmed? A11y clean? Mobile verified? 4+ new E2E tests?

---

## Phase 5: Third-Party Integration Readiness

**Agent team:** Backend Architect (lead) + API Tester + Security Engineer
**Entry requirement:** Phase 3 complete
**Can run in PARALLEL with Phase 4**
**Estimated time:** 2-3 sessions

### Tasks 5.1-5.10: Integration Review Tasks

Each task is a code review + documentation exercise. Key files per task:

- **5.1 Strava:** `supabase/functions/initiate-oauth/index.ts`, `supabase/functions/strava-oauth/index.ts`, `supabase/functions/strava-sync/index.ts`
- **5.2 Fitbit:** `supabase/functions/fitbit-oauth/index.ts`, `supabase/functions/fitbit-sync/index.ts`
- **5.3 Garmin:** `supabase/functions/garmin-oauth/index.ts`, `supabase/functions/garmin-webhook/index.ts`
- **5.4 Hevy/Liftosaur:** `supabase/functions/hevy-sync/index.ts`, `supabase/functions/liftosaur-sync/index.ts`
- **5.5 Token refresh:** `supabase/functions/strava-sync/index.ts` (lines ~93-111), `supabase/functions/fitbit-sync/index.ts`
- **5.6 Normalization:** All sync function output -> `external_activities` table schema
- **5.7 Rate limits:** `src/lib/integrations/rate-limits.ts`, `supabase/functions/process-sync-queue/index.ts` (lines 12-17)
- **5.8 Disconnect:** `supabase/functions/disconnect-integration/index.ts`
- **5.9 Garmin webhook:** `supabase/functions/garmin-webhook/index.ts`
- **5.10 UI review:** `src/app/components/Integrations.tsx` (or equivalent)

Deliverable: `docs/review/phase-5-integration-flows.md`

**Phase 5 Exit Gate:** All 5 auth flows documented? Token refresh verified? Disconnect clean? Dormant endpoints safe?

---

## Phase 6: Performance + Operational Readiness

**Agent team:** Performance Benchmarker (lead) + DevOps Automator + Frontend Developer
**Entry requirement:** Phases 4 AND 5 complete
**Estimated time:** 2-3 sessions

### Tasks 6.1-6.11: Performance & Ops Tasks

Key commands for each task:

- **6.1 Bundle:** `ANALYZE=true npm run build` (or `npm run analyze`)
- **6.2 Lighthouse:** `npx lighthouse http://localhost:5173 --output=json --chrome-flags="--headless"`
- **6.3 CWV:** Measured via Lighthouse or Chrome DevTools
- **6.4 Cold starts:** Measure via Supabase Edge Function logs (first invocation after idle)
- **6.5 DB queries:** `EXPLAIN ANALYZE` on top queries via Supabase SQL editor
- **6.6 PWA:** Test in Chrome DevTools Application tab
- **6.7 Sentry:** Trigger `throw new Error('test')` in a component, verify in Sentry dashboard
- **6.8 Alerting:** Configure via Supabase dashboard or external service
- **6.9 Load test:** Use `autocannon` or `k6` for concurrent request testing
- **6.10 Deploy:** Full CI run + Cloudflare Pages deploy + Edge Function deploy
- **6.11 Runbook:** Create `docs/runbooks/operations.md`

### Final Task: Go/No-Go Checklist

**Files:**
- Create: `docs/review/go-no-go-checklist.md`

After all phases complete, compile the final checklist:

```markdown
# Go/No-Go Checklist — Beta Launch

## BLOCKER Items (must ALL pass)
- [ ] Phase 0: Clean build, no HIGH npm vulns, CLAUDE.md updated
- [ ] Phase 1: All billing events tested, schema consistent, idempotency proven
- [ ] Phase 2: RLS complete, auth audit clean, rate limiting active, GDPR verified
- [ ] Phase 3: Sync contract verified, payload limits, realtime broadcast works
- [ ] Phase 4: Coverage >= 40% critical paths, a11y clean, mobile verified
- [ ] Phase 5: All auth flows verified, dormant endpoints safe
- [ ] Phase 6: Cold starts <3s, alerting active, load test passes, runbook committed

## NON-BLOCKER Items (tracked for post-launch)
- [ ] CSP tightened (or accepted risk documented)
- [ ] Analytics.tsx decomposed to <800 lines
- [ ] Bundle size < 300KB gzipped
- [ ] Lighthouse scores meet targets
- [ ] CWV all "Good"
- [ ] PWA verified
```

```bash
git add docs/review/go-no-go-checklist.md
git commit -m "docs: add Go/No-Go checklist for beta launch decision"
```

---

## Execution Notes

### Parallelization Opportunities
- Phase 0 tasks 0.1-0.5 can run in parallel (independent checks)
- Phase 1 tasks 1.1-1.8 are mostly independent (can parallelize reviews)
- Phase 2 tasks 2.1-2.2 (RLS + auth audit) can run in parallel
- **Phases 4 and 5 can run fully in parallel** (different agent teams, different code)
- Phase 6 tasks 6.1-6.6 can run in parallel

### Agent Dispatch Pattern
Each task should be dispatched as:
```
"You are a [Agent Role]. Your task is [Task N.N from the beta readiness review plan].
Read the plan at docs/superpowers/plans/2026-03-18-beta-readiness-review.md for full context.
Read the spec at docs/superpowers/specs/2026-03-18-beta-readiness-review-design.md for exit criteria.
Your specific task: [paste task description]
Files to examine: [exact paths]
Verification: [what success looks like]"
```

### Phase Reports
At the end of each phase, create a phase report at `docs/review/phase-N-report.md` summarizing:
- Tasks completed
- Issues found and fixed
- Accepted risks with justification
- Exit criteria status (pass/fail per item)
