-- =============================================================================
-- Fix #507: local_profiles FK constraints and backfill
-- =============================================================================

-- Step 1: Backfill a "default" local_profiles row for every auth user that
-- doesn't already have one.  This guarantees the FK target row exists before
-- any personal_records normalization.
INSERT INTO public.local_profiles (user_id, id, name, device_id)
SELECT au.id, 'default', 'Default', 'server'
FROM auth.users au
WHERE NOT EXISTS (
    SELECT 1
    FROM public.local_profiles lp
    WHERE lp.user_id = au.id
      AND lp.id = 'default'
)
ON CONFLICT (user_id, id) DO NOTHING;

-- Step 2: Fix ON DELETE SET NULL on all 5 composite FK constraints.
-- The original ON DELETE SET NULL tries to null BOTH (user_id, local_profile_id),
-- but user_id is NOT NULL, so deleting a local_profiles row would fail.
-- PG 15+ supports SET NULL (column_list) to null only local_profile_id.

-- personal_records
ALTER TABLE public.personal_records DROP CONSTRAINT IF EXISTS fk_personal_records_profile;
ALTER TABLE public.personal_records
  ADD CONSTRAINT fk_personal_records_profile
  FOREIGN KEY (user_id, local_profile_id)
  REFERENCES public.local_profiles(user_id, id)
  ON DELETE SET NULL (local_profile_id)
  NOT VALID;

-- workout_sessions
ALTER TABLE public.workout_sessions DROP CONSTRAINT IF EXISTS fk_workout_sessions_profile;
ALTER TABLE public.workout_sessions
  ADD CONSTRAINT fk_workout_sessions_profile
  FOREIGN KEY (user_id, local_profile_id)
  REFERENCES public.local_profiles(user_id, id)
  ON DELETE SET NULL (local_profile_id)
  NOT VALID;

-- routines
ALTER TABLE public.routines DROP CONSTRAINT IF EXISTS fk_routines_profile;
ALTER TABLE public.routines
  ADD CONSTRAINT fk_routines_profile
  FOREIGN KEY (user_id, local_profile_id)
  REFERENCES public.local_profiles(user_id, id)
  ON DELETE SET NULL (local_profile_id)
  NOT VALID;

-- training_cycles
ALTER TABLE public.training_cycles DROP CONSTRAINT IF EXISTS fk_training_cycles_profile;
ALTER TABLE public.training_cycles
  ADD CONSTRAINT fk_training_cycles_profile
  FOREIGN KEY (user_id, local_profile_id)
  REFERENCES public.local_profiles(user_id, id)
  ON DELETE SET NULL (local_profile_id)
  NOT VALID;

-- exercise_progress
ALTER TABLE public.exercise_progress DROP CONSTRAINT IF EXISTS fk_exercise_progress_profile;
ALTER TABLE public.exercise_progress
  ADD CONSTRAINT fk_exercise_progress_profile
  FOREIGN KEY (user_id, local_profile_id)
  REFERENCES public.local_profiles(user_id, id)
  ON DELETE SET NULL (local_profile_id)
  NOT VALID;

-- Step 3: Normalize NULL-scoped personal_records to "default" for users that
-- now have a "default" local_profiles row (i.e., everyone after the backfill).
-- This prevents identity-key dedup divergence between NULL and "default".
UPDATE public.personal_records pr
SET local_profile_id = 'default',
    updated_at = NOW()
WHERE pr.local_profile_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.local_profiles lp
    WHERE lp.user_id = pr.user_id
      AND lp.id = 'default'
  );

-- Step 4: Update handle_new_user() to also create a default local_profiles row
-- at sign-up time, so the FK target always exists for first-time sync pushes.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NULLIF(split_part(NEW.email, '@', 1), ''), 'User'))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.local_profiles (user_id, id, name, device_id)
  VALUES (NEW.id, 'default', 'Default', 'server')
  ON CONFLICT (user_id, id) DO NOTHING;

  RETURN NEW;
END;
$$;
