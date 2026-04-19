-- Beta audit: performance index, single active cycle constraint, personal_records wire fields,
-- workout_sessions UPDATE policy WITH CHECK (R-C03).

-- P-C01: routine_exercises lookups by routine_id (mobile-sync-push orphan cleanup)
CREATE INDEX IF NOT EXISTS idx_routine_exercises_routine_id
  ON public.routine_exercises(routine_id);

-- C16: at most one active training cycle per user per profile (local_profile_id NULL treated as distinct bucket)
CREATE UNIQUE INDEX IF NOT EXISTS idx_training_cycles_one_active
  ON public.training_cycles(user_id, COALESCE(local_profile_id, ''))
  WHERE status = 'active';

-- C13: personal_records fields expected by mobile sync pull DTO
-- Use NUMERIC for weight to match sets.weight_kg / exercise_progress.max_weight_kg;
-- REAL (single-precision float) introduces rounding drift when comparing PRs.
ALTER TABLE public.personal_records
  ADD COLUMN IF NOT EXISTS weight_kg NUMERIC;
-- Force-promote to NUMERIC on preview branches that already ran an earlier
-- version of this migration with REAL.
ALTER TABLE public.personal_records
  ALTER COLUMN weight_kg TYPE NUMERIC USING weight_kg::NUMERIC;
ALTER TABLE public.personal_records
  ADD COLUMN IF NOT EXISTS reps INTEGER;
ALTER TABLE public.personal_records
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.workout_sessions(id) ON DELETE SET NULL;

-- C18: routines.estimated_duration is now stored as seconds (new write path).
-- Historically the portal wrote minutes while the mobile client wrote seconds,
-- so the column contains a mix. A blanket `* 60` would corrupt rows already
-- in seconds (e.g. a 30-minute routine synced from mobile as 1800 would
-- become 108000, i.e. 30 hours). Use an exercise-count-aware heuristic instead:
-- the current write path contributes at least one 2.5-minute set per exercise,
-- so a seconds-based value is always >= exercise_count * 150. Anything below
-- that floor cannot already be stored in seconds and is therefore legacy minutes.
UPDATE public.routines
  SET estimated_duration = estimated_duration * 60
  WHERE estimated_duration IS NOT NULL
    AND estimated_duration > 0
    AND estimated_duration < GREATEST(exercise_count, 1) * 150;

-- R-C03: prevent user_id reassignment on workout_sessions UPDATE
DROP POLICY IF EXISTS "Users can update own sessions" ON public.workout_sessions;
CREATE POLICY "Users can update own sessions"
  ON public.workout_sessions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
