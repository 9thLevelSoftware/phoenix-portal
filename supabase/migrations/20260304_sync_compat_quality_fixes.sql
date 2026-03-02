-- =============================================================================
-- Migration: Quality fixes for sync-compat migrations (20260302_*)
-- Date: 2026-03-04
-- Phase: 23 (Portal DB Foundation + RLS)
--
-- Fixes discovered during Phase 23 planning:
-- 1. Bare auth.uid() in gamification RLS policies → (select auth.uid()) wrapper
--    (Supabase lint 0003_auth_rls_initplan, ~20x perf via initPlan caching)
-- 2. Missing TO authenticated on INSERT policies
-- 3. superset_id column type UUID → TEXT (CONTEXT.md Decision 3)
-- 4. routine_session_id column type UUID → TEXT (CONTEXT.md requirement)
-- =============================================================================

BEGIN;

-- =============================================================================
-- Section 1: rpg_attributes — replace all 3 policies
-- Strategy: CREATE new policy (different name) BEFORE DROP to close security gap
-- Old names use "RPG" (uppercase); new names use "rpg" (lowercase)
-- =============================================================================

-- SELECT: replace with wrapped auth.uid()
CREATE POLICY "Users can view own rpg attributes"
  ON rpg_attributes FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can view own RPG attributes" ON rpg_attributes;

-- INSERT: replace with wrapped auth.uid() + TO authenticated
CREATE POLICY "Users can insert rpg attributes"
  ON rpg_attributes FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can insert own RPG attributes" ON rpg_attributes;

-- UPDATE: replace with wrapped auth.uid()
CREATE POLICY "Users can update rpg attributes"
  ON rpg_attributes FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can update own RPG attributes" ON rpg_attributes;

-- =============================================================================
-- Section 2: earned_badges — replace all 3 policies
-- Same CREATE-before-DROP pattern
-- =============================================================================

-- SELECT
CREATE POLICY "Users can view earned badges"
  ON earned_badges FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can view own badges" ON earned_badges;

-- INSERT
CREATE POLICY "Users can insert earned badges"
  ON earned_badges FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can insert own badges" ON earned_badges;

-- DELETE
CREATE POLICY "Users can delete earned badges"
  ON earned_badges FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can delete own badges" ON earned_badges;

-- =============================================================================
-- Section 3: gamification_stats — replace all 3 policies
-- Same CREATE-before-DROP pattern
-- =============================================================================

-- SELECT
CREATE POLICY "Users can view gamification stats"
  ON gamification_stats FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can view own gamification stats" ON gamification_stats;

-- INSERT
CREATE POLICY "Users can insert gamification stats"
  ON gamification_stats FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can insert own gamification stats" ON gamification_stats;

-- UPDATE
CREATE POLICY "Users can update gamification stats"
  ON gamification_stats FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can update own gamification stats" ON gamification_stats;

-- =============================================================================
-- Section 4: Fix column types (UUID → TEXT)
-- routine_exercises.superset_id: UUID → TEXT (CONTEXT.md Decision 3)
-- Column may have UUID values stored — TEXT accepts all UUID strings, no data loss.
-- workout_sessions.routine_session_id: UUID → TEXT (CONTEXT.md requirement)
-- Mobile DTO: both fields are String? (not restricted to UUID format)
-- =============================================================================

-- routine_exercises.superset_id: UUID → TEXT (CONTEXT.md Decision 3)
-- Column may have UUID values stored — TEXT accepts all UUID strings so no data loss
ALTER TABLE routine_exercises ALTER COLUMN superset_id TYPE TEXT;

-- workout_sessions.routine_session_id: UUID → TEXT (CONTEXT.md requirement)
ALTER TABLE workout_sessions ALTER COLUMN routine_session_id TYPE TEXT;

COMMIT;
