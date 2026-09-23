-- ============================================================================
-- Fix: add cursor/limit pagination to get_personal_records_excluding_ids
-- Issue: #97 — cloud sync pull fails with repeated cursor loop detection
-- Root cause: this is the only parity RPC missing p_cursor_updated_at /
--             p_cursor_id / p_limit. The edge function chained .or() on the
--             RPC builder as a workaround, but PostgREST silently ignores
--             .or() on RPC function responses, so the same cursor was returned
--             every call and the client loop guard aborted after 4 pages.
-- Fix: add the three pagination params + composite cursor predicate + LIMIT,
--      matching get_cycles_excluding_ids / get_badges_excluding_ids / the
--      tombstone sibling. Profile filter matches the H-18-safe form (no
--      OR pr.local_profile_id IS NULL).
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_personal_records_excluding_ids(UUID, UUID[], TEXT);

CREATE FUNCTION public.get_personal_records_excluding_ids(
  p_user_id UUID,
  p_known_ids UUID[] DEFAULT '{}',
  p_profile_id TEXT DEFAULT NULL,
  p_cursor_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 76
)
RETURNS SETOF public.personal_records
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT pr.*
  FROM public.personal_records pr
  WHERE pr.user_id = p_user_id
    AND pr.deleted_at IS NULL
    AND (array_length(p_known_ids, 1) IS NULL OR pr.id != ALL(p_known_ids))
    AND (
      p_profile_id IS NULL
      OR (p_profile_id = 'default' AND pr.local_profile_id IS NULL)
      OR pr.local_profile_id = p_profile_id
    )
    AND (
      p_cursor_updated_at IS NULL
      OR pr.updated_at > p_cursor_updated_at
      OR (pr.updated_at = p_cursor_updated_at AND pr.id > p_cursor_id)
    )
  ORDER BY pr.updated_at ASC, pr.id ASC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.get_personal_records_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT) IS
'Fetches personal records not in the provided UUID list with cursor pagination. Uses POST body via RPC to bypass URL length limits.';

-- Restore service-role-only grant (parity helper, not a public API).
REVOKE ALL ON FUNCTION public.get_personal_records_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_personal_records_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT)
  TO service_role;
