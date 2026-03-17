-- Migration: Fix subscriptions table for Paddle billing
-- Adds Paddle-specific columns, drops unused RevenueCat/Stripe legacy columns,
-- and updates status constraint to allow 'none'.

BEGIN;

-- 1. Add Paddle-specific columns
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS paddle_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS price_id TEXT;

-- 2. Drop legacy columns (confirmed empty — no data to migrate)
ALTER TABLE public.subscriptions
  DROP COLUMN IF EXISTS revenuecat_customer_id,
  DROP COLUMN IF EXISTS product_id,
  DROP COLUMN IF EXISTS entitlement_ids,
  DROP COLUMN IF EXISTS store;

-- 3. Update status constraint to include 'none'
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status = ANY (ARRAY['active', 'past_due', 'canceled', 'trialing', 'incomplete', 'none']));

COMMIT;
