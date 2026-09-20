-- KD-4: tombstones for routine and training-cycle deletes.
--
-- Routines and cycles are hard-deleted. Without a record of the delete, a
-- device that still holds the row never learns of it (pull only returns live
-- rows) and re-creates it on its next push. An AFTER DELETE trigger records
-- every delete, whatever the path (portal PostgREST, mobile-sync-push, RPCs,
-- future code), so no SPA change is needed.
--
-- * mobile-sync-pull returns tombstoned ids the device says it holds
--   (`deletedRoutineIds` / `deletedCycleIds`).
-- * mobile-sync-push refuses to re-create a tombstoned id (`skippedDeleted`).
--
-- The FK removes existing tombstones when an account is deleted. The trigger
-- skips users whose auth.users row is already gone, so the cascade adds no new
-- tombstones while routines and cycles are being removed.
-- A portal create-rollback delete also records a tombstone for an id no
-- device ever held; clients must treat reported ids as "delete if present".
--
-- Idempotent: safe to re-run.

-- upsert_routine_lww (20260420190710) writes routines.created_at, but no
-- migration creates that column (prod has it through drift; PR 2 captures
-- it). Without it every SYNC_LWW_ENABLED=true routine push fails on a DB
-- built from migrations. Duplicate of PR 2's statement; a no-op in prod.
ALTER TABLE public.routines
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

CREATE TABLE IF NOT EXISTS public.sync_tombstones (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity TEXT NOT NULL CHECK (entity IN ('routine', 'cycle')),
  entity_id UUID NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entity, entity_id)
);

-- "Tombstones since lastSync" lookups.
CREATE INDEX IF NOT EXISTS sync_tombstones_user_entity_deleted_at_idx
  ON public.sync_tombstones (user_id, entity, deleted_at);

ALTER TABLE public.sync_tombstones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own sync tombstones" ON public.sync_tombstones;
CREATE POLICY "Users can view own sync tombstones"
  ON public.sync_tombstones
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Only the trigger (definer) and service role write tombstones. TRUNCATE is
-- not subject to RLS, so revoke every browser-role privilege except SELECT.
REVOKE ALL ON TABLE public.sync_tombstones FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.sync_tombstones TO authenticated;
GRANT ALL ON TABLE public.sync_tombstones TO service_role;

-- Trigger function. SECURITY DEFINER because portal deletes run as
-- `authenticated`, which can neither read auth.users nor write the table.
-- TG_ARGV[0] is the entity name ('routine' or 'cycle').
CREATE OR REPLACE FUNCTION public.record_sync_tombstone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Account deletion: auth.users is already gone while its cascade deletes
  -- routines/cycles. Record nothing for a deleted user.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id) THEN
    RETURN OLD;
  END IF;

  INSERT INTO public.sync_tombstones (user_id, entity, entity_id, deleted_at)
  VALUES (OLD.user_id, TG_ARGV[0], OLD.id, now())
  ON CONFLICT (user_id, entity, entity_id)
  DO UPDATE SET deleted_at = now();

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.record_sync_tombstone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS routines_sync_tombstone ON public.routines;
CREATE TRIGGER routines_sync_tombstone
  AFTER DELETE ON public.routines
  FOR EACH ROW EXECUTE FUNCTION public.record_sync_tombstone('routine');

DROP TRIGGER IF EXISTS training_cycles_sync_tombstone ON public.training_cycles;
CREATE TRIGGER training_cycles_sync_tombstone
  AFTER DELETE ON public.training_cycles
  FOR EACH ROW EXECUTE FUNCTION public.record_sync_tombstone('cycle');

-- Edge-only lookup (service role). Ids travel in the POST body, so up to
-- 10,000 known ids never hit a URL limit.
--   p_entity NULL -> both entities.
--   p_ids non-NULL -> tombstones for those ids (the device's known ids).
--   p_since non-NULL -> tombstones recorded after p_since.
-- Both filters apply when both are given. An id that is live again for the
-- SAME user (which the push path refuses, but another path could do) is not
-- reported, so a device is never told to delete a row it still owns. A row
-- with that id owned by another user does not hide the owner's tombstone.
-- mobile-sync-push re-deletes a row that a concurrent delete tombstoned
-- while the push was re-writing it, so that race cannot mask a tombstone.
CREATE OR REPLACE FUNCTION public.get_sync_tombstones(
  p_user_id UUID,
  p_entity TEXT DEFAULT NULL,
  p_ids UUID[] DEFAULT NULL,
  p_since TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (entity TEXT, entity_id UUID, deleted_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT t.entity, t.entity_id, t.deleted_at
  FROM public.sync_tombstones t
  WHERE t.user_id = p_user_id
    AND (p_entity IS NULL OR t.entity = p_entity)
    AND (p_ids IS NULL OR t.entity_id = ANY (p_ids))
    AND (p_since IS NULL OR t.deleted_at > p_since)
    AND NOT (
      t.entity = 'routine'
      AND EXISTS (
        SELECT 1 FROM public.routines r
        WHERE r.id = t.entity_id AND r.user_id = t.user_id
      )
    )
    AND NOT (
      t.entity = 'cycle'
      AND EXISTS (
        SELECT 1 FROM public.training_cycles c
        WHERE c.id = t.entity_id AND c.user_id = t.user_id
      )
    )
  ORDER BY t.deleted_at ASC, t.entity ASC, t.entity_id ASC;
$$;

REVOKE ALL ON FUNCTION public.get_sync_tombstones(UUID, TEXT, UUID[], TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_sync_tombstones(UUID, TEXT, UUID[], TIMESTAMPTZ)
  TO service_role;
