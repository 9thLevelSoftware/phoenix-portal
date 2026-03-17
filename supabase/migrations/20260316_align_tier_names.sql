-- Migration: Align subscription tier names with frontend
-- PHOENIX → EMBER, ELITE → FLAME, add INFERNO
--
-- Database is fresh (no existing subscribers), so no data migration needed.
-- This is a constraint + RLS policy update only.

BEGIN;

-- ============================================================
-- 1. Replace CHECK constraint on subscriptions.tier
-- ============================================================
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_tier_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_tier_check
  CHECK (tier IN ('FREE', 'EMBER', 'FLAME', 'INFERNO'));

-- ============================================================
-- 2. Update RLS policy on community_comments
--    Old: IN ('PHOENIX', 'ELITE')
--    New: IN ('EMBER', 'FLAME', 'INFERNO')
-- ============================================================
DROP POLICY IF EXISTS "Premium users can post comments"
  ON public.community_comments;

CREATE POLICY "Premium users can post comments"
  ON public.community_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.user_subscription_tier() IN ('EMBER', 'FLAME', 'INFERNO')
  );

COMMIT;
