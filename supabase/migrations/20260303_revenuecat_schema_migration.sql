-- Migration: Evolve subscriptions table from Stripe to RevenueCat
-- Phase 21-01: Database Schema Migration
--
-- Strategy: Drop Stripe-specific columns, add RevenueCat columns, preserve
-- tier/status/period columns so user_subscription_tier(), RLS policies,
-- Realtime, and useSubscription hook need ZERO changes.
--
-- CRITICAL: This migration MUST be a single transaction. If any step fails,
-- the entire migration rolls back. This prevents the RLS gap described in
-- PITFALLS-billing-migration.md Pitfall 4.
--
-- Rollback reference (original Stripe columns):
--   stripe_customer_id TEXT NOT NULL
--   stripe_subscription_id TEXT UNIQUE NOT NULL
--   price_id TEXT NOT NULL

BEGIN;

-- ============================================================
-- Step 1: Drop Stripe-specific constraints and columns
-- ============================================================
-- Drop the unique constraint on stripe_subscription_id first
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_stripe_subscription_id_key;

-- Drop Stripe columns (these are Stripe-specific identifiers with no RevenueCat equivalent)
ALTER TABLE public.subscriptions
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS stripe_subscription_id,
  DROP COLUMN IF EXISTS price_id;

-- ============================================================
-- Step 2: Add RevenueCat-specific columns
-- ============================================================
-- revenuecat_customer_id: The RevenueCat customer identifier (may differ from app_user_id if aliases are used)
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS revenuecat_customer_id TEXT;

-- product_id: The RevenueCat product identifier (e.g., "com.phoenix.monthly")
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS product_id TEXT;

-- entitlement_ids: Array of active RevenueCat entitlement IDs (e.g., ["phoenix"] or ["elite"])
-- Used for tier mapping: "elite" -> ELITE, "phoenix" -> PHOENIX, empty -> FREE
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS entitlement_ids TEXT[] DEFAULT '{}';

-- store: The originating app store (APP_STORE, PLAY_STORE, STRIPE, PROMOTIONAL, etc.)
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS store TEXT;

-- environment: PRODUCTION or SANDBOX (for filtering test events)
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS environment TEXT DEFAULT 'PRODUCTION';

-- last_event_id: Last processed RevenueCat webhook event ID for idempotency
-- See PITFALLS-billing-migration.md Pitfall 8
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS last_event_id TEXT;

-- ============================================================
-- Step 3: Relax NOT NULL constraint on current_period_start
-- ============================================================
-- RevenueCat may not always include purchased_at_ms in every event type.
-- The critical column is current_period_end (expiration), which is always present.
ALTER TABLE public.subscriptions
  ALTER COLUMN current_period_start DROP NOT NULL;

-- ============================================================
-- Step 4: Verify preserved columns (documentation only)
-- ============================================================
-- The following columns are UNCHANGED and must remain as-is:
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid()
--   user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE (UNIQUE)
--   tier TEXT NOT NULL CHECK (tier IN ('FREE', 'PHOENIX', 'ELITE'))
--   status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'incomplete'))
--   current_period_end TIMESTAMPTZ NOT NULL
--   cancel_at_period_end BOOLEAN DEFAULT FALSE
--   created_at TIMESTAMPTZ DEFAULT NOW()
--   updated_at TIMESTAMPTZ DEFAULT NOW()
--
-- user_subscription_tier() reads: tier, status (WHERE status IN ('active', 'trialing'))
-- useSubscription reads: tier, status, current_period_end, cancel_at_period_end
-- RLS policies call: user_subscription_tier() -> reads tier from this table
-- Realtime: postgres_changes on this table (already in supabase_realtime publication)

-- ============================================================
-- Step 5: Add comment documenting the new schema purpose
-- ============================================================
COMMENT ON TABLE public.subscriptions IS
  'Subscription status synced from RevenueCat webhooks. One row per user. '
  'Tier/status columns consumed by user_subscription_tier() RLS function, '
  'useSubscription hook, and SubscriptionGate component. '
  'Migrated from Stripe in v1.3 Phase 21.';

COMMIT;
