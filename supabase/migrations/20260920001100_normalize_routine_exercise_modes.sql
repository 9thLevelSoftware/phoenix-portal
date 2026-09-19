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
