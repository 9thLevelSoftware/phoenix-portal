# Architecture: RevenueCat Billing Migration

**Domain:** Stripe-to-RevenueCat subscription migration for a React/Supabase web portal
**Researched:** 2026-02-28
**Overall Confidence:** MEDIUM-HIGH

## Executive Summary

Phoenix Portal currently uses Stripe for web-based subscription billing with 3 Edge Functions (checkout, portal, webhooks), a `subscriptions` table, and a `user_subscription_tier()` helper function used in RLS policies. The mobile app already writes to a separate `user_subscriptions` table with RevenueCat data. The migration consolidates billing to RevenueCat as the single source of truth, making the portal a subscription status **consumer** rather than a billing initiator.

The core architectural change: replace Stripe's "portal initiates checkout, webhook writes status" pattern with RevenueCat's "mobile app initiates purchase, webhook syncs status to portal DB" pattern. The portal stops being a checkout flow and becomes a status display.

---

## Current Architecture (Stripe)

### Data Flow: Purchase to Portal Display

```
User clicks "Subscribe" on /pricing
        |
        v
PricingPlans.tsx -> redirectToCheckout(priceId)
        |
        v
src/lib/stripe.ts -> supabase.functions.invoke("stripe-checkout")
        |
        v
Edge Function: stripe-checkout
  - Authenticates user via JWT
  - Creates/looks up Stripe customer
  - Creates Stripe Checkout Session
  - Returns checkout URL
        |
        v
User completes payment on Stripe-hosted page
        |
        v
Stripe sends webhook POST to stripe-webhooks Edge Function
  - Verifies signature with STRIPE_WEBHOOK_SIGNING_SECRET
  - Handles: checkout.session.completed, subscription.updated/deleted,
             invoice.paid, invoice.payment_failed
  - Writes to `subscriptions` table using service_role_key (bypasses RLS)
        |
        v
subscriptions table updated (tier, status, period dates)
        |
        v
Supabase Realtime (postgres_changes) fires
        |
        v
useSubscription hook receives change, invalidates TanStack Query
        |
        v
SubscriptionGate re-evaluates, UI updates
```

### Existing Components Inventory

| Component | File | Role | Migration Impact |
|-----------|------|------|-----------------|
| `stripe-checkout` | `supabase/functions/stripe-checkout/index.ts` | Creates Checkout Session | **DELETE** |
| `stripe-portal` | `supabase/functions/stripe-portal/index.ts` | Opens billing management | **DELETE** |
| `stripe-webhooks` | `supabase/functions/stripe-webhooks/index.ts` | Processes 5 event types | **REPLACE** with `revenuecat-webhooks` |
| `delete-account` | `supabase/functions/delete-account/index.ts` | Cancels Stripe sub on deletion | **MODIFY** - remove Stripe cancellation |
| `src/lib/stripe.ts` | Client-side Stripe helpers | `redirectToCheckout`, `openCustomerPortal` | **DELETE** |
| `src/hooks/useSubscription.ts` | Reads `subscriptions` table | Returns tier/status/period | **MODIFY** - read new table schema |
| `src/app/components/PricingPlans.tsx` | Checkout flow with price IDs | Subscribe buttons call Stripe | **REWRITE** - "subscribe in app" CTAs |
| `src/app/components/Profile.tsx` | "Manage Subscription" button | Calls `openCustomerPortal()` | **MODIFY** - change to app redirect |
| `src/app/components/SubscriptionGate.tsx` | Tier gating wrapper | Reads `useSubscription` | **NO CHANGE** (reads same interface) |
| `src/app/components/UpgradePrompt.tsx` | Upgrade CTA card | Links to /pricing | **MODIFY** - "open in app" CTA |
| `src/lib/pricing.ts` | TIER_PRICING config | Price amounts per tier | **MODIFY** - prices may change, remove Stripe price IDs |
| `src/app/components/TermsOfService.tsx` | Legal text | References Stripe | **MODIFY** - update billing provider text |
| `src/app/components/PrivacyPolicy.tsx` | Legal text | References Stripe 3 times | **MODIFY** - update to RevenueCat |
| `src/lib/export/data-export.ts` | GDPR export | Excludes `stripe_customer_id` | **MODIFY** - exclude `revenuecat_customer_id` |
| `src/lib/__tests__/stripe-webhook-handlers.test.ts` | Webhook handler tests | Tests Stripe event handling | **DELETE** and replace |
| `00001_create_subscriptions.sql` | Migration | Creates subscriptions table | **NEW MIGRATION** to alter |
| `20260228_rls_denormalization.sql` | Migration | Deprecates `user_subscriptions` | **SUPERSEDED** - un-deprecate |

### Existing Database Schema

**`subscriptions` table (Stripe-powered):**
```sql
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT UNIQUE NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('FREE', 'PHOENIX', 'ELITE')),
  status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'incomplete')),
  price_id TEXT NOT NULL,
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);
```

**`user_subscriptions` table (RevenueCat, mobile-written, currently "deprecated"):**
```sql
-- Already exists in DB with these columns:
id UUID, user_id UUID, revenuecat_customer_id TEXT, product_id TEXT,
subscription_status TEXT, expires_at TIMESTAMPTZ, last_verified_at TIMESTAMPTZ,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

**`user_subscription_tier()` helper (used in RLS):**
```sql
CREATE OR REPLACE FUNCTION public.user_subscription_tier()
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT tier FROM public.subscriptions
     WHERE user_id = auth.uid()
     AND status IN ('active', 'trialing')
     LIMIT 1),
    'FREE'
  );
$$;
```

**RLS policies using `user_subscription_tier()`:**
- `community_comments` INSERT policy: requires `user_subscription_tier() IN ('PHOENIX', 'ELITE')`
- `user_goals` enforce_goal_limits trigger: checks tier for goal count limits

---

## Target Architecture (RevenueCat)

### Design Decision: Webhooks + Database, NOT REST API Polling

**Why webhooks as primary, not REST API:**
1. RevenueCat webhooks deliver within 5-60 seconds of events (cancellation within 2 hours)
2. REST API polling would need to run on every page load or on a timer -- wasteful and slower
3. The existing architecture already follows webhook-to-DB pattern (Stripe does the same thing)
4. Supabase Realtime on the subscriptions table already pushes changes to the UI instantly
5. REST API v1 `/v1/subscribers/{app_user_id}` remains available as a **fallback verifier**, not the primary source

**Confidence:** HIGH -- this matches the existing pattern and RevenueCat's recommended architecture.

### Critical Prerequisite: app_user_id = Supabase auth.uid

The mobile app MUST configure RevenueCat with the Supabase `auth.uid` as the `app_user_id`. This is the bridge between RevenueCat events and Supabase user records.

**Verification needed:** Confirm the mobile app calls `Purchases.logIn(supabaseUser.id)` after authentication. If the mobile app uses anonymous IDs (`$RCAnonymousID:...`), the webhook `app_user_id` will not match any Supabase user, and the entire integration breaks.

**Confidence:** MEDIUM -- the existing `user_subscriptions` table has a `user_id` column referencing the Supabase user, which strongly suggests the mobile app already uses Supabase UIDs. But this must be verified.

### Data Flow: Purchase to Portal Display (New)

```
User subscribes in mobile app (App Store / Play Store)
        |
        v
RevenueCat SDK processes purchase
RevenueCat identifies user by app_user_id (= Supabase auth.uid)
        |
        v
RevenueCat sends webhook POST to revenuecat-webhooks Edge Function
  - Validates Authorization header (shared secret)
  - Parses event: INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, etc.
  - Maps entitlement_ids to tier (["phoenix"] -> "PHOENIX", ["elite"] -> "ELITE")
  - Upserts into `subscriptions` table using service_role_key
        |
        v
subscriptions table updated (tier, status, expiration)
        |
        v
Supabase Realtime (postgres_changes) fires
        |
        v
useSubscription hook receives change, invalidates TanStack Query
        |
        v
SubscriptionGate re-evaluates, UI updates
        |
        (Existing flow from here is UNCHANGED)
```

### New Edge Function: revenuecat-webhooks

```
supabase/functions/revenuecat-webhooks/index.ts
```

**Responsibilities:**
1. Validate `Authorization` header against `REVENUECAT_WEBHOOK_SECRET`
2. Parse the event from `request.body.event`
3. Extract `app_user_id` (this IS the Supabase user UUID)
4. Map event type to subscription state change
5. Upsert into `subscriptions` table

**RevenueCat webhook event mapping:**

| RevenueCat Event | Action | Resulting Status |
|-----------------|--------|-----------------|
| `INITIAL_PURCHASE` | Upsert subscription row | `active` (or `trialing` if `period_type === "TRIAL"`) |
| `RENEWAL` | Update period dates, confirm active | `active` |
| `CANCELLATION` | Set `cancel_at_period_end = true` | `active` (still has access until period end) |
| `UNCANCELLATION` | Set `cancel_at_period_end = false` | `active` |
| `EXPIRATION` | Revoke access | `canceled` |
| `BILLING_ISSUE` | Flag billing problem | `past_due` |
| `PRODUCT_CHANGE` | Update tier based on new entitlements | `active` |
| `SUBSCRIPTION_EXTENDED` | Push out expiration date | `active` |
| `REFUND_REVERSED` | Restore access | `active` |
| `TEST` | Log and return 200 | (no DB change) |

**Authentication:** RevenueCat does not use cryptographic signing like Stripe. Instead, you configure a static authorization header in the RevenueCat dashboard. The Edge Function validates this header value.

```typescript
// Pseudocode for webhook auth
const authHeader = req.headers.get("Authorization");
if (authHeader !== `Bearer ${Deno.env.get("REVENUECAT_WEBHOOK_SECRET")}`) {
  return new Response("Unauthorized", { status: 401 });
}
```

**Confidence:** HIGH -- RevenueCat docs explicitly describe this auth model.

### Entitlement-to-Tier Mapping

RevenueCat uses "entitlements" as an abstraction layer over products. The webhook payload includes `entitlement_ids` (array of strings). Configure in RevenueCat dashboard:

| RevenueCat Entitlement ID | Phoenix Portal Tier | Products Attached |
|--------------------------|--------------------|--------------------|
| `phoenix` | `PHOENIX` | `com.phoenix.monthly`, `com.phoenix.annual` |
| `elite` | `ELITE` | `com.elite.monthly`, `com.elite.annual` |
| (none active) | `FREE` | (no active subscription) |

**Mapping logic in the webhook handler:**

```typescript
function mapEntitlementsToTier(entitlementIds: string[] | null): string {
  if (!entitlementIds || entitlementIds.length === 0) return "FREE";
  if (entitlementIds.includes("elite")) return "ELITE";
  if (entitlementIds.includes("phoenix")) return "PHOENIX";
  return "FREE";
}
```

**Why entitlement-based, not product-based:** Products are platform-specific (`com.ios.phoenix.monthly` vs `com.android.phoenix.monthly`). Entitlements abstract across platforms. Since Phoenix Portal serves users from both iOS and Android, entitlements are the correct mapping key.

**Confidence:** HIGH -- this is RevenueCat's explicitly recommended pattern.

### Database Schema Changes

**Option A (Recommended): Evolve the existing `subscriptions` table**

Rename Stripe columns, add RevenueCat columns, preserve the table name so all existing code (`useSubscription`, RLS function, Realtime subscription) continues working with minimal changes.

```sql
-- Migration: Migrate subscriptions table from Stripe to RevenueCat
BEGIN;

-- Step 1: Drop Stripe-specific constraints and columns
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_stripe_subscription_id_key;
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS stripe_customer_id;
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS stripe_subscription_id;
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS price_id;

-- Step 2: Add RevenueCat-specific columns
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS revenuecat_customer_id TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS product_id TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS entitlement_ids TEXT[];
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS store TEXT;  -- APP_STORE, PLAY_STORE, STRIPE, etc.
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS environment TEXT DEFAULT 'PRODUCTION';

-- Step 3: Relax NOT NULL on period columns (RevenueCat may not always send both)
ALTER TABLE public.subscriptions ALTER COLUMN current_period_start DROP NOT NULL;

-- Step 4: Add idempotency tracking
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS last_event_id TEXT;

COMMIT;
```

**Why Option A over creating a new table:**
- `useSubscription` already reads from `subscriptions` with the correct column names (`tier`, `status`, `current_period_end`, `cancel_at_period_end`)
- `user_subscription_tier()` already queries `subscriptions` -- no RLS changes needed
- Supabase Realtime is already configured on `subscriptions`
- All query keys, hooks, and components reference the same data shape

**Option B (NOT recommended): Switch to `user_subscriptions` table**

The mobile app already writes to `user_subscriptions`, but this table has a different schema (no `tier` column, uses `subscription_status` instead of `status`, no `cancel_at_period_end`). Switching would require changing every consumer.

**Confidence:** HIGH for Option A -- minimal blast radius.

### Updated `user_subscription_tier()` Function

The function already works correctly -- it reads `tier` from `subscriptions` where `status IN ('active', 'trialing')`. Since the webhook handler writes the same `tier` values (`FREE`, `PHOENIX`, `ELITE`) and the same `status` values (`active`, `trialing`, `canceled`, `past_due`), **no change is needed** to this function.

```sql
-- EXISTING -- NO CHANGES REQUIRED
CREATE OR REPLACE FUNCTION public.user_subscription_tier()
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT tier FROM public.subscriptions
     WHERE user_id = auth.uid()
     AND status IN ('active', 'trialing')
     LIMIT 1),
    'FREE'
  );
$$;
```

**Confidence:** HIGH -- the function is tier/status agnostic regarding the billing provider.

### RLS Policy Impact

**No RLS policy changes needed.** All tier-gating RLS policies call `user_subscription_tier()`, which reads from the `subscriptions` table. As long as the webhook handler writes correct `tier` and `status` values to that same table, all policies continue to work.

Policies affected (no changes, just listing for awareness):
- `community_comments` INSERT: `user_subscription_tier() IN ('PHOENIX', 'ELITE')`
- `user_goals` trigger: checks `user_subscription_tier()` for goal count limits

**Confidence:** HIGH.

---

## Component-Level Changes

### Files to DELETE (6 files)

| File | Reason |
|------|--------|
| `supabase/functions/stripe-checkout/index.ts` | No web checkout with RevenueCat |
| `supabase/functions/stripe-portal/index.ts` | No web billing portal |
| `supabase/functions/stripe-webhooks/index.ts` | Replaced by `revenuecat-webhooks` |
| `src/lib/stripe.ts` | No Stripe client-side SDK needed |
| `src/lib/__tests__/stripe-webhook-handlers.test.ts` | Tests for deleted handler |
| `@stripe/stripe-js` npm dependency | No longer needed |

### Files to CREATE (3 files)

| File | Purpose |
|------|---------|
| `supabase/functions/revenuecat-webhooks/index.ts` | New webhook handler for RevenueCat events |
| `supabase/migrations/YYYYMMDD_revenuecat_migration.sql` | Schema migration (drop Stripe cols, add RC cols) |
| `src/lib/__tests__/revenuecat-webhook-handlers.test.ts` | Tests for new webhook handler |

### Files to MODIFY (10 files)

| File | Change | Scope |
|------|--------|-------|
| `src/hooks/useSubscription.ts` | Minor: statuses stay same, types unchanged. May simplify if `trialing` is not used by RC | Small |
| `src/app/components/PricingPlans.tsx` | Major rewrite: remove checkout flow, show "Subscribe in App" CTAs, remove PRICE_IDS, remove Stripe import | Large |
| `src/app/components/Profile.tsx` | Remove `openCustomerPortal()` call, replace "Manage Subscription" with "Manage in App" or deep link | Medium |
| `src/app/components/UpgradePrompt.tsx` | Change CTA from "View Plans" link to "Subscribe in App" message | Small |
| `src/lib/pricing.ts` | Keep tier structure, potentially update prices, remove Stripe price ID references (they are in PricingPlans, not here) | Small |
| `src/app/components/TermsOfService.tsx` | Update "Stripe" references to "RevenueCat" / "App Store / Google Play" | Small |
| `src/app/components/PrivacyPolicy.tsx` | Update 3 Stripe references | Small |
| `src/lib/export/data-export.ts` | Change `stripe_customer_id` exclusion to `revenuecat_customer_id` | Small |
| `supabase/functions/delete-account/index.ts` | Remove Stripe subscription cancellation block (RevenueCat handles cancellation via app stores) | Medium |
| `src/lib/database.types.ts` | Regenerate after migration (`npm run gen:types`) | Auto-generated |

### Files UNCHANGED (critical to verify)

| File | Why Unchanged |
|------|--------------|
| `src/app/components/SubscriptionGate.tsx` | Reads `useSubscription()` which returns same interface |
| `src/app/components/TierBadge.tsx` | Reads `useSubscription()` |
| `src/queries/keys.ts` | Query key structure unchanged |
| All feature components using `useSubscription` | 10+ components -- all read the same hook interface |
| All `user_subscription_tier()` RLS consumers | Function signature unchanged |

### Environment Variables

**Remove:**
- `VITE_STRIPE_PUBLISHABLE_KEY`
- `VITE_STRIPE_PHOENIX_MONTHLY_PRICE_ID`
- `VITE_STRIPE_PHOENIX_ANNUAL_PRICE_ID`
- `VITE_STRIPE_ELITE_MONTHLY_PRICE_ID`
- `VITE_STRIPE_ELITE_ANNUAL_PRICE_ID`
- `STRIPE_SECRET_KEY` (Edge Function secret)
- `STRIPE_WEBHOOK_SIGNING_SECRET` (Edge Function secret)
- `STRIPE_PHOENIX_MONTHLY_PRICE_ID` (Edge Function secret)
- `STRIPE_PHOENIX_ANNUAL_PRICE_ID` (Edge Function secret)
- `STRIPE_ELITE_MONTHLY_PRICE_ID` (Edge Function secret)
- `STRIPE_ELITE_ANNUAL_PRICE_ID` (Edge Function secret)

**Add:**
- `REVENUECAT_WEBHOOK_SECRET` (Edge Function secret) -- shared secret for webhook auth header
- `REVENUECAT_API_KEY` (Edge Function secret, optional) -- for REST API fallback verification

**No client-side (VITE_) env vars needed** -- the portal never talks to RevenueCat directly. All communication goes through the webhook Edge Function writing to Supabase.

---

## Patterns to Follow

### Pattern 1: Entitlement-Based Tier Mapping (not Product-Based)

**What:** Map RevenueCat entitlement IDs to portal tiers, not product IDs to tiers.
**When:** Processing every webhook event that includes `entitlement_ids`.
**Why:** Products are platform-specific; entitlements are cross-platform. A user subscribing on iOS and Android gets the same entitlement.

```typescript
// GOOD: Entitlement-based
function mapEntitlementsToTier(entitlementIds: string[] | null): string {
  if (!entitlementIds?.length) return "FREE";
  if (entitlementIds.includes("elite")) return "ELITE";
  if (entitlementIds.includes("phoenix")) return "PHOENIX";
  return "FREE";
}

// BAD: Product-based (fragile, platform-specific)
function mapProductToTier(productId: string): string {
  // Must maintain mapping for every platform x billing period combination
  const map = {
    "com.ios.phoenix.monthly": "PHOENIX",
    "com.android.phoenix.monthly": "PHOENIX",
    "com.ios.phoenix.annual": "PHOENIX",
    // ... grows linearly with products
  };
}
```

### Pattern 2: Idempotent Webhook Processing

**What:** Track the last processed event ID per user to handle duplicate deliveries.
**When:** Every webhook event.
**Why:** RevenueCat documentation explicitly warns about rare duplicate deliveries.

```typescript
// Check for duplicate before processing
const { data: existing } = await supabase
  .from("subscriptions")
  .select("last_event_id")
  .eq("user_id", appUserId)
  .single();

if (existing?.last_event_id === event.id) {
  return new Response(JSON.stringify({ received: true, duplicate: true }), {
    status: 200,
  });
}

// Include event ID in upsert
await supabase.from("subscriptions").upsert({
  user_id: appUserId,
  last_event_id: event.id,
  // ... other fields
}, { onConflict: "user_id" });
```

### Pattern 3: Preserve the useSubscription Interface

**What:** Keep the `SubscriptionData` return type identical so all 10+ consumer components need zero changes.
**When:** Modifying `useSubscription.ts`.

```typescript
// This interface MUST NOT CHANGE:
interface SubscriptionData {
  tier: SubscriptionTier;           // "FREE" | "PHOENIX" | "ELITE"
  status: SubscriptionStatus;       // "active" | "past_due" | "canceled" | "trialing" | "incomplete" | "none"
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  isLoading: boolean;
  isPremium: boolean;
  isElite: boolean;
}
```

The existing `fetchSubscription` function reads from `subscriptions` table with columns `tier`, `status`, `current_period_end`, `cancel_at_period_end`. As long as the migration preserves these column names (which it does -- we only drop Stripe-specific columns and add RC-specific ones), the hook works unchanged.

### Pattern 4: Graceful Degradation for Missing Subscription

**What:** If a user has no row in `subscriptions`, treat as FREE tier.
**When:** New users who have not subscribed, or during migration window.
**Why:** The existing `useSubscription` already does this with `.maybeSingle()` returning null = FREE. The `user_subscription_tier()` function does this with COALESCE. Maintain this.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Polling RevenueCat REST API on Every Page Load

**What:** Calling `GET /v1/subscribers/{app_user_id}` from the portal to check entitlements.
**Why bad:** Adds latency to every page load, creates API rate limit risk, adds a network dependency that does not exist in the current architecture. The database is the source of truth for the portal.
**Instead:** Use webhooks to write to the database. The portal reads the database. REST API is only for emergency verification or admin tooling.

### Anti-Pattern 2: Installing @revenuecat/purchases-js

**What:** Adding the RevenueCat Web SDK (purchases-js) to the portal.
**Why bad:** The Web SDK is for initiating purchases on the web. The portal explicitly does NOT handle purchases -- billing happens in the mobile app. Installing it adds bundle weight for zero functionality, and creates a confusing code path that will never be used.
**Instead:** The portal only needs to READ subscription status from Supabase. No RevenueCat client SDK needed.

### Anti-Pattern 3: Splitting Subscriptions Across Two Tables

**What:** Reading from `user_subscriptions` (mobile-written) for some things and `subscriptions` (webhook-written) for others.
**Why bad:** Two sources of truth that can disagree. RLS policies reference one table, hooks reference another. Race conditions between mobile writes and webhook writes.
**Instead:** One table (`subscriptions`), one writer (the webhook Edge Function), multiple readers (hook, RLS function, data export).

### Anti-Pattern 4: Mapping product_id Instead of entitlement_ids

**What:** Using `event.product_id` to determine tier instead of `event.entitlement_ids`.
**Why bad:** Product IDs are platform-specific and change when you add new billing periods or platforms. Entitlements are stable identifiers configured once in the RevenueCat dashboard.
**Instead:** Always use `entitlement_ids` for tier mapping. Fall back to product_id only if entitlement_ids is unexpectedly empty (and log a warning).

---

## Recommended Architecture Diagram

```
+-------------------+     +---------------------+     +------------------+
|   Mobile App      |     |    RevenueCat        |     |  Supabase        |
|                   |     |                      |     |                  |
| User subscribes   |---->| Processes purchase   |     |                  |
| via App Store /   |     | Manages entitlements |     |                  |
| Play Store        |     |                      |     |                  |
|                   |     | Sends webhook ------->|---->| Edge Function:   |
| Sets app_user_id  |     | POST with event JSON |     | revenuecat-      |
| = auth.uid        |     | + Auth header        |     | webhooks         |
+-------------------+     +---------------------+     |                  |
                                                       | Validates auth   |
                                                       | Maps entitlements|
                                                       | Upserts to       |
                                                       | subscriptions    |
                                                       | table            |
                                                       +--------+---------+
                                                                |
                                                    Realtime (postgres_changes)
                                                                |
                                                       +--------v---------+
                                                       |  Phoenix Portal  |
                                                       |                  |
                                                       | useSubscription  |
                                                       | hook reads DB    |
                                                       |                  |
                                                       | SubscriptionGate |
                                                       | gates features   |
                                                       |                  |
                                                       | RLS policies use |
                                                       | user_subscription|
                                                       | _tier() function |
                                                       +------------------+
```

---

## Scalability Considerations

| Concern | Current (100s of users) | At 10K users | At 100K users |
|---------|------------------------|--------------|---------------|
| Webhook volume | < 10/day | ~100/day | ~1000/day |
| Edge Function cold starts | Negligible | Negligible | Still fine -- webhooks are async |
| Realtime connections | ~10 concurrent | ~500 concurrent | May need channel multiplexing |
| `user_subscription_tier()` RLS calls | Fast (indexed) | Fast (indexed) | Fast (indexed, SECURITY DEFINER cached) |
| Stale subscription data | < 60s via webhook | < 60s via webhook | < 60s via webhook, add REST API cron for safety |

At 100K+ users, consider adding a nightly cron job (Supabase pg_cron or scheduled Edge Function) that batch-verifies subscription statuses via RevenueCat REST API v1 to catch any missed webhooks.

---

## Migration Strategy: Zero-Downtime Transition

### Phase 1: Add RevenueCat webhook handler (alongside Stripe)

Both systems active. Portal reads from same `subscriptions` table. New migration adds RevenueCat columns without removing Stripe columns. This allows testing the webhook handler without breaking existing Stripe users.

### Phase 2: Verify webhook flow end-to-end

Test with a real RevenueCat sandbox subscription. Confirm:
- Webhook arrives at Edge Function
- `app_user_id` matches Supabase user
- Subscription row is created/updated correctly
- `useSubscription` hook picks up the change
- `SubscriptionGate` gates correctly
- RLS policies enforce tier correctly

### Phase 3: Migrate UI (remove Stripe checkout flow)

Replace `PricingPlans.tsx` checkout with "subscribe in app" CTAs. Remove `openCustomerPortal()` calls. Update `Profile.tsx` subscription management section.

### Phase 4: Remove Stripe infrastructure

Delete Stripe Edge Functions, `src/lib/stripe.ts`, Stripe npm dependency. Run migration to drop Stripe columns. Remove Stripe environment variables.

### Phase 5: Clean up

Update legal pages (Terms, Privacy). Update data export. Update delete-account function. Regenerate database types.

---

## Webhook Handler Implementation Sketch

```typescript
// supabase/functions/revenuecat-webhooks/index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function mapEntitlementsToTier(entitlementIds: string[] | null): string {
  if (!entitlementIds?.length) return "FREE";
  // Check highest tier first (ELITE > PHOENIX)
  if (entitlementIds.includes("elite")) return "ELITE";
  if (entitlementIds.includes("phoenix")) return "PHOENIX";
  return "FREE";
}

function mapEventToStatus(
  eventType: string,
  periodType?: string
): string | null {
  switch (eventType) {
    case "INITIAL_PURCHASE":
      return periodType === "TRIAL" ? "trialing" : "active";
    case "RENEWAL":
    case "UNCANCELLATION":
    case "SUBSCRIPTION_EXTENDED":
    case "REFUND_REVERSED":
      return "active";
    case "EXPIRATION":
      return "canceled";
    case "BILLING_ISSUE":
      return "past_due";
    case "CANCELLATION":
      // User still has access until period end -- status stays active,
      // but cancel_at_period_end becomes true
      return null; // handled separately
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  // 1. Validate authorization
  const authHeader = req.headers.get("Authorization");
  const expectedSecret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  // 2. Parse event
  const body = await req.json();
  const event = body.event;

  if (!event || !event.type) {
    return new Response(JSON.stringify({ error: "Invalid payload" }), {
      status: 400,
    });
  }

  // 3. Handle TEST event
  if (event.type === "TEST") {
    console.log("RevenueCat test webhook received");
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  // 4. Extract user ID
  const appUserId = event.app_user_id;
  if (!appUserId) {
    console.error("No app_user_id in event");
    return new Response(JSON.stringify({ error: "Missing app_user_id" }), {
      status: 400,
    });
  }

  try {
    // 5. Handle CANCELLATION specially (user keeps access, just will not renew)
    if (event.type === "CANCELLATION") {
      await supabase
        .from("subscriptions")
        .update({
          cancel_at_period_end: true,
          updated_at: new Date().toISOString(),
          last_event_id: event.id,
        })
        .eq("user_id", appUserId);

      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // 6. Map event to status
    const status = mapEventToStatus(event.type, event.period_type);
    if (!status) {
      console.log(`Unhandled event type: ${event.type}`);
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // 7. Map entitlements to tier
    const tier = mapEntitlementsToTier(event.entitlement_ids);

    // 8. Upsert subscription
    await supabase.from("subscriptions").upsert(
      {
        user_id: appUserId,
        revenuecat_customer_id: event.original_app_user_id ?? appUserId,
        tier,
        status,
        product_id: event.product_id,
        entitlement_ids: event.entitlement_ids ?? [],
        store: event.store,
        environment: event.environment,
        current_period_end: event.expiration_at_ms
          ? new Date(event.expiration_at_ms).toISOString()
          : null,
        current_period_start: event.purchased_at_ms
          ? new Date(event.purchased_at_ms).toISOString()
          : null,
        cancel_at_period_end:
          event.type === "UNCANCELLATION" ? false : undefined,
        updated_at: new Date().toISOString(),
        last_event_id: event.id,
      },
      { onConflict: "user_id" }
    );
  } catch (err) {
    console.error(`Error processing ${event.type}:`, err);
    return new Response(JSON.stringify({ error: "Handler failed" }), {
      status: 500,
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
```

---

## Suggested Build Order

Based on dependency analysis, this is the recommended implementation sequence:

| Step | Task | Depends On | Rationale |
|------|------|-----------|-----------|
| 1 | Database migration (add RC columns, keep Stripe columns temporarily) | Nothing | Foundation -- everything else reads from this table |
| 2 | Create `revenuecat-webhooks` Edge Function | Step 1 | Core integration point -- needs table ready |
| 3 | Deploy and test webhook with RevenueCat sandbox | Steps 1-2 | Validate the entire server-side pipeline before touching UI |
| 4 | Write webhook handler tests | Step 2 | Test coverage before UI changes |
| 5 | Modify `PricingPlans.tsx` (remove checkout, add "subscribe in app") | Step 3 verified | Largest UI change; depends on webhook being proven |
| 6 | Modify `Profile.tsx` (remove Manage Subscription portal) | None (parallel with 5) | Independent of webhook |
| 7 | Modify `UpgradePrompt.tsx` | None (parallel with 5) | Independent |
| 8 | Modify `delete-account` Edge Function (remove Stripe block) | None (parallel with 5) | Independent |
| 9 | Delete Stripe Edge Functions + `src/lib/stripe.ts` | Steps 5-7 complete | Only after all Stripe imports removed |
| 10 | Database migration: drop Stripe columns | Step 9 | Only after all Stripe code deleted |
| 11 | Remove `@stripe/stripe-js` npm dependency | Step 9 | Only after all Stripe imports gone |
| 12 | Update legal pages (Terms, Privacy) | None (parallel with 9) | Content change only |
| 13 | Update data export exclusions | Step 10 | Needs new column names |
| 14 | Regenerate database types (`npm run gen:types`) | Step 10 | Needs final schema |
| 15 | Update `useSubscription.ts` if needed | Step 10 | May need minor type adjustments |
| 16 | Remove Stripe env vars from `.env.example`, Edge Function secrets | Step 9 | Cleanup |
| 17 | Add RC env vars to `.env.example`, Edge Function secrets | Step 2 | Can do early |

**Critical path:** Steps 1 -> 2 -> 3 -> 5 -> 9 -> 10 -> 14

---

## Open Questions Requiring Human Verification

1. **Does the mobile app set `app_user_id` to the Supabase `auth.uid`?** If not, the webhook `app_user_id` will not match any row in auth.users, breaking the entire integration. This is the single biggest risk.

2. **What are the exact entitlement IDs configured in RevenueCat?** The architecture assumes `"phoenix"` and `"elite"` but the actual values need to be confirmed from the RevenueCat dashboard.

3. **Does the mobile app currently use the `user_subscriptions` table for anything critical?** The migration drops reliance on this table. If the mobile app reads from it, we need to coordinate.

4. **Are there existing RevenueCat sandbox credentials for testing?** The webhook handler needs to be tested with real RevenueCat events, not just unit tests.

5. **Should the portal support deep links to mobile app subscription management?** iOS has `itms-apps://apps.apple.com/account/subscriptions`, Android has `https://play.google.com/store/account/subscriptions`. These could replace the "Manage Subscription" button.

---

## Sources

- [RevenueCat Webhook Event Types and Fields](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields) -- HIGH confidence
- [RevenueCat Webhooks Configuration](https://www.revenuecat.com/docs/integrations/webhooks) -- HIGH confidence
- [RevenueCat Sample Events](https://www.revenuecat.com/docs/integrations/webhooks/sample-events) -- HIGH confidence
- [RevenueCat Common Webhook Flows](https://www.revenuecat.com/docs/integrations/webhooks/event-flows) -- HIGH confidence
- [RevenueCat API v1 Subscribers](https://www.revenuecat.com/docs/api-v1) -- MEDIUM confidence (doc page did not render fully)
- [RevenueCat Identifying Customers](https://www.revenuecat.com/docs/customers/identifying-customers) -- HIGH confidence
- [RevenueCat Entitlements](https://www.revenuecat.com/docs/getting-started/entitlements) -- HIGH confidence
- [RevenueCat Web SDK](https://www.revenuecat.com/docs/web/web-billing/web-sdk) -- HIGH confidence (confirmed NOT needed)
- [RevenueCat Community: Webhook + Supabase](https://community.revenuecat.com/third-party-integrations-53/error-extracting-app-user-id-from-webhook-in-supabase-400-user-id-not-found-6557) -- MEDIUM confidence
- [RevenueCat Community: Entitlements in v1 vs v2](https://community.revenuecat.com/general-questions-7/entitlements-in-api-v1-vs-v2-6080) -- MEDIUM confidence
