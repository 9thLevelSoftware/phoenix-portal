-- F214: The user_goals INSERT policy is named "Premium users can create goals",
-- but it only enforces ownership (user_id = auth.uid()). Per-tier limits are
-- enforced by the check_goal_limit() BEFORE INSERT trigger, which intentionally
-- allows FREE users one active goal and paid tiers up to three. The policy name
-- therefore misrepresents the actual behavior.
--
-- The trigger limit is the intended design (FREE = 1 active goal), so this
-- migration only corrects the misleading policy name; it does not change who can
-- insert goals. Idempotent: drop-if-exists both the old and new names, then
-- recreate with the accurate name and the same ownership check.

DROP POLICY IF EXISTS "Premium users can create goals" ON public.user_goals;
DROP POLICY IF EXISTS "Users can create own goals" ON public.user_goals;

CREATE POLICY "Users can create own goals"
  ON public.user_goals FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());
