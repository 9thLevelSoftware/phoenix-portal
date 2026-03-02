-- =============================================================================
-- Migration: exercises.user_id Denormalization + INSERT RLS Policies
-- Date: 2026-03-04
-- Phase: 23-01 (Portal DB Foundation + RLS)
-- Requirements: PORTAL-03 (INSERT RLS defense-in-depth on sync target tables)
--
-- Problem 1: exercises table lacks user_id column, so its SELECT RLS policy
-- uses a subquery JOIN (session_id IN SELECT FROM workout_sessions) — the
-- multi-hop anti-pattern described in the Supabase RLS Performance Guide.
-- This is O(n) per query instead of a simple index scan.
--
-- Problem 2: exercises, sets, rep_summaries, and rep_telemetry all lack INSERT
-- RLS policies. Phase 25 Edge Functions use service_role (which bypasses RLS),
-- but INSERT policies provide defense-in-depth for direct authenticated-role
-- PostgREST API access.
--
-- Solution:
-- 1. Denormalize user_id onto exercises (nullable → backfill → NOT NULL, no FK).
-- 2. Replace the multi-hop SELECT policy with a direct user_id equality check.
-- 3. Add INSERT WITH CHECK policies on exercises, sets, rep_summaries, and
--    rep_telemetry — all using (select auth.uid()) wrapper for initPlan caching.
--
-- Note: sets, rep_summaries, and rep_telemetry already have denormalized user_id
-- from migration 20260228_rls_denormalization.sql. Only INSERT policies are added
-- here for those three tables.
--
-- Reference: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
-- =============================================================================

BEGIN;

-- =============================================================================
-- Section 1: Denormalize user_id onto exercises table (PORTAL-03)
-- =============================================================================
-- Before: exercises -> workout_sessions -> user_id (1 JOIN via session_id)
-- After:  exercises -> user_id (direct column, no FK constraint)
--
-- No FK to auth.users — consistent with sets, rep_summaries, and rep_telemetry
-- which also use denormalized user_id without FK (see 20260228_rls_denormalization.sql).

-- Step 1: Add nullable column (no REFERENCES — matches existing denorm pattern)
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS user_id UUID;

-- Step 2: Backfill from workout_sessions via the direct FK exercises.session_id
UPDATE exercises e
SET user_id = ws.user_id
FROM workout_sessions ws
WHERE e.session_id = ws.id
  AND e.user_id IS NULL;

-- Step 3: Set NOT NULL (safe after backfill)
ALTER TABLE exercises ALTER COLUMN user_id SET NOT NULL;

-- =============================================================================
-- Section 2: Replace exercises SELECT RLS policy (PORTAL-03)
-- =============================================================================
-- Create new policy FIRST (zero security gap), then drop old multi-hop policy.
-- Old policy used session_id IN (subquery) — O(n) JOIN cost.
-- New policy uses direct user_id equality — simple index scan.

CREATE POLICY "Users can view own exercises"
  ON exercises FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view exercises in own sessions" ON exercises;

-- =============================================================================
-- Section 3: Add INSERT policy on exercises (PORTAL-03)
-- =============================================================================

CREATE POLICY "Users can insert own exercises"
  ON exercises FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

-- =============================================================================
-- Section 4: Add INSERT policies on sets, rep_summaries, rep_telemetry (PORTAL-03)
-- =============================================================================
-- These three tables already have denormalized user_id from 20260228_rls_denormalization.sql.
-- They have SELECT policies but lack INSERT policies — added here for defense-in-depth.

-- sets (user_id added in 20260228_rls_denormalization.sql)
CREATE POLICY "Users can insert own sets"
  ON sets FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

-- rep_summaries (user_id added in 20260228_rls_denormalization.sql)
CREATE POLICY "Users can insert own rep summaries"
  ON rep_summaries FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

-- rep_telemetry (user_id added in 20260228_rls_denormalization.sql)
CREATE POLICY "Users can insert own telemetry"
  ON rep_telemetry FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

-- =============================================================================
-- Section 5: Index for RLS performance on exercises.user_id
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_exercises_user_id ON exercises(user_id);

COMMIT;
