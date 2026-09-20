-- Keep routine child cleanup in a POST-body RPC. Serializing every retained
-- exercise UUID into a PostgREST `.not(..., in, ...)` query can exceed proxy
-- URL limits for large routines and turns a deterministic failure into an
-- endlessly retried push.

CREATE OR REPLACE FUNCTION public.cleanup_routine_exercise_orphans(
  p_user_id UUID,
  p_routine_id UUID,
  p_keep_ids UUID[] DEFAULT '{}'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF p_user_id IS NULL OR p_routine_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id and p_routine_id are required'
      USING ERRCODE = '22004';
  END IF;

  DELETE FROM public.routine_exercises AS re
  WHERE re.routine_id = p_routine_id
    AND re.id <> ALL(COALESCE(p_keep_ids, '{}'))
    AND EXISTS (
      SELECT 1
      FROM public.routines AS r
      WHERE r.id = p_routine_id
        AND r.user_id = p_user_id
    );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.cleanup_routine_exercise_orphans(UUID, UUID, UUID[]) IS
  'mobile-sync-push only (service_role). Deletes routine exercise rows absent from the POST-body keep-id array after verifying routine ownership.';

REVOKE ALL ON FUNCTION public.cleanup_routine_exercise_orphans(UUID, UUID, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_routine_exercise_orphans(UUID, UUID, UUID[])
  TO service_role;
