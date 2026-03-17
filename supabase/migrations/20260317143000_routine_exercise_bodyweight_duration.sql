-- Migration: bodyweight and duration support for routine builder exercises
ALTER TABLE routine_exercises
  ADD COLUMN IF NOT EXISTS is_bodyweight BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duration_seconds INT;

COMMENT ON COLUMN routine_exercises.is_bodyweight IS
  'When true, exercise uses bodyweight only with no external load.';
COMMENT ON COLUMN routine_exercises.duration_seconds IS
  'Duration in seconds for time-based exercises; NULL means rep-based.';
