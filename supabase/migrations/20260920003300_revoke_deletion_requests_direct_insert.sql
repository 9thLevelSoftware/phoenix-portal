-- Remove the browser's direct INSERT on deletion_requests.
--
-- The portal now requests deletion only through
-- public.request_account_deletion() (20260920003200), a SECURITY DEFINER
-- function that runs as the table owner and so needs neither an RLS INSERT
-- policy nor an INSERT grant for authenticated. Keeping the direct path
-- would let a client bypass the RPC's rules (re-request after cancel,
-- already_pending / already_executing checks, audit carry-forward).
--
-- The mobile app never writes deletion_requests; delete-account uses
-- service_role. Both are unaffected.
--
-- Untouched on purpose:
--   * SELECT policy (the Danger Zone reads its own row);
--   * UPDATE (cancelled_at, status) grant and the UPDATE policy
--     (the cancel path is still a direct pending -> cancelled update).
--
-- Idempotent: DROP POLICY IF EXISTS and REVOKE are both safe to re-run.

DROP POLICY IF EXISTS "Users can insert own deletion request" ON public.deletion_requests;

-- A table-level REVOKE also removes column-level grants; the column form is
-- repeated so the removal of INSERT (user_id) from 20260823120000 is explicit.
REVOKE INSERT ON public.deletion_requests FROM PUBLIC;
REVOKE INSERT ON public.deletion_requests FROM anon;
REVOKE INSERT ON public.deletion_requests FROM authenticated;
REVOKE INSERT (user_id) ON public.deletion_requests FROM authenticated;
