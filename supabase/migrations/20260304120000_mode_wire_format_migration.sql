-- =============================================================================
-- Migration: Standardize workout mode strings to SCREAMING_SNAKE wire format
-- Date: 2026-03-04
-- Phase: 23 (Portal DB Foundation + RLS)
-- Requirement: CONTEXT.md Decision 2 — Wire Format Canonical
--
-- Problem: routine_exercises.mode and workout_sessions.workout_mode contain a
-- mix of display-name strings (from portal UI writes) and wire-format strings
-- (from prior mobile syncs). Mobile sends SCREAMING_SNAKE format exclusively.
--
-- Solution: Standardize all mode values to SCREAMING_SNAKE wire format.
-- Portal's transforms.ts already maps wire→display for UI rendering.
-- =============================================================================

BEGIN;

-- =============================================================================
-- Section 1: routine_exercises.mode — convert display names to wire format
-- =============================================================================
-- The six canonical modes are: OLD_SCHOOL, PUMP, TUT, TUT_BEAST, ECCENTRIC_ONLY, ECHO
-- POWER and CLASSIC are not canonical modes; map to OLD_SCHOOL (closest equivalent).

UPDATE routine_exercises SET mode = 'OLD_SCHOOL' WHERE mode = 'Old School';
UPDATE routine_exercises SET mode = 'PUMP' WHERE mode = 'Pump';
-- TUT is already wire format (TUT == TUT), but include for completeness
UPDATE routine_exercises SET mode = 'TUT' WHERE mode = 'Tut';
UPDATE routine_exercises SET mode = 'TUT_BEAST' WHERE mode = 'Tut Beast';
UPDATE routine_exercises SET mode = 'TUT_BEAST' WHERE mode = 'TUT Beast';
UPDATE routine_exercises SET mode = 'ECCENTRIC_ONLY' WHERE mode = 'Eccentric Only';
UPDATE routine_exercises SET mode = 'ECHO' WHERE mode = 'Echo';
-- Clean up any stale POWER values (portal had POWER in transforms.ts but mobile doesn't use it)
UPDATE routine_exercises SET mode = 'OLD_SCHOOL' WHERE mode = 'Power';
UPDATE routine_exercises SET mode = 'OLD_SCHOOL' WHERE mode = 'POWER';
UPDATE routine_exercises SET mode = 'OLD_SCHOOL' WHERE mode = 'CLASSIC';
UPDATE routine_exercises SET mode = 'OLD_SCHOOL' WHERE mode = 'Classic';

-- =============================================================================
-- Section 2: routine_exercises.mode — update DEFAULT to wire format
-- =============================================================================
-- Previously defaulted to 'Old School' (display name). Now uses wire format.

ALTER TABLE routine_exercises ALTER COLUMN mode SET DEFAULT 'OLD_SCHOOL';

-- =============================================================================
-- Section 3: workout_sessions.workout_mode — convert display names to wire format
-- =============================================================================
-- Same mapping as Section 1. workout_mode is a nullable TEXT column.

UPDATE workout_sessions SET workout_mode = 'OLD_SCHOOL' WHERE workout_mode = 'Old School';
UPDATE workout_sessions SET workout_mode = 'PUMP' WHERE workout_mode = 'Pump';
UPDATE workout_sessions SET workout_mode = 'TUT' WHERE workout_mode = 'Tut';
UPDATE workout_sessions SET workout_mode = 'TUT_BEAST' WHERE workout_mode = 'Tut Beast';
UPDATE workout_sessions SET workout_mode = 'TUT_BEAST' WHERE workout_mode = 'TUT Beast';
UPDATE workout_sessions SET workout_mode = 'ECCENTRIC_ONLY' WHERE workout_mode = 'Eccentric Only';
UPDATE workout_sessions SET workout_mode = 'ECHO' WHERE workout_mode = 'Echo';
-- Clean up stale CLASSIC/POWER values
UPDATE workout_sessions SET workout_mode = 'OLD_SCHOOL' WHERE workout_mode = 'CLASSIC';
UPDATE workout_sessions SET workout_mode = 'OLD_SCHOOL' WHERE workout_mode = 'Classic';
UPDATE workout_sessions SET workout_mode = 'OLD_SCHOOL' WHERE workout_mode = 'Power';
UPDATE workout_sessions SET workout_mode = 'OLD_SCHOOL' WHERE workout_mode = 'POWER';

COMMIT;
