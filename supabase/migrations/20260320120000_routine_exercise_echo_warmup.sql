-- Add per-set echo levels and warmup sets to routine_exercises
-- These fields are sent by mobile sync but were previously dropped
ALTER TABLE routine_exercises
  ADD COLUMN IF NOT EXISTS per_set_echo_levels text,
  ADD COLUMN IF NOT EXISTS warmup_sets text;

COMMENT ON COLUMN routine_exercises.per_set_echo_levels IS 'JSON array of echo level names per set, e.g. ["LEVEL_1","LEVEL_2","LEVEL_3"]';
COMMENT ON COLUMN routine_exercises.warmup_sets IS 'JSON array of warmup set configs, e.g. [{"reps":5,"percentOfWorking":50}]';
