-- Migration: Allow current_period_end to be NULL
--
-- Paddle cancellation and pause webhooks may not include a
-- current_billing_period, which means current_period_end will be NULL.
-- The original schema (00001_create_subscriptions.sql) defined it as NOT NULL.
-- The RevenueCat migration (20260303) relaxed current_period_start but left
-- current_period_end as NOT NULL. This migration fixes that.

ALTER TABLE public.subscriptions
  ALTER COLUMN current_period_end DROP NOT NULL;
