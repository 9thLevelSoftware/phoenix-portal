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
-- changes nothing.
--
-- Deploy order: NONE REQUIRED. This migration and the PR 30 SPA may ship in
-- either order.
--   * The new SPA writes target_basis = 'per_cable' explicitly on every goal
--     insert and on every target_value update (src/mutations/goals.ts), so a
--     goal it creates before this migration runs is already stamped and the
--     one-shot backfill below skips it.
--   * An OLD SPA sends no target_basis at all. The BEFORE INSERT trigger
--     below halves such a PR target (it is a doubled total) and stamps it
--     per_cable, so an insert from a stale client lands correct. The column
--     therefore has NO DEFAULT: the default would silently mislabel an old
--     client's doubled target as per-cable, which is exactly the corruption
--     this trigger exists to prevent.
--
-- Residual (cannot be fixed server-side): an OLD SPA *updating* an existing
-- goal's target_value sends no target_basis, and the row's basis is already
-- 'per_cable', so the write is indistinguishable from a new client's. Such an
-- update stores a doubled target. The PWA is registerType "autoUpdate" with
-- skipWaiting/clientsClaim, so a stale client self-corrects after one reload.
--
-- Operator audit (PR goals that a stale client may have marked completed
-- against a halved target — Goals.tsx flips status to 'completed' when
-- progress reaches 100% and nothing ever reopens a completed goal). Replace
-- the two timestamps with the deploy window, widened generously:
--
--   SELECT g.id, g.user_id, g.exercise_name, g.target_value,
--          COALESCE(MAX(pr.value), 0) AS best_per_cable_record,
--          g.completed_at
--     FROM public.user_goals g
--     LEFT JOIN public.personal_records pr
--       ON pr.user_id = g.user_id
--      AND pr.deleted_at IS NULL
--      AND upper(COALESCE(pr.record_type, 'MAX_WEIGHT')) IN ('MAX_WEIGHT', '1RM')
--      AND (
--            (g.exercise_id IS NOT NULL AND pr.exercise_id = g.exercise_id)
--         OR (g.exercise_id IS NULL AND lower(pr.exercise_name) = lower(g.exercise_name))
--          )
--    WHERE g.goal_type = 'pr'
--      AND g.status = 'completed'
--      AND g.completed_at >= TIMESTAMPTZ '<window start>'
--      AND g.completed_at <  TIMESTAMPTZ '<window end>'
--    GROUP BY g.id, g.user_id, g.exercise_name, g.target_value, g.completed_at
--   HAVING COALESCE(MAX(pr.value), 0) < g.target_value
--    ORDER BY g.completed_at;
--
-- Reopening is the operator's call (the SPA has no reopen path):
--   UPDATE public.user_goals
--      SET status = 'active', completed_at = NULL, updated_at = now()
--    WHERE id IN (<ids from the audit>);

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

-- Order-independence trigger. A NULL basis on insert means "the client does
-- not know about per-cable targets", i.e. a pre-PR-30 SPA: a PR target from
-- it is a doubled total and is halved. Frequency and volume targets were
-- never doubled, so they are only stamped. The column has no default, so this
-- trigger is what keeps the NOT NULL constraint satisfiable for old clients.
CREATE OR REPLACE FUNCTION public.user_goals_default_target_basis()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.target_basis IS NULL THEN
    IF NEW.goal_type = 'pr' AND NEW.target_value IS NOT NULL THEN
      NEW.target_value := NEW.target_value / 2;
    END IF;
    NEW.target_basis := 'per_cable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.user_goals_default_target_basis() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_goals_default_target_basis()
  TO authenticated, service_role;

DROP TRIGGER IF EXISTS user_goals_default_target_basis ON public.user_goals;
CREATE TRIGGER user_goals_default_target_basis
  BEFORE INSERT ON public.user_goals
  FOR EACH ROW
  EXECUTE FUNCTION public.user_goals_default_target_basis();

ALTER TABLE public.user_goals ALTER COLUMN target_basis DROP DEFAULT;
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
  'Load basis of target_value. per_cable: PR-goal targets are per cable (KD-8). Pre-PR-30 PR-goal targets (doubled totals) were halved once by 20260920003000; an insert arriving with a NULL basis is a pre-PR-30 client and is halved and stamped by user_goals_default_target_basis().';
