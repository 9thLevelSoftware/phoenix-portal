# Paddle Subscription Upgrade Flow

**Date:** 2026-03-17
**Status:** Approved
**Scope:** Fix broken webhook DB schema, add subscription upgrade via Paddle API

## Goal

Enable users to upgrade their subscription tier through the existing pricing UI, with Paddle handling proration. Fix the underlying DB schema and webhook handler so subscription billing works end-to-end.

## Files to Modify

- `supabase/migrations/YYYYMMDD_paddle_schema_fix.sql` — new migration
- `supabase/functions/paddle-webhooks/index.ts` — fix column names in upsert
- `supabase/functions/paddle-update-subscription/index.ts` — new edge function
- `src/app/components/PricingPlans.tsx` — upgrade vs new checkout logic

## Design Sections

### 1. Database Schema Migration

**Problem:** Live DB is missing columns the webhook needs (`stripe_customer_id`, `stripe_subscription_id`, `price_id`), has unused RevenueCat columns, and the `status` constraint doesn't allow `'none'`.

**Changes:**
- Add `paddle_customer_id` (TEXT, nullable)
- Add `paddle_subscription_id` (TEXT, nullable)
- Add `price_id` (TEXT, nullable)
- Drop legacy columns: `revenuecat_customer_id`, `product_id`, `entitlement_ids`, `store`. These columns are confirmed empty — there are no existing subscription rows with data (the table was empty until a manual insert today, which only populated `user_id`, `tier`, `status`, `current_period_end`, `cancel_at_period_end`).
- Keep `environment`, `last_event_id` (both actively used)
- Update `status` check constraint to allow `'none'` in addition to existing values: `'active'`, `'past_due'`, `'canceled'`, `'trialing'`, `'incomplete'`, `'none'`

**Columns kept as-is:** `id`, `user_id`, `tier`, `status`, `current_period_start`, `current_period_end`, `cancel_at_period_end`, `created_at`, `updated_at`, `environment`, `last_event_id`

### 2. Webhook Handler Fix

**Problem:** `paddle-webhooks/index.ts` writes to `stripe_customer_id` and `stripe_subscription_id` which don't exist in the live DB.

**Changes:**
- Rename `stripe_customer_id` → `paddle_customer_id` in the upsert payload
- Rename `stripe_subscription_id` → `paddle_subscription_id` in the upsert payload
- `price_id` stays as-is (column will exist after migration)
- No other logic changes — signature verification, tier mapping, and status mapping are all correct

### 3. New Edge Function — `paddle-update-subscription`

**Purpose:** Update an existing Paddle subscription's price (for tier upgrades).

**Endpoint:** `POST /functions/v1/paddle-update-subscription`

**Auth:** JWT-verified. Follow the established auth pattern from `delete-account/index.ts`: create a user-scoped Supabase client from the `Authorization` header, call `supabase.auth.getUser()`. Use a separate service-role client for DB queries.

**CORS:** Import `getCorsHeaders` from `../_shared/cors.ts`, matching the pattern used by all other authenticated edge functions.

**Request body:**
```json
{ "price_id": "pri_xxxxx" }
```

**Flow:**
1. Get authenticated user from JWT (user-scoped client + `auth.getUser()`)
2. Query `subscriptions` table (service-role client) for user's `paddle_subscription_id`, `price_id`, and `status`
3. If no subscription, status not in `['active', 'trialing']`, or no `paddle_subscription_id` → return 400 error
4. If `price_id` matches the requested price → return 400 (no-op, same plan)
5. Call Paddle API: `PATCH {paddleBaseUrl}/subscriptions/{id}` with:
   - `items: [{ price_id: newPriceId, quantity: 1 }]`
   - `proration_billing_mode: "prorated_immediately"` (charges the difference right away)
   - Authorization: `Bearer {PADDLE_API_KEY}`
6. Return success — the actual tier change happens when Paddle fires the `subscription.updated` webhook back to `paddle-webhooks`

**Environment variables needed:**
- `PADDLE_API_KEY` — Paddle server-side API key (must be set in Supabase Edge Function secrets)

**Paddle API URL selection:**
- Use the `PADDLE_ENVIRONMENT` env var (already used by the frontend via `VITE_PADDLE_ENVIRONMENT`):
  - If `PADDLE_ENVIRONMENT=sandbox` → `https://sandbox-api.paddle.com`
  - Otherwise → `https://api.paddle.com`
- Do NOT read from the `environment` column (it may be NULL for manually-inserted rows).

**Error cases:**
- Not authenticated → 401
- No active/trialing subscription → 400 `{ "error": "No active subscription found" }`
- Same price as current → 400 `{ "error": "Already on this plan" }`
- Paddle API error → 502 with Paddle's error message forwarded

**Paddle webhook events during upgrade:** When a subscription is updated via `PATCH /subscriptions/{id}`, Paddle fires `subscription.updated`. The existing webhook handler already handles this event type, so no additional webhook handling is needed. To be verified during manual testing.

### 4. Frontend — Upgrade vs New Checkout

**Problem:** `PricingPlans.tsx` always calls `openCheckout()` regardless of subscription state.

**Changes to `PricingPlans.tsx`:**
- Import `useSubscription` hook to get current `tier`, `status`
- **Upgrade eligible statuses:** `active` and `trialing` only. Users with `past_due`, `canceled`, `incomplete`, or `none` status must use the normal checkout flow (new subscription).
- If user has an upgrade-eligible subscription and clicks a **higher** tier:
  - Call the `paddle-update-subscription` edge function via `supabase.functions.invoke('paddle-update-subscription', { body: { price_id } })`
  - Show a loading state on the button during the API call
  - On success, show toast: "Subscription updated! Changes may take a moment to reflect."
  - Invalidate the subscription query to trigger a refetch
- If user has **no subscription** (FREE tier) or non-eligible status:
  - Keep current behavior — `openCheckout()` as normal
- Button text:
  - Free users: "Subscribe"
  - Existing subscribers on a higher tier: "Upgrade"
  - Existing subscribers on the current tier: disabled, show "Current Plan"
  - Existing subscribers on a lower tier: keep existing "Included in your plan" disabled state (downgrades are out of scope)
  - Coming soon tiers: "Coming Soon" (disabled), unchanged

**Changes to `paddle-client.ts`:** None — stays as checkout-only helper.

## Out of Scope

- Paddle customer portal integration
- Cancellation flow (separate feature)
- **Downgrade flow** — users cannot downgrade to a lower tier through the UI. Only upgrades are supported. Downgrades can be handled manually via Paddle dashboard if needed.
- Annual/monthly billing period switching
- `useSubscription` hook changes (already works correctly)
- `SubscriptionGate` component changes
- Fixing inline CORS in existing `paddle-webhooks/index.ts` (cosmetic, not blocking)

## Testing

- Typecheck passes (`npm run typecheck`)
- Existing unit tests pass (`npm test`)
- Deploy edge functions to Supabase
- Apply migration to live DB
- Set `PADDLE_API_KEY` and `PADDLE_ENVIRONMENT` in Supabase Edge Function secrets
- Manual test flow:
  1. Free user subscribes to Ember via checkout → webhook fires → DB updated → UI shows Ember
  2. Ember user clicks Flame "Upgrade" → edge function calls Paddle API → Paddle fires `subscription.updated` webhook → DB updated → UI shows Flame
  3. Verify proration: Paddle charges the difference immediately
  4. Verify: Flame user sees "Current Plan" on Flame, "Upgrade" on Inferno, "Included in your plan" on Ember
