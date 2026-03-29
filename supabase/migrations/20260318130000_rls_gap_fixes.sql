-- RLS Gap Fixes (audit task 2.1A)
-- Closes 4 policy gaps found during beta-readiness RLS audit.
--
-- GAP-06 (HIGH):  challenge_participants missing DELETE policy
-- GAP-05 (MED):   creator_follows & community_benchmarks SELECT open to anon
-- GAP-03 (MED):   personal_records missing INSERT policy
-- GAP-09 (HIGH):  dead service_role FOR ALL policies on user_insights & community_benchmarks

BEGIN;

-- ============================================================
-- GAP-06: challenge_participants — allow users to leave
-- ============================================================
CREATE POLICY "Users can leave challenges"
  ON public.challenge_participants FOR DELETE
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- GAP-05a: creator_follows — restrict SELECT to authenticated
-- ============================================================
DROP POLICY IF EXISTS "Users can view follows" ON public.creator_follows;

CREATE POLICY "Authenticated users can view follows"
  ON public.creator_follows FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- GAP-05b: community_benchmarks — restrict SELECT to authenticated
-- ============================================================
DO $$
BEGIN
  IF to_regclass('public.community_benchmarks') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Anyone can read benchmarks" ON public.community_benchmarks';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can read benchmarks" ON public.community_benchmarks';
    EXECUTE 'CREATE POLICY "Authenticated users can read benchmarks"
      ON public.community_benchmarks FOR SELECT
      TO authenticated
      USING (true)';
  END IF;
END
$$;

-- ============================================================
-- GAP-03: personal_records — allow users to insert own records
-- ============================================================
CREATE POLICY "Users can insert own records"
  ON public.personal_records FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

-- ============================================================
-- GAP-09: remove dead service_role policies
-- service_role bypasses RLS entirely, so these never evaluate.
-- ============================================================
DO $$
BEGIN
  IF to_regclass('public.user_insights') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Service role can manage insights" ON public.user_insights';
  END IF;

  IF to_regclass('public.community_benchmarks') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Service role can manage benchmarks" ON public.community_benchmarks';
  END IF;
END
$$;

COMMIT;
