-- Normalize routine_exercises.mode to mobile's wire vocabulary.
--
-- Problem: the portal routine builder saved display names ('Echo', 'Pump',
-- 'TUT Beast', 'Eccentric Only', 'Old School'). Mobile's
-- ProgramMode.fromSyncString accepts only OLD_SCHOOL | CLASSIC | PUMP | TUT |
-- TUT_BEAST | ECCENTRIC_ONLY | ECHO, so every portal-authored mode except
-- 'TUT' trained as Old School. 20260304120000_mode_wire_format_migration.sql
-- cleaned historical rows once, but the writer kept producing display names.
--
-- Fix (independent of SPA deploy order):
--   1. public.normalize_workout_mode(text): the same mapping as
--      20260304120000 (display names, case-insensitive; CLASSIC/POWER ->
--      OLD_SCHOOL) and as supabase/functions/_shared/workoutModes.ts
--      toWireMode(). Unknown values are returned unchanged.
--   2. Backfill rows whose stored mode normalizes to a different value.
--   3. BEFORE INSERT OR UPDATE OF mode trigger applying the same mapping.
--      It never rejects unknown values, so an older mobile build pushing an
--      unexpected mode is not broken on push.
--
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, and the backfill
-- only touches rows that still change.
--
-- Why the backfill deliberately does NOT bump routines.updated_at:
--   * Delivery. Shipping mobile pulls with lastSync=0 plus knownEntityIds
--     (Project-Phoenix-MP PortalApiClient.kt: `lastSync = 0`). mobile-sync-pull
--     passes the epoch as p_last_sync_at, and get_routines_excluding_ids'
--     stale arm (`r.updated_at > p_last_sync_at`, 20260706120000) is then true
--     for every routine, so every pull re-delivers every routine with its
--     corrected exercise modes. mergePortalRoutines applies them unless the
--     device edited that routine locally since its last sync. No bump is
--     needed for these clients to receive the fix.
--   * Push. Mobile pushes only routines modified locally since its last
--     sync (getFullRoutinesModifiedSince), so idle routines never push the
--     device's mis-parsed OldSchool copy back. The only revert path is a
--     device that edits the routine on the phone before its first pull after
--     this migration. A bump does not close it: with SYNC_LWW_ENABLED=false,
--     the push overwrites regardless. With SYNC_LWW_ENABLED=true, the push
--     carries the device's own edit time (PortalSyncAdapter: updatedAt =
--     routine.updatedAt), and upsert_routine_lww accepts only when the stored
--     updated_at <= incoming. A migration-time bump would therefore REJECT
--     offline phone edits made before the migration. That discards user edits,
--     which is worse than the mode the device already had wrong.
--   * Residual. A future client that pulls with a real lastSync (PR 27) and
--     did not sync between this migration and its upgrade would never see
--     these unchanged parents again. PR 27's release checklist must force
--     one full (lastSync=0) pull on the first sync after upgrade.
--   * Unrecoverable. If a device already pushed an edited routine back (the
--     server row now says OLD_SCHOOL), the original portal mode is gone and
--     no server-side backfill can restore it. The user must re-save that
--     routine in the portal.
--
-- Operator pre-check (read-only, rows that will change):
--   SELECT mode, count(*) FROM public.routine_exercises
--   WHERE mode IS NOT NULL
--     AND mode NOT IN ('OLD_SCHOOL','PUMP','TUT','TUT_BEAST','ECCENTRIC_ONLY','ECHO')
--   GROUP BY mode ORDER BY count(*) DESC;
-- Post-check (expect 0, unless the pre-check listed genuinely unknown values):
--   SELECT count(*) FROM public.routine_exercises
--   WHERE mode NOT IN ('OLD_SCHOOL','PUMP','TUT','TUT_BEAST','ECCENTRIC_ONLY','ECHO');

CREATE OR REPLACE FUNCTION public.normalize_workout_mode(p_mode TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE upper(
      regexp_replace(
        regexp_replace(p_mode, '^[[:space:]]+|[[:space:]]+$', '', 'g'),
        '[[:space:]-]+', '_', 'g'
      )
    )
    WHEN 'OLD_SCHOOL' THEN 'OLD_SCHOOL'
    WHEN 'PUMP' THEN 'PUMP'
    WHEN 'TUT' THEN 'TUT'
    WHEN 'TUT_BEAST' THEN 'TUT_BEAST'
    WHEN 'ECCENTRIC_ONLY' THEN 'ECCENTRIC_ONLY'
    WHEN 'ECHO' THEN 'ECHO'
    -- Legacy aliases (see 20260304120000): mobile's old CLASSIC name and the
    -- retired portal-only POWER mode.
    WHEN 'CLASSIC' THEN 'OLD_SCHOOL'
    WHEN 'POWER' THEN 'OLD_SCHOOL'
    ELSE p_mode
  END
$$;

-- Pure helper. Called at row time by the trigger below, whose body runs as
-- the writing role (authenticated via RLS, service_role from Edge), so both
-- need EXECUTE. anon never writes routine_exercises.
REVOKE ALL ON FUNCTION public.normalize_workout_mode(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_workout_mode(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.normalize_workout_mode(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_workout_mode(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.routine_exercises_normalize_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.mode := public.normalize_workout_mode(NEW.mode);
  RETURN NEW;
END;
$$;

-- Trigger functions are only executed by the trigger (EXECUTE is checked at
-- CREATE TRIGGER time, not per row), so no role needs to call it directly.
REVOKE ALL ON FUNCTION public.routine_exercises_normalize_mode() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.routine_exercises_normalize_mode() FROM anon;
REVOKE ALL ON FUNCTION public.routine_exercises_normalize_mode() FROM authenticated;

-- Backfill. On a first apply the trigger does not exist yet; on a re-run it
-- does and applies the same idempotent mapping.
UPDATE public.routine_exercises
SET mode = public.normalize_workout_mode(mode)
WHERE mode IS DISTINCT FROM public.normalize_workout_mode(mode);

DROP TRIGGER IF EXISTS routine_exercises_normalize_mode ON public.routine_exercises;
CREATE TRIGGER routine_exercises_normalize_mode
BEFORE INSERT OR UPDATE OF mode ON public.routine_exercises
FOR EACH ROW EXECUTE FUNCTION public.routine_exercises_normalize_mode();
