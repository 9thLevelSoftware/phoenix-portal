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
ALTER TABLE public.personal_records
  ADD COLUMN IF NOT EXISTS weight_kg REAL;
ALTER TABLE public.personal_records
  ADD COLUMN IF NOT EXISTS reps INTEGER;
ALTER TABLE public.personal_records
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.workout_sessions(id) ON DELETE SET NULL;

-- C18: routines.estimated_duration stored as seconds (historically minutes)
UPDATE public.routines
  SET estimated_duration = estimated_duration * 60
  WHERE estimated_duration IS NOT NULL AND estimated_duration < 86400;

-- R-C03: prevent user_id reassignment on workout_sessions UPDATE
DROP POLICY IF EXISTS "Users can update own sessions" ON public.workout_sessions;
CREATE POLICY "Users can update own sessions"
  ON public.workout_sessions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
