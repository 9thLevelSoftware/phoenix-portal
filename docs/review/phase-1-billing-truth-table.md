# Phase 1: Paddle Billing Webhook Truth Table

**Date:** 2026-03-18
**Auditor:** Backend Architect Agent (Task 1.2)
**Scope:** All Paddle webhook event types handled by `paddle-webhooks/index.ts`, their mapping to DB state and UI behavior.

---

## Source Files Reviewed

| File | Purpose |
|---|---|
| `supabase/functions/paddle-webhooks/index.ts` | Webhook handler (Edge Function) |
| `supabase/functions/_shared/requireSubscription.ts` | Server-side subscription gate (Edge Functions) |
| `src/hooks/useSubscription.ts` | Client-side subscription query hook |
| `src/app/components/SubscriptionGate.tsx` | Client-side UI gate component |
| `src/lib/pricing.ts` | Tier definitions and pricing |
| `src/lib/paddle.ts` | Client-side paddle utilities (shared mapping functions) |

---

## Key Mapping Functions

### `mapPaddleStatusToSubscriptionStatus()` (webhook handler lines 100-115)

| Paddle `data.status` | Portal `status` column |
|---|---|
| `active` | `active` |
| `trialing` | `trialing` |
| `paused` | `canceled` |
| `canceled` | `canceled` |
| `past_due` | `past_due` |
| _(anything else)_ | `none` |

### `mapPriceIdToTier()` (webhook handler lines 77-93)

| Env var match | Portal `tier` column |
|---|---|
| Price ID in `PADDLE_INFERNO_PRICE_IDS` | `INFERNO` |
| Price ID in `PADDLE_FLAME_PRICE_IDS` | `FLAME` |
| Price ID in `PADDLE_EMBER_PRICE_IDS` | `EMBER` |
| No match / empty | `FREE` |

### `cancel_at_period_end` derivation (webhook handler lines 214-221)

```
isCanceled = event_type === "subscription.canceled"
          OR data.scheduled_change.action === "cancel"

isPaused   = event_type === "subscription.paused"
          OR data.scheduled_change.action === "pause"

cancel_at_period_end = isCanceled OR isPaused
```

---

## Access Control Summary

There are **two independent access control mechanisms** with different logic:

### 1. Server-side: `requireSubscription()` (Edge Functions)

- Queries `subscriptions` table filtered by `status IN ('active', 'trialing')`
- Compares `tier` against required minimum tier
- **Denies access when status is anything other than `active` or `trialing`** (including `past_due`, `canceled`, `none`)
- When denied, returns 402 response

### 2. Client-side: `SubscriptionGate` component + `useSubscription()` hook

- `useSubscription()` fetches from `subscriptions` table with **NO status filter** -- returns whatever `tier` is in the row
- `SubscriptionGate` compares `tier` level only, **never checks `status`**
- `isPremium` is derived as `tier !== "FREE"`, also **status-agnostic**
- Components using `isPremium`, `isFlame`, `isInferno` also do not check status

**CRITICAL FINDING:** The server-side and client-side gates use fundamentally different logic. A user with `status = 'canceled'` and `tier = 'FLAME'` will:
- Be **denied** by server-side `requireSubscription()` (status not in `active`/`trialing`)
- Be **granted access** by client-side `SubscriptionGate` (tier >= required tier)

This discrepancy is documented further in the Edge Cases section below.

---

## Complete Truth Table

### Event 1: `subscription.created`

Paddle fires this when a new subscription is created (after first successful payment or trial start).

| Field | Value |
|---|---|
| **Paddle event type** | `subscription.created` |
| **Typical Paddle `data.status`** | `active` (paid) or `trialing` (free trial) |
| **Portal status after mapping** | `active` or `trialing` |
| **Tier after mapping** | Determined by `items[0].price.id` -- `EMBER`, `FLAME`, or `INFERNO` |
| **`cancel_at_period_end`** | `false` (no scheduled_change on creation) |
| **Server-side access** | GRANTED -- status is `active` or `trialing` |
| **Client-side access** | GRANTED -- tier is not `FREE` |
| **Duration of access** | Until subscription status changes |

---

### Event 2: `subscription.updated`

Paddle fires this on plan changes, payment method updates, billing period changes, or when a scheduled change is added.

| Field | Value |
|---|---|
| **Paddle event type** | `subscription.updated` |
| **Typical Paddle `data.status`** | `active` (most updates), could also be `past_due` or `trialing` |
| **Portal status after mapping** | Matches input: `active`, `past_due`, or `trialing` |
| **Tier after mapping** | Re-derived from `items[0].price.id` -- could change if plan upgraded/downgraded |
| **`cancel_at_period_end`** | `true` if `scheduled_change.action === "cancel"` or `"pause"`, else `false` |
| **Server-side access** | GRANTED if `active`/`trialing`; DENIED if `past_due` |
| **Client-side access** | GRANTED if tier is not `FREE` (status-agnostic) |
| **Duration of access** | Until next status change |

**Sub-scenarios:**

| Update scenario | `data.status` | Portal status | `cancel_at_period_end` | Access |
|---|---|---|---|---|
| Plan upgrade (EMBER -> FLAME) | `active` | `active` | `false` | Full access at new tier |
| Plan downgrade (FLAME -> EMBER) | `active` | `active` | `false` | Access at new (lower) tier |
| User schedules cancellation | `active` | `active` | `true` (scheduled_change.action = "cancel") | Access until period end |
| User schedules pause | `active` | `active` | `true` (scheduled_change.action = "pause") | Access until period end |
| Payment fails (Paddle retry) | `past_due` | `past_due` | depends on scheduled_change | **SERVER: DENIED, CLIENT: GRANTED** |
| User removes scheduled cancel | `active` | `active` | `false` (scheduled_change cleared) | Full access restored |

---

### Event 3: `subscription.canceled`

Paddle fires this when the cancellation becomes effective (end of billing period, or immediate).

| Field | Value |
|---|---|
| **Paddle event type** | `subscription.canceled` |
| **Typical Paddle `data.status`** | `canceled` |
| **Portal status after mapping** | `canceled` |
| **Tier after mapping** | Preserved from last `items[0].price.id` (e.g. still `FLAME`) |
| **`cancel_at_period_end`** | `true` (hardcoded: event_type matches `subscription.canceled`) |
| **Server-side access** | DENIED -- status `canceled` is not in `('active', 'trialing')` |
| **Client-side access** | **GRANTED** -- tier is still whatever it was (not `FREE`) |
| **Duration of (incorrect) client access** | Until page refresh re-fetches from DB... but `useSubscription()` has no status filter, so it will STILL show the old tier |

**BUG:** When `subscription.canceled` fires, the DB row gets `status = 'canceled'` and `tier = 'FLAME'` (or whatever the tier was). The client-side `SubscriptionGate` only checks tier, so the user sees premium content. Server-side calls correctly deny access. This creates an inconsistent experience where the UI shows premium content but API calls to Edge Functions fail with 402.

---

### Event 4: `subscription.paused`

Paddle fires this when a pause takes effect (Paddle supports pause/resume natively).

| Field | Value |
|---|---|
| **Paddle event type** | `subscription.paused` |
| **Typical Paddle `data.status`** | `paused` |
| **Portal status after mapping** | `canceled` (line 107: `paused` maps to `canceled`) |
| **Tier after mapping** | Preserved from last `items[0].price.id` |
| **`cancel_at_period_end`** | `true` (hardcoded: event_type matches `subscription.paused`) |
| **Server-side access** | DENIED -- status `canceled` is not in `('active', 'trialing')` |
| **Client-side access** | **GRANTED** -- same tier-only bug as canceled |
| **Duration of (incorrect) client access** | Indefinite until subscription row is cleaned up or user logs out and back in |

**Note:** Mapping `paused` to `canceled` is a deliberate design choice (line 107). The semantic difference is lost in the DB. If the product later needs to distinguish "paused (will resume)" from "canceled (gone forever)" for UI messaging, this mapping makes that impossible. The `cancel_at_period_end = true` flag partially compensates but does not carry the original Paddle status.

---

### Event 5: `subscription.resumed`

Paddle fires this when a paused subscription is resumed.

| Field | Value |
|---|---|
| **Paddle event type** | `subscription.resumed` |
| **Typical Paddle `data.status`** | `active` |
| **Portal status after mapping** | `active` |
| **Tier after mapping** | Re-derived from `items[0].price.id` |
| **`cancel_at_period_end`** | `false` (no cancel/pause event type or scheduled_change) |
| **Server-side access** | GRANTED -- status is `active` |
| **Client-side access** | GRANTED -- tier is not `FREE` |
| **Duration of access** | Normal subscription lifecycle |

This event correctly restores full access after a pause.

---

### Event 6: `subscription.activated`

Paddle fires this when a subscription moves from `trialing` to `active` (first real payment collected after trial ends).

| Field | Value |
|---|---|
| **Paddle event type** | `subscription.activated` |
| **Typical Paddle `data.status`** | `active` |
| **Portal status after mapping** | `active` |
| **Tier after mapping** | Re-derived from `items[0].price.id` |
| **`cancel_at_period_end`** | `false` |
| **Server-side access** | GRANTED |
| **Client-side access** | GRANTED |
| **Duration of access** | Normal subscription lifecycle |

**Observation:** This event is in the `handledEvents` array (line 173) and flows through the generic upsert path. It works correctly because Paddle sends `data.status = "active"` and the mapping function handles that. There is no special-case handling needed. The status transition from `trialing` to `active` in the DB happens naturally via the upsert.

---

## Unhandled Event Types

### `subscription.past_due` -- DOES NOT EXIST as a Paddle event type

Paddle does not fire a discrete `subscription.past_due` event. Instead, when a payment fails:
1. Paddle fires `transaction.payment_failed` (not a subscription event -- silently 200'd by the unhandled events path)
2. Paddle fires `subscription.updated` with `data.status = "past_due"`

So the `past_due` status IS handled, but via `subscription.updated`, not via a dedicated event type. The `mapPaddleStatusToSubscriptionStatus()` function correctly maps `past_due` to `past_due` (line 110-111).

**However:** `past_due` status is NOT in the `requireSubscription()` allowed list (`active`, `trialing`). This means a past_due user is immediately denied server-side access. Whether this is correct depends on business requirements:
- **Strict approach (current):** Deny immediately on first failed payment.
- **Lenient approach:** Allow access during Paddle's automatic retry window (typically 1-3 retry attempts over days).

### `transaction.completed` and `transaction.payment_failed`

These are listed in the `PaddleEventType` type in `src/lib/paddle.ts` but are NOT in the `handledEvents` array in the webhook handler. They are silently acknowledged with 200 (no DB update). This is acceptable since subscription-level status changes are what matter.

---

## Edge Case Analysis

### Question 1: When `paused` maps to `canceled`, does `requireSubscription()` correctly deny access?

**YES.** `requireSubscription()` queries with `.in('status', ['active', 'trialing'])` (line 42). Since `paused` maps to `canceled` in the DB, and `canceled` is not in the allowed set, the server correctly denies access.

**However**, the client-side `SubscriptionGate` does NOT check status at all. It only checks tier level. So a paused user with `tier = 'FLAME'` will still see premium content in the UI, but any Edge Function calls they trigger will fail with 402. This is the same inconsistency noted above.

### Question 2: Is `subscription.activated` handled correctly?

**YES.** It is in the `handledEvents` array and follows the standard upsert path. Paddle sends `data.status = "active"` with this event, so `mapPaddleStatusToSubscriptionStatus()` returns `active`. The tier is re-derived from the price ID. No special-case logic is needed.

### Question 3: Does `subscription.past_due` get handled? Should it be?

**`subscription.past_due` does not exist as a Paddle event type.** Paddle signals past_due status via `subscription.updated` with `data.status = "past_due"`. The status mapping function correctly handles this value (line 110-111), mapping it to `past_due` in the DB.

The current behavior immediately locks the user out of server-side features. Whether `past_due` should be treated as a grace period with continued access is a business decision. If a grace period is desired, `requireSubscription()` would need to add `past_due` to its allowed status list (with appropriate time-boxing).

### Question 4: When a subscription is canceled at period end, what tier does the user keep until the period ends?

**The user keeps their full tier until... they don't.** Here is the exact sequence:

1. User clicks "Cancel" in Paddle portal
2. Paddle fires `subscription.updated` with `data.status = "active"` and `scheduled_change.action = "cancel"`
3. Webhook writes: `status = 'active'`, `tier = 'FLAME'`, `cancel_at_period_end = true`
4. **User retains full access** -- status is `active`, tier is unchanged
5. At period end, Paddle fires `subscription.canceled` with `data.status = "canceled"`
6. Webhook writes: `status = 'canceled'`, `tier = 'FLAME'`, `cancel_at_period_end = true`
7. **Server-side access denied** -- status is no longer `active`/`trialing`
8. **Client-side access still granted** -- `SubscriptionGate` only checks tier, which is still `FLAME`

The period-end transition (step 5-8) is where the client/server discrepancy manifests. The tier column is never reset to `FREE` on cancellation -- it preserves the last-known tier. Only the status changes.

---

## Bugs and Issues Found

### BUG-1 (Severity: HIGH) -- Client-side gate does not check subscription status

**Location:** `src/app/components/SubscriptionGate.tsx` line 35, `src/hooks/useSubscription.ts` lines 94-104

**Problem:** `SubscriptionGate` only checks `TIER_LEVEL[tier] >= TIER_LEVEL[requiredTier]`. The `useSubscription()` hook exposes `isPremium` as `tier !== "FREE"`. Neither checks `status`. When a subscription is canceled/paused/past_due, the `tier` column retains its value (e.g. `FLAME`), so the client-side gate continues granting access.

**Impact:** Users with `canceled`, `paused`, or `past_due` subscriptions see premium UI content but get 402 errors from Edge Functions. This creates a broken UX where features appear available but fail when used.

**Affected components** (all use `useSubscription().isPremium` or `SubscriptionGate` without status checks):
- `ComparisonView.tsx` (isPremium)
- `Goals.tsx` (isPremium, isInferno)
- `GoalDashboardWidget.tsx` (isPremium)
- `Integrations.tsx` (isPremium)
- `Recovery.tsx` (isPremium)
- `RecoveryDashboardWidget.tsx` (isPremium)
- `SessionDetail.tsx` (isPremium)
- `WorkoutHistory.tsx` (isPremium)
- `SessionReplay.tsx` (isInferno)
- `CommentThread.tsx` (isPremium)

**Fix:** `useSubscription()` should derive `isPremium`, `isFlame`, `isInferno`, and `tier` (for `SubscriptionGate`) from BOTH the tier AND the status. When status is not `active` or `trialing`, the effective tier should be `FREE`.

### BUG-2 (Severity: MEDIUM) -- Tier column never resets to FREE on cancellation

**Location:** `supabase/functions/paddle-webhooks/index.ts` lines 209-235

**Problem:** When `subscription.canceled` fires, the upsert writes `status = 'canceled'` but derives `tier` from `items[0].price.id`, which still reflects the canceled plan's price. The tier column is never set to `FREE`.

**Impact:** This is only a problem because of BUG-1. If the client-side gate checked status, this would be a non-issue (the tier would be informational, showing "what plan you had"). However, combined with BUG-1, it means canceled users retain apparent access.

**Note:** Resetting tier to `FREE` on cancellation would be one fix, but it would lose the "last known tier" information. A better approach is to fix BUG-1 by having the client check status, and treat the tier column as "which plan this subscription is/was for."

### ISSUE-1 (Severity: LOW) -- Paused vs. canceled distinction lost

**Location:** `supabase/functions/paddle-webhooks/index.ts` line 107

**Problem:** `paused` maps to `canceled` in the portal status. If the product later needs to show "Your subscription is paused -- resume anytime" vs. "Your subscription was canceled", the current schema cannot distinguish these states.

**Fix if needed:** Add `paused` as a distinct portal status. Update `requireSubscription()` and client-side hooks accordingly.

### ISSUE-2 (Severity: LOW) -- No grace period for past_due

**Location:** `supabase/functions/_shared/requireSubscription.ts` line 42

**Problem:** A single failed payment immediately locks the user out of server-side features. Paddle retries payments automatically (typically 2-3 retries over several days). During this retry window, the user has no access.

**Fix if needed:** Add `past_due` to the allowed statuses in `requireSubscription()`, or implement a time-boxed grace period check using `current_period_end`.

---

## Summary Matrix

| Paddle Event | Paddle `data.status` | DB `status` | DB `tier` | `cancel_at_period_end` | Server Access | Client Access | Consistent? |
|---|---|---|---|---|---|---|---|
| `subscription.created` | `active` | `active` | from price | `false` | GRANTED | GRANTED | YES |
| `subscription.created` | `trialing` | `trialing` | from price | `false` | GRANTED | GRANTED | YES |
| `subscription.updated` | `active` | `active` | from price | varies | GRANTED | GRANTED | YES |
| `subscription.updated` | `active` + sched cancel | `active` | from price | `true` | GRANTED | GRANTED | YES |
| `subscription.updated` | `past_due` | `past_due` | from price | varies | **DENIED** | **GRANTED** | **NO** |
| `subscription.canceled` | `canceled` | `canceled` | from price (stale) | `true` | **DENIED** | **GRANTED** | **NO** |
| `subscription.paused` | `paused` | `canceled` | from price (stale) | `true` | **DENIED** | **GRANTED** | **NO** |
| `subscription.resumed` | `active` | `active` | from price | `false` | GRANTED | GRANTED | YES |
| `subscription.activated` | `active` | `active` | from price | `false` | GRANTED | GRANTED | YES |

**4 of 9 scenarios have inconsistent server/client access decisions.** All four share the same root cause: the client-side gate ignores subscription status.

---

## Recommended Fixes (Priority Order)

1. **[HIGH] Fix `useSubscription()` to factor in status.** When status is not `active` or `trialing`, return effective tier as `FREE` and `isPremium` as `false`. This single change fixes all 4 inconsistent scenarios and all 10+ affected components.

2. **[MEDIUM] Consider a `past_due` grace period.** Add `past_due` to `requireSubscription()` allowed statuses, possibly time-boxed to `current_period_end`. This is a business/product decision.

3. **[LOW] Preserve `paused` as a distinct status.** If the product roadmap includes pause/resume messaging, add `paused` to the portal status enum now rather than later.

---

## Schema Verification (Task 1.1)

**Date:** 2026-03-18
**Auditor:** Backend Architect Agent
**Method:** Traced all 5 migrations in order, cross-referenced against both upsert code paths and all read paths.

### Migration Trace

| # | Migration File | Operations on `subscriptions` |
|---|---|---|
| 1 | `00001_create_subscriptions.sql` | CREATE TABLE with 11 columns; CREATE `profiles` table with `stripe_customer_id` |
| 2 | `20260303_revenuecat_schema_migration.sql` | DROP `stripe_customer_id`, `stripe_subscription_id`, `price_id`; ADD `revenuecat_customer_id`, `product_id`, `entitlement_ids`, `store`, `environment`, `last_event_id`; ALTER `current_period_start` DROP NOT NULL |
| 3 | `20260316_align_tier_names.sql` | Replace tier CHECK: `FREE,PHOENIX,ELITE` -> `FREE,EMBER,FLAME,INFERNO` |
| 4 | `20260317_paddle_schema_fix.sql` | ADD `paddle_customer_id`, `paddle_subscription_id`, `price_id`; DROP `revenuecat_customer_id`, `product_id`, `entitlement_ids`, `store`; Replace status CHECK to add `none` |
| 5 | `20260318120000_fix_period_end_nullable.sql` | ALTER `current_period_end` DROP NOT NULL |

### Final Column Set (subscriptions table)

| Column | Type | Nullable | Default | Constraint | Added By | Written By Code | Read By Code |
|---|---|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | Migration 1 | auto-generated | data-export |
| `user_id` | UUID | NOT NULL | -- | UNIQUE, FK -> auth.users | Migration 1 | webhook upsert, paddle.ts | all subscription queries |
| `tier` | TEXT | NOT NULL | -- | CHECK: `FREE,EMBER,FLAME,INFERNO` | Migration 1, updated 3 | webhook upsert, paddle.ts | useSubscription, requireSubscription, SubscriptionGate, data-export |
| `status` | TEXT | NOT NULL | -- | CHECK: `active,past_due,canceled,trialing,incomplete,none` | Migration 1, updated 4 | webhook upsert, paddle.ts | useSubscription, requireSubscription, data-export |
| `current_period_start` | TIMESTAMPTZ | NULL | -- | -- | Migration 1, relaxed 2 | webhook upsert, paddle.ts | data-export |
| `current_period_end` | TIMESTAMPTZ | NULL | -- | -- | Migration 1, relaxed 5 | webhook upsert, paddle.ts | useSubscription, PricingPlans, Profile, data-export |
| `cancel_at_period_end` | BOOLEAN | NULL | `false` | -- | Migration 1 | webhook upsert, paddle.ts | useSubscription, PricingPlans, Profile, data-export |
| `created_at` | TIMESTAMPTZ | NULL | `NOW()` | -- | Migration 1 | auto-default | data-export |
| `updated_at` | TIMESTAMPTZ | NULL | `NOW()` | -- | Migration 1 | webhook upsert, paddle.ts | data-export |
| `paddle_customer_id` | TEXT | NULL | -- | -- | Migration 4 | webhook upsert, paddle.ts | -- (never read by app code) |
| `paddle_subscription_id` | TEXT | NULL | -- | -- | Migration 4 | webhook upsert, paddle.ts | paddle-update-subscription, paddle-cancel-subscription |
| `price_id` | TEXT | NULL | -- | -- | Migration 1 (dropped 2, re-added 4) | webhook upsert, paddle.ts | paddle-update-subscription |
| `environment` | TEXT | NULL | `'PRODUCTION'` | -- | Migration 2 | **NEVER WRITTEN** | **NEVER READ** |
| `last_event_id` | TEXT | NULL | -- | -- | Migration 2 | webhook upsert, paddle.ts | webhook idempotency check |

**Total: 14 columns** (13 active + 1 orphaned)

### Upsert Field Verification

Both upsert code paths (Edge Function and client-side `buildSubscriptionUpsert()`) write identical column sets. Verified field by field:

| Upsert Field | Edge Function (line 223-235) | paddle.ts (line 174-186) | Column Exists | Type Compatible |
|---|---|---|---|---|
| `user_id` | `event.data.custom_data.user_id` (string) | `data.custom_data.user_id` (string) | YES | YES (UUID text) |
| `paddle_customer_id` | `event.data.customer_id` (string) | `data.customer_id` (string) | YES | YES (TEXT) |
| `paddle_subscription_id` | `event.data.id` (string) | `data.id` (string) | YES | YES (TEXT) |
| `tier` | `mapPriceIdToTier(priceId)` (string) | `tierResolver(priceId)` (string) | YES | YES (TEXT with CHECK) |
| `status` | `mapPaddleStatusToSubscriptionStatus()` (string) | `mapPaddleStatusToSubscriptionStatus()` (string) | YES | YES (TEXT with CHECK) |
| `price_id` | `priceId \|\| null` (string/null) | `priceId \|\| null` (string/null) | YES | YES (TEXT NULL) |
| `current_period_start` | `...starts_at ?? null` (string/null) | `...starts_at ?? null` (string/null) | YES | YES (TIMESTAMPTZ NULL) |
| `current_period_end` | `...ends_at ?? null` (string/null) | `...ends_at ?? null` (string/null) | YES | YES (TIMESTAMPTZ NULL, fixed by Migration 5) |
| `cancel_at_period_end` | `isCanceled \|\| isPaused` (boolean) | `isCanceled \|\| isPaused` (boolean) | YES | YES (BOOLEAN) |
| `last_event_id` | `event.event_id` (string) | `event.event_id` (string) | YES | YES (TEXT) |
| `updated_at` | `new Date().toISOString()` (string) | `new Date().toISOString()` (string) | YES | YES (TIMESTAMPTZ) |

**Result: All 11 upsert fields verified. No missing columns, no type mismatches.**

### Orphaned Column Analysis

#### 1. `subscriptions.environment` -- ORPHANED (Severity: LOW)

- **Added by:** Migration 2 (RevenueCat schema, `20260303`)
- **Never dropped:** Migration 4 (Paddle schema fix, `20260317`) dropped `revenuecat_customer_id`, `product_id`, `entitlement_ids`, `store` -- but missed `environment`
- **Written by:** No code writes to it. The Paddle webhook handler does not include `environment` in its upsert payload. New rows get the DEFAULT value `'PRODUCTION'`.
- **Read by:** No application code reads it. The column appears only in `database.types.ts` (auto-generated).
- **Impact:** Dead weight in the schema. Every new subscription row gets `environment = 'PRODUCTION'` from the DEFAULT, which is meaningless in the Paddle context.
- **Recommended action:** Drop in a cleanup migration. No data loss risk (column is either NULL or the default `'PRODUCTION'` for all rows).

#### 2. `subscriptions.stripe_customer_id` -- ALREADY DROPPED

- **Added by:** Migration 1 (`00001_create_subscriptions.sql`)
- **Dropped by:** Migration 2 (`20260303_revenuecat_schema_migration.sql`, line 28)
- **Status:** Does not exist in the final schema. Confirmed.

#### 3. `subscriptions.stripe_subscription_id` -- ALREADY DROPPED

- **Added by:** Migration 1 (`00001_create_subscriptions.sql`)
- **Dropped by:** Migration 2 (`20260303_revenuecat_schema_migration.sql`, line 29)
- **Status:** Does not exist in the final schema. Confirmed.

#### 4. `profiles.stripe_customer_id` -- ORPHANED (Severity: MEDIUM)

- **Added by:** Migration 1 (`00001_create_subscriptions.sql`, line 10) as part of the original Stripe integration
- **Never dropped:** No migration removes this column from the `profiles` table
- **Written by:** No application code writes to it. The `useUpdateProfile` mutation writes only display_name, avatar_url, weight_unit, and notification preferences.
- **Read by:** No application code reads it. The `profileOptions` query explicitly selects `display_name, avatar_url, created_at, weight_unit, email_digests, push_notifications, streak_reminders, challenge_updates, profile_visible, leaderboard_participation` -- it does NOT select `stripe_customer_id`.
- **Impact:** Dead column on the profiles table with a UNIQUE constraint consuming index space. Since Paddle uses `paddle_customer_id` on the subscriptions table, this Stripe-era column is entirely vestigial.
- **Recommended action:** Drop in a cleanup migration: `ALTER TABLE profiles DROP COLUMN IF EXISTS stripe_customer_id;`

#### 5. `subscriptions.paddle_customer_id` -- WRITTEN BUT NEVER READ (Severity: INFO)

- **Written by:** Both upsert paths write `event.data.customer_id` to this column
- **Read by:** No application code or Edge Function ever reads it. The `paddle-update-subscription` and `paddle-cancel-subscription` Edge Functions read `paddle_subscription_id` and `price_id` but not `paddle_customer_id`.
- **Impact:** Not harmful -- it provides useful audit/debugging data and could be needed for future Paddle API calls. Keeping it is reasonable.
- **Recommended action:** Keep. Mark as audit/reference data in schema comments.

### Generated Types Drift

The `database.types.ts` file is **stale** relative to the current schema:

| Issue | Types File | Actual DB (after all migrations) |
|---|---|---|
| `current_period_end` in Row | `string` (non-null) | `TIMESTAMPTZ NULL` (nullable after Migration 5) |
| `current_period_end` in Insert | `string` (required, non-null) | nullable, not required |
| `environment` in types | Present | Present but orphaned -- should be dropped |
| `profiles.stripe_customer_id` in types | Present | Present but orphaned -- should be dropped |

The `useSubscription` hook already declares `currentPeriodEnd: string | null` in its interface (line 19), so the client code handles null correctly. However, the generated types file does not reflect the nullable constraint, which means TypeScript will not flag unsafe non-null access patterns.

**Recommended action:** Regenerate types with `npm run gen:types` after applying any cleanup migrations.

### Summary of Findings

| Finding | Severity | Action Required |
|---|---|---|
| All upsert fields verified against schema | -- | None (PASS) |
| Edge Function and paddle.ts upsert payloads match | -- | None (PASS) |
| `subscriptions.environment` orphaned | LOW | Drop in cleanup migration |
| `profiles.stripe_customer_id` orphaned | MEDIUM | Drop in cleanup migration (has unused UNIQUE index) |
| `subscriptions.paddle_customer_id` written but never read | INFO | Keep (audit data) |
| `database.types.ts` stale for `current_period_end` nullability | MEDIUM | Regenerate after cleanup migration |
| `stripe_customer_id` on subscriptions | -- | Confirmed already dropped (PASS) |
| `stripe_subscription_id` on subscriptions | -- | Confirmed already dropped (PASS) |

---
---

# Security Audit: Webhook Signature Verification & Tier Gating (Tasks 1.5 & 1.6)

**Date:** 2026-03-18
**Auditor:** Security Engineer
**Scope:** Signature verification in `paddle-webhooks/index.ts`, subscription enforcement path from webhook to UI
**Branch:** `beta-readiness-review`

---

## Section A: Webhook Signature Verification (Task 1.5)

**File:** `supabase/functions/paddle-webhooks/index.ts`, lines 22-69

### A.1 Algorithm Verification

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| HMAC algorithm | SHA-256 | `{ name: "HMAC", hash: "SHA-256" }` (line 42) | PASS |
| Payload format | `ts:rawBody` | `` `${ts}:${rawBody}` `` (line 47) | PASS |
| Signature header parsed | `ts=<timestamp>;h1=<hmac_hex>` | Split on `;`, extract `ts=` and `h1=` prefixes (lines 27-34) | PASS |
| Web Crypto API used | Yes | `crypto.subtle.importKey` + `crypto.subtle.sign` (lines 39-52) | PASS |

**Assessment:** The HMAC-SHA256 computation matches the Paddle Billing webhook specification. The payload is correctly assembled as `timestamp:rawBody` before signing.

### A.2 Timing-Safe Comparison

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Length check before comparison | Yes | `computedHex.length !== expectedHex.length` (line 59) | PASS |
| XOR-based constant-time loop | Yes | `mismatch \|= a[i] ^ b[i]` (line 66) | PASS |
| Accumulator checked at end | Yes | `return mismatch === 0` (line 68) | PASS |

**Assessment:** The timing-safe comparison is correctly implemented. The length pre-check at line 59 is acceptable because HMAC-SHA256 output is always 64 hex characters; a length mismatch indicates a malformed or forged header, not a partial-match timing leak.

### A.3 Raw Body Handling

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Raw body read before JSON parse | Yes | `req.text()` at line 135, `JSON.parse()` at line 157 | PASS |
| No intermediate body consumption | Yes | Single `req.text()` call, reused for both verify and parse | PASS |

**Assessment:** Correct. The raw body is captured once via `req.text()`, then passed to signature verification and only parsed after verification succeeds. This prevents JSON serialization differences from invalidating signatures.

### A.4 Error Handling on Missing/Malformed Signature

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Missing webhook secret -> 401 | Yes | `!webhookSecret` check at line 141, returns 401 | PASS |
| Missing Paddle-Signature header -> 401 | Yes | `!signatureHeader` check at line 141, returns 401 | PASS |
| Invalid signature -> 401 | Yes | `!isValid` check at line 149, returns 401 | PASS |
| Malformed header (no ts= or h1=) -> false | Yes | Early return `false` at line 31 | PASS |

**Assessment:** All rejection paths correctly return HTTP 401. No information leakage in error messages (generic "Unauthorized" / "Invalid signature").

### A.5 Idempotency Guard

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Duplicate event detection | Yes | `last_event_id` comparison at lines 196-207 | PASS |
| Duplicate returns 200 (no retry) | Yes | Returns `{ received: true, duplicate: true }` with 200 | PASS |
| Event ID persisted on upsert | Yes | `last_event_id: event.event_id` at line 233 | PASS |

**Assessment:** Idempotency guard prevents exact-replay of the most recent event and prevents Paddle retry storms.

### A.6 FINDING SIG-01: Missing Timestamp Validation (Replay Attack Window)

**Severity: MEDIUM (CVSS 5.3)**
**CVSS Vector:** AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:L/A:L

**Description:** The `verifyPaddleSignature()` function extracts the timestamp (`ts`) from the `Paddle-Signature` header at line 33 but never validates its age. Paddle recommends rejecting signatures older than 5 minutes to prevent replay attacks. An attacker who intercepts a valid webhook payload (via network-level MITM, log exfiltration, or compromised endpoint) could replay it indefinitely.

**Current state:** The `ts` value is extracted and included in the HMAC payload (correct -- prevents timestamp tampering), but the timestamp age is never checked against server time.

**Impact:** An attacker with a captured valid webhook could:
- Replay a `subscription.created` event to restore a canceled subscription
- Replay a `subscription.canceled` event to cancel an active subscription
- The idempotency check (lines 196-207) mitigates EXACT replays of the same `event_id`, but does NOT protect against replaying an older event whose `event_id` differs from the current `last_event_id` (e.g., replaying a `subscription.created` event after a newer `subscription.canceled` event has been processed)

**Mitigating factors:**
- Attacker must first obtain a valid signed webhook payload (requires network compromise or log access)
- The idempotency guard blocks exact-replay of the most recent event
- Paddle signs the body including `ts`, so an attacker cannot forge a new timestamp

**Remediation:** Add a timestamp age check after extracting `ts` at line 33:

```typescript
// After line 36 (if (!ts || !expectedHex) return false;):
const TS_MAX_AGE_SECONDS = 300; // 5 minutes
const timestampAge = Math.floor(Date.now() / 1000) - parseInt(ts, 10);
if (isNaN(timestampAge) || timestampAge < 0 || timestampAge > TS_MAX_AGE_SECONDS) {
  return false;
}
```

**Timeline:** Address before beta launch. Low urgency for private beta since exploitation requires prior compromise of a signed payload.

### A.7 FINDING SIG-02: CORS Allow-Origin Wildcard on Webhook Endpoint

**Severity: LOW (CVSS 2.0)**

**Description:** The `corsHeaders` object at lines 8-12 sets `Access-Control-Allow-Origin: *`. While functionally harmless for a server-to-server webhook endpoint (browsers do not send Paddle webhooks), it represents a configuration hygiene issue.

**Remediation:** Remove CORS headers entirely from this endpoint, or set to empty string. Paddle sends server-to-server requests and does not use CORS.

**Timeline:** Low priority, address as part of general hardening.

---

## Section B: Subscription Tier Gating Path (Task 1.6)

### B.1 Server-Side Gate: `requireSubscription()`

**File:** `supabase/functions/_shared/requireSubscription.ts`

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Tier hierarchy defined | FREE < EMBER < FLAME < INFERNO | `TIER_LEVEL: { FREE: 0, EMBER: 1, FLAME: 2, INFERNO: 3 }` (lines 7-12) | PASS |
| Status filter applied | active, trialing only | `.in('status', ['active', 'trialing'])` (line 42) | PASS |
| Null/missing subscription defaults to FREE | Yes | `?? 'FREE'` fallback at line 45 | PASS |
| Rejection returns 402 | Yes | Returns `{ status: 402, error: 'subscription_required' }` (lines 53-61) | PASS |
| Reads from authoritative DB | Yes | Supabase query with service role key | PASS |

**Assessment:** Correct server-side enforcement. The function queries `subscriptions` directly using the service role key, filtering for active/trialing statuses only. This is the authoritative access control and it is sound.

### B.2 Server-Side Gate Adoption Across Edge Functions

| Edge Function | Required Tier | Gate Present | Status |
|---------------|---------------|--------------|--------|
| `fitbit-sync` | FLAME | Yes (line 199) | PASS |
| `strava-sync` | FLAME | Yes (line 173) | PASS |
| `hevy-sync` | FLAME | Yes (line 92) | PASS |
| `garmin-webhook` | FLAME | Yes (line 178) | PASS |
| `liftosaur-sync` | FLAME | Yes (line 129) | PASS |
| `process-sync-queue` | FLAME | Yes (line 62) | PASS |
| `mobile-sync-push` | EMBER | Yes (line 253) | PASS |

**Assessment:** All data-mutating Edge Functions that serve premium features enforce server-side tier gating. Tier requirements are consistent (FLAME for third-party integrations, EMBER for mobile sync).

### B.3 Client-Side Gate: `SubscriptionGate` Component

**File:** `src/app/components/SubscriptionGate.tsx`

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Tier hierarchy matches server | Yes | Same `TIER_LEVEL` mapping (lines 9-14) | PASS |
| Loading state handled | Yes | Shows `Skeleton` during load (lines 31-33) | PASS |
| Insufficient tier shows upgrade prompt | Yes | `UpgradePrompt` fallback (lines 41-46) | PASS |

**Usage across the codebase:**

| Component | Required Tier | Feature Gated |
|-----------|---------------|---------------|
| `Biomechanics.tsx` | INFERNO | Biomechanics analysis |
| `Analytics.tsx` (performance tab) | INFERNO | Biomechanics in analytics |
| `SessionReplay.tsx` | INFERNO | Session replay |
| `Integrations.tsx` | FLAME | Third-party integrations |
| `SessionDetail.tsx` | FLAME | Session comparison |
| `SubscribedRoute` wrapper | EMBER (default) | Route-level gate |

### B.4 Can a User Bypass Tier Gating by Manipulating the Client-Side Query?

**Answer: No. Defense in depth is correctly implemented.**

| Attack Vector | Mitigated By | Status |
|---------------|--------------|--------|
| Modify client-side tier value in DevTools/memory | Server-side `requireSubscription()` on all Edge Functions | MITIGATED |
| Direct Supabase query to UPDATE subscription tier | RLS: only SELECT policy exists for authenticated users (no INSERT/UPDATE/DELETE) | MITIGATED |
| Forge a Paddle webhook to grant a higher tier | HMAC-SHA256 signature verification | MITIGATED |
| Replay an older webhook to restore a canceled tier | Idempotency guard (partial); no timestamp validation (see SIG-01) | PARTIALLY MITIGATED |
| Call Edge Function directly without valid subscription | 402 response from `requireSubscription()` | MITIGATED |

**Key security property:** The `subscriptions` table (created in `00001_create_subscriptions.sql`) has RLS enabled with ONLY a SELECT policy for the `authenticated` role (`auth.uid() = user_id`). There are no INSERT, UPDATE, or DELETE policies for authenticated users. Only the service role key -- used by the webhook Edge Function -- can modify subscription records. This is the correct architecture.

### B.5 Is the Tier Enforced Server-Side?

**Yes.** Every Edge Function that serves a premium feature calls `requireSubscription()` before performing the action. The function reads directly from the database with the service role key, completely independent of any client-side state or cache. Even if a user manipulates their local tier value, every server-side call re-checks against the authoritative database row.

### B.6 Webhook-to-UI Propagation and Stale Cache Window

**Propagation path:**

```
Paddle sends webhook
  -> paddle-webhooks Edge Function (service role key)
     1. Verify HMAC-SHA256 signature
     2. Map price_id to tier, Paddle status to portal status
     3. UPSERT subscriptions table
  -> Supabase Realtime detects postgres_changes on subscriptions table
  -> useSubscription hook receives Realtime event (lines 67-92)
     1. Calls invalidateQueries for subscription.byUser(userId)
  -> TanStack Query refetches from subscriptions table (RLS-filtered)
  -> SubscriptionGate re-evaluates tier, renders accordingly
```

**Cache timing:**

| Scenario | Propagation Delay | Risk |
|----------|-------------------|------|
| Realtime connected (normal) | < 1 second after DB write | None |
| Realtime disconnected | Up to 5 minutes (`staleTime: 5 * 60 * 1000` at line 63) | UI shows stale tier until refetch |
| No refetch trigger + Realtime down | Indefinite until page reload | UI indefinitely stale |

**Security assessment:** The stale cache window is a UX issue, not a security issue. Server-side enforcement via `requireSubscription()` does not use any client cache -- it always reads from the database. Even if the client shows stale tier data for up to 5 minutes, all API calls are gated server-side.

### B.7 FINDING GATE-01: Client-Side Query Does Not Filter by Subscription Status

**Severity: LOW (CVSS 2.4) from a security perspective**

NOTE: The Task 1.2 Backend Architect audit (above in this same document) rated this as HIGH from a UX/consistency perspective (BUG-1). From a pure security standpoint it is LOW because the server-side gate is the authoritative control and it IS correct. The two severity ratings are complementary -- the UX impact is real and should drive the priority, but there is no actual access control bypass.

**Description:** The client-side `fetchSubscription()` (lines 28-32 of `useSubscription.ts`) queries `subscriptions` without filtering by status. The `SubscriptionGate` component checks only `TIER_LEVEL[tier] >= TIER_LEVEL[requiredTier]`, ignoring whether the subscription is active. A user with `status = 'canceled'` and `tier = 'FLAME'` will see FLAME-gated UI content, but all Edge Function calls will fail with 402.

**Security impact:** None. The server-side `requireSubscription()` correctly filters by `status IN ('active', 'trialing')`. The client-side gate is a UX convenience layer, not a security boundary.

**UX impact:** Significant. Users see features they cannot use, leading to confusing 402 errors. This was thoroughly documented in the Task 1.2 audit above (BUG-1).

**Remediation:** Align with the Task 1.2 recommendation: update `useSubscription()` to derive effective tier from both `tier` and `status`. When status is not `active` or `trialing`, effective tier should be `FREE`.

### B.8 Database Constraint Alignment

| Constraint | DB (after all migrations) | Webhook Handler | Server Gate | Client Gate | Aligned? |
|------------|--------------------------|-----------------|-------------|-------------|----------|
| Valid tiers | FREE, EMBER, FLAME, INFERNO (`subscriptions_tier_check`) | `mapPriceIdToTier()` returns these 4 | `TIER_LEVEL` maps these 4 | `TIER_LEVEL` maps these 4 | YES |
| Valid statuses | active, past_due, canceled, trialing, incomplete, none (`subscriptions_status_check`) | `mapPaddleStatusToSubscriptionStatus()` maps to subset | Filters `active, trialing` only | No status filter | PARTIAL (see GATE-01) |
| User isolation | RLS: SELECT only on own row | Uses service role (bypasses RLS, correct) | Queries by user_id with service role | Queries by user_id, RLS enforced | YES |
| Tier DB function | `user_subscription_tier()` filters by `active, trialing` | N/A (not used in webhook) | N/A (uses own query) | N/A (uses own query) | N/A |

---

## Section C: Security Findings Summary

| ID | Severity | CVSS | Finding | Location | Category |
|----|----------|------|---------|----------|----------|
| SIG-01 | MEDIUM | 5.3 | Missing timestamp validation enables webhook replay | `paddle-webhooks/index.ts:33` | Signature Verification |
| SIG-02 | LOW | 2.0 | CORS wildcard on webhook endpoint | `paddle-webhooks/index.ts:9` | Configuration Hygiene |
| GATE-01 | LOW | 2.4 | Client query does not filter by subscription status (UX issue, not access control bypass) | `useSubscription.ts:28-32` | Tier Gating |

### What Is Correct

- HMAC-SHA256 signature verification with timing-safe comparison: **Sound**
- Raw body read before JSON parsing: **Correct**
- 401 on missing/invalid signature: **Correct**
- Idempotency guard via `last_event_id`: **Correct**
- Server-side tier gating via `requireSubscription()` on all premium Edge Functions: **Correct**
- RLS on `subscriptions` table (SELECT-only for authenticated users): **Correct**
- Realtime-based cache invalidation for fast UI updates: **Correct**
- Defense in depth (client gate + server gate + RLS + DB constraints): **Correct**

### What Needs Attention

- Add 5-minute timestamp age check in `verifyPaddleSignature()` to close replay window (SIG-01)
- Align client-side status filtering with server-side logic (GATE-01, corroborates BUG-1 from Task 1.2)
- Remove unnecessary CORS headers from webhook endpoint (SIG-02)

**Overall Assessment:** The billing security architecture is well-designed with proper defense in depth. The server-side enforcement is the authoritative control and it is correctly implemented. The two substantive findings (timestamp replay window and client-side status mismatch) should be addressed before beta launch. Neither is a security blocker for a private beta, as SIG-01 requires prior compromise of a signed payload, and GATE-01 is a UX issue with no access control bypass.
