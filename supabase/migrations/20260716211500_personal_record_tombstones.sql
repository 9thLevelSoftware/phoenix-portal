-- Issue #655: retain personal-record tombstones so deletes converge across devices.
-- Existing rows remain active because deleted_at defaults to NULL.
ALTER TABLE public.personal_records
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- Mobile supplies the authoritative mutation timestamp used by the dedicated
-- UUID LWW protocol. Preserve it when present; direct portal edits that leave
-- updated_at unchanged still receive the normal server timestamp.
CREATE OR REPLACE FUNCTION public.update_personal_record_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.updated_at IS NULL OR NEW.updated_at = OLD.updated_at THEN
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS personal_records_updated_at ON public.personal_records;
CREATE TRIGGER personal_records_updated_at
BEFORE UPDATE ON public.personal_records
FOR EACH ROW EXECUTE FUNCTION public.update_personal_record_updated_at();

-- A parity pull must only treat non-deleted rows as records that are new to
-- the device. Recreate the RPC after adding deleted_at so its row type includes
-- the tombstone column and unseen tombstones cannot be serialized as active.
DROP FUNCTION IF EXISTS public.get_personal_records_excluding_ids(UUID, UUID[], TEXT);
CREATE FUNCTION public.get_personal_records_excluding_ids(
  p_user_id UUID,
  p_known_ids UUID[] DEFAULT '{}',
  p_profile_id TEXT DEFAULT NULL
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
  ORDER BY pr.updated_at ASC, pr.id ASC;
$$;

-- Known-ID tombstones travel through an RPC POST body. This avoids putting up
-- to 10,000 UUIDs into a PostgREST query URL while retaining stable pagination.
CREATE FUNCTION public.get_personal_record_tombstones(
  p_user_id UUID,
  p_known_ids UUID[] DEFAULT '{}',
  p_last_sync_at TIMESTAMPTZ DEFAULT '-infinity',
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
    AND pr.id = ANY(p_known_ids)
    AND pr.deleted_at IS NOT NULL
    AND pr.updated_at > p_last_sync_at
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

-- Both parity helpers are Edge Function internals. Dropping/recreating the
-- existing function resets privileges, so restore the service-role-only grant.
REVOKE ALL ON FUNCTION public.get_personal_records_excluding_ids(UUID, UUID[], TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_personal_records_excluding_ids(UUID, UUID[], TEXT)
  TO service_role;
REVOKE ALL ON FUNCTION public.get_personal_record_tombstones(
  UUID, UUID[], TIMESTAMPTZ, TEXT, TIMESTAMPTZ, UUID, INT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_personal_record_tombstones(
  UUID, UUID[], TIMESTAMPTZ, TEXT, TIMESTAMPTZ, UUID, INT
) TO service_role;
