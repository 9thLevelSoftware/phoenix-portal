-- request_account_deletion(): let a user request deletion again after a cancel.
--
-- deletion_requests has UNIQUE (user_id), and authenticated may only UPDATE a
-- 'pending' row to 'cancelled' (RLS), so the old client INSERT of a new
-- request fails once the user has cancelled. requested_at/scheduled_for are
-- frozen on UPDATE by enforce_deletion_request_grace, so the cancelled row
-- cannot be reopened with a fresh 30-day grace either.
--
-- This RPC works on auth.uid()'s own row only:
--   * no row                 -> INSERT a fresh 'pending' row.
--   * 'cancelled'            -> DELETE it and INSERT a fresh 'pending' row in
--                               the same transaction (new requested_at, new
--                               30-day floor). The UPDATE freeze is never hit.
--   * 'pending'              -> RAISE 'already_pending'.
--   * any other status       -> RAISE 'already_executing'. This covers
--                               'executed' (a purge that crashed mid-run
--                               leaves it, see PR 34) and 'executing' (the
--                               atomic claim PR 35 adds to the status CHECK).
--                               A claimed row must never be reset to pending
--                               behind the purge's back.
--
-- The 30-day floor is enforced by the existing INSERT branch of
-- enforce_deletion_request_grace and the deletion_requests_scheduled_for_min_grace
-- CHECK; the RPC adds no trigger exemption.
--
-- Concurrency: the existing row is locked FOR UPDATE, so the RPC serialises
-- with a user cancel and with PR 35's `UPDATE ... WHERE status='pending'`
-- claim. Two concurrent first requests race on UNIQUE (user_id); the loser
-- gets 'already_pending' instead of a raw unique_violation.
--
-- Errors use SQLSTATE P0001 with the code as the message, so the client can
-- match on `error.message` ('already_pending', 'already_executing').
--
-- KD-3: new SECURITY DEFINER function -> REVOKE ALL FROM PUBLIC, then grant
-- EXECUTE to authenticated only. It is added to the authenticated allow-list
-- in supabase/tests/database/definer_function_grants.test.sql and the prod
-- grant check in .github/workflows/prod-migration-drift.yml.

DROP FUNCTION IF EXISTS public.request_account_deletion();

CREATE FUNCTION public.request_account_deletion()
RETURNS public.deletion_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_existing public.deletion_requests;
  v_created public.deletion_requests;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT *
    INTO v_existing
    FROM public.deletion_requests
   WHERE user_id = v_user_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status = 'pending' THEN
      RAISE EXCEPTION 'already_pending' USING ERRCODE = 'P0001';
    ELSIF v_existing.status <> 'cancelled' THEN
      RAISE EXCEPTION 'already_executing' USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM public.deletion_requests
     WHERE id = v_existing.id;
  END IF;

  BEGIN
    INSERT INTO public.deletion_requests (
      user_id,
      requested_at,
      scheduled_for,
      status
    )
    VALUES (
      v_user_id,
      now(),
      now() + INTERVAL '30 days',
      'pending'
    )
    RETURNING * INTO v_created;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_pending' USING ERRCODE = 'P0001';
  END;

  RETURN v_created;
END;
$$;

COMMENT ON FUNCTION public.request_account_deletion() IS
  'Creates a pending deletion request for auth.uid() with a fresh 30-day grace. Replaces a cancelled request; raises already_pending / already_executing for an active one.';

REVOKE ALL ON FUNCTION public.request_account_deletion() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_account_deletion() FROM anon;
REVOKE ALL ON FUNCTION public.request_account_deletion() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;
