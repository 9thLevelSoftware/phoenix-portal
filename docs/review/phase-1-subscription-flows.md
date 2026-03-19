# Phase 1: Subscription Flows Review

**Tasks:** 1.7 (Upgrade/Downgrade) and 1.8 (Cancellation)
**Reviewer:** Backend Architect
**Date:** 2026-03-18
**Branch:** beta-readiness-review

---

## Files Reviewed

| File | Role |
|------|------|
| `supabase/functions/paddle-update-subscription/index.ts` | Edge Function: tier change API |
| `supabase/functions/paddle-cancel-subscription/index.ts` | Edge Function: cancellation API |
| `supabase/functions/paddle-webhooks/index.ts` | Webhook handler: source of truth for DB state |
| `src/lib/pricing.ts` | Tier pricing config (price IDs, amounts) |
| `src/lib/paddle.ts` | Paddle types, mapping utilities, signature verification |
| `src/lib/paddle-client.ts` | Client-side Paddle.js SDK wrapper |
| `src/hooks/useSubscription.ts` | Client subscription state (TanStack Query + Realtime) |
| `src/app/components/PricingPlans.tsx` | UI: pricing cards, upgrade/cancel actions |
| `supabase/functions/_shared/requireSubscription.ts` | Server-side tier gating helper |

---

## Database Schema: `subscriptions` Table

Final schema after all migrations (00001 + RevenueCat migration + Paddle schema fix + period-end nullable fix):

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | UUID | NO | PK, gen_random_uuid() |
| `user_id` | UUID | NO | FK to auth.users, UNIQUE |
| `paddle_customer_id` | TEXT | YES | ctm_XXXX |
| `paddle_subscription_id` | TEXT | YES | sub_XXXX |
| `tier` | TEXT | NO | CHECK: FREE, EMBER, FLAME, INFERNO |
| `status` | TEXT | NO | CHECK: active, past_due, canceled, trialing, incomplete, none |
| `price_id` | TEXT | YES | Paddle price ID (pri_XXXX) |
| `current_period_start` | TIMESTAMPTZ | YES | Billing period start |
| `current_period_end` | TIMESTAMPTZ | YES | Billing period end |
| `cancel_at_period_end` | BOOLEAN | YES | DEFAULT FALSE |
| `last_event_id` | TEXT | YES | Idempotency: last processed webhook event ID |
| `environment` | TEXT | YES | DEFAULT 'PRODUCTION' |
| `created_at` | TIMESTAMPTZ | YES | DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | YES | DEFAULT NOW() |

**RLS:** Users can SELECT their own row. Service-role key (used by webhook handler) bypasses RLS.
**Realtime:** Enabled via `ALTER PUBLICATION supabase_realtime ADD TABLE subscriptions`.

---

## Task 1.7: Upgrade/Downgrade Flow

### 1.7.1 Authentication

The Edge Function authenticates the user via their Supabase JWT:

```
Authorization: Bearer <jwt>
```

A per-request Supabase client is created with the user's auth header (line 28-31), then `supabase.auth.getUser()` validates the JWT and extracts the user. Returns 401 if the JWT is invalid or expired.

A separate service-role client (`supabaseAdmin`) is used for the DB lookup to bypass RLS.

**Verdict:** Correct. JWT-based auth with proper separation between user-context and admin-context clients.

### 1.7.2 Parameters Accepted

Single parameter in the POST body:

```json
{ "price_id": "pri_XXXX" }
```

- Must be a non-empty string (validated at line 45-49).
- The function does NOT accept a tier name; it accepts a raw Paddle price ID.
- The client (`PricingPlans.tsx`, line 196-198) resolves the price ID from `TIER_PRICING` based on the selected tier and annual/monthly toggle.

**Observation:** The Edge Function does not validate that the provided `price_id` maps to a known tier. It passes whatever price ID the client sends directly to Paddle. If someone sends a garbage price ID, Paddle's API will reject it (returned as a 502 to the client), so there is no security issue, but the error message will be generic ("Failed to update subscription") rather than a helpful "Invalid price ID".

### 1.7.3 Paddle API Call

**Endpoint:** `PATCH /subscriptions/{paddle_subscription_id}`

**Payload:**
```json
{
  "items": [{ "price_id": "<newPriceId>", "quantity": 1 }],
  "proration_billing_mode": "prorated_immediately"
}
```

**Auth:** `Bearer {PADDLE_API_KEY}` header.

**Environment routing:** Uses `PADDLE_ENVIRONMENT` env var to switch between sandbox (`sandbox-api.paddle.com`) and production (`api.paddle.com`).

### 1.7.4 Proration Handling

`proration_billing_mode: "prorated_immediately"` means:

- **Upgrade:** Paddle charges the price difference for the remaining billing period immediately. The new tier takes effect immediately.
- **Downgrade:** Paddle issues a credit for the unused portion of the higher-priced plan and applies it to the lower-priced plan. The new tier takes effect immediately.
- **Same-tier period change (monthly to annual):** Paddle calculates the prorated difference and charges/credits accordingly, effective immediately.

This is the most aggressive proration mode. The user sees the change reflected as soon as the webhook fires.

### 1.7.5 DB Update Strategy

**The Edge Function does NOT update the DB directly.** After a successful Paddle API response, it returns `{ success: true }` to the client (line 131-133). The actual DB update happens asynchronously when Paddle fires a `subscription.updated` webhook to the `paddle-webhooks` Edge Function.

**Flow:**
1. Client calls `paddle-update-subscription` with new price ID
2. Edge Function calls `PATCH /subscriptions/{id}` on Paddle API
3. Paddle API returns success
4. Edge Function returns `{ success: true }` to client
5. (Async) Paddle fires `subscription.updated` webhook
6. `paddle-webhooks` handler processes the event and upserts the `subscriptions` row
7. Supabase Realtime fires a postgres_changes event
8. `useSubscription` hook invalidates the TanStack Query cache
9. UI re-renders with the new tier

**Latency gap:** Between steps 3 and 6, the DB still has the old tier. The UI shows a toast ("Subscription updated! Changes may take a moment to reflect.") and also manually invalidates the subscription query cache (line 228-231), but since the DB hasn't changed yet, the refetch returns the old tier. The Realtime subscription (lines 67-92 of `useSubscription.ts`) handles the eventual update.

### 1.7.6 Paddle API Succeeds, DB Update Fails

This scenario splits into two failure modes:

**A. Paddle API succeeds, webhook never arrives:**
- The subscription is changed at Paddle's end but the portal DB is stale.
- Paddle retries webhooks with exponential backoff, so transient failures self-heal.
- If the webhook endpoint is completely broken, the user has a new plan in Paddle but sees the old tier in the portal.
- **Mitigation:** None currently. There is no reconciliation job or manual sync mechanism.

**B. Paddle API succeeds, webhook arrives but DB upsert fails:**
- The webhook handler returns HTTP 500 (line 241-246).
- Paddle will retry the webhook (standard retry policy).
- The idempotency check (line 196-207) uses `last_event_id`, so if the upsert eventually succeeds, duplicate deliveries are handled.

**Risk assessment:** Low-medium. Paddle's webhook retry policy provides resilience, but there is no fallback reconciliation. If the webhook endpoint is down for an extended period, users could be stuck on the wrong tier.

### 1.7.7 Validation Guards

Before calling Paddle, the Edge Function validates:

1. User has a subscription row with a `paddle_subscription_id` (line 68)
2. Subscription status is `active` or `trialing` (line 75)
3. The new price ID differs from the current price ID (line 82)

**Gap:** The Edge Function does not check whether the user is downgrading vs upgrading. Both directions use the same `prorated_immediately` billing mode. This is acceptable since Paddle handles the billing math, but the UI only exposes the "Upgrade" button for higher tiers. Downgrades are not exposed in the current UI.

### 1.7.8 Test Scenarios

#### Scenario A: EMBER -> FLAME (upgrade)

| Step | Action | DB State |
|------|--------|----------|
| 0 | User is on EMBER monthly | tier=EMBER, status=active, price_id=pri_ember_monthly |
| 1 | User clicks "Upgrade" on FLAME card | UI shows confirmation dialog: "Your payment method on file will be charged a prorated amount..." |
| 2 | User confirms | `paddle-update-subscription` called with FLAME monthly price ID |
| 3 | Edge Function validates: has active sub, price ID differs | Calls `PATCH /subscriptions/{id}` with new price ID |
| 4 | Paddle charges prorated difference immediately | Returns 200 |
| 5 | Edge Function returns `{ success: true }` | Toast: "Subscription updated!" |
| 6 | Paddle fires `subscription.updated` webhook | Webhook handler: tier=FLAME, status=active, price_id=pri_flame_monthly |
| 7 | Realtime event fires | `useSubscription` invalidates cache, UI shows FLAME |

**Expected final DB state:**
```
tier: FLAME
status: active
price_id: pri_flame_monthly
cancel_at_period_end: false (assuming no scheduled_change)
current_period_start: <original start> (unchanged within same period)
current_period_end: <original end> (unchanged within same period)
```

#### Scenario B: FLAME -> EMBER (downgrade)

| Step | Action | DB State |
|------|--------|----------|
| 0 | User is on FLAME monthly | tier=FLAME, status=active, price_id=pri_flame_monthly |
| 1 | User attempts downgrade | **UI does not expose a downgrade button** |

**Current UI behavior (PricingPlans.tsx, line 291-296):** When the user's current tier is higher than the displayed card tier, the button shows "Included in your plan" (disabled). There is no downgrade path in the UI.

**If called via API directly:**
- The Edge Function would accept it (no tier-level validation).
- Paddle would process it with `prorated_immediately` (credit for unused FLAME, charge for EMBER).
- Webhook would update DB to tier=EMBER.

**Gap identified:** There is no UI for downgrades. A user wanting to downgrade from FLAME to EMBER has no path in the portal. They would need to cancel and re-subscribe, losing their billing continuity. This may be intentional (simplify UI) or an oversight.

#### Scenario C: FLAME monthly -> FLAME annual (billing period change)

| Step | Action | DB State |
|------|--------|----------|
| 0 | User is on FLAME monthly (pri_flame_monthly) | tier=FLAME, status=active |
| 1 | User toggles to "Annual" billing | Pricing cards show annual prices |
| 2 | User clicks "Upgrade" on FLAME card | **This will NOT work** |

**Issue:** The Edge Function checks `sub.price_id === newPriceId` (line 82) and returns "Already on this plan" if they match. Since the monthly and annual price IDs are different, this check would pass. However, `handleUpgrade` only fires when `isUpgradeEligible` is true AND the target tier is higher than the current tier.

Looking at `renderCTA` (line 249): when `currentTier === tierConfig.tier`, the button renders as "Current Plan" (disabled), regardless of whether the billing period differs. The "Upgrade" path only triggers when `TIER_LEVEL[currentTier] < TIER_LEVEL[tierConfig.tier]`.

**Gap identified:** Same-tier billing period changes (monthly <-> annual) are not supported in the UI. The Edge Function would handle it correctly if called directly, but the UI blocks it.

---

## Task 1.8: Cancellation Flow

### 1.8.1 Authentication

Identical pattern to the update function: JWT from `Authorization` header, validated via `supabase.auth.getUser()`. Returns 401 if not authenticated.

### 1.8.2 Cancellation Timing

The Edge Function cancels at period end, NOT immediately:

```json
{ "effective_from": "next_billing_period" }
```

**Paddle API call:** `POST /subscriptions/{paddle_subscription_id}/cancel`

This means:
- The subscription remains active until `current_period_end`.
- No refund is issued.
- Paddle marks the subscription with a `scheduled_change: { action: "cancel", effective_at: "<period_end>" }`.

### 1.8.3 DB Record During Grace Period

The Edge Function does NOT update the DB directly. Like the upgrade flow, it relies entirely on the webhook.

**Immediate webhook response:** After the cancel API call, Paddle fires a `subscription.updated` webhook (not `subscription.canceled` yet) with `scheduled_change.action = "cancel"`.

The webhook handler (line 214-217) detects this:
```typescript
const isCanceled =
  event.event_type === "subscription.canceled" ||
  event.data.scheduled_change?.action === "cancel";
```

**DB state during grace period:**
```
tier: FLAME          (unchanged -- still the paid tier)
status: active       (Paddle status is still "active" until period ends)
cancel_at_period_end: true    (set by scheduled_change detection)
current_period_end: 2026-04-15T00:00:00Z  (original period end)
```

The user retains full access to their tier features during the grace period because `requireSubscription()` checks `status IN ('active', 'trialing')`, and the status is still `active`.

### 1.8.4 Period End: Full Cancellation

When the billing period ends, Paddle fires `subscription.canceled` with:
- `status: "canceled"`
- `scheduled_change: null` (change has been applied)
- `current_billing_period: null` (no next period)

The webhook handler processes this:
1. `mapPaddleStatusToSubscriptionStatus("canceled")` returns `"canceled"`
2. `mapPriceIdToTier(priceId)` returns the tier based on the last price ID (e.g., FLAME)
3. `isCanceled = true` (event_type is `subscription.canceled`)

**DB state after period end:**
```
tier: FLAME          (still shows the last tier -- NOT reverted to FREE)
status: canceled
cancel_at_period_end: true
current_period_end: null (or the expired period end date)
```

**Important finding:** The webhook handler does NOT revert the tier to FREE upon cancellation. It sets the tier based on the price ID in the event, which is still the FLAME price ID. The access gating works because `requireSubscription()` checks `status IN ('active', 'trialing')` -- a `canceled` status fails this check, so the user is effectively gated as FREE even though `tier` column says FLAME.

The `useSubscription` hook also falls back correctly: if no row matches active/trialing, it still returns the tier from the row but with `status: "canceled"`. The `isPremium` check uses `tier !== "FREE"`, which would show as premium even after cancellation, but feature gating uses the `SubscriptionGate` component and `requireSubscription()` which both check status.

**Potential inconsistency:** The `useSubscription` hook does NOT filter by status -- it fetches the row regardless:
```typescript
const { data, error } = await supabase
  .from("subscriptions")
  .select("tier, status, current_period_end, cancel_at_period_end")
  .eq("user_id", userId)
  .maybeSingle();
```

This means `tier` will be FLAME and `isPremium` will be true even after cancellation. Components that rely on `isPremium` rather than the proper gating mechanism could show premium UI to canceled users. However, server-side gating via `requireSubscription()` correctly checks status, so data access is properly gated.

### 1.8.5 Re-subscription During Grace Period

**Can the user re-subscribe during the grace period?**

Looking at the UI (`PricingPlans.tsx`, line 258-269): when `cancelAtPeriodEnd` is true and the user is viewing their current tier, the button shows "Current Plan" (disabled) with a "Cancels on {date}" label. There is no "Resume" or "Undo cancellation" button.

For other tiers, since `currentStatus === "active"` during the grace period, `isUpgradeEligible` is true (line 186-188), and higher tiers show an "Upgrade" button. This means a FLAME user who canceled could upgrade to INFERNO during the grace period (if it were available).

However, the user cannot:
1. **Resume their current subscription** -- no UI for this. Paddle supports `POST /subscriptions/{id}` to remove the scheduled cancellation, but no Edge Function exists for this.
2. **Re-subscribe to the same tier** -- the "Current Plan" button is disabled.
3. **Subscribe to a lower tier** -- "Included in your plan" is disabled.

After the period ends (status becomes `canceled`), the `isUpgradeEligible` check fails, and the user sees "Subscribe" buttons for all tiers. They can start a new subscription via checkout.

**Gap identified:** No "undo cancellation" / "resume subscription" flow exists. Users who cancel and change their mind before period end have no self-service path to reverse it.

### 1.8.6 Full Cancel Lifecycle Trace

```
Step 1: User clicks "Cancel subscription" on their current tier card
        -> Confirmation dialog: "Your subscription will remain active until
           the end of your current billing period ({date}). After that,
           you'll be downgraded to the Free plan."
        -> User clicks "Yes, cancel"

Step 2: PricingPlans.handleCancel()
        -> supabase.functions.invoke("paddle-cancel-subscription")
        -> JWT passed automatically by Supabase client

Step 3: paddle-cancel-subscription Edge Function
        -> Validates JWT, fetches subscription row
        -> Checks status is active or trialing
        -> POST /subscriptions/{sub_id}/cancel { effective_from: "next_billing_period" }
        -> Returns { success: true }

Step 4: Client receives success
        -> Toast: "Subscription canceled. You'll retain access until the end
           of your billing period."
        -> Invalidates subscription query cache

Step 5: Paddle fires subscription.updated webhook (with scheduled_change)
        -> paddle-webhooks handler processes
        -> DB UPSERT:
           {
             tier: "FLAME",
             status: "active",
             cancel_at_period_end: true,
             current_period_end: "2026-04-15T00:00:00Z",
             last_event_id: "evt_xxxxx"
           }
        -> Realtime event fires -> UI updates

Step 6: Grace period (user retains FLAME access)
        -> DB state: tier=FLAME, status=active, cancel_at_period_end=true
        -> requireSubscription("EMBER") -> allowed (status is active)
        -> UI shows "Current Plan" with "Cancels on Apr 15, 2026"

Step 7: Period ends -> Paddle fires subscription.canceled webhook
        -> paddle-webhooks handler processes
        -> DB UPSERT:
           {
             tier: "FLAME",     (NOT reverted to FREE)
             status: "canceled",
             cancel_at_period_end: true,
             current_period_end: null (or expired date)
           }

Step 8: After period end
        -> requireSubscription("EMBER") -> NOT allowed (status is canceled)
        -> useSubscription returns { tier: "FLAME", status: "canceled", isPremium: true }
        -> SubscriptionGate blocks premium features (checks status, not just tier)
        -> PricingPlans shows "Subscribe" buttons (isUpgradeEligible = false)
```

---

## Findings Summary

### Confirmed Working

| ID | Finding | Status |
|----|---------|--------|
| F1 | JWT authentication on both Edge Functions | OK |
| F2 | Upgrade flow (EMBER -> FLAME) with immediate proration | OK |
| F3 | Cancel-at-period-end behavior with grace period | OK |
| F4 | Webhook idempotency via `last_event_id` | OK |
| F5 | Realtime subscription for automatic UI refresh | OK |
| F6 | HMAC-SHA256 signature verification with timing-safe comparison | OK |
| F7 | Paddle sandbox/production environment switching | OK |
| F8 | Server-side gating (`requireSubscription`) correctly checks status | OK |

### Gaps and Risks

| ID | Severity | Finding | Recommendation |
|----|----------|---------|----------------|
| G1 | **Medium** | No downgrade path in UI. FLAME users cannot downgrade to EMBER without cancel + re-subscribe. | Decide if this is intentional. If not, add a downgrade button with Paddle's `prorated_immediately` mode (which handles credits). |
| G2 | **Medium** | No same-tier billing period change (monthly <-> annual). UI shows "Current Plan" regardless of billing frequency. | Add detection: compare current price ID against monthly/annual variants. Show "Switch to Annual" or "Switch to Monthly" when appropriate. |
| G3 | **Medium** | No "undo cancellation" / resume flow. Users who cancel during grace period cannot self-service reverse it. | Add a `paddle-resume-subscription` Edge Function that calls `PATCH /subscriptions/{id}` to remove the `scheduled_change`. Add a "Resume" button when `cancelAtPeriodEnd` is true. |
| G4 | **Low-Medium** | `isPremium` in `useSubscription` returns true for canceled subscriptions (tier is still FLAME in DB). Components relying on `isPremium` instead of proper gating may show premium UI to expired users. | Either revert tier to FREE on `subscription.canceled` webhook, or audit all `isPremium` usage to ensure it's paired with a status check. |
| G5 | **Low** | No reconciliation mechanism if webhooks fail persistently. Paddle retries help, but extended outages could leave DB stale. | Consider a periodic reconciliation job that calls Paddle's `GET /subscriptions` API and syncs any drift. |
| G6 | **Low** | Edge Function does not validate price ID against known tiers before calling Paddle. Invalid price IDs produce generic error messages. | Add server-side validation: check `newPriceId` against `PADDLE_*_PRICE_IDS` env vars before calling Paddle. Return a specific 400 error for unknown price IDs. |
| G7 | **Informational** | The `tier` column retains the last paid tier after cancellation (e.g., FLAME) rather than reverting to FREE. This is a design choice, not a bug, since access gating uses status. | Document this behavior. Ensure all future feature checks use status-aware gating, not `tier !== "FREE"`. |

### Pre-existing Schema Issues

| ID | Finding | Notes |
|----|---------|-------|
| S1 | Original migration created `stripe_customer_id` and `stripe_subscription_id` columns, which were removed during RevenueCat migration and replaced by Paddle columns. Column names in the webhook handler comment as "legacy Stripe column names" (line 223) is outdated -- they are now Paddle columns. | Cosmetic, no functional impact. |
| S2 | The `subscriptions_status_check` constraint allows `incomplete` and `none` but the Paddle status mapper never produces `incomplete`. The `none` status comes from the default case in `mapPaddleStatusToSubscriptionStatus`. | No functional issue; the CHECK constraint is just permissive. |

---

## Test Matrix

| Scenario | Edge Function | Paddle API | Webhook Event | Final DB State | UI State |
|----------|--------------|------------|---------------|----------------|----------|
| EMBER -> FLAME (upgrade) | paddle-update-subscription | PATCH /subscriptions/{id} | subscription.updated | tier=FLAME, status=active, cancel_at_period_end=false | "Current Plan" on FLAME |
| FLAME -> EMBER (downgrade) | paddle-update-subscription | PATCH /subscriptions/{id} | subscription.updated | tier=EMBER, status=active | **Not reachable from UI** |
| FLAME monthly -> annual | paddle-update-subscription | PATCH /subscriptions/{id} | subscription.updated | tier=FLAME, price_id=pri_flame_annual | **Not reachable from UI** |
| Cancel FLAME | paddle-cancel-subscription | POST /subscriptions/{id}/cancel | subscription.updated (scheduled) | tier=FLAME, status=active, cancel_at_period_end=true | "Cancels on {date}" |
| Period end after cancel | N/A (webhook-driven) | N/A | subscription.canceled | tier=FLAME, status=canceled | "Subscribe" buttons |
| Resume after cancel | N/A | N/A | N/A | N/A | **Not implemented** |
| FREE user tries update | paddle-update-subscription | N/A (rejected at validation) | N/A | No change | 400 "No active subscription found" |
| Already on same plan | paddle-update-subscription | N/A (rejected at validation) | N/A | No change | 400 "Already on this plan" |
