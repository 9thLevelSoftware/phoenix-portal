-- PR 50: resumable Liftosaur history backfill.
--
-- Liftosaur's GET /history is newest-first and a single liftosaur-sync run
-- reads at most 10 pages (2,000 records). For a larger history the function
-- now walks DOWNWARD over successive runs with `endDate`, and needs to remember
-- where it stopped:
--
--   backfill_before     – upper bound (`endDate`) for the next run; NULL when
--                         no backfill is in progress.
--   backfill_after      – the chain's lower bound (`startDate`), fixed when the
--                         chain starts; NULL = full history (an `initial` /
--                         reconnect chain), so the watermark cannot narrow it.
--   backfill_started_at – when the in-progress backfill chain started; becomes
--                         last_sync_at once the chain reaches the end.
--
-- Written only by Edge Functions with the service role (which already holds
-- SELECT/INSERT/UPDATE/DELETE on the table, 20260517173000). No grants change:
-- authenticated keeps its existing SELECT (RLS: own rows only), and these
-- columns hold only timestamps. Idempotent.

ALTER TABLE public.user_integrations
  ADD COLUMN IF NOT EXISTS backfill_before TIMESTAMPTZ;

ALTER TABLE public.user_integrations
  ADD COLUMN IF NOT EXISTS backfill_after TIMESTAMPTZ;

ALTER TABLE public.user_integrations
  ADD COLUMN IF NOT EXISTS backfill_started_at TIMESTAMPTZ;

COMMENT ON COLUMN public.user_integrations.backfill_before IS
  'Resumable provider backfill: endDate for the next run (NULL = no backfill in progress).';
COMMENT ON COLUMN public.user_integrations.backfill_after IS
  'Resumable provider backfill: startDate of the in-progress chain (NULL = full history).';
COMMENT ON COLUMN public.user_integrations.backfill_started_at IS
  'Resumable provider backfill: start of the in-progress chain; becomes last_sync_at when it completes.';
