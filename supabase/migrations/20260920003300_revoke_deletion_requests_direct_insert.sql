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
-- DELETE is revoked as well (review R-13). It was never usable — RLS is on and
-- deletion_requests has no DELETE policy, so a PostgREST delete matched zero
-- rows — but this PR's guarantee is "the RPC is the only write path", and that
-- guarantee should not rest on the absence of a policy alone. The RPC deletes
-- the replaced cancelled row as the table owner (SECURITY DEFINER) and
-- delete-account uses service_role, so neither is affected.
--
-- ---------------------------------------------------------------------------
-- DEPLOY ORDER (required; the SPA half and the SQL half ship separately)
-- ---------------------------------------------------------------------------
--   1. Apply 20260920003200 (the request_account_deletion RPC) in prod.
--   2. Deploy the SPA that calls the RPC.
--   3. Apply THIS migration (revoke the direct INSERT).
--
-- Why that order, for a GDPR path that must not go quietly dark:
--   * SPA before 003200 -> PostgREST answers the RPC with 404 PGRST202 and
--     NO user can request deletion at all, with no self-healing.
--   * This migration before the SPA -> tabs still running the old bundle POST
--     /rest/v1/deletion_requests and get 403/42501 until they reload. That
--     window is short and self-heals on reload, but the old bundle cannot be
--     taught a better message, so it is still second-best.
-- Step 3 may lag step 2 safely: between them both paths work.
-- src/mutations/account.ts maps PGRST202 and 42501 to their own messages
-- ("contact support" / "reload the page") so an ordering mistake is visible
-- instead of hiding behind "Please try again".
--
-- ---------------------------------------------------------------------------
-- BLAST RADIUS: this removes the LAST fallback (review R-10)
-- ---------------------------------------------------------------------------
-- 20260920000100_lockdown_definer_function_grants.sql revokes EXECUTE from
-- every browser-callable SECURITY DEFINER function outside a hard-coded
-- v_allow_list, and that list (immutable, it predates 003200) does NOT contain
-- request_account_deletion(). Before this migration a replay of that lockdown
-- would only break re-requests after a cancel, because the direct INSERT still
-- worked. After it, the same replay leaves `authenticated` with neither
-- EXECUTE on the RPC nor INSERT on the table: nobody can request deletion at
-- all. PR 76's 20260920007600 restates the allow-list *including*
-- request_account_deletion(), so 007600 must land with or before any replay or
-- restatement of 000100's list. Any migration that restates that list and omits
-- the function re-opens this hole; the definer_function_grants pgTAP test and
-- the prod grant check in .github/workflows/prod-migration-drift.yml assert the
-- steady state.
--
-- Idempotent: DROP POLICY IF EXISTS and REVOKE are both safe to re-run.

DROP POLICY IF EXISTS "Users can insert own deletion request" ON public.deletion_requests;

-- A table-level REVOKE also removes column-level grants; the column form is
-- repeated so the removal of INSERT (user_id) from 20260823120000 is explicit.
REVOKE INSERT ON public.deletion_requests FROM PUBLIC;
REVOKE INSERT ON public.deletion_requests FROM anon;
REVOKE INSERT ON public.deletion_requests FROM authenticated;
REVOKE INSERT (user_id) ON public.deletion_requests FROM authenticated;

-- Left over from Supabase's default GRANT ALL ON TABLES to anon/authenticated
-- (20260301_deletion_support.sql); no DELETE policy has ever existed.
REVOKE DELETE ON public.deletion_requests FROM PUBLIC;
REVOKE DELETE ON public.deletion_requests FROM anon;
REVOKE DELETE ON public.deletion_requests FROM authenticated;
