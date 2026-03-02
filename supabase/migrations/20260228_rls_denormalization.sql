-- =============================================================================
-- Migration: RLS Denormalization & Subscription Table Deprecation
-- Date: 2026-02-28
-- Phase: 15-02 (CI/CD & Database Foundation)
-- Requirements: DB-01 (unify/deprecate dual subscription tables)
--               DB-02 (eliminate multi-hop JOINs in RLS policies)
--
-- Problem: RLS policies on sets, rep_summaries, and rep_telemetry traverse
-- multiple JOINs (up to 3 hops) to reach user_id via workout_sessions.
-- This is the exact anti-pattern described in the Supabase RLS Performance
-- Guide, causing O(n) joins per query instead of simple index scans.
--
-- Solution: Denormalize user_id directly onto sets, rep_summaries, and
-- rep_telemetry tables. Replace multi-hop RLS policies with direct
-- user_id equality checks using (select auth.uid()) wrapper for
-- PostgreSQL initPlan caching (~20x performance improvement).
--
-- Reference: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
-- =============================================================================

BEGIN;

-- =============================================================================
-- Section 1: Deprecate user_subscriptions table (DB-01)
-- =============================================================================
-- The mobile app uses user_subscriptions (RevenueCat). The portal uses
-- public.subscriptions (Stripe). Rather than dropping and breaking the mobile
-- app, we mark it deprecated so portal code never queries it.

-- user_subscriptions table may have been removed by RevenueCat migration
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_subscriptions') THEN
    COMMENT ON TABLE user_subscriptions IS 'DEPRECATED: RevenueCat mobile subscription table. Portal uses public.subscriptions (Stripe). Do not query from portal code. See Phase 15 DB-01.';
  END IF;
END $$;

-- =============================================================================
-- Section 2: Denormalize user_id onto sets table (DB-02)
-- =============================================================================
-- Before: sets -> exercises -> workout_sessions -> user_id (2 JOINs)
-- After:  sets -> user_id (direct column)

-- Step 1: Add nullable column
ALTER TABLE sets ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 2: Backfill from exercises -> workout_sessions
UPDATE sets s
SET user_id = ws.user_id
FROM exercises e
JOIN workout_sessions ws ON e.session_id = ws.id
WHERE s.exercise_id = e.id
  AND s.user_id IS NULL;

-- Step 3: Set NOT NULL (safe after backfill)
ALTER TABLE sets ALTER COLUMN user_id SET NOT NULL;

-- Replace RLS policy: create new FIRST, then drop old (no security gap)
CREATE POLICY "Users can view own sets"
  ON sets FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view sets in own sessions" ON sets;

-- Index for RLS performance
CREATE INDEX IF NOT EXISTS idx_sets_user_id ON sets(user_id);

-- =============================================================================
-- Section 3: Denormalize user_id onto rep_summaries table (DB-02)
-- =============================================================================
-- Before: rep_summaries -> sets -> exercises -> workout_sessions -> user_id (3 JOINs)
-- After:  rep_summaries -> user_id (direct column)

-- Step 1: Add nullable column
ALTER TABLE rep_summaries ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 2: Backfill using sets.user_id (already populated in Section 2)
UPDATE rep_summaries rs
SET user_id = s.user_id
FROM sets s
WHERE rs.set_id = s.id
  AND rs.user_id IS NULL;

-- Step 3: Set NOT NULL
ALTER TABLE rep_summaries ALTER COLUMN user_id SET NOT NULL;

-- Replace RLS policy: create new FIRST, then drop old
CREATE POLICY "Users can view own rep summaries"
  ON rep_summaries FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view rep summaries in own sessions" ON rep_summaries;

-- Index for RLS performance
CREATE INDEX IF NOT EXISTS idx_rep_summaries_user_id ON rep_summaries(user_id);

-- =============================================================================
-- Section 4: Denormalize user_id onto rep_telemetry table
-- =============================================================================
-- Same multi-hop anti-pattern as rep_summaries. Including in this migration
-- since the pattern is identical and the cost is minimal (one extra column +
-- backfill), avoiding a future single-table migration.
--
-- Before: rep_telemetry -> sets -> exercises -> workout_sessions -> user_id (3 JOINs)
-- After:  rep_telemetry -> user_id (direct column)

-- Step 1: Add nullable column
ALTER TABLE rep_telemetry ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 2: Backfill using sets.user_id (already populated in Section 2)
UPDATE rep_telemetry rt
SET user_id = s.user_id
FROM sets s
WHERE rt.set_id = s.id
  AND rt.user_id IS NULL;

-- Step 3: Set NOT NULL
ALTER TABLE rep_telemetry ALTER COLUMN user_id SET NOT NULL;

-- Replace RLS policy: create new FIRST, then drop old
CREATE POLICY "Users can view own telemetry"
  ON rep_telemetry FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view telemetry in own sessions" ON rep_telemetry;

-- Index for RLS performance
CREATE INDEX IF NOT EXISTS idx_rep_telemetry_user_id ON rep_telemetry(user_id);

COMMIT;
