-- KD-5 (PR 21, review round 1 follow-up): a row's owner is immutable.
--
-- R-13, promoted from minor to a required fix after the security
-- verification measured it on the SHIPPING path.
--
-- `SYNC_LWW_ENABLED` defaults to "false" (_shared/flags.ts), so the default
-- mobile-sync-push path is the PostgREST upsert at
-- mobile-sync-push/index.ts:1786-1789, which never reaches the guarded LWW
-- RPCs. That upsert writes `user_id` along with the content, so a cross-user
-- id in the TOCTOU window between `assertRowsOwnedByUser` and the write does
-- not merely overwrite the victim's row: it changes the row's OWNER
-- outright. Measured against a live stack:
--   POST /rest/v1/workout_sessions  (service_role,
--   Prefer: resolution=merge-duplicates, victim's id + attacker's user_id)
-- succeeded, and the row moved to the attacker.
--
-- 20260920002101 added `WHERE ws.user_id = EXCLUDED.user_id` to
-- `upsert_workout_session_lww` / `upsert_routine_lww`, and
-- `merge_training_cycles_from_push` has had the equivalent check since PR
-- 18. Those guards are real and load-bearing (deleting the predicate turns
-- the refusal back into a successful cross-user write), but they only exist
-- on the non-default branch. The binding rule for this run is that every fix
-- must be correct for EITHER value of SYNC_LWW_ENABLED, whose production
-- value is unknown, so the guard has to hold on the PostgREST path too.
--
-- Shape chosen: a database trigger, not "route both flag values through the
-- guarded RPCs".
--   * PostgREST cannot express "user_id may not change", so the predicate
--     has to live in the database whatever else happens.
--   * A trigger covers EVERY writer — the flag-off upsert, both LWW RPCs,
--     the cycle merge, community imports, operator scripts and any future
--     code path — rather than the two paths the Edge happens to use today.
--   * Routing the flag-off branch through the LWW RPCs would either turn LWW
--     semantics on for the shipping default path (which is exactly what the
--     flag exists to withhold) or require adding a `p_use_lww` parameter to
--     both RPCs — a signature change plus a switch of the default path from
--     one bulk upsert to a row-by-row plpgsql loop. That is a large blast
--     radius on the shipping path for a review fix round, and it would still
--     leave the DB unable to refuse a direct PostgREST write.
-- The Edge `assertRowsOwnedByUser` pre-check stays where it is: it turns the
-- ordinary case into a clean 403 instead of a failed transaction. This
-- trigger is the backstop for the race it cannot close.
--
-- These three tables never legitimately change owner: rows are created by
-- their owner (mobile push, portal insert) and removed by deletion or the
-- account purge. A migration that ever needs to move ownership must drop and
-- recreate the trigger explicitly.
--
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.reject_user_id_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION
      'row owner is immutable: %.% may not change user_id',
      TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_user_id_change() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.reject_user_id_change() IS
  'KD-5 / R-13: refuses any UPDATE that moves a row to a different user_id. The backstop for the SYNC_LWW_ENABLED=false PostgREST upsert path, which writes user_id and cannot express the predicate itself.';

DROP TRIGGER IF EXISTS workout_sessions_owner_immutable ON public.workout_sessions;
CREATE TRIGGER workout_sessions_owner_immutable
  BEFORE UPDATE ON public.workout_sessions
  FOR EACH ROW EXECUTE FUNCTION public.reject_user_id_change();

DROP TRIGGER IF EXISTS routines_owner_immutable ON public.routines;
CREATE TRIGGER routines_owner_immutable
  BEFORE UPDATE ON public.routines
  FOR EACH ROW EXECUTE FUNCTION public.reject_user_id_change();

DROP TRIGGER IF EXISTS training_cycles_owner_immutable ON public.training_cycles;
CREATE TRIGGER training_cycles_owner_immutable
  BEFORE UPDATE ON public.training_cycles
  FOR EACH ROW EXECUTE FUNCTION public.reject_user_id_change();
