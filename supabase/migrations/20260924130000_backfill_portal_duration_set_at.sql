-- Port of e38321d2 / 8aa731a2 (codex/review-pr-145): portal_duration_set_at
-- backfill.
--
-- 20260920001800 added training_cycles.portal_duration_set_at with no
-- backfill, so every cycle that existed before it looks mobile-owned: the
-- first legacy push carrying the derived ceil(days / 7) default can replace a
-- duration the user configured on the portal (KD-6). Whether a pre-marker
-- duration came from the portal or a phone cannot be recovered, so, as the
-- original fix decided, pre-existing values are treated as portal-owned.
--
-- The column already exists everywhere this runs, so "pre-existing" is
-- decided by updated_at (training_cycles has no created_at), against a fixed
-- cutoff so a re-run relabels nothing new. The cutoff must not fall before
-- the moment 20260920001800 reached the database: production applied it on
-- 2026-09-23 (UTC), so every row it holds from before the marker was last
-- written before 2026-09-24. (The earlier 2026-09-20 cutoff was the file
-- date, not the apply date, and would have left every cycle edited between
-- then and the production apply looking mobile-owned.) A row written after
-- the marker went through the marker-aware merge or a portal edit; labelling
-- one of those that falls before the cutoff costs at most that a later legacy
-- push no longer re-derives its duration, which is the safe side (KD-6).
--
-- updated_at is the pull cursor and each cycle's baseUpdatedAt; the backfill
-- must not move it, so cycles_updated_at is disabled for this one UPDATE. As
-- postgres with no JWT, the portal-edit and LWW stamp triggers write nothing.
--
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE public.training_cycles DISABLE TRIGGER cycles_updated_at;

UPDATE public.training_cycles
   SET portal_duration_set_at = updated_at
 WHERE portal_duration_set_at IS NULL
   AND updated_at < '2026-09-24T00:00:00Z'::timestamptz;

ALTER TABLE public.training_cycles ENABLE TRIGGER cycles_updated_at;

COMMIT;
