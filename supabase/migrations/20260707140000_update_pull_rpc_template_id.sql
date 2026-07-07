DROP FUNCTION IF EXISTS get_cycles_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT);
DROP FUNCTION IF EXISTS get_cycles_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT, TIMESTAMPTZ);

CREATE FUNCTION get_cycles_excluding_ids(
    p_user_id UUID,
    p_known_ids UUID[] DEFAULT '{}',
    p_profile_id TEXT DEFAULT NULL,
    p_cursor_updated_at TIMESTAMPTZ DEFAULT NULL,
    p_cursor_id UUID DEFAULT NULL,
    p_limit INT DEFAULT 76,
    p_last_sync_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    name TEXT,
    description TEXT,
    duration_weeks INT,
    workout_days INT,
    rest_days INT,
    current_week INT,
    status TEXT,
    started_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    progression_settings JSONB,
    deload_settings JSONB,
    template_id TEXT,
    updated_at TIMESTAMPTZ,
    local_profile_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        tc.id,
        tc.user_id,
        tc.name,
        tc.description,
        tc.duration_weeks,
        tc.workout_days,
        tc.rest_days,
        tc.current_week,
        tc.status,
        tc.started_at,
        tc.last_used_at,
        tc.progression_settings,
        tc.deload_settings,
        tc.template_id,
        tc.updated_at,
        tc.local_profile_id
    FROM training_cycles tc
    WHERE tc.user_id = p_user_id
      AND (
          array_length(p_known_ids, 1) IS NULL
          OR tc.id != ALL(p_known_ids)
          OR (p_last_sync_at IS NOT NULL AND tc.updated_at > p_last_sync_at)
      )
      AND (
          p_profile_id IS NULL
          OR (p_profile_id = 'default' AND tc.local_profile_id IS NULL)
          OR tc.local_profile_id = p_profile_id
          OR tc.local_profile_id IS NULL
      )
      AND (
          p_cursor_updated_at IS NULL
          OR tc.updated_at > p_cursor_updated_at
          OR (tc.updated_at = p_cursor_updated_at AND tc.id > p_cursor_id)
      )
    ORDER BY tc.updated_at ASC, tc.id ASC
    LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION get_cycles_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT, TIMESTAMPTZ) IS
'Fetches training cycles not in the provided ID list OR updated since last sync. Uses POST body via RPC to bypass URL length limits.';
