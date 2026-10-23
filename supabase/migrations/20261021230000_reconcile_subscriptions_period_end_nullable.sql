-- Reconcile subscriptions.current_period_end nullability with the chain.
--
-- 20260318120000_fix_period_end_nullable dropped NOT NULL so a canceled or
-- paused subscription, which Paddle sends without a current_billing_period,
-- can be stored with a null period end. Production records that version with
-- its statement, but on 2026-10-21 prod's column was still NOT NULL
-- (information_schema.columns.is_nullable = 'NO'). Every canceled write from
-- apply_subscription_event failed with 23502, paddle-webhooks answered 500,
-- and prod held no canceled subscription rows at all.
--
-- DROP NOT NULL on a nullable column does nothing, so this is a no-op on a
-- clean apply (20260318120000 already ran) and safe to re-run.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.subscriptions
  ALTER COLUMN current_period_end DROP NOT NULL;

COMMIT;
