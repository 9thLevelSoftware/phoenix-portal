-- Add per-set reps column to routine_exercises (mirrors per_set_weights / per_set_rest)
-- Fixes: editing reps on one set cascading to all sets (issue #35)
ALTER TABLE public.routine_exercises
  ADD COLUMN IF NOT EXISTS per_set_reps jsonb DEFAULT NULL;

COMMENT ON COLUMN public.routine_exercises.per_set_reps
  IS 'JSON array of per-set rep targets, e.g. [10,8,6]. NULL = uniform (use reps column).';

-- Add is_bodyweight column — was in the save payload but missing from schema (silent data loss)
ALTER TABLE public.routine_exercises
  ADD COLUMN IF NOT EXISTS is_bodyweight boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.routine_exercises.is_bodyweight
  IS 'When true, exercise uses bodyweight only (no external load).';
