-- Reverse the eight column facts that 20260920007600 reconciles, so the
-- migration's catalog gates have something to fire on.
--
-- This is the state a clean apply of the chain UP TO 20260920007600 leaves
-- behind. It is deliberately hand-written rather than derived from the
-- migration, so that a change to the migration's gates cannot silently change
-- what "drifted" means.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'routine_exercises'
      AND column_name = 'per_set_echo_levels' AND data_type = 'jsonb'
  ) THEN
    ALTER TABLE public.routine_exercises
      ALTER COLUMN per_set_echo_levels TYPE text
      USING per_set_echo_levels #>> '{}';
  END IF;
END
$$;

ALTER TABLE public.routines
  ALTER COLUMN created_at DROP NOT NULL,
  ALTER COLUMN created_at DROP DEFAULT,
  ALTER COLUMN updated_at DROP NOT NULL,
  ALTER COLUMN updated_at DROP DEFAULT;

ALTER TABLE public.training_cycles
  ALTER COLUMN updated_at DROP NOT NULL,
  ALTER COLUMN updated_at DROP DEFAULT;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS digest_frequency,
  DROP COLUMN IF EXISTS digest_last_sent_at,
  DROP COLUMN IF EXISTS feature_flags;

ALTER TABLE public.user_goals DROP COLUMN IF EXISTS last_snapshot_at;

COMMIT;
