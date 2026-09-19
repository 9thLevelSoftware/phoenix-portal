-- PR 30 (KD-8): PR-goal targets become per cable.
--
-- Before PR 30 the portal showed personal_records.value doubled (x2), so
-- users entered PR-goal targets (goal_type = 'pr', MAX_WEIGHT / 1RM) against
-- that doubled figure. PR 30 shows and compares records per cable, as stored
-- and as the phone shows them. Existing PR-goal targets are halved exactly
-- once so progress stays where it was.
--
-- Frequency goals are counts. Volume goals compare workout_sessions.total_volume,
-- which was never doubled, so both are left alone.
--
-- Run-once guard: target_basis is added WITHOUT a default, so every row that
-- predates this migration has target_basis IS NULL. Only those rows are
-- converted, then marked 'per_cable'. Re-running finds no NULL rows and
-- changes nothing. New rows default to 'per_cable'.
--
-- Deploy order: apply this migration before the PR 30 SPA ships. A goal
-- created by the new SPA before this runs would otherwise be halved too.
-- No functions are created or replaced here, so no grants are needed.

ALTER TABLE public.user_goals ADD COLUMN IF NOT EXISTS target_basis TEXT;

UPDATE public.user_goals
SET target_value = target_value / 2,
    target_basis = 'per_cable',
    updated_at = now()
WHERE target_basis IS NULL
  AND goal_type = 'pr';

UPDATE public.user_goals
SET target_basis = 'per_cable'
WHERE target_basis IS NULL;

ALTER TABLE public.user_goals ALTER COLUMN target_basis SET DEFAULT 'per_cable';
ALTER TABLE public.user_goals ALTER COLUMN target_basis SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_goals_target_basis_check'
      AND conrelid = 'public.user_goals'::regclass
  ) THEN
    ALTER TABLE public.user_goals
      ADD CONSTRAINT user_goals_target_basis_check
      CHECK (target_basis = 'per_cable');
  END IF;
END $$;

COMMENT ON COLUMN public.user_goals.target_basis IS
  'Load basis of target_value. per_cable: PR-goal targets are per cable (KD-8). Pre-PR-30 PR-goal targets (doubled totals) were halved once by 20260920003000.';
