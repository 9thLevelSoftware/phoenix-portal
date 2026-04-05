-- Finalize RLS for analytics tables created after the original gap-fix migration.
-- The earlier migration now skips missing relations during fresh bootstrap, and
-- this migration applies the intended end-state once the tables exist.

BEGIN;

DROP POLICY IF EXISTS "Anyone can read benchmarks" ON public.community_benchmarks;
DROP POLICY IF EXISTS "Authenticated users can read benchmarks" ON public.community_benchmarks;

CREATE POLICY "Authenticated users can read benchmarks"
  ON public.community_benchmarks FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage insights" ON public.user_insights;
DROP POLICY IF EXISTS "Service role can manage benchmarks" ON public.community_benchmarks;

COMMIT;
