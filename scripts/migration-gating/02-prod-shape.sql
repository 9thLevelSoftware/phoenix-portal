-- The shape NF-8 says production already has, applied WITHOUT running
-- 20260920007600. Running the migration against a database in this state must
-- be a complete no-op (zero `reconcile:` NOTICEs) -- that is the PR's
-- "no-op against a prod-shaped schema" acceptance criterion, expressed as
-- something CI can fail on instead of a paragraph in a header.
--
-- Hand-written on purpose: if this file were generated from the migration the
-- check would prove nothing. Keep it in step with the eight facts in the
-- migration header when prod's real catalog is finally read.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'routine_exercises'
      AND column_name = 'per_set_echo_levels' AND data_type <> 'jsonb'
  ) THEN
    ALTER TABLE public.routine_exercises
      ALTER COLUMN per_set_echo_levels TYPE jsonb
      USING to_jsonb(per_set_echo_levels);
  END IF;
END
$$;

UPDATE public.routines
  SET created_at = coalesce(created_at, updated_at, now()),
      updated_at = coalesce(updated_at, created_at, now())
  WHERE created_at IS NULL OR updated_at IS NULL;

ALTER TABLE public.routines
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

UPDATE public.training_cycles SET updated_at = now() WHERE updated_at IS NULL;

ALTER TABLE public.training_cycles
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS digest_frequency text DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS digest_last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS feature_flags jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.user_goals ADD COLUMN IF NOT EXISTS last_snapshot_at timestamptz;

COMMIT;
