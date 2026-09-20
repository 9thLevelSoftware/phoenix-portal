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
--                               the same transaction (new id, new
--                               requested_at, new 30-day floor). The UPDATE
--                               freeze is never hit.
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
-- Audit trail (review R-3/R-8). Deleting the cancelled row would otherwise
-- lose the only record of the earlier request/cancel. The new row carries it
-- forward in three columns added here, instead of a separate history table:
--   previous_requested_at  requested_at of the request that was replaced
--   previous_cancelled_at  cancelled_at of the request that was replaced
--   rerequest_count        how many times this user has re-requested after
--                          a cancel (previous count + 1)
-- Only the most recent replaced cycle keeps its timestamps; older cycles
-- survive only as the count. The columns hold timestamps and a counter about
-- the user's own request, no new personal data. They live on the user's own
-- row, so they show in the GDPR export (select *) and cascade away with the
-- account on purge. authenticated has no INSERT/UPDATE grant on them (the
-- column grants stay INSERT (user_id) and UPDATE (cancelled_at, status)).
-- No existing audit table fits: the only audit trigger in the schema is on
-- subscriptions, and subscription_events is billing-specific.
--
-- Concurrency: the existing row is locked FOR UPDATE, so the RPC serialises
-- with a user cancel and with PR 35's `UPDATE ... WHERE status='pending'`
-- claim. Two concurrent first requests race on UNIQUE (user_id); the loser
-- gets 'already_pending' instead of a raw unique_violation. Both paths are
-- covered by a two-session (dblink) test in trust_plane.test.sql.
--
-- Errors use SQLSTATE P0001 with the code as the message, so the client can
-- match on `error.message` ('already_pending', 'already_executing').
--
-- KD-3: new SECURITY DEFINER function -> REVOKE ALL FROM PUBLIC, then grant
-- EXECUTE to authenticated only. It is added to the authenticated allow-list
-- in supabase/tests/database/definer_function_grants.test.sql and the prod
-- grant check in .github/workflows/prod-migration-drift.yml.
--
-- Allow-list exception (review R-1): the hard-coded v_allow_list in
-- 20260920000100_lockdown_definer_function_grants.sql does NOT include
-- request_account_deletion() (that migration is immutable and predates this
-- one). A clean apply is fine because 000100 runs first, but re-running
-- 000100's catalog revoke after this file would take EXECUTE away from
-- authenticated and break re-requests. PR 76 restates the lockdown allow-list
-- including request_account_deletion(); any other migration that restates
-- or replays that list must include it too.

-- ---------------------------------------------------------------------------
-- 1. Audit columns carried forward on re-request
-- ---------------------------------------------------------------------------
ALTER TABLE public.deletion_requests
  ADD COLUMN IF NOT EXISTS previous_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS previous_cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rerequest_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'deletion_requests_rerequest_count_nonnegative'
      AND conrelid = 'public.deletion_requests'::regclass
  ) THEN
    ALTER TABLE public.deletion_requests
      ADD CONSTRAINT deletion_requests_rerequest_count_nonnegative
      CHECK (rerequest_count >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.deletion_requests.previous_requested_at IS
  'requested_at of the cancelled request this row replaced (request_account_deletion).';
COMMENT ON COLUMN public.deletion_requests.previous_cancelled_at IS
  'cancelled_at of the cancelled request this row replaced (request_account_deletion).';
COMMENT ON COLUMN public.deletion_requests.rerequest_count IS
  'Number of times the user re-requested deletion after a cancel.';

-- ---------------------------------------------------------------------------
-- 2. request_account_deletion()
-- ---------------------------------------------------------------------------
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
      status,
      previous_requested_at,
      previous_cancelled_at,
      rerequest_count
    )
    VALUES (
      v_user_id,
      now(),
      now() + INTERVAL '30 days',
      'pending',
      v_existing.requested_at,
      v_existing.cancelled_at,
      COALESCE(v_existing.rerequest_count + 1, 0)
    )
    RETURNING * INTO v_created;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_pending' USING ERRCODE = 'P0001';
  END;

  RETURN v_created;
END;
$$;

COMMENT ON FUNCTION public.request_account_deletion() IS
  'Creates a pending deletion request for auth.uid() with a fresh 30-day grace. Replaces a cancelled request (carrying its requested_at/cancelled_at forward); raises already_pending / already_executing for an active one.';

REVOKE ALL ON FUNCTION public.request_account_deletion() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_account_deletion() FROM anon;
REVOKE ALL ON FUNCTION public.request_account_deletion() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;
