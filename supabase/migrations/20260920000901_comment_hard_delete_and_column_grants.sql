-- PR 9 review round 1 (R-1 / R-3 / R-12 / R-13): make comment removal work on
-- the path the portal actually uses, keep the denormalised comment_count
-- honest, and stop a FLAME owner from editing round the 5-minute window.
--
-- Context. The SPA used to "delete" a comment with
-- `UPDATE community_comments SET deleted_at = now()`. That could never work,
-- at any tier and any comment age: the SELECT policy on the table is
-- `deleted_at IS NULL`, and Postgres applies SELECT policies to the new row
-- of an UPDATE, so setting deleted_at always raises
-- "new row violates row-level security policy" (42501). Verified against a
-- local stack. The 5-minute WITH CHECK window and, since 20260920000900, a
-- FLAME check sit on the same policy, so nothing about that path is worth
-- keeping. The owner DELETE policy has no window and no tier check, so a hard
-- DELETE is both the working path and the tier-free one.
-- src/mutations/comments.ts now issues
-- `.delete().eq(id).eq(user_id).select('id')`, and the `.select` turns a
-- 0-row outcome into an error instead of a fake success.
--
-- What this migration does:
--   1. update_comment_count() also handles TG_OP = 'DELETE', decrementing only
--      when the deleted row was still live (OLD.deleted_at IS NULL). Rows that
--      were soft-deleted before this change were already decremented by the
--      UPDATE branch, so they must not be decremented a second time.
--   2. The trigger fires on DELETE as well as INSERT / UPDATE.
--   2b. Any leftover tombstone is purged once. Because the browser path never
--      succeeded, these can only have come from a service-role write or from
--      before the `deleted_at IS NULL` SELECT policy existed, so the purge may
--      well match nothing — but a row with deleted_at set is unreachable
--      forever otherwise: Postgres applies SELECT policies to the rows an
--      UPDATE or DELETE reads, so such a row is invisible even to its own
--      author, who can no longer delete it. They are already excluded from
--      comment_count (the UPDATE branch decremented when deleted_at was set)
--      and from every client read, and each one is a comment its author asked
--      to remove. The DELETE branch's OLD.deleted_at guard is what keeps this
--      purge from taking comment_count down a second time.
--   3. The community_comments UPDATE policy checks the 5-minute window in
--      USING (the OLD row) as well as WITH CHECK, so the window is decided by
--      the comment's real age.
--   4. Column-level grants: authenticated may only write the columns the
--      portal legitimately sets. On community_comments that is
--      (item_id, item_type, user_id, body) for INSERT and (body, updated_at)
--      for UPDATE — so `created_at` can neither be back/forward-dated at
--      insert time nor refreshed on update to escape the edit window, and
--      `deleted_at` can no longer be written from a browser at all.
--      challenge_participants INSERT is narrowed to (challenge_id, user_id)
--      so joining a challenge cannot also mark it completed.
--      (item_id / item_type were already immutable after insert via the
--      prevent_community_comment_target_change trigger, 20260517173000.)
--
-- Every statement is idempotent: CREATE OR REPLACE FUNCTION on an unchanged
-- signature, DROP TRIGGER IF EXISTS + CREATE TRIGGER, DROP POLICY IF EXISTS +
-- CREATE POLICY, and REVOKE/GRANT (which are naturally re-runnable).

-- ---------------------------------------------------------------------------
-- 1. comment_count keeps up with hard deletes
--    Body starts from the latest definition
--    (20260517173000_security_scan_rls_privilege_fixes.sql:216) and only adds
--    the DELETE branch. SECURITY DEFINER is still required: the trigger writes
--    shared_routines / shared_cycles rows owned by other users.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_comment_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.item_type = 'routine' THEN
      UPDATE public.shared_routines SET comment_count = comment_count + 1 WHERE id = NEW.item_id;
    ELSE
      UPDATE public.shared_cycles SET comment_count = comment_count + 1 WHERE id = NEW.item_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF OLD.item_type = 'routine' THEN
      UPDATE public.shared_routines SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.item_id;
    ELSE
      UPDATE public.shared_cycles SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.item_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Only a comment that was still live counted towards comment_count. A row
    -- that had already been soft-deleted was decremented by the branch above.
    IF OLD.deleted_at IS NULL THEN
      IF OLD.item_type = 'routine' THEN
        UPDATE public.shared_routines SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.item_id;
      ELSE
        UPDATE public.shared_cycles SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.item_id;
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- KD-3 rule 3b. A trigger function needs no EXECUTE grant for the role whose
-- statement fires it, so nothing is granted back to anon / authenticated.
REVOKE ALL ON FUNCTION public.update_comment_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_comment_count() FROM anon;
REVOKE ALL ON FUNCTION public.update_comment_count() FROM authenticated;

DROP TRIGGER IF EXISTS update_comment_count_on_change ON public.community_comments;
CREATE TRIGGER update_comment_count_on_change
  AFTER INSERT OR UPDATE OR DELETE ON public.community_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_comment_count();

-- Purge the soft-delete tombstones (see 2b in the header). Runs as the
-- migration role, which owns the table and so is not filtered by the
-- `deleted_at IS NULL` SELECT policy. Idempotent: a re-run finds nothing.
-- comment_count is untouched because every one of these rows has
-- deleted_at IS NOT NULL.
DELETE FROM public.community_comments WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The 5-minute edit window is decided by the OLD row too.
--    Same FLAME owner check as 20260920000900; the window moves into USING so
--    a comment's age, not the value being written, closes the window.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can edit own comments within 5 minutes" ON public.community_comments;
CREATE POLICY "Users can edit own comments within 5 minutes"
  ON public.community_comments FOR UPDATE
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
    AND created_at > now() - INTERVAL '5 minutes'
  )
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('FLAME'))
    AND created_at > now() - INTERVAL '5 minutes'
  );

-- ---------------------------------------------------------------------------
-- 3. Column-level write grants for browser clients.
--    service_role is re-granted explicitly because the REVOKE ... FROM PUBLIC
--    above it would otherwise leave it relying on a PUBLIC grant.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE ON public.community_comments FROM PUBLIC;
REVOKE INSERT, UPDATE ON public.community_comments FROM anon;
REVOKE INSERT, UPDATE ON public.community_comments FROM authenticated;
GRANT INSERT (item_id, item_type, user_id, body)
  ON public.community_comments TO authenticated;
GRANT UPDATE (body, updated_at)
  ON public.community_comments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_comments TO service_role;

REVOKE INSERT ON public.challenge_participants FROM PUBLIC;
REVOKE INSERT ON public.challenge_participants FROM anon;
REVOKE INSERT ON public.challenge_participants FROM authenticated;
GRANT INSERT (challenge_id, user_id)
  ON public.challenge_participants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.challenge_participants TO service_role;
